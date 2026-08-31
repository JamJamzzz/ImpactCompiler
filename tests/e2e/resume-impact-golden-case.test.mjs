// tests/e2e/resume-impact-golden-case.test.mjs — Resume-Impact phase golden
// cases, built on top of the already-complete Quantification V1 controlled
// benchmark (see tests/e2e/v5-golden-case.test.mjs): target implementation
// is the customer-matching engine refactor, scope 1,000,000 records, before
// median 1.82s, after median 0.47s, 30 runs/side, 74.18% reduction, high
// measurement quality, strong attribution.
import {
  test, before, after as afterAll,
} from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeImpact, writeImpactArtifact } from '../../src/core/impact-compiler.mjs';
import { ClaudeCliProvider } from '../../src/providers/claude-cli-provider.mjs';

let repoPath;
let outputDir;
let baseSha;
let targetSha;

function git(args) {
  return execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

before(() => {
  repoPath = mkdtempSync(join(tmpdir(), 'impact-compiler-resume-repo-'));
  outputDir = mkdtempSync(join(tmpdir(), 'impact-compiler-resume-out-'));
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

function writePlan(overrides = {}) {
  const plan = {
    version: 1,
    benchmark_id: 'customer-matching-v1',
    repo: repoPath,
    base_ref: baseSha,
    target_ref: targetSha,
    command: { executable: process.execPath, args: ['benchmarks/matching.mjs'], cwd: '.' },
    result: {
      mode: 'stdout_json', json_path: 'duration_seconds', name: 'customer matching runtime', unit: 'sec', direction: 'lower_is_better', operation: 'percentage_reduction', primary_statistic: 'median',
    },
    warmup_runs: 2,
    measurement_runs: 30,
    timeout_ms: 30000,
    scope: { dataset_name: 'synthetic-customers-v3', records: 1000000 },
    ...overrides,
  };
  const path = join(outputDir, `plan-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify(plan, null, 2));
  return path;
}

function resumeProviderFor(candidateId) {
  return new ClaudeCliProvider({
    invoke: () => ({
      rawStdout: JSON.stringify({
        claims: [{
          candidate_id: candidateId,
          title: 'Refactored the customer-matching engine',
          problem: 'Customer matching was too slow at scale.',
          change: 'Replaced the matching logic with a hash-based lookup.',
          outcome: 'Matching runtime dropped substantially in controlled benchmarks.',
          resume_variants: {
            short: 'Optimized the customer-matching engine, reducing processing time by 74.18% across a one-million-record dataset.',
            standard: 'Refactored the customer-matching engine, reducing processing time across a one-million-record dataset from 1.82s to 0.47s, a 74.18% reduction.',
            technical: 'Refactored the customer-matching engine and, across 30 controlled runs on a one-million-record dataset, reduced median processing time from 1.82s to 0.47s, a 74.18% reduction.',
          },
          limitations: [],
        }],
        uncertainties: [],
        limitations: [],
      }),
      executablePath: '/mock/claude',
    }),
  });
}

test('golden case: standard resume claim states the completed action, system, one-million-record scope, 1.82s->0.47s, exact 74.18% reduction, full traceability', async () => {
  const planPath = writePlan();

  // First pass with provider:null to discover the deterministic candidate id.
  // Also supply the target commit as git_commit evidence so the
  // controlled_benchmark deterministically links to an implementation
  // record (evidence-linker.mjs) — without it, evidence_strength can only
  // reach 'medium' (measurement evidence alone), capping eligibility at
  // 'qualified' per quality-profile.mjs's documented rules.
  const dryRun = await analyzeImpact({ commits: [{ repo: repoPath, sha: targetSha }], measurementPlanPaths: [planPath], provider: null });
  assert.equal(dryRun.impact_candidates.length, 1);
  const candidate = dryRun.impact_candidates[0];
  assert.equal(candidate.quality_profile.resume_eligibility, 'strong');

  const artifact = await analyzeImpact({ commits: [{ repo: repoPath, sha: targetSha }], measurementPlanPaths: [planPath], provider: resumeProviderFor(candidate.id) });
  assert.equal(artifact.run.analysis_status, 'analyzed');
  const claim = artifact.claims[0];

  assert.match(claim.statement, /Refactored the customer-matching engine/);
  assert.match(claim.statement, /one-million-record/);
  assert.match(claim.statement, /1\.82s/);
  assert.match(claim.statement, /0\.47s/);
  assert.match(claim.statement, /74\.18%/);

  assert.match(claim.resume_variants.technical, /median/);
  assert.match(claim.resume_variants.technical, /30 controlled runs/);
  assert.match(claim.resume_variants.technical, /74\.18%/);

  // ---- full traceability: Claim -> candidate -> Metric -> Evidence ----
  const metric = artifact.metrics.find((m) => m.id === claim.metric_ids[0]);
  assert.ok(metric);
  assert.equal(metric.before, 1.82);
  assert.equal(metric.after, 0.47);
  const ev = artifact.evidence.find((e) => e.id === claim.evidence_ids.find((id) => id === e.id) && e.type === 'controlled_benchmark');
  assert.ok(ev);
  assert.equal(ev.base_commit, baseSha);
  assert.equal(ev.target_commit, targetSha);

  const { reviewMdPath } = writeImpactArtifact(artifact, outputDir);
  const review = readFileSync(reviewMdPath, 'utf-8');
  assert.match(review, /74\.18%/);
  assert.match(review, /30 controlled runs/);
  assert.match(review, /resume_eligibility=strong/);
});

test('golden case: benchmark + linked production evidence produces a combined Claim with production outcomes, only because the link resolved', async () => {
  const planPath = writePlan({ link: { service: 'customer-matching' } });
  const prodPath = join(outputDir, 'prod-metric.json');
  writeFileSync(prodPath, JSON.stringify({
    name: 'p95 latency',
    before: 100,
    after: 39,
    unit: 'ms',
    direction: 'lower_is_better',
    environment: 'production',
    service: 'customer-matching',
    window: { before: '2026-01-01', after: '2026-01-15' },
    verification_status: 'verified',
  }));

  const dryRun = await analyzeImpact({ measurementPlanPaths: [planPath], productionMetricPaths: [prodPath], provider: null });
  assert.equal(dryRun.impact_candidates.length, 1, 'the benchmark and production candidates were combined into one');
  const combined = dryRun.impact_candidates[0];
  assert.ok(combined.combined_from, 'combination only happens via a deterministic link');
  assert.ok(combined.production_summary);
  assert.equal(combined.production_summary.window.days, 14);
  assert.equal(combined.production_summary.metrics[0].result_value, 61);

  const artifact = await analyzeImpact({ measurementPlanPaths: [planPath], productionMetricPaths: [prodPath], provider: resumeProviderFor(combined.id) });
  const claim = artifact.claims[0];
  assert.ok(claim.production_summary);
  assert.equal(claim.production_summary.metrics[0].result_value, 61);

  const { reviewMdPath } = writeImpactArtifact(artifact, outputDir);
  const review = readFileSync(reviewMdPath, 'utf-8');
  assert.match(review, /Production metric — p95 latency: 100 -> 39 ms \(61%\)/);
  assert.match(review, /14 days/);
});

test('no production link means no combined production statement — two unrelated candidates stay separate', async () => {
  const planPath = writePlan(); // no link.service declared
  const prodPath = join(outputDir, 'prod-metric-unlinked.json');
  writeFileSync(prodPath, JSON.stringify({
    name: 'p95 latency', before: 100, after: 39, unit: 'ms', direction: 'lower_is_better', environment: 'production', service: 'unrelated-service',
  }));
  const artifact = await analyzeImpact({ measurementPlanPaths: [planPath], productionMetricPaths: [prodPath], provider: null });
  assert.ok(!artifact.impact_candidates.some((c) => c.combined_from), 'no candidate was combined without a deterministic link');
});

test('missing scope is omitted from the candidate, never invented', async () => {
  const planPath = writePlan({ scope: {} });
  const artifact = await analyzeImpact({ measurementPlanPaths: [planPath], provider: null });
  const candidate = artifact.impact_candidates[0];
  assert.equal(candidate.scope, null);
  assert.equal(candidate.impact_level, 'L1', 'no explicit scale means no L2 promotion');
});

test('an unresolved (failed) benchmark produces no candidate and no quantified Claim', async () => {
  const planPath = writePlan({ target_ref: 'not-a-real-ref' });
  const artifact = await analyzeImpact({ measurementPlanPaths: [planPath], provider: null });
  assert.equal(artifact.metrics.length, 0);
  assert.equal(artifact.impact_candidates.length, 0);
});

test('a regression never produces a positive resume Claim — resume_eligibility is ineligible', async () => {
  // base prints the FASTER value, target prints the SLOWER value: a real
  // regression. Content is marked with a unique comment per commit so git
  // always sees a real diff, even where the printed number coincidentally
  // matches an earlier commit's.
  writeFileSync(join(repoPath, 'benchmarks', 'matching.mjs'), 'console.log(JSON.stringify({ duration_seconds: 0.47 })); // regression-base\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'accidental regression: base']);
  const regressionBase = git(['rev-parse', 'HEAD']);
  writeFileSync(join(repoPath, 'benchmarks', 'matching.mjs'), 'console.log(JSON.stringify({ duration_seconds: 1.82 })); // regression-target\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'accidental regression: target']);
  const regressionTarget = git(['rev-parse', 'HEAD']);

  const planPath = writePlan({
    base_ref: regressionBase, target_ref: regressionTarget, warmup_runs: 0, measurement_runs: 5,
  });
  const artifact = await analyzeImpact({ measurementPlanPaths: [planPath], provider: null });
  const metric = artifact.metrics[0];
  assert.equal(metric.result.outcome, 'regression');
  const candidate = artifact.impact_candidates.find((c) => c.metric_ids.includes(metric.id));
  assert.equal(candidate.quality_profile.resume_eligibility, 'ineligible');
});

test('provider-off mode preserves Candidates, Evidence, and Metrics without fabricating a Claim', async () => {
  const planPath = writePlan();
  const artifact = await analyzeImpact({ measurementPlanPaths: [planPath], provider: null });
  assert.equal(artifact.run.analysis_status, 'pending_llm');
  assert.equal(artifact.claims.length, 0);
  assert.equal(artifact.impact_candidates.length, 1);
  assert.equal(artifact.metrics.length, 1);
  assert.equal(artifact.evidence.some((e) => e.type === 'controlled_benchmark'), true);

  const { impactJsonPath, reviewMdPath } = writeImpactArtifact(artifact, outputDir);
  const writtenJson = JSON.parse(readFileSync(impactJsonPath, 'utf-8'));
  assert.equal(writtenJson.impact_candidates.length, 1);
  const review = readFileSync(reviewMdPath, 'utf-8');
  assert.match(review, /Impact Candidates/);
});
