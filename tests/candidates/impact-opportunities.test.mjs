import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectImpactOpportunities } from '../../src/candidates/impact-opportunities.mjs';

test('missing scope on a candidate produces a missing_scope opportunity', () => {
  const candidates = [{
    id: 'c1', system: { name: 'x' }, metric_ids: ['m1'], production_evidence_ids: [], quality_profile: { scope_completeness: 'missing', attribution_strength: 'strong', conflict_status: 'none' },
  }];
  const opportunities = detectImpactOpportunities({ evidence: [], metrics: [], candidates });
  assert.ok(opportunities.some((o) => o.status === 'missing_scope'));
});

test('weak/none attribution produces a weak_attribution opportunity', () => {
  const candidates = [{
    id: 'c1', system: { name: 'x' }, metric_ids: ['m1'], production_evidence_ids: [], quality_profile: { scope_completeness: 'complete', attribution_strength: 'weak', conflict_status: 'none' },
  }];
  const opportunities = detectImpactOpportunities({ evidence: [], metrics: [], candidates });
  assert.ok(opportunities.some((o) => o.status === 'weak_attribution'));
});

test('an unresolved controlled_benchmark evidence record produces an insufficient_samples or measurement_failed opportunity', () => {
  const evidence = [{
    id: 'ev1', type: 'controlled_benchmark', resolution: 'unresolved', reason: 'insufficient valid samples collected', benchmark_id: 'x',
  }];
  const opportunities = detectImpactOpportunities({ evidence, metrics: [], candidates: [] });
  assert.equal(opportunities[0].status, 'insufficient_samples');
});

test('a self_reported candidate produces an unknown_verification_status opportunity', () => {
  const candidates = [{
    id: 'c1', system: { name: 'x' }, metric_ids: [], production_evidence_ids: [], quantification_type: 'self_reported', quality_profile: { scope_completeness: 'missing', attribution_strength: 'none', conflict_status: 'none' },
  }];
  const opportunities = detectImpactOpportunities({ evidence: [], metrics: [], candidates });
  assert.ok(opportunities.some((o) => o.status === 'unknown_verification_status'));
});

test('a material conflict produces a conflicting_evidence opportunity', () => {
  const candidates = [{
    id: 'c1', system: { name: 'x' }, metric_ids: ['m1'], production_evidence_ids: [], limitations: ['conflicting production values for "x": a vs b'], quality_profile: { scope_completeness: 'complete', attribution_strength: 'strong', conflict_status: 'material' },
  }];
  const opportunities = detectImpactOpportunities({ evidence: [], metrics: [], candidates });
  assert.ok(opportunities.some((o) => o.status === 'conflicting_evidence'));
});

test('never fabricates a value — recommended_measurement only ever describes what to supply', () => {
  const candidates = [{
    id: 'c1', system: { name: 'x' }, metric_ids: ['m1'], production_evidence_ids: [], quality_profile: { scope_completeness: 'missing', attribution_strength: 'strong', conflict_status: 'none' },
  }];
  const opportunities = detectImpactOpportunities({ evidence: [], metrics: [], candidates });
  const o = opportunities.find((x) => x.status === 'missing_scope');
  assert.ok(typeof o.recommended_measurement === 'string' && o.recommended_measurement.length > 0);
  assert.ok(!/\d[\d,]*(?:\.\d+)?%/.test(o.recommended_measurement), 'a recommendation never contains an invented quantified figure');
});

test('a strong, complete candidate produces no opportunities', () => {
  const candidates = [{
    id: 'c1', system: { name: 'x' }, metric_ids: ['m1'], production_evidence_ids: [], quantification_type: 'measured', quality_profile: { scope_completeness: 'complete', attribution_strength: 'strong', conflict_status: 'none' },
  }];
  const opportunities = detectImpactOpportunities({ evidence: [], metrics: [], candidates });
  assert.deepEqual(opportunities, []);
});

// ---- P1-5.2: a bare, unmeasured commit/PR is surfaced as a missing-benchmark opportunity ----

test('P1-5.2: a bare git_commit with no linked measurement evidence produces a missing_benchmark opportunity', () => {
  const evidence = [{
    id: 'ev_commit', type: 'git_commit', resolution: 'resolved', subject: 'Replace O(n^2) matching logic with a hash-based lookup', linked_evidence_ids: [],
  }];
  const opportunities = detectImpactOpportunities({ evidence, metrics: [], candidates: [] });
  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0].status, 'missing_benchmark');
  assert.equal(opportunities[0].candidate_topic, 'Replace O(n^2) matching logic with a hash-based lookup');
});

test('P1-5.2: a commit that already has a linked measurement produces no missing_benchmark opportunity', () => {
  const evidence = [
    { id: 'ev_commit', type: 'git_commit', resolution: 'resolved', subject: 'x', linked_evidence_ids: [] },
    {
      id: 'ev_bench', type: 'benchmark_artifact', resolution: 'resolved', linked_evidence_ids: ['ev_commit'],
    },
  ];
  const opportunities = detectImpactOpportunities({ evidence, metrics: [], candidates: [] });
  assert.ok(!opportunities.some((o) => o.status === 'missing_benchmark'));
});

test('P1-5.2: never fabricates a Metric or Candidate for the bare commit — only names the gap', () => {
  const evidence = [{
    id: 'ev_commit', type: 'git_commit', resolution: 'resolved', subject: 'x', linked_evidence_ids: [],
  }];
  const opportunities = detectImpactOpportunities({ evidence, metrics: [], candidates: [] });
  assert.ok(!/\d[\d,]*(?:\.\d+)?%/.test(opportunities[0].recommended_measurement));
});

// ---- P1-5.5: readable Metric name preferred over a raw metric ID ----

test('P1-5.5: candidate_topic prefers the Metric\'s own name over a raw metric ID when no system.name exists', () => {
  const metricsById = new Map([['metric_xyz', { id: 'metric_xyz', name: 'independent-file throughput ratio' }]]);
  const candidates = [{
    id: 'c1', system: { name: null }, metric_ids: ['metric_xyz'], production_evidence_ids: [], quality_profile: { scope_completeness: 'missing', attribution_strength: 'strong', conflict_status: 'none' },
  }];
  const opportunities = detectImpactOpportunities({
    evidence: [], metrics: [], candidates, metricsById,
  });
  assert.equal(opportunities[0].candidate_topic, 'independent-file throughput ratio');
});

test('P1-5.5: falls back to the raw metric ID when no metric is found (unchanged legacy behavior)', () => {
  const candidates = [{
    id: 'c1', system: { name: null }, metric_ids: ['metric_missing'], production_evidence_ids: [], quality_profile: { scope_completeness: 'missing', attribution_strength: 'strong', conflict_status: 'none' },
  }];
  const opportunities = detectImpactOpportunities({ evidence: [], metrics: [], candidates });
  assert.equal(opportunities[0].candidate_topic, 'metric_missing');
});
