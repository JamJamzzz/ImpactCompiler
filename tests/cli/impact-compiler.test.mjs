// tests/cli/impact-compiler.test.mjs — exercises the actual CLI entrypoint
// (not just analyzeImpact()) with --measurement-plan --provider off, so the
// full "Definition of Done" #1/#7 requirement (CLI can compare two commits
// and produce complete quantitative output with the provider disabled) is
// covered end-to-end, not just at the library level.
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

let repoPath;
let outputDir;
let planPath;

function git(args) {
  return execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

before(() => {
  repoPath = mkdtempSync(join(tmpdir(), 'impact-compiler-cli-repo-'));
  outputDir = mkdtempSync(join(tmpdir(), 'impact-compiler-cli-out-'));
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);

  mkdirSync(join(repoPath, 'bench'), { recursive: true });
  writeFileSync(join(repoPath, 'bench', 'run.mjs'), 'console.log(JSON.stringify({ duration_seconds: 2.0 }));\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
  const baseSha = git(['rev-parse', 'HEAD']);

  writeFileSync(join(repoPath, 'bench', 'run.mjs'), 'console.log(JSON.stringify({ duration_seconds: 1.0 }));\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'target']);
  const targetSha = git(['rev-parse', 'HEAD']);

  planPath = join(repoPath, 'plan.json');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    benchmark_id: 'cli-test',
    repo: repoPath,
    base_ref: baseSha,
    target_ref: targetSha,
    command: { executable: process.execPath, args: ['bench/run.mjs'], cwd: '.' },
    result: {
      mode: 'stdout_json', json_path: 'duration_seconds', name: 'cli test runtime', unit: 'sec', direction: 'lower_is_better', operation: 'percentage_reduction', primary_statistic: 'median',
    },
    warmup_runs: 0,
    measurement_runs: 3,
    timeout_ms: 10000,
    scope: { dataset_name: 'cli-fixture', records: 42 },
  }));
});

afterAll(() => {
  rmSync(repoPath, { recursive: true, force: true });
  rmSync(outputDir, { recursive: true, force: true });
});

test('CLI: --measurement-plan --provider off writes impact.json/review.md with no fabricated claim, exit code 2 (pending_llm)', () => {
  const cliPath = join(process.cwd(), 'src', 'cli', 'impact-compiler.mjs');
  let stdout = '';
  let exitCode = 0;
  try {
    stdout = execFileSync(process.execPath, [
      cliPath, 'analyze', '--measurement-plan', planPath, '--output', outputDir, '--provider', 'off', '--json',
    ], { encoding: 'utf-8' });
  } catch (err) {
    stdout = err.stdout;
    exitCode = err.status;
  }
  assert.equal(exitCode, 2, 'pending_llm (no provider) is a partial-success exit code, not an error');

  const parsed = JSON.parse(stdout);
  assert.equal(parsed.status, 'pending_llm');

  const impactJson = JSON.parse(readFileSync(join(outputDir, 'impact.json'), 'utf-8'));
  assert.equal(impactJson.claims.length, 0);
  const metric = impactJson.metrics.find((m) => m.name === 'cli test runtime');
  assert.ok(metric);
  assert.equal(metric.before, 2.0);
  assert.equal(metric.after, 1.0);
  assert.equal(metric.relative_change_percent, 50);

  const review = readFileSync(join(outputDir, 'review.md'), 'utf-8');
  assert.match(review, /cli test runtime/);
  assert.match(review, /attribution: strong/);
});

test('CLI: --quantitative-fact and --derivation produce a Derived Metric end to end', () => {
  const factPath = join(outputDir, 'fact.json');
  writeFileSync(factPath, JSON.stringify({
    fact_id: 'fact_cli_runs', name: 'cli runs per week', value: 10, unit: 'runs/week', verification_status: 'verified', related_benchmark_id: 'cli-test',
  }));
  const derivationPath = join(outputDir, 'derivation.json');
  writeFileSync(derivationPath, JSON.stringify({
    derivation_id: 'cli-total-time-saved',
    formula_id: 'total_time_saved',
    inputs: {
      duration_metric: { benchmark_id: 'cli-test' },
      event_count_fact_id: 'fact_cli_runs',
    },
    output: { name: 'cli total time saved' },
  }));

  const cliPath = join(process.cwd(), 'src', 'cli', 'impact-compiler.mjs');
  let stdout = '';
  let exitCode = 0;
  try {
    stdout = execFileSync(process.execPath, [
      cliPath, 'analyze', '--measurement-plan', planPath, '--quantitative-fact', factPath, '--derivation', derivationPath, '--output', outputDir, '--provider', 'off', '--json',
    ], { encoding: 'utf-8' });
  } catch (err) {
    stdout = err.stdout;
    exitCode = err.status;
  }
  assert.equal(exitCode, 2);
  JSON.parse(stdout);

  const impactJson = JSON.parse(readFileSync(join(outputDir, 'impact.json'), 'utf-8'));
  const derived = impactJson.metrics.find((m) => m.name === 'cli total time saved');
  assert.ok(derived, 'expected the derived Metric in impact.json');
  assert.equal(derived.value, 1.0 * 10); // 1 sec saved/run * 10 runs
  assert.equal(derived.quantification_type, 'derived');
  assert.ok(impactJson.evidence.some((e) => e.type === 'quantitative_fact' && e.fact_id === 'fact_cli_runs'));
});
