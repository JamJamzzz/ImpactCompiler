// tests/e2e/multi-production-golden-case.test.mjs — item 4/5/12: a
// controlled benchmark combined with TWO deterministically linked
// production Metrics (P95 latency AND timeout rate), verified against the
// ACTUAL final resume statement (not just review.md's separate rendering).
import {
  test, before, after as afterAll,
} from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, writeFileSync, mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeImpact } from '../../src/core/impact-compiler.mjs';
import { ClaudeCliProvider } from '../../src/providers/claude-cli-provider.mjs';

let repoPath;
let outputDir;
let baseSha;
let targetSha;

function git(args) {
  return execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

before(() => {
  repoPath = mkdtempSync(join(tmpdir(), 'impact-compiler-multiprod-repo-'));
  outputDir = mkdtempSync(join(tmpdir(), 'impact-compiler-multiprod-out-'));
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);

  mkdirSync(join(repoPath, 'benchmarks'), { recursive: true });
  writeFileSync(join(repoPath, 'benchmarks', 'matching.mjs'), 'console.log(JSON.stringify({ duration_seconds: 1.82 }));\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'Refactor the customer-matching engine (base)']);
  baseSha = git(['rev-parse', 'HEAD']);

  writeFileSync(join(repoPath, 'benchmarks', 'matching.mjs'), 'console.log(JSON.stringify({ duration_seconds: 0.47 }));\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'Refactor the customer-matching engine (target)']);
  targetSha = git(['rev-parse', 'HEAD']);
});

afterAll(() => {
  rmSync(repoPath, { recursive: true, force: true });
  rmSync(outputDir, { recursive: true, force: true });
});

test('combined Claim actually contains benchmark + BOTH production outcomes in its final resume statement, with correct traceability', async () => {
  const planPath = join(outputDir, 'plan.json');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    benchmark_id: 'customer-matching-v1',
    repo: repoPath,
    base_ref: baseSha,
    target_ref: targetSha,
    command: { executable: process.execPath, args: ['benchmarks/matching.mjs'], cwd: '.' },
    result: {
      mode: 'stdout_json', json_path: 'duration_seconds', name: 'customer matching runtime', unit: 'sec', direction: 'lower_is_better', operation: 'percentage_reduction', primary_statistic: 'median',
    },
    warmup_runs: 1,
    measurement_runs: 30,
    timeout_ms: 30000,
    scope: { dataset_name: 'synthetic-customers-v3', records: 1000000 },
    link: { service: 'customer-matching' },
  }));

  const p95Path = join(outputDir, 'p95.json');
  writeFileSync(p95Path, JSON.stringify({
    name: 'P95 latency', before: 100, after: 39, unit: 'ms', direction: 'lower_is_better', environment: 'production', service: 'customer-matching', window: { before: '2026-01-01', after: '2026-01-15' },
  }));
  const timeoutPath = join(outputDir, 'timeout.json');
  writeFileSync(timeoutPath, JSON.stringify({
    name: 'timeout rate', before: 2.1, after: 0.6, unit: 'percent', direction: 'lower_is_better', environment: 'production', service: 'customer-matching', window: { before: '2026-01-01', after: '2026-01-15' },
  }));

  const dryRun = await analyzeImpact({ measurementPlanPaths: [planPath], productionMetricPaths: [p95Path, timeoutPath], provider: null });
  assert.equal(dryRun.impact_candidates.length, 1, 'benchmark + both production metrics combine into one candidate');
  const combined = dryRun.impact_candidates[0];
  assert.equal(combined.production_summary.metrics.length, 2);
  assert.equal(combined.production_summary.window.days, 14);

  const factNames = combined.allowed_numeric_facts.map((f) => f.name);
  const p95Fact = factNames.some((n) => /p95/i.test(n) && /result/.test(n));
  const timeoutBeforeFact = factNames.some((n) => /timeout/i.test(n) && /before/.test(n));
  const timeoutAfterFact = factNames.some((n) => /timeout/i.test(n) && /after/.test(n));
  assert.ok(p95Fact && timeoutBeforeFact && timeoutAfterFact, `both production metrics contribute independent allowed numeric facts; got: ${JSON.stringify(factNames)}`);

  const provider = new ClaudeCliProvider({
    invoke: () => ({
      rawStdout: JSON.stringify({
        claims: [{
          candidate_id: combined.id,
          title: 'Refactored the customer-matching engine',
          problem: 'Customer matching was slow and occasionally timed out at scale.',
          change: 'Replaced the matching logic with a hash-based lookup.',
          outcome: 'Matching got faster in controlled benchmarks and production latency/timeouts improved over the following weeks.',
          resume_variants: {
            standard: 'Refactored the customer-matching engine, reducing batch-processing time across a one-million-record dataset from 1.82s to 0.47s (74.18%); over the following 14 days, production P95 latency decreased by 61% and timeout rate fell from 2.1% to 0.6%.',
            technical: 'Refactored the customer-matching engine and, across 30 controlled runs on a one-million-record dataset, reduced median processing time from 1.82s to 0.47s, a 74.18% reduction; over the following 14 days, production P95 latency fell from 100ms to 39ms (61%) and timeout rate fell from 2.1% to 0.6%.',
          },
          limitations: [],
        }],
        uncertainties: [],
        limitations: [],
      }),
      executablePath: '/mock/claude',
    }),
  });

  const artifact = await analyzeImpact({ measurementPlanPaths: [planPath], productionMetricPaths: [p95Path, timeoutPath], provider });
  const claim = artifact.claims[0];

  // ---- assert against the ACTUAL final resume statement, not just review.md ----
  assert.match(claim.statement, /Refactored the customer-matching engine/);
  assert.match(claim.statement, /one-million-record/);
  assert.match(claim.statement, /1\.82s/);
  assert.match(claim.statement, /0\.47s/);
  assert.match(claim.statement, /74\.18%/);
  assert.match(claim.statement, /14 days/);
  assert.match(claim.statement, /61%/);
  assert.match(claim.statement, /2\.1%/);
  assert.match(claim.statement, /0\.6%/);
  assert.doesNotMatch(claim.statement, /\b99\b/, 'no unsupported number leaked into the final statement');

  assert.match(claim.resume_variants.technical, /100ms/);
  assert.match(claim.resume_variants.technical, /39ms/);

  // ---- correct Candidate/Metric/Evidence IDs preserved ----
  assert.equal(claim.candidate_id, combined.id);
  assert.deepEqual(new Set(claim.metric_ids), new Set(combined.metric_ids));
  assert.deepEqual(new Set(claim.evidence_ids), new Set(combined.evidence_ids));
  assert.equal(claim.scope.records, 1000000);
  assert.equal(claim.attribution.strength, 'strong');
});
