import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildImpactCandidates } from '../../src/candidates/impact-candidate-builder.mjs';

function controlledBenchmarkEvidence(overrides = {}) {
  return {
    id: 'ev_cb',
    type: 'controlled_benchmark',
    resolution: 'resolved',
    scope: { dataset_name: 'synthetic-customers-v3', records: 1000000, source_evidence_ids: undefined },
    measurement_runs: 30,
    measurement_quality: 'high',
    attribution: {
      strength: 'strong', method: 'controlled_before_after', base_commit: 'a'.repeat(40), target_commit: 'b'.repeat(40), confounders: [],
    },
    primary_statistic: 'median',
    linked_evidence_ids: ['ev_commit'],
    ...overrides,
  };
}

function commitEvidence() {
  return {
    id: 'ev_commit', type: 'git_commit', resolution: 'resolved', sha: 'b'.repeat(40), subject: 'Refactor the customer-matching engine',
  };
}

function metric(overrides = {}) {
  return {
    id: 'metric_1',
    name: 'customer matching runtime',
    unit: 'sec',
    operation: 'percentage_reduction',
    direction: 'lower_is_better',
    calculation: '(1.82 - 0.47) / 1.82 * 100',
    confidence: 'high',
    evidence_ids: ['ev_cb'],
    before: 1.82,
    after: 0.47,
    absolute_delta: -1.35,
    relative_change_percent: 74.18,
    result: { value: 74.18, value_unit: 'percent', outcome: 'improvement' },
    ...overrides,
  };
}

test('one controlled benchmark creates one measured candidate', () => {
  const candidates = buildImpactCandidates({ evidence: [controlledBenchmarkEvidence(), commitEvidence()], metrics: [metric()] });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].quantification_type, 'measured');
});

test('scope is preserved verbatim from the measurement evidence', () => {
  const candidates = buildImpactCandidates({ evidence: [controlledBenchmarkEvidence(), commitEvidence()], metrics: [metric()] });
  assert.equal(candidates[0].scope.records, 1000000);
  assert.equal(candidates[0].scope.dataset_name, 'synthetic-customers-v3');
});

test('before/after/result/run count are preserved', () => {
  const candidates = buildImpactCandidates({ evidence: [controlledBenchmarkEvidence(), commitEvidence()], metrics: [metric()] });
  const { measurement } = candidates[0];
  assert.equal(measurement.before, 1.82);
  assert.equal(measurement.after, 0.47);
  assert.equal(measurement.result_value, 74.18);
  assert.equal(measurement.run_count, 30);
});

test('implementation and measurement evidence remain distinct arrays', () => {
  const candidates = buildImpactCandidates({ evidence: [controlledBenchmarkEvidence(), commitEvidence()], metrics: [metric()] });
  assert.deepEqual(candidates[0].implementation_evidence_ids, ['ev_commit']);
  assert.deepEqual(candidates[0].measurement_evidence_ids, ['ev_cb']);
});

test('candidate IDs are stable and deterministic across runs', () => {
  const build = () => buildImpactCandidates({ evidence: [controlledBenchmarkEvidence(), commitEvidence()], metrics: [metric()] });
  assert.equal(build()[0].id, build()[0].id);
});

test('unrelated evidence supplied in the same run is not added to the candidate', () => {
  const unrelatedNote = {
    id: 'ev_note', type: 'note', resolution: 'resolved', content: 'unrelated context',
  };
  const candidates = buildImpactCandidates({ evidence: [controlledBenchmarkEvidence(), commitEvidence(), unrelatedNote], metrics: [metric()] });
  assert.ok(!candidates[0].evidence_ids.includes('ev_note'));
});

test('scope is null when the measurement evidence carries none (never invented)', () => {
  const ev = controlledBenchmarkEvidence({ scope: null });
  const candidates = buildImpactCandidates({ evidence: [ev, commitEvidence()], metrics: [metric()] });
  assert.equal(candidates[0].scope, null);
  assert.equal(candidates[0].impact_level, 'L1');
});

test('impact_level is L2 when scope carries a positive numeric scale', () => {
  const candidates = buildImpactCandidates({ evidence: [controlledBenchmarkEvidence(), commitEvidence()], metrics: [metric()] });
  assert.equal(candidates[0].impact_level, 'L2');
});

test('impact_domain classifies "matching runtime" as performance', () => {
  const candidates = buildImpactCandidates({ evidence: [controlledBenchmarkEvidence(), commitEvidence()], metrics: [metric()] });
  assert.equal(candidates[0].impact_domain, 'performance');
});

test('a regression outcome is preserved on the candidate, not hidden', () => {
  const regressionMetric = metric({
    before: 1.0, after: 1.5, absolute_delta: 0.5, relative_change_percent: -50, result: { value: -50, value_unit: 'percent', outcome: 'regression' },
  });
  const candidates = buildImpactCandidates({ evidence: [controlledBenchmarkEvidence(), commitEvidence()], metrics: [regressionMetric] });
  assert.equal(candidates[0].outcome, 'regression');
});

test('no candidate is built for a Metric with no traceable measurement evidence', () => {
  const orphanMetric = metric({ evidence_ids: ['does_not_exist'] });
  const candidates = buildImpactCandidates({ evidence: [], metrics: [orphanMetric] });
  assert.equal(candidates.length, 0);
});

// ---- P1-5.1: generic scope for externally-supplied benchmark_artifact evidence ----

function benchmarkArtifactEvidence(overrides = {}) {
  return {
    id: 'ev_bench',
    type: 'benchmark_artifact',
    resolution: 'resolved',
    name: 'SAFER-CC vs GlobalLock',
    before: 8771.51, after: 49336.65, unit: 'ops/sec', direction: 'higher_is_better',
    repetitions: 5,
    scope: { workers: 64, files: 32 },
    linked_evidence_ids: [],
    ...overrides,
  };
}

function benchmarkMetric(overrides = {}) {
  return {
    id: 'metric_bench',
    name: 'SAFER-CC vs GlobalLock',
    unit: 'ops/sec',
    operation: 'ratio',
    direction: 'higher_is_better',
    calculation: '49336.65 / 8771.51',
    confidence: 'high',
    evidence_ids: ['ev_bench'],
    before: 8771.51,
    after: 49336.65,
    absolute_delta: 40565.14,
    relative_change_percent: null,
    result: { value: 5.62, value_unit: 'ratio', outcome: 'improvement' },
    ...overrides,
  };
}

test('P1-5.1: an externally-supplied benchmark_artifact with a generic scope (workers/files) produces a populated candidate scope, not null', () => {
  const candidates = buildImpactCandidates({ evidence: [benchmarkArtifactEvidence()], metrics: [benchmarkMetric()] });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].scope.workers, 64);
  assert.equal(candidates[0].scope.files, 32);
});

test('P1-5.1: scope keys are never hardcoded to a specific domain — arbitrary keys pass through generically', () => {
  const ev = benchmarkArtifactEvidence({ scope: { requests: 500, dataset_size_gb: 12 } });
  const candidates = buildImpactCandidates({ evidence: [ev], metrics: [benchmarkMetric()] });
  assert.equal(candidates[0].scope.requests, 500);
  assert.equal(candidates[0].scope.dataset_size_gb, 12);
});

test('P1-5.1: a benchmark_artifact with no scope declared still produces scope: null (never invented)', () => {
  const ev = benchmarkArtifactEvidence({ scope: null });
  const candidates = buildImpactCandidates({ evidence: [ev], metrics: [benchmarkMetric()] });
  assert.equal(candidates[0].scope, null);
});

// ---- P0-1: external measurement quality flows into candidate.measurement ----

test('P0-1: a benchmark_artifact with repetitions>=5 and a variance signal classifies measurement_quality high', () => {
  const ev = benchmarkArtifactEvidence({ repetitions: 5, min: { before: 8500, after: 41000 } });
  const candidates = buildImpactCandidates({ evidence: [ev], metrics: [benchmarkMetric()] });
  assert.equal(candidates[0].measurement.measurement_quality, 'high');
});

test('P0-1: a benchmark_artifact with NO measurement-context fields classifies unknown, not insufficient', () => {
  const ev = benchmarkArtifactEvidence({ repetitions: null, scope: null });
  const candidates = buildImpactCandidates({ evidence: [ev], metrics: [benchmarkMetric()] });
  assert.equal(candidates[0].measurement.measurement_quality, 'unknown');
});
