// tests/e2e/evaluation-matrix.test.mjs — hardening pass item 5: a real-world
// Impact evaluation matrix covering distinct engineering-impact patterns.
// Every quantified case asserts against the ACTUAL final resume statement
// (claim.statement / resume_variants), never only internal Candidates or
// review.md rendering.
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
let planCounter = 0;

function git(args) {
  return execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

before(() => {
  repoPath = mkdtempSync(join(tmpdir(), 'impact-compiler-matrix-repo-'));
  outputDir = mkdtempSync(join(tmpdir(), 'impact-compiler-matrix-out-'));
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);

  mkdirSync(join(repoPath, 'bench'), { recursive: true });
  writeFileSync(join(repoPath, 'bench', 'run.mjs'), 'console.log(JSON.stringify({ duration_seconds: 1.82 }));\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
  baseSha = git(['rev-parse', 'HEAD']);

  writeFileSync(join(repoPath, 'bench', 'run.mjs'), 'console.log(JSON.stringify({ duration_seconds: 0.47 }));\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'target']);
  targetSha = git(['rev-parse', 'HEAD']);
});

afterAll(() => {
  rmSync(repoPath, { recursive: true, force: true });
  rmSync(outputDir, { recursive: true, force: true });
});

function writePlan(benchmarkId, overrides = {}) {
  planCounter += 1;
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
  const path = join(outputDir, `matrix-plan-${planCounter}.json`);
  writeFileSync(path, JSON.stringify(plan, null, 2));
  return path;
}

function writeJson(name, obj) {
  planCounter += 1;
  const path = join(outputDir, `matrix-${name}-${planCounter}.json`);
  writeFileSync(path, JSON.stringify(obj, null, 2));
  return path;
}

function mockedResumeProvider(candidateId, standard, extra = {}) {
  return new ClaudeCliProvider({
    invoke: () => ({
      rawStdout: JSON.stringify({
        claims: [{
          candidate_id: candidateId,
          title: 'title',
          problem: 'problem',
          change: 'change',
          outcome: 'outcome',
          resume_variants: { standard, ...extra },
        }],
      }),
      executablePath: '/mock/claude',
    }),
  });
}

// ---- 1. Performance: controlled benchmark + explicit scope ----

test('matrix 1 — performance: benchmark + scope, resume statement states action/system/scope/before/after/result', async () => {
  const planPath = writePlan('perf-matrix', { scope: { dataset_name: 'orders-v2', records: 500000 } });
  const dryRun = await analyzeImpact({ measurementPlanPaths: [planPath], provider: null });
  const candidate = dryRun.impact_candidates[0];
  assert.equal(candidate.impact_level, 'L2');

  const provider = mockedResumeProvider(candidate.id, 'Refactored the order-matching path, reducing processing time across a 500,000-record dataset from 1.82s to 0.47s (74.18%).');
  const artifact = await analyzeImpact({ measurementPlanPaths: [planPath], provider });
  const { statement } = artifact.claims[0];
  assert.match(statement, /500,000/);
  assert.match(statement, /1\.82s/);
  assert.match(statement, /0\.47s/);
  assert.match(statement, /74\.18%/);
});

// ---- 2. Performance plus production: benchmark + P95 + timeout rate + observation window ----

test('matrix 2 — performance plus production: benchmark combined with P95 latency and timeout rate, resume statement states benchmark result AND both production outcomes', async () => {
  const planPath = writePlan('perfprod-matrix', {
    scope: { dataset_name: 'orders-v2', records: 500000 }, link: { service: 'perfprod-matrix' },
  });
  const p95Path = writeJson('p95', {
    name: 'P95 latency', before: 100, after: 39, unit: 'ms', direction: 'lower_is_better', environment: 'production', service: 'perfprod-matrix', window: { before: '2026-01-01', after: '2026-01-15' },
  });
  const timeoutPath = writeJson('timeout', {
    name: 'timeout rate', before: 2.1, after: 0.6, unit: 'percent', direction: 'lower_is_better', environment: 'production', service: 'perfprod-matrix', window: { before: '2026-01-01', after: '2026-01-15' },
  });
  const dryRun = await analyzeImpact({ measurementPlanPaths: [planPath], productionMetricPaths: [p95Path, timeoutPath], provider: null });
  const combined = dryRun.impact_candidates.find((c) => c.combined_from);
  assert.ok(combined);
  assert.equal(combined.production_summary.metrics.length, 2);

  const provider = mockedResumeProvider(combined.id, 'Refactored the order-matching path, reducing processing time across a 500,000-record dataset from 1.82s to 0.47s (74.18%); over the following 14 days, production P95 latency decreased by 61% and timeout rate fell from 2.1% to 0.6%.');
  const artifact = await analyzeImpact({ measurementPlanPaths: [planPath], productionMetricPaths: [p95Path, timeoutPath], provider });
  const { statement } = artifact.claims[0];
  assert.match(statement, /500,000/);
  assert.match(statement, /1\.82s/);
  assert.match(statement, /0\.47s/);
  assert.match(statement, /74\.18%/);
  assert.match(statement, /14 days/);
  assert.match(statement, /61%/);
  assert.match(statement, /2\.1%/);
  assert.match(statement, /0\.6%/);
});

// ---- 3. Developer productivity: duration saved + verified frequency + exact unit conversion ----

test('matrix 3 — developer productivity: derived annual time saved with explicit hours/year conversion', async () => {
  const planPath = writePlan('dev-productivity-matrix');
  const factPath = writeJson('fact', {
    fact_id: 'fact_dev_runs', name: 'runs per week', value: 12, unit: 'runs/week', verification_status: 'verified', related_benchmark_id: 'dev-productivity-matrix',
  });
  const derivationPath = writeJson('derivation', {
    derivation_id: 'dev-annual-saved',
    formula_id: 'annual_time_saved',
    inputs: {
      duration_metric: { benchmark_id: 'dev-productivity-matrix' },
      events_per_period_fact_id: 'fact_dev_runs',
      periods_per_year: { value: 52, unit: 'weeks/year', source: 'explicit_convention' },
    },
    output: { name: 'developer time saved annually', unit: 'hours/year' },
  });
  const dryRun = await analyzeImpact({
    measurementPlanPaths: [planPath], quantitativeFactPaths: [factPath], derivationPaths: [derivationPath], provider: null,
  });
  const candidate = dryRun.impact_candidates.find((c) => c.quantification_type === 'estimated');
  assert.ok(candidate);
  const derivedMetric = dryRun.metrics.find((m) => m.id === candidate.metric_ids[0]);
  assert.equal(derivedMetric.unit, 'hours/year', 'the explicit unit conversion was applied end to end');

  const provider = mockedResumeProvider(candidate.id, `Automated a recurring workflow step, saving an estimated ${derivedMetric.value} hours/year across weekly runs.`);
  const artifact = await analyzeImpact({
    measurementPlanPaths: [planPath], quantitativeFactPaths: [factPath], derivationPaths: [derivationPath], provider,
  });
  const { statement } = artifact.claims[0];
  assert.match(statement, new RegExp(`${derivedMetric.value} hours/year`));
  assert.match(statement, /estimated/i);
});

// ---- 4. Estimated operational impact: partial-period frequency extrapolated to a year ----

test('matrix 4 — estimated operational impact: partial-period frequency extrapolated, quantification_type estimated, qualified language required', async () => {
  const planPath = writePlan('op-impact-matrix');
  const factPath = writeJson('fact', {
    fact_id: 'fact_op_runs', name: 'ops runs per week', value: 8, unit: 'runs/week', verification_status: 'verified', related_benchmark_id: 'op-impact-matrix',
  });
  const derivationPath = writeJson('derivation', {
    derivation_id: 'op-annual-saved',
    formula_id: 'annual_time_saved',
    inputs: {
      duration_metric: { benchmark_id: 'op-impact-matrix' },
      events_per_period_fact_id: 'fact_op_runs',
      periods_per_year: { value: 52, unit: 'weeks/year', source: 'explicit_convention' },
    },
    output: { name: 'operational time saved annually' },
  });
  const artifact = await analyzeImpact({ measurementPlanPaths: [planPath], quantitativeFactPaths: [factPath], derivationPaths: [derivationPath], provider: null });
  const metric = artifact.metrics.find((m) => m.name === 'operational time saved annually');
  assert.equal(metric.quantification_type, 'estimated');
  assert.ok(metric.assumptions.length > 0);
  const candidate = artifact.impact_candidates.find((c) => c.metric_ids.includes(metric.id));
  assert.notEqual(candidate.quality_profile.resume_eligibility, 'strong', 'an estimated result can never be strong');
});

// ---- 5. Reliability: production error rate before/after (no benchmark) ----

test('matrix 5 — reliability: production error-rate before/after, resume statement states the before/after/result', async () => {
  const errRatePath = writeJson('errrate', {
    name: 'error rate', before: 3.4, after: 0.9, unit: 'percent', direction: 'lower_is_better', environment: 'production', service: 'checkout',
  });
  const dryRun = await analyzeImpact({ productionMetricPaths: [errRatePath], provider: null });
  assert.equal(dryRun.impact_candidates.length, 1);
  const candidate = dryRun.impact_candidates[0];

  const provider = mockedResumeProvider(candidate.id, 'Following the release, production error rate fell from 3.4% to 0.9%.');
  const artifact = await analyzeImpact({ productionMetricPaths: [errRatePath], provider });
  const { statement } = artifact.claims[0];
  assert.match(statement, /3\.4%/);
  assert.match(statement, /0\.9%/);
});

// ---- 6. Cost: verified resource reduction + verified unit cost + explicit period ----

test('matrix 6 — cost: resource_cost_savings derivation with fully verified inputs is DERIVED, resume statement cites the exact figure', async () => {
  const factReduction = writeJson('fact', {
    fact_id: 'fact_cost_reduction', name: 'compute hours reduced per week', value: 40, unit: 'hour', verification_status: 'verified',
  });
  const derivationPath = writeJson('derivation', {
    derivation_id: 'cost-savings',
    formula_id: 'resource_cost_savings',
    inputs: {
      resource_reduction_fact_id: 'fact_cost_reduction',
      unit_cost: { value: 0.5, unit: 'USD/hour', source: 'explicit_convention' },
      usage_or_period: { value: 52, unit: 'weeks', source: 'explicit_convention' },
    },
    output: { name: 'annual cloud cost savings' },
  });
  const dryRun = await analyzeImpact({ derivationPaths: [derivationPath], quantitativeFactPaths: [factReduction], provider: null });
  const metric = dryRun.metrics.find((m) => m.name === 'annual cloud cost savings');
  assert.ok(metric);
  assert.equal(metric.quantification_type, 'derived');
  assert.equal(metric.value, 40 * 0.5 * 52);
  const candidate = dryRun.impact_candidates.find((c) => c.metric_ids.includes(metric.id));
  assert.ok(candidate);

  const provider = mockedResumeProvider(candidate.id, `Reduced cloud spend by an estimated $${metric.value} per year through compute-hour optimization.`);
  const artifact = await analyzeImpact({ derivationPaths: [derivationPath], quantitativeFactPaths: [factReduction], provider });
  const { statement } = artifact.claims[0];
  assert.match(statement, new RegExp(String(metric.value)));
});

// ---- 7. Context-only: commit/PR/ticket without a measurable result ----

test('matrix 7 — context-only: a ticket with no measurable result produces no quantified Candidate or Claim', async () => {
  const ticketPath = writeJson('ticket', {
    provider: 'jira', ticket_id: 'PROJ-1', title: 'Investigate slow checkout', description: 'Users report checkout is slow.',
  });
  const artifact = await analyzeImpact({ ticketPaths: [ticketPath], provider: null });
  assert.equal(artifact.impact_candidates.length, 0, 'no quantified Metric exists, so no Candidate is built');
  assert.equal(artifact.metrics.length, 0);
  assert.ok(artifact.evidence.some((e) => e.type === 'ticket'), 'the ticket itself is still preserved as context Evidence');
});

// ---- 8. Conflicting Evidence: contradictory production Metrics for the same service/window ----

test('matrix 8 — conflicting evidence: contradictory production Metrics for the same name/service/window are preserved, never silently resolved, and never presented as a clean positive Claim', async () => {
  const planPath = writePlan('conflict-matrix', { link: { service: 'conflict-matrix' } });
  const metricA = writeJson('conflict-a', {
    name: 'p95 latency', before: 100, after: 40, unit: 'ms', direction: 'lower_is_better', environment: 'production', service: 'conflict-matrix', window: { before: '2026-01-01', after: '2026-01-15' },
  });
  const metricB = writeJson('conflict-b', {
    name: 'p95 latency', before: 100, after: 90, unit: 'ms', direction: 'lower_is_better', environment: 'production', service: 'conflict-matrix', window: { before: '2026-01-01', after: '2026-01-15' },
  });
  const artifact = await analyzeImpact({ measurementPlanPaths: [planPath], productionMetricPaths: [metricA, metricB], provider: null });
  const combined = artifact.impact_candidates.find((c) => c.combined_from);
  assert.ok(combined);
  assert.equal(combined.conflicting_evidence, true);
  assert.equal(combined.production_summary.metrics.length, 2, 'both contradictory values preserved, never silently picked');
  assert.notEqual(combined.quality_profile.resume_eligibility, 'strong', 'a material conflict can never present as strong/clean');
});
