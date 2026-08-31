import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankAndDeduplicateCandidates } from '../../src/candidates/ranking.mjs';

function strongCandidate(id) {
  return {
    id,
    quantification_type: 'measured',
    impact_level: 'L2',
    metric_ids: [`metric_${id}`],
    evidence_ids: [`ev_${id}`],
    measurement: { method: 'controlled_before_after', assumptions: [] },
    quality_profile: {
      evidence_strength: 'high', measurement_quality: 'high', attribution_strength: 'strong', scope_completeness: 'complete', production_corroboration: false, conflict_status: 'none', resume_eligibility: 'strong',
    },
  };
}

function selfReportedCandidate(id) {
  return {
    id,
    quantification_type: 'self_reported',
    impact_level: 'L1',
    metric_ids: [],
    evidence_ids: [`ev_${id}`],
    measurement: { method: 'self_reported' },
    quality_profile: {
      evidence_strength: 'low', measurement_quality: 'insufficient', attribution_strength: 'none', scope_completeness: 'missing', production_corroboration: false, conflict_status: 'none', resume_eligibility: 'context_only',
    },
  };
}

function regressionCandidate(id) {
  return {
    id,
    quantification_type: 'measured',
    impact_level: 'L2',
    metric_ids: [`metric_${id}`],
    evidence_ids: [`ev_${id}`],
    measurement: { method: 'controlled_before_after', assumptions: [] },
    quality_profile: {
      evidence_strength: 'high', measurement_quality: 'high', attribution_strength: 'weak', scope_completeness: 'missing', production_corroboration: false, conflict_status: 'none', resume_eligibility: 'ineligible',
    },
  };
}

function estimatedCandidate(id, assumptions = ['an assumption']) {
  return {
    id,
    quantification_type: 'estimated',
    impact_level: 'L3',
    metric_ids: [`metric_${id}`],
    evidence_ids: [`ev_${id}`],
    measurement: { method: 'derived', assumptions },
    quality_profile: {
      evidence_strength: 'high', measurement_quality: 'high', attribution_strength: 'strong', scope_completeness: 'complete', production_corroboration: false, conflict_status: 'none', resume_eligibility: 'qualified',
    },
  };
}

test('a strong controlled benchmark ranks above an unverified self-report', () => {
  const ranked = rankAndDeduplicateCandidates([selfReportedCandidate('a'), strongCandidate('b')], { max: 5 });
  assert.equal(ranked[0].id, 'b');
});

test('derived with verified inputs ranks above estimated', () => {
  const derived = { ...estimatedCandidate('c', []), quantification_type: 'derived' };
  const estimated = estimatedCandidate('d');
  const ranked = rankAndDeduplicateCandidates([estimated, derived], { max: 5 });
  assert.equal(ranked[0].id, 'c');
});

test('regression is never ranked as positive impact — ineligible sorts last', () => {
  const regression = {
    id: 'reg', quantification_type: 'measured', impact_level: 'L1', metric_ids: ['metric_reg'], evidence_ids: ['ev_reg'], measurement: { method: 'controlled_before_after' }, quality_profile: { evidence_strength: 'high', measurement_quality: 'high', attribution_strength: 'strong', scope_completeness: 'complete', production_corroboration: false, conflict_status: 'none', resume_eligibility: 'ineligible' },
  };
  const ranked = rankAndDeduplicateCandidates([regression, strongCandidate('good')], { max: 5 });
  assert.equal(ranked[0].id, 'good');
  assert.equal(ranked[ranked.length - 1].id, 'reg');
});

test('P0-2: returns every candidate by default — no silent truncation', () => {
  const many = ['a', 'b', 'c', 'd', 'e'].map(strongCandidate);
  const ranked = rankAndDeduplicateCandidates(many);
  assert.equal(ranked.length, 5);
  // every real candidate id survives, none silently dropped
  assert.deepEqual(new Set(ranked.map((c) => c.id)), new Set(['a', 'b', 'c', 'd', 'e']));
});

test('P0-2: an explicitly requested max still truncates, but only when the caller opts in', () => {
  const many = ['a', 'b', 'c', 'd', 'e'].map(strongCandidate);
  const ranked = rankAndDeduplicateCandidates(many, { max: 3 });
  assert.equal(ranked.length, 3);
});

test('P0-2: recommended marks only the top recommendedMax without removing anything', () => {
  const many = ['a', 'b', 'c', 'd', 'e'].map(strongCandidate);
  const ranked = rankAndDeduplicateCandidates(many);
  assert.equal(ranked.length, 5);
  assert.equal(ranked.filter((c) => c.recommended).length, 3);
  assert.deepEqual(ranked.map((c) => c.rank), [1, 2, 3, 4, 5]);
});

// ---- recommendation-semantics fix (exposed by CS61C proj3: 15/15 regressions,
// all ineligible, yet the OLD `i < recommendedMax` logic still recommended the
// top 3 by rank regardless of eligibility) ----

test('recommendation fix, case 1: mixed slate keeps all 3 candidates but only the 2 qualified ones can be recommended', () => {
  const good1 = estimatedCandidate('good1');
  const good2 = estimatedCandidate('good2');
  const bad = regressionCandidate('bad');
  const ranked = rankAndDeduplicateCandidates([good1, good2, bad]);
  assert.equal(ranked.length, 3, 'all 3 candidates preserved, including the regression');
  assert.deepEqual(new Set(ranked.map((c) => c.id)), new Set(['good1', 'good2', 'bad']));
  const recommended = ranked.filter((c) => c.recommended).map((c) => c.id).sort();
  assert.deepEqual(recommended, ['good1', 'good2']);
  assert.equal(ranked.find((c) => c.id === 'bad').recommended, false);
});

test('recommendation fix, case 2: an all-ineligible slate preserves every candidate but recommends none', () => {
  const many = ['r1', 'r2', 'r3'].map(regressionCandidate);
  const ranked = rankAndDeduplicateCandidates(many);
  assert.equal(ranked.length, 3, 'no candidate dropped merely because none is eligible');
  assert.equal(ranked.filter((c) => c.recommended).length, 0);
  // mirrors core/impact-compiler.mjs's derivation of recommended_candidate_ids
  const recommendedIds = ranked.filter((c) => c.recommended).map((c) => c.id);
  assert.deepEqual(recommendedIds, []);
});

test('recommendation fix, case 3: with more than 3 eligible candidates, only the top 3 eligible ones are recommended', () => {
  const eligible = ['e1', 'e2', 'e3', 'e4', 'e5'].map((id) => estimatedCandidate(id, []));
  const ranked = rankAndDeduplicateCandidates(eligible);
  assert.equal(ranked.length, 5);
  assert.equal(ranked.filter((c) => c.recommended).length, 3);
  assert.deepEqual(ranked.map((c) => c.rank), [1, 2, 3, 4, 5]);
});

test('recommendation fix, case 4: an ineligible candidate is skipped for recommendation even if every other quality signal beats an eligible one, and ranking order is untouched', () => {
  // superiorButIneligible has the best possible secondary quality signals
  // (evidence_strength/measurement_quality/attribution/scope all top-tier)
  // but is still `ineligible` — it must never be recommended, and the
  // weaker-but-eligible candidate must be, without reordering anything to
  // "fix" this: eligibility is already the dominant ranking key by design.
  const superiorButIneligible = {
    ...regressionCandidate('superior_ineligible'),
    quality_profile: {
      evidence_strength: 'high', measurement_quality: 'high', attribution_strength: 'strong', scope_completeness: 'complete', production_corroboration: false, conflict_status: 'none', resume_eligibility: 'ineligible',
    },
  };
  const weakerButEligible = {
    ...estimatedCandidate('weaker_eligible'),
    quality_profile: {
      evidence_strength: 'medium', measurement_quality: 'medium', attribution_strength: 'weak', scope_completeness: 'partial', production_corroboration: false, conflict_status: 'none', resume_eligibility: 'qualified',
    },
  };
  const ranked = rankAndDeduplicateCandidates([superiorButIneligible, weakerButEligible], { recommendedMax: 1 });
  assert.equal(ranked.length, 2, 'both candidates preserved');
  assert.equal(ranked.find((c) => c.id === 'weaker_eligible').recommended, true, 'the only eligible candidate is recommended, despite weaker secondary evidence');
  assert.equal(ranked.find((c) => c.id === 'superior_ineligible').recommended, false, 'never recommended purely for having the best secondary quality signals — eligibility gates recommendation first');
  // ranking order itself is untouched by the recommendation fix: eligibility
  // is already the dominant, pre-existing ranking key (see rankKey/
  // ELIGIBILITY_RANK above) — this assertion documents that invariant rather
  // than something the recommendation fix changed.
  assert.equal(ranked[0].id, 'weaker_eligible');
});

test('ranking is deterministic (stable tiebreak by id)', () => {
  const candidates = ['x', 'y', 'z'].map(strongCandidate);
  const r1 = rankAndDeduplicateCandidates(candidates, { max: 5 }).map((c) => c.id);
  const r2 = rankAndDeduplicateCandidates(candidates, { max: 5 }).map((c) => c.id);
  assert.deepEqual(r1, r2);
});

// ---- combination of a controlled_benchmark + linked production candidate ----

function benchmarkCandidateWithEvidence() {
  return {
    id: 'cand_bench',
    quantification_type: 'measured',
    impact_level: 'L2',
    metric_ids: ['metric_bench'],
    evidence_ids: ['ev_cb'],
    measurement_evidence_ids: ['ev_cb'],
    production_evidence_ids: [],
    measurement: {
      method: 'controlled_before_after', before: 1.82, after: 0.47, unit: 'sec', assumptions: [],
    },
    quality_profile: {
      evidence_strength: 'high', measurement_quality: 'high', attribution_strength: 'strong', scope_completeness: 'complete', production_corroboration: false, conflict_status: 'none', resume_eligibility: 'strong',
    },
  };
}

function productionCandidateWithEvidence() {
  return {
    id: 'cand_prod',
    quantification_type: 'measured',
    impact_level: 'L1',
    metric_ids: ['metric_prod'],
    evidence_ids: ['ev_prod'],
    measurement_evidence_ids: ['ev_prod'],
    production_evidence_ids: ['ev_prod'],
    measurement: {
      method: 'production_observed', before: 100, after: 39, unit: 'ms', assumptions: [],
    },
    quality_profile: {
      evidence_strength: 'medium', measurement_quality: 'medium', attribution_strength: 'moderate', scope_completeness: 'missing', production_corroboration: true, conflict_status: 'none', resume_eligibility: 'qualified',
    },
  };
}

test('a controlled benchmark and production candidate combine when their Evidence records are deterministically linked', () => {
  const evidenceById = new Map([
    ['ev_cb', { id: 'ev_cb', type: 'controlled_benchmark', linked_evidence_ids: ['ev_prod'] }],
    ['ev_prod', {
      id: 'ev_prod', type: 'production_metric', name: 'p95 latency', window: { before: '2026-01-01', after: '2026-01-15' }, linked_evidence_ids: ['ev_cb'],
    }],
  ]);
  const metricsById = new Map([['metric_prod', { id: 'metric_prod', result: { value: 61, value_unit: 'percent' } }]]);
  const ranked = rankAndDeduplicateCandidates([benchmarkCandidateWithEvidence(), productionCandidateWithEvidence()], { evidenceById, metricsById, max: 5 });
  assert.equal(ranked.length, 1, 'the two candidates were merged into one combined candidate');
  assert.deepEqual(ranked[0].combined_from, ['cand_bench', 'cand_prod']);
  assert.equal(ranked[0].production_summary.metrics[0].result_value, 61);
  assert.equal(ranked[0].production_summary.window.days, 14);
});

test('a benchmark combines with MULTIPLE linked production Metrics (P95 latency + timeout rate), each preserved independently', () => {
  const evidenceById = new Map([
    ['ev_cb', { id: 'ev_cb', type: 'controlled_benchmark', linked_evidence_ids: ['ev_p95', 'ev_timeout'] }],
    ['ev_p95', {
      id: 'ev_p95', type: 'production_metric', name: 'p95 latency', window: { before: '2026-01-01', after: '2026-01-15' }, linked_evidence_ids: ['ev_cb'],
    }],
    ['ev_timeout', {
      id: 'ev_timeout', type: 'production_metric', name: 'timeout rate', window: { before: '2026-01-01', after: '2026-01-15' }, linked_evidence_ids: ['ev_cb'],
    }],
  ]);
  const metricsById = new Map([
    ['metric_p95', { id: 'metric_p95', result: { value: 61, value_unit: 'percent' } }],
    ['metric_timeout', { id: 'metric_timeout', result: { value: 71.43, value_unit: 'percent' } }],
  ]);
  const p95Candidate = { ...productionCandidateWithEvidence(), id: 'cand_p95', metric_ids: ['metric_p95'], evidence_ids: ['ev_p95'], measurement_evidence_ids: ['ev_p95'], production_evidence_ids: ['ev_p95'] };
  const timeoutCandidate = {
    ...productionCandidateWithEvidence(), id: 'cand_timeout', metric_ids: ['metric_timeout'], evidence_ids: ['ev_timeout'], measurement_evidence_ids: ['ev_timeout'], production_evidence_ids: ['ev_timeout'], measurement: { method: 'production_observed', before: 2.1, after: 0.6, unit: 'percent', assumptions: [] },
  };
  const ranked = rankAndDeduplicateCandidates([benchmarkCandidateWithEvidence(), p95Candidate, timeoutCandidate], { evidenceById, metricsById, max: 5 });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].production_summary.metrics.length, 2);
  const byName = Object.fromEntries(ranked[0].production_summary.metrics.map((m) => [m.name, m]));
  assert.equal(byName['p95 latency'].result_value, 61);
  assert.equal(byName['timeout rate'].before, 2.1);
  assert.equal(byName['timeout rate'].after, 0.6);
  assert.deepEqual(ranked[0].combined_from, ['cand_bench', 'cand_p95', 'cand_timeout']);
});

test('contradictory production values for the same name/window are preserved as a conflict, never silently resolved', () => {
  const evidenceById = new Map([
    ['ev_cb', { id: 'ev_cb', type: 'controlled_benchmark', linked_evidence_ids: ['ev_a', 'ev_b'] }],
    ['ev_a', {
      id: 'ev_a', type: 'production_metric', name: 'p95 latency', window: { before: '2026-01-01', after: '2026-01-15' }, linked_evidence_ids: ['ev_cb'],
    }],
    ['ev_b', {
      id: 'ev_b', type: 'production_metric', name: 'p95 latency', window: { before: '2026-01-01', after: '2026-01-15' }, linked_evidence_ids: ['ev_cb'],
    }],
  ]);
  const metricsById = new Map([
    ['metric_a', { id: 'metric_a', result: { value: 61, value_unit: 'percent' } }],
    ['metric_b', { id: 'metric_b', result: { value: 40, value_unit: 'percent' } }],
  ]);
  const candA = { ...productionCandidateWithEvidence(), id: 'cand_a', metric_ids: ['metric_a'], evidence_ids: ['ev_a'], measurement_evidence_ids: ['ev_a'], production_evidence_ids: ['ev_a'] };
  const candB = { ...productionCandidateWithEvidence(), id: 'cand_b', metric_ids: ['metric_b'], evidence_ids: ['ev_b'], measurement_evidence_ids: ['ev_b'], production_evidence_ids: ['ev_b'], measurement: { method: 'production_observed', before: 100, after: 60, unit: 'ms', assumptions: [] } };
  const ranked = rankAndDeduplicateCandidates([benchmarkCandidateWithEvidence(), candA, candB], { evidenceById, metricsById, max: 5 });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].conflicting_evidence, true);
  assert.equal(ranked[0].production_summary.metrics.length, 2, 'both contradictory metrics are preserved, never silently dropped');
  assert.ok(ranked[0].limitations.some((l) => l.includes('conflicting production values')));
});

test('unrelated production Metrics from the same run are never attached', () => {
  const evidenceById = new Map([
    ['ev_cb', { id: 'ev_cb', type: 'controlled_benchmark', linked_evidence_ids: [] }],
    ['ev_unrelated', { id: 'ev_unrelated', type: 'production_metric', name: 'unrelated metric', linked_evidence_ids: [] }],
  ]);
  const unrelated = { ...productionCandidateWithEvidence(), id: 'cand_unrelated', evidence_ids: ['ev_unrelated'], measurement_evidence_ids: ['ev_unrelated'] };
  const ranked = rankAndDeduplicateCandidates([benchmarkCandidateWithEvidence(), unrelated], { evidenceById, max: 5 });
  assert.equal(ranked.length, 2);
  assert.ok(!ranked.some((c) => c.combined_from));
});

test('two candidates are NOT combined merely because they appeared in the same run without a deterministic link', () => {
  const evidenceById = new Map([
    ['ev_cb', { id: 'ev_cb', type: 'controlled_benchmark', linked_evidence_ids: [] }],
    ['ev_prod', { id: 'ev_prod', type: 'production_metric', name: 'p95 latency', linked_evidence_ids: [] }],
  ]);
  const ranked = rankAndDeduplicateCandidates([benchmarkCandidateWithEvidence(), productionCandidateWithEvidence()], { evidenceById, max: 5 });
  assert.equal(ranked.length, 2, 'unrelated candidates stay separate');
  assert.ok(!ranked.some((c) => c.combined_from));
});

test('incompatible-unit percentages are not ranked solely by magnitude — a lower-percent strong candidate beats a higher-percent weak one', () => {
  const strongSmall = { ...strongCandidate('strong_small') };
  const weakBig = {
    id: 'weak_big', quantification_type: 'measured', impact_level: 'L1', metric_ids: ['metric_weak'], evidence_ids: ['ev_weak'], measurement: { method: 'controlled_before_after' }, quality_profile: { evidence_strength: 'low', measurement_quality: 'low', attribution_strength: 'weak', scope_completeness: 'missing', production_corroboration: false, conflict_status: 'none', resume_eligibility: 'qualified' },
  };
  const ranked = rankAndDeduplicateCandidates([weakBig, strongSmall], { max: 5 });
  assert.equal(ranked[0].id, 'strong_small');
});

// ---- P0-2: real-world SAFER-CC-shaped preservation (5 distinct candidates,
// including the strongest positive and an honest negative) ----

function externalBenchmarkCandidate(id, { outcome = 'improvement', eligibility = 'qualified' } = {}) {
  return {
    id,
    quantification_type: 'measured',
    impact_level: 'L2',
    metric_ids: [`metric_${id}`],
    evidence_ids: [`ev_${id}`],
    measurement: { method: 'explicit_before_after' },
    outcome,
    quality_profile: {
      evidence_strength: 'medium', measurement_quality: 'high', attribution_strength: 'weak', scope_completeness: 'complete', production_corroboration: false, conflict_status: 'none', resume_eligibility: eligibility,
    },
  };
}

test('P0-2: all 5 real candidates survive compilation — strongest positive and honest negative both present', () => {
  const strongestPositive = externalBenchmarkCandidate('best_5_62x');
  const honestNegative = externalBenchmarkCandidate('regression_e', { outcome: 'regression', eligibility: 'ineligible' });
  const middle1 = externalBenchmarkCandidate('mid_1');
  const middle2 = externalBenchmarkCandidate('mid_2');
  const middle3 = externalBenchmarkCandidate('mid_3');
  const ranked = rankAndDeduplicateCandidates(
    [middle1, middle2, middle3, strongestPositive, honestNegative],
  );
  assert.equal(ranked.length, 5);
  const ids = new Set(ranked.map((c) => c.id));
  assert.ok(ids.has('best_5_62x'), 'strongest positive candidate must not be silently dropped');
  assert.ok(ids.has('regression_e'), 'honest negative candidate must not be silently dropped');
});

test('P0-2: an optional top-N presentation view (recommended) never removes the regression from the full array', () => {
  const strongestPositive = externalBenchmarkCandidate('best');
  const honestNegative = externalBenchmarkCandidate('reg', { outcome: 'regression', eligibility: 'ineligible' });
  const ranked = rankAndDeduplicateCandidates([strongestPositive, honestNegative], { recommendedMax: 1 });
  assert.equal(ranked.length, 2);
  const negative = ranked.find((c) => c.id === 'reg');
  assert.ok(negative, 'regression candidate still present in the full array even though it is not "recommended"');
  assert.equal(negative.recommended, false);
});

// ---- P1-5.3: multiple named outputs from ONE benchmark run combine into a
// single candidate instead of fragmenting ----

test('P1-5.3: two candidates sharing the same controlled_benchmark benchmark_id merge into one, unioning metric_ids', () => {
  const evidenceById = new Map([
    ['ev_run', { id: 'ev_run', type: 'controlled_benchmark', benchmark_id: 'bench_routing_v1' }],
  ]);
  const rawCount = {
    id: 'raw_count',
    quantification_type: 'measured',
    impact_level: 'L2',
    metric_ids: ['metric_raw_count'],
    evidence_ids: ['ev_run'],
    measurement_evidence_ids: ['ev_run'],
    measurement: { method: 'controlled_before_after' },
    quality_profile: { evidence_strength: 'high', measurement_quality: 'high', attribution_strength: 'strong', scope_completeness: 'complete', production_corroboration: false, conflict_status: 'none', resume_eligibility: 'strong' },
  };
  const pct = {
    id: 'pct',
    quantification_type: 'measured',
    impact_level: 'L2',
    metric_ids: ['metric_pct'],
    evidence_ids: ['ev_run'],
    measurement_evidence_ids: ['ev_run'],
    measurement: { method: 'controlled_before_after' },
    quality_profile: { evidence_strength: 'high', measurement_quality: 'high', attribution_strength: 'strong', scope_completeness: 'complete', production_corroboration: false, conflict_status: 'none', resume_eligibility: 'strong' },
  };
  const metricsById = new Map([
    ['metric_raw_count', { id: 'metric_raw_count', name: 'raw count', unit: 'count', before: 13, after: 16 }],
    ['metric_pct', { id: 'metric_pct', name: 'accuracy', unit: 'percent', before: 81.25, after: 100 }],
  ]);
  const ranked = rankAndDeduplicateCandidates([rawCount, pct], { evidenceById, metricsById });
  assert.equal(ranked.length, 1, 'same-benchmark_id candidates merge into exactly one');
  assert.deepEqual(new Set(ranked[0].metric_ids), new Set(['metric_raw_count', 'metric_pct']));
});

test('P1-5.3: controlled_benchmark candidates from DIFFERENT runs (different benchmark_id) are never merged', () => {
  const evidenceById = new Map([
    ['ev_run1', { id: 'ev_run1', type: 'controlled_benchmark', benchmark_id: 'bench_a' }],
    ['ev_run2', { id: 'ev_run2', type: 'controlled_benchmark', benchmark_id: 'bench_b' }],
  ]);
  const c1 = {
    id: 'c1', quantification_type: 'measured', impact_level: 'L2', metric_ids: ['m1'], evidence_ids: ['ev_run1'], measurement_evidence_ids: ['ev_run1'], measurement: { method: 'controlled_before_after' }, quality_profile: { evidence_strength: 'high', measurement_quality: 'high', attribution_strength: 'strong', scope_completeness: 'complete', production_corroboration: false, conflict_status: 'none', resume_eligibility: 'strong' },
  };
  const c2 = {
    id: 'c2', quantification_type: 'measured', impact_level: 'L2', metric_ids: ['m2'], evidence_ids: ['ev_run2'], measurement_evidence_ids: ['ev_run2'], measurement: { method: 'controlled_before_after' }, quality_profile: { evidence_strength: 'high', measurement_quality: 'high', attribution_strength: 'strong', scope_completeness: 'complete', production_corroboration: false, conflict_status: 'none', resume_eligibility: 'strong' },
  };
  const ranked = rankAndDeduplicateCandidates([c1, c2], { evidenceById, metricsById: new Map() });
  assert.equal(ranked.length, 2);
});
