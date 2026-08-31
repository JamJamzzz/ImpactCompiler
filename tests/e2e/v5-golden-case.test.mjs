// tests/e2e/v5-golden-case.test.mjs — Quantification V1 end-to-end golden
// case: a measurement plan comparing a real base/target commit pair, whose
// fixed (non-wall-clock) benchmark script prints 1.82s on base and 0.47s on
// target, run 30 times each. Asserts the full chain: analyzeImpact ->
// writeImpactArtifact -> impact.json/review.md, with no LLM provider
// involved (--provider off equivalent), so nothing here can be a fabricated
// Claim — only deterministically-computed Evidence/Metrics.
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

let repoPath;
let outputDir;
let planPath;
let baseSha;
let targetSha;

function git(args) {
  return execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

before(() => {
  repoPath = mkdtempSync(join(tmpdir(), 'impact-compiler-v5-repo-'));
  outputDir = mkdtempSync(join(tmpdir(), 'impact-compiler-v5-out-'));
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);

  mkdirSync(join(repoPath, 'benchmarks'), { recursive: true });
  writeFileSync(join(repoPath, 'benchmarks', 'matching.mjs'), 'console.log(JSON.stringify({ duration_seconds: 1.82 }));\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'replace O(n^2) matching logic with a hash-based lookup (base: before)']);
  baseSha = git(['rev-parse', 'HEAD']);

  writeFileSync(join(repoPath, 'benchmarks', 'matching.mjs'), 'console.log(JSON.stringify({ duration_seconds: 0.47 }));\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'hash-based matching lookup (target: after)']);
  targetSha = git(['rev-parse', 'HEAD']);

  const plan = {
    version: 1,
    benchmark_id: 'customer-matching-v1',
    repo: repoPath,
    base_ref: baseSha,
    target_ref: targetSha,
    command: { executable: process.execPath, args: ['benchmarks/matching.mjs'], cwd: '.' },
    result: {
      mode: 'stdout_json',
      json_path: 'duration_seconds',
      name: 'customer matching runtime',
      unit: 'sec',
      direction: 'lower_is_better',
      operation: 'percentage_reduction',
      primary_statistic: 'median',
    },
    warmup_runs: 2,
    measurement_runs: 30,
    timeout_ms: 30000,
    scope: { dataset_name: 'synthetic-customers-v3', records: 1000000 },
  };
  planPath = join(repoPath, 'measurement-plan.json');
  writeFileSync(planPath, JSON.stringify(plan, null, 2));
});

afterAll(() => {
  rmSync(repoPath, { recursive: true, force: true });
  rmSync(outputDir, { recursive: true, force: true });
});

test('golden case end-to-end: 1.82s -> 0.47s across 30 controlled runs, 74.18% reduction, no fabricated claim', async () => {
  const artifact = await analyzeImpact({
    measurementPlanPaths: [planPath],
    provider: null,
  });

  assert.equal(artifact.run.analysis_status, 'pending_llm');
  assert.equal(artifact.claims.length, 0, 'no LLM provider ran — claims must stay empty, never fabricated');

  const ev = artifact.evidence.find((e) => e.type === 'controlled_benchmark');
  assert.ok(ev, 'expected a controlled_benchmark evidence record');
  assert.equal(ev.resolution, 'resolved');
  assert.equal(ev.base_commit, baseSha);
  assert.equal(ev.target_commit, targetSha);
  assert.match(ev.base_commit, /^[0-9a-f]{40}$/);
  assert.match(ev.target_commit, /^[0-9a-f]{40}$/);
  assert.equal(ev.raw_samples.before.length, 30);
  assert.equal(ev.raw_samples.after.length, 30);
  assert.ok(ev.raw_samples.before.every((v) => v === 1.82));
  assert.ok(ev.raw_samples.after.every((v) => v === 0.47));
  assert.equal(ev.scope.records, 1000000);
  assert.equal(ev.scope.dataset_name, 'synthetic-customers-v3');
  assert.equal(ev.measurement_quality, 'high');
  assert.equal(ev.attribution.strength, 'strong');
  assert.equal(ev.primary_statistic, 'median');

  const metric = artifact.metrics.find((m) => m.name === 'customer matching runtime');
  assert.ok(metric, 'expected a computed Metric from the measurement plan');
  assert.equal(metric.before, 1.82);
  assert.equal(metric.after, 0.47);
  assert.equal(metric.relative_change_percent, 74.18);
  assert.equal(metric.result.outcome, 'improvement');
  assert.equal(metric.result.value, 74.18);
  assert.equal(metric.confidence, 'high');

  const { impactJsonPath, reviewMdPath } = writeImpactArtifact(artifact, outputDir);
  const writtenJson = JSON.parse(readFileSync(impactJsonPath, 'utf-8'));
  const writtenReview = readFileSync(reviewMdPath, 'utf-8');

  const writtenMetric = writtenJson.metrics.find((m) => m.name === 'customer matching runtime');
  assert.equal(writtenMetric.relative_change_percent, 74.18);
  assert.equal(writtenJson.claims.length, 0);

  // review.md must render the benchmark name, scope, commits, before/after,
  // relative change, sample count, primary statistic, measurement quality,
  // and attribution strength — all read from impact.json, never recomputed.
  assert.match(writtenReview, /customer matching runtime/);
  assert.match(writtenReview, /1\.82 -> 0\.47/);
  assert.match(writtenReview, /74\.18/);
  assert.match(writtenReview, new RegExp(baseSha));
  assert.match(writtenReview, new RegExp(targetSha));
  assert.match(writtenReview, /synthetic-customers-v3/);
  assert.match(writtenReview, /1000000/);
  assert.match(writtenReview, /before 30, after 30/);
  assert.match(writtenReview, /primary statistic: median/);
  assert.match(writtenReview, /measurement quality: high/);
  assert.match(writtenReview, /attribution: strong/);
});
