import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDerivationRequest, resolveAndComputeDerivation } from '../../src/derived/derivation-request.mjs';

function lookups(overrides = {}) {
  const benchmarkEvidence = {
    id: 'ev_bench', type: 'controlled_benchmark', benchmark_id: 'customer-matching-v1',
  };
  const metric = {
    id: 'metric_bench', before: 30, after: 5, unit: 'minutes', evidence_ids: ['ev_bench'],
  };
  const fact = {
    fact_id: 'fact_runs_per_week', value: 12, unit: 'runs/week', evidence_id: 'ev_fact', verification_status: 'verified',
  };
  return {
    metricsById: new Map([[metric.id, metric]]),
    metrics: [metric],
    evidenceById: new Map([[benchmarkEvidence.id, benchmarkEvidence]]),
    factsById: new Map([[fact.fact_id, fact]]),
    ...overrides,
  };
}

test('valid derivation request passes validation', () => {
  const result = validateDerivationRequest({
    derivation_id: 'd1', formula_id: 'annual_time_saved', inputs: {}, output: { name: 'x' },
  });
  assert.equal(result.ok, true);
});

test('unknown formula_id is rejected', () => {
  const result = validateDerivationRequest({
    derivation_id: 'd1', formula_id: 'multiply_by_pi', inputs: {}, output: { name: 'x' },
  });
  assert.equal(result.ok, false);
});

test('resolves duration_metric via benchmark_id, chains into total_time_saved', () => {
  const request = {
    derivation_id: 'd1',
    formula_id: 'total_time_saved',
    inputs: {
      duration_metric: { benchmark_id: 'customer-matching-v1' },
      event_count_fact_id: 'fact_runs_per_week',
    },
    output: { name: 'weekly time saved' },
  };
  const result = resolveAndComputeDerivation(request, lookups());
  assert.equal(result.ok, true);
  assert.equal(result.metric.value, 25 * 12); // 25 minutes/run * 12 runs
  assert.equal(result.metric.unit, 'minutes');
  assert.ok(result.evidenceIds.includes('ev_bench'));
  assert.ok(result.evidenceIds.includes('ev_fact'));
});

test('annual_time_saved: 30min->5min benchmark, 12 runs/week fact, explicit 52 weeks/year -> 15,600 minutes/year', () => {
  const request = {
    derivation_id: 'annual-matching-time-saved',
    formula_id: 'annual_time_saved',
    inputs: {
      duration_metric: { benchmark_id: 'customer-matching-v1' },
      events_per_period_fact_id: 'fact_runs_per_week',
      periods_per_year: { value: 52, unit: 'weeks/year', source: 'explicit_convention' },
    },
    output: {
      name: 'annual engineering time saved', unit: 'minutes/year', impact_domain: 'operational_efficiency', impact_level: 'L3',
    },
  };
  const result = resolveAndComputeDerivation(request, lookups());
  assert.equal(result.ok, true);
  assert.equal(result.metric.value, 25 * 12 * 52);
  assert.equal(result.metric.unit, 'minutes/year');
  assert.equal(result.metric.quantification_type, 'estimated');
  assert.equal(result.metric.assumptions.length, 1);
});

test('missing fact input produces a derivation opportunity, never a fabricated metric', () => {
  const request = {
    derivation_id: 'd1',
    formula_id: 'total_time_saved',
    inputs: { duration_metric: { benchmark_id: 'customer-matching-v1' }, event_count_fact_id: 'fact_does_not_exist' },
    output: { name: 'x' },
  };
  const result = resolveAndComputeDerivation(request, lookups());
  assert.equal(result.ok, false);
  assert.equal(result.opportunity.formula_id, 'total_time_saved');
  assert.match(result.opportunity.note, /fact_does_not_exist/);
});

test('unknown benchmark_id produces a derivation opportunity', () => {
  const request = {
    derivation_id: 'd1', formula_id: 'time_saved_per_event', inputs: { duration_metric: { benchmark_id: 'nonexistent' } }, output: { name: 'x' },
  };
  const result = resolveAndComputeDerivation(request, lookups());
  assert.equal(result.ok, false);
  assert.match(result.opportunity.note, /nonexistent/);
});

test('direct metric_id reference resolves to that Metric\'s result value', () => {
  const request = {
    derivation_id: 'd1',
    formula_id: 'resource_cost_savings',
    inputs: {
      resource_reduction: { value: 10, unit: 'hour' },
      unit_cost: { value: 50, unit: 'USD/hour' },
      usage_or_period: { value: 4, unit: 'weeks' },
    },
    output: { name: 'cost saved' },
  };
  const result = resolveAndComputeDerivation(request, lookups());
  assert.equal(result.ok, true);
  assert.equal(result.metric.value, 2000);
  assert.equal(result.metric.quantification_type, 'derived');
});

// ---- explicit unit conversion (item 2) ----

test('an explicit output.unit triggers an exact conversion, appended to the original calculation', () => {
  const request = {
    derivation_id: 'annual-matching-time-saved',
    formula_id: 'annual_time_saved',
    inputs: {
      duration_metric: { benchmark_id: 'customer-matching-v1' },
      events_per_period_fact_id: 'fact_runs_per_week',
      periods_per_year: { value: 52, unit: 'weeks/year', source: 'explicit_convention' },
    },
    output: { name: 'annual engineering time saved', unit: 'hours/year' },
  };
  const result = resolveAndComputeDerivation(request, lookups());
  assert.equal(result.ok, true);
  assert.equal(result.metric.value, 260);
  assert.equal(result.metric.unit, 'hours/year');
  assert.equal(result.metric.calculation, '(25 minutes × 12 runs/week × 52 weeks/year) / 60');
});

test('no output.unit means no conversion is attempted — the formula\'s natural unit is kept', () => {
  const request = {
    derivation_id: 'd1',
    formula_id: 'total_time_saved',
    inputs: { duration_metric: { benchmark_id: 'customer-matching-v1' }, event_count_fact_id: 'fact_runs_per_week' },
    output: { name: 'x' },
  };
  const result = resolveAndComputeDerivation(request, lookups());
  assert.equal(result.ok, true);
  assert.equal(result.metric.unit, 'minutes');
});

test('an incompatible requested output unit produces a derivation opportunity, never a silently mismatched Metric', () => {
  const request = {
    derivation_id: 'd1',
    formula_id: 'total_time_saved',
    inputs: { duration_metric: { benchmark_id: 'customer-matching-v1' }, event_count_fact_id: 'fact_runs_per_week' },
    output: { name: 'x', unit: 'gb' },
  };
  const result = resolveAndComputeDerivation(request, lookups());
  assert.equal(result.ok, false);
  assert.match(result.opportunity.note, /incompatible/);
});

// ---- annualization classification via annual_event_count ----

test('a verified annual_event_count fact resolves to a DERIVED annual result, no extrapolation assumption', () => {
  const factsById = new Map([
    ['fact_runs_per_week', {
      fact_id: 'fact_runs_per_week', value: 12, unit: 'runs/week', evidence_id: 'ev_fact', verification_status: 'verified',
    }],
    ['fact_annual_runs', {
      fact_id: 'fact_annual_runs', value: 624, unit: 'runs/year', evidence_id: 'ev_annual_fact', verification_status: 'verified',
    }],
  ]);
  const request = {
    derivation_id: 'd1',
    formula_id: 'annual_time_saved',
    inputs: {
      duration_metric: { benchmark_id: 'customer-matching-v1' },
      annual_event_count_fact_id: 'fact_annual_runs',
    },
    output: { name: 'x' },
  };
  const result = resolveAndComputeDerivation(request, lookups({ factsById }));
  assert.equal(result.ok, true);
  assert.equal(result.metric.quantification_type, 'derived');
  assert.deepEqual(result.metric.assumptions, []);
});

test('a self-reported annual_event_count fact resolves to an ESTIMATED annual result', () => {
  const factsById = new Map([
    ['fact_annual_runs', {
      fact_id: 'fact_annual_runs', value: 624, unit: 'runs/year', evidence_id: 'ev_annual_fact', verification_status: 'self_reported',
    }],
  ]);
  const request = {
    derivation_id: 'd1',
    formula_id: 'annual_time_saved',
    inputs: {
      duration_metric: { benchmark_id: 'customer-matching-v1' },
      annual_event_count_fact_id: 'fact_annual_runs',
    },
    output: { name: 'x' },
  };
  const result = resolveAndComputeDerivation(request, lookups({ factsById }));
  assert.equal(result.ok, true);
  assert.equal(result.metric.quantification_type, 'estimated');
});

test('an unrecognized input reference shape produces a derivation opportunity', () => {
  const request = {
    derivation_id: 'd1', formula_id: 'resource_cost_savings', inputs: { resource_reduction: 'not-a-valid-ref' }, output: { name: 'x' },
  };
  const result = resolveAndComputeDerivation(request, lookups());
  assert.equal(result.ok, false);
});
