// tests/e2e/post-combination-ranking.test.mjs — hardening pass item 1: final
// ranking must use POST-combination quality profiles, not the profile a
// candidate carried before combining with linked production Evidence.
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

let repoPath;
let outputDir;
let baseSha;
let targetSha;

function git(args) {
  return execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

before(() => {
  repoPath = mkdtempSync(join(tmpdir(), 'impact-compiler-postcomb-repo-'));
  outputDir = mkdtempSync(join(tmpdir(), 'impact-compiler-postcomb-out-'));
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);

  mkdirSync(join(repoPath, 'bench'), { recursive: true });
  writeFileSync(join(repoPath, 'bench', 'run.mjs'), 'console.log(JSON.stringify({ duration_seconds: 2.0 }));\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
  baseSha = git(['rev-parse', 'HEAD']);

  writeFileSync(join(repoPath, 'bench', 'run.mjs'), 'console.log(JSON.stringify({ duration_seconds: 1.0 }));\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'target']);
  targetSha = git(['rev-parse', 'HEAD']);
});

afterAll(() => {
  rmSync(repoPath, { recursive: true, force: true });
  rmSync(outputDir, { recursive: true, force: true });
});

function writePlan(benchmarkId, overrides = {}) {
  const plan = {
    version: 1,
    benchmark_id: benchmarkId,
    repo: repoPath,
    base_ref: baseSha,
    target_ref: targetSha,
    command: { executable: process.execPath, args: ['bench/run.mjs'], cwd: '.' },
    result: {
      mode: 'stdout_json', json_path: 'duration_seconds', name: `${benchmarkId} runtime`, unit: 'sec', direction: 'lower_is_better', operation: 'percentage_reduction', primary_statistic: 'median',
    },
    warmup_runs: 0,
    measurement_runs: 3,
    timeout_ms: 10000,
    scope: {},
    ...overrides,
  };
  const path = join(outputDir, `plan-${benchmarkId}.json`);
  writeFileSync(path, JSON.stringify(plan, null, 2));
  return path;
}

test('a lower-ranked pre-combination benchmark candidate becomes strongest after gaining production corroboration, multiple production Metrics, and a complete observation window', async () => {
  const planAPath = writePlan('service-a');
  const planBPath = writePlan('service-b');

  // ---- baseline: two equivalent, unlinked benchmark candidates ----
  const baseline = await analyzeImpact({ measurementPlanPaths: [planAPath, planBPath], provider: null });
  assert.equal(baseline.impact_candidates.length, 2);
  assert.ok(!baseline.impact_candidates.some((c) => c.combined_from), 'no production evidence yet, nothing combined');

  // Whichever candidate sorts SECOND pre-combination (an arbitrary but
  // deterministic tiebreak between two otherwise-identical candidates) is
  // the one we'll strengthen with production evidence.
  const loser = baseline.impact_candidates[1];
  const loserBenchmarkId = loser.measurement_evidence_ids
    .map((id) => baseline.evidence.find((e) => e.id === id))
    .find((e) => e?.type === 'controlled_benchmark').benchmark_id;
  const otherBenchmarkId = loserBenchmarkId === 'service-a' ? 'service-b' : 'service-a';
  const otherPlanPath = otherBenchmarkId === 'service-a' ? planAPath : planBPath;

  // ---- give the pre-combination loser two linked production Metrics with
  // a complete, agreeing observation window ----
  const loserPlanWithLink = writePlan(loserBenchmarkId, { link: { service: loserBenchmarkId } });
  const p95Path = join(outputDir, `${loserBenchmarkId}-p95.json`);
  writeFileSync(p95Path, JSON.stringify({
    name: 'P95 latency', before: 100, after: 39, unit: 'ms', direction: 'lower_is_better', environment: 'production', service: loserBenchmarkId, window: { before: '2026-01-01', after: '2026-01-15' },
  }));
  const timeoutPath = join(outputDir, `${loserBenchmarkId}-timeout.json`);
  writeFileSync(timeoutPath, JSON.stringify({
    name: 'timeout rate', before: 2.1, after: 0.6, unit: 'percent', direction: 'lower_is_better', environment: 'production', service: loserBenchmarkId, window: { before: '2026-01-01', after: '2026-01-15' },
  }));

  const enhanced = await analyzeImpact({ measurementPlanPaths: [loserPlanWithLink, otherPlanPath], productionMetricPaths: [p95Path, timeoutPath], provider: null });

  const combinedCandidate = enhanced.impact_candidates.find((c) => c.combined_from);
  assert.ok(combinedCandidate, 'the enhanced benchmark combined with its production evidence');
  assert.equal(combinedCandidate.quality_profile.production_corroboration, true);
  assert.equal(combinedCandidate.production_summary.metrics.length, 2);
  assert.equal(combinedCandidate.production_summary.window.days, 14);

  // ---- the enhanced candidate must now rank FIRST — using its POST-
  // combination profile, not the one it had before combining ----
  assert.equal(enhanced.impact_candidates[0].id, combinedCandidate.id, 'the combined candidate ranks first after re-ranking with its post-combination profile');
});
