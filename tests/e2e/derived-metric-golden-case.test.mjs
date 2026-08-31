// tests/e2e/derived-metric-golden-case.test.mjs — Resume-Impact phase item
// 3/12: a Derived Metric produced through the REAL pipeline (analyzeImpact,
// not the formula-registry/derivation-request modules directly).
//
// Benchmark: 30 minutes -> 5 minutes per run (a controlled_benchmark).
// Fact: 12 runs/week (explicit, verified).
// Explicit convention: 52 weeks/year (typed directly into the derivation
// request, not inferred).
// Derived result: 25 minutes saved/run, 15,600 minutes/year.
//
// NOTE ON UNITS: the first test below deliberately does NOT request an
// output unit, so it verifies the annual result stays in the SAME unit the
// inputs were supplied in (minutes/year) — no IMPLICIT conversion is ever
// performed. The second test (added in the correctness-hardening pass)
// explicitly REQUESTS "hours/year" via the derivation request's
// `output.unit`, exercising the whitelisted, explicit unit-conversion
// registry (src/derived/unit-conversion.mjs) end to end through the real
// CLI — an explicit conversion is not the same thing as an implicit one.
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
  repoPath = mkdtempSync(join(tmpdir(), 'impact-compiler-derived-repo-'));
  outputDir = mkdtempSync(join(tmpdir(), 'impact-compiler-derived-out-'));
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);

  mkdirSync(join(repoPath, 'bench'), { recursive: true });
  writeFileSync(join(repoPath, 'bench', 'workflow.mjs'), 'console.log(JSON.stringify({ duration_minutes: 30 }));\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'Automate the manual workflow step (base)']);
  baseSha = git(['rev-parse', 'HEAD']);

  writeFileSync(join(repoPath, 'bench', 'workflow.mjs'), 'console.log(JSON.stringify({ duration_minutes: 5 }));\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'Automate the manual workflow step (target)']);
  targetSha = git(['rev-parse', 'HEAD']);
});

afterAll(() => {
  rmSync(repoPath, { recursive: true, force: true });
  rmSync(outputDir, { recursive: true, force: true });
});

test('golden case: derived Metric (time saved per event -> annual) through the real analyzeImpact pipeline', async () => {
  const planPath = join(outputDir, 'plan.json');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    benchmark_id: 'manual-workflow-automation',
    repo: repoPath,
    base_ref: baseSha,
    target_ref: targetSha,
    command: { executable: process.execPath, args: ['bench/workflow.mjs'], cwd: '.' },
    result: {
      mode: 'stdout_json', json_path: 'duration_minutes', name: 'manual workflow duration', unit: 'minutes', direction: 'lower_is_better', operation: 'percentage_reduction', primary_statistic: 'median',
    },
    warmup_runs: 1,
    measurement_runs: 5,
    timeout_ms: 10000,
    scope: {},
  }));

  const factPath = join(outputDir, 'fact.json');
  writeFileSync(factPath, JSON.stringify({
    fact_id: 'fact_runs_per_week',
    name: 'workflow runs per week',
    kind: 'event_frequency',
    value: 12,
    unit: 'runs/week',
    verification_status: 'verified',
    source_reference: 'operations-report-2026-Q2',
    related_benchmark_id: 'manual-workflow-automation',
  }));

  const derivationPath = join(outputDir, 'derivation.json');
  writeFileSync(derivationPath, JSON.stringify({
    derivation_id: 'annual-workflow-time-saved',
    formula_id: 'annual_time_saved',
    inputs: {
      duration_metric: { benchmark_id: 'manual-workflow-automation' },
      events_per_period_fact_id: 'fact_runs_per_week',
      periods_per_year: { value: 52, unit: 'weeks/year', source: 'explicit_convention' },
    },
    output: {
      name: 'annual workflow time saved', unit: 'minutes/year', impact_domain: 'operational_efficiency', impact_level: 'L3',
    },
  }));

  const dryRun = await analyzeImpact({
    measurementPlanPaths: [planPath], quantitativeFactPaths: [factPath], derivationPaths: [derivationPath], provider: null,
  });

  const benchmarkMetric = dryRun.metrics.find((m) => m.name === 'manual workflow duration');
  assert.ok(benchmarkMetric);
  assert.equal(benchmarkMetric.before, 30);
  assert.equal(benchmarkMetric.after, 5);

  const derivedMetric = dryRun.metrics.find((m) => m.name === 'annual workflow time saved');
  assert.ok(derivedMetric, 'expected the derived Metric to be produced through the real pipeline');
  assert.equal(derivedMetric.formula_id, 'annual_time_saved');
  assert.equal(derivedMetric.calculation, '25 minutes × 12 runs/week × 52 weeks/year');
  assert.equal(derivedMetric.value, 25 * 12 * 52);
  assert.equal(derivedMetric.unit, 'minutes/year');
  assert.equal(derivedMetric.quantification_type, 'estimated', 'annualization always records an explicit assumption');
  assert.equal(derivedMetric.assumptions.length, 1);
  assert.ok(derivedMetric.evidence_ids.length > 0);

  const derivedCandidate = dryRun.impact_candidates.find((c) => c.metric_ids.includes(derivedMetric.id));
  assert.ok(derivedCandidate);
  assert.equal(derivedCandidate.impact_level, 'L3');
  assert.equal(derivedCandidate.classification_source.impact_level, 'explicit');
  assert.equal(derivedCandidate.quantification_type, 'estimated');

  // ---- resume claim, via a mocked provider citing only allowed numbers ----
  const provider = new ClaudeCliProvider({
    invoke: () => ({
      rawStdout: JSON.stringify({
        claims: [{
          candidate_id: derivedCandidate.id,
          title: 'Automated the manual workflow step',
          problem: 'A workflow step required 30 minutes of manual work per run.',
          change: 'Automated the step end-to-end.',
          outcome: 'Reclaimed engineering time across weekly workflow runs.',
          resume_variants: {
            standard: `Automated the manual workflow step, saving an estimated ${derivedMetric.value.toLocaleString('en-US')} minutes/year across weekly workflow runs.`,
          },
        }],
      }),
      executablePath: '/mock/claude',
    }),
  });

  const artifact = await analyzeImpact({
    measurementPlanPaths: [planPath], quantitativeFactPaths: [factPath], derivationPaths: [derivationPath], provider,
  });
  const claim = artifact.claims.find((c) => c.candidate_id === derivedCandidate.id);
  assert.ok(claim);
  assert.match(claim.statement, /15,600 minutes\/year/);
  assert.match(claim.statement, /estimated/i, 'estimated quantification must use qualified language');
  assert.equal(claim.quantification_type, 'estimated');

  const { reviewMdPath } = writeImpactArtifact(artifact, outputDir);
  const review = readFileSync(reviewMdPath, 'utf-8');
  assert.match(review, /annual_time_saved/);
  assert.match(review, /25 minutes × 12 runs\/week × 52 weeks\/year/);
  assert.match(review, /15600 minutes\/year|15,600 minutes\/year/);
});

test('a derivation with a missing fact input produces a structured Impact Opportunity, never a fabricated Metric', async () => {
  const planPath = join(outputDir, 'plan2.json');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    benchmark_id: 'manual-workflow-automation-2',
    repo: repoPath,
    base_ref: baseSha,
    target_ref: targetSha,
    command: { executable: process.execPath, args: ['bench/workflow.mjs'], cwd: '.' },
    result: {
      mode: 'stdout_json', json_path: 'duration_minutes', name: 'workflow duration 2', unit: 'minutes', direction: 'lower_is_better', operation: 'percentage_reduction', primary_statistic: 'median',
    },
    warmup_runs: 0,
    measurement_runs: 3,
    timeout_ms: 10000,
    scope: {},
  }));
  const derivationPath = join(outputDir, 'derivation-missing.json');
  writeFileSync(derivationPath, JSON.stringify({
    derivation_id: 'missing-fact-derivation',
    formula_id: 'total_time_saved',
    inputs: {
      duration_metric: { benchmark_id: 'manual-workflow-automation-2' },
      event_count_fact_id: 'fact_does_not_exist',
    },
    output: { name: 'total time saved' },
  }));

  const artifact = await analyzeImpact({ measurementPlanPaths: [planPath], derivationPaths: [derivationPath], provider: null });
  assert.ok(!artifact.metrics.some((m) => m.name === 'total time saved'), 'no fabricated Metric for the unresolved derivation');
  const opportunity = artifact.impact_opportunities.find((o) => o.candidate_topic === 'missing-fact-derivation');
  assert.ok(opportunity);
  assert.equal(opportunity.status, 'missing_derivation_input');
  assert.match(opportunity.missing_evidence.join(' '), /fact_does_not_exist/);
});

test('CLI end-to-end: an explicit output.unit ("hours/year") produces an exact 260 hours/year, and the resume Claim uses it', async () => {
  const planPath = join(outputDir, 'plan3.json');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    benchmark_id: 'manual-workflow-automation-3',
    repo: repoPath,
    base_ref: baseSha,
    target_ref: targetSha,
    command: { executable: process.execPath, args: ['bench/workflow.mjs'], cwd: '.' },
    result: {
      mode: 'stdout_json', json_path: 'duration_minutes', name: 'manual workflow duration 3', unit: 'minutes', direction: 'lower_is_better', operation: 'percentage_reduction', primary_statistic: 'median',
    },
    warmup_runs: 0,
    measurement_runs: 3,
    timeout_ms: 10000,
    scope: {},
  }));
  const factPath = join(outputDir, 'fact3.json');
  writeFileSync(factPath, JSON.stringify({
    fact_id: 'fact_runs_per_week_3',
    name: 'workflow runs per week',
    value: 12,
    unit: 'runs/week',
    verification_status: 'verified',
    related_benchmark_id: 'manual-workflow-automation-3',
  }));
  const derivationPath = join(outputDir, 'derivation3.json');
  writeFileSync(derivationPath, JSON.stringify({
    derivation_id: 'annual-workflow-time-saved-hours',
    formula_id: 'annual_time_saved',
    inputs: {
      duration_metric: { benchmark_id: 'manual-workflow-automation-3' },
      events_per_period_fact_id: 'fact_runs_per_week_3',
      periods_per_year: { value: 52, unit: 'weeks/year', source: 'explicit_convention' },
    },
    output: { name: 'annual workflow time saved (hours)', unit: 'hours/year' },
  }));

  const cliPath = join(process.cwd(), 'src', 'cli', 'impact-compiler.mjs');
  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, [
      cliPath, 'analyze', '--measurement-plan', planPath, '--quantitative-fact', factPath, '--derivation', derivationPath, '--output', outputDir, '--provider', 'off', '--json',
    ], { encoding: 'utf-8' });
  } catch (err) {
    stdout = err.stdout;
  }
  JSON.parse(stdout);

  const impactJson = JSON.parse(readFileSync(join(outputDir, 'impact.json'), 'utf-8'));
  const derived = impactJson.metrics.find((m) => m.name === 'annual workflow time saved (hours)');
  assert.ok(derived, 'expected the unit-converted derived Metric in impact.json');
  assert.equal(derived.value, 260);
  assert.equal(derived.unit, 'hours/year');
  assert.equal(derived.calculation, '(25 minutes × 12 runs/week × 52 weeks/year) / 60');

  // ---- the same derived Metric, via a mocked resume-Claim provider ----
  const dryRun = await analyzeImpact({
    measurementPlanPaths: [planPath], quantitativeFactPaths: [factPath], derivationPaths: [derivationPath], provider: null,
  });
  const candidate = dryRun.impact_candidates.find((c) => c.metric_ids.some((id) => dryRun.metrics.find((m) => m.id === id)?.name === 'annual workflow time saved (hours)'));
  assert.ok(candidate);

  const provider = new ClaudeCliProvider({
    invoke: () => ({
      rawStdout: JSON.stringify({
        claims: [{
          candidate_id: candidate.id,
          title: 'Automated the manual workflow step',
          resume_variants: { standard: 'Automated the manual workflow step, saving an estimated 260 hours/year across weekly workflow runs.' },
        }],
      }),
      executablePath: '/mock/claude',
    }),
  });
  const artifact = await analyzeImpact({
    measurementPlanPaths: [planPath], quantitativeFactPaths: [factPath], derivationPaths: [derivationPath], provider,
  });
  const claim = artifact.claims.find((c) => c.candidate_id === candidate.id);
  assert.match(claim.statement, /260 hours\/year/);
});
