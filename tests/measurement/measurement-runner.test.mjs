import {
  test, before, after as afterAll,
} from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMeasurementPlan } from '../../src/measurement/measurement-runner.mjs';
import { validateMeasurementPlan } from '../../src/measurement/measurement-plan.mjs';

let repoPath;
let baseSha;
let targetSha;

function git(args) {
  return execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function writeBenchmarkScript(value) {
  writeFileSync(
    join(repoPath, 'benchmark.mjs'),
    `console.log(JSON.stringify({ duration_seconds: ${value} }));\n`,
  );
}

before(() => {
  repoPath = mkdtempSync(join(tmpdir(), 'impact-compiler-runner-repo-'));
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);

  writeBenchmarkScript(1.82);
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base: slow matching']);
  baseSha = git(['rev-parse', 'HEAD']);

  writeBenchmarkScript(0.47);
  git(['add', '.']);
  git(['commit', '-q', '-m', 'target: fast matching']);
  targetSha = git(['rev-parse', 'HEAD']);
});

afterAll(() => {
  rmSync(repoPath, { recursive: true, force: true });
});

function basePlanConfig(overrides = {}) {
  const { ok, plan } = validateMeasurementPlan({
    version: 1,
    benchmark_id: 'test-matching',
    repo: repoPath,
    base_ref: baseSha,
    target_ref: targetSha,
    command: { executable: process.execPath, args: ['benchmark.mjs'], cwd: '.' },
    result: {
      mode: 'stdout_json', json_path: 'duration_seconds', name: 'matching runtime', unit: 'sec', direction: 'lower_is_better', operation: 'percentage_reduction', primary_statistic: 'median',
    },
    warmup_runs: 1,
    measurement_runs: 4,
    timeout_ms: 10000,
    scope: { dataset_name: 'unit-test', records: 100 },
    ...overrides,
  });
  assert.equal(ok, true);
  return plan;
}

test('runs both base and target commits, collecting raw samples from each', async () => {
  const plan = basePlanConfig();
  const result = await runMeasurementPlan(plan);

  assert.equal(result.resolved, true, result.reason);
  assert.equal(result.raw_samples.before.length, 4);
  assert.equal(result.raw_samples.after.length, 4);
  assert.ok(result.raw_samples.before.every((v) => v === 1.82));
  assert.ok(result.raw_samples.after.every((v) => v === 0.47));
});

test('resolves base_ref/target_ref to full 40-char commit SHAs', async () => {
  const plan = basePlanConfig();
  const result = await runMeasurementPlan(plan);
  assert.equal(result.base_commit, baseSha);
  assert.equal(result.target_commit, targetSha);
  assert.match(result.base_commit, /^[0-9a-f]{40}$/);
  assert.match(result.target_commit, /^[0-9a-f]{40}$/);
});

test('median before/after and scope are correctly reflected in statistics', async () => {
  const plan = basePlanConfig();
  const result = await runMeasurementPlan(plan);
  assert.equal(result.statistics.before.median, 1.82);
  assert.equal(result.statistics.after.median, 0.47);
});

test('an unresolvable ref never produces fabricated samples — evidence marked unresolved with an exact reason', async () => {
  const plan = basePlanConfig({ target_ref: 'not-a-real-ref-abcdef' });
  const result = await runMeasurementPlan(plan);
  assert.equal(result.resolved, false);
  assert.match(result.reason, /could not resolve/);
  assert.equal(result.raw_samples.before.length, 0);
  assert.equal(result.raw_samples.after.length, 0);
});

test('does not modify the caller\'s current working tree/branch', async () => {
  const branchBefore = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const statusBefore = git(['status', '--porcelain']);
  const plan = basePlanConfig();
  await runMeasurementPlan(plan);
  assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD']), branchBefore);
  assert.equal(git(['status', '--porcelain']), statusBefore);
});

test('cleans up temporary worktrees after a run (no leftover linked worktrees)', async () => {
  const plan = basePlanConfig();
  await runMeasurementPlan(plan);
  const worktreeList = git(['worktree', 'list']);
  // Only the main worktree should remain listed.
  assert.equal(worktreeList.split('\n').length, 1);
});

test('a benchmark that always fails on one side produces execution failures, never a fabricated metric-worthy result', async () => {
  const plan = basePlanConfig({
    command: { executable: process.execPath, args: ['-e', 'process.exit(1)'], cwd: '.' },
  });
  const result = await runMeasurementPlan(plan);
  assert.equal(result.resolved, false);
  assert.ok(result.execution_failures.length > 0);
  assert.match(result.reason, /execution failures/);
});

test('a command that times out is reported as a failure, not a hang or a fabricated sample', async () => {
  const plan = basePlanConfig({
    command: { executable: process.execPath, args: ['-e', 'setTimeout(() => {}, 60000)'], cwd: '.' },
    timeout_ms: 300,
    warmup_runs: 0,
    measurement_runs: 1,
  });
  const result = await runMeasurementPlan(plan);
  assert.equal(result.resolved, false);
  assert.ok(result.execution_failures.some((f) => /timed out/.test(f)));
}, { timeout: 15000 });

test('an invalid setup_command aborts the run and is recorded honestly, worktrees still cleaned up', async () => {
  const plan = basePlanConfig({
    setup_command: { executable: process.execPath, args: ['-e', 'process.exit(7)'], cwd: '.' },
  });
  const result = await runMeasurementPlan(plan);
  assert.equal(result.resolved, false);
  assert.match(result.reason, /setup_command failed/);
  const worktreeList = git(['worktree', 'list']);
  assert.equal(worktreeList.split('\n').length, 1);
});
