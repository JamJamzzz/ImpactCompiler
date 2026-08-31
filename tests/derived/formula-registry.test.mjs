import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDerivedMetric, describeDerivationOpportunity, FORMULA_IDS } from '../../src/derived/formula-registry.mjs';

function slot(value, unit, extra = {}) {
  return { value, unit, ...extra };
}

test('time_saved_per_event: before - after, same unit', () => {
  const result = computeDerivedMetric('time_saved_per_event', {
    before_duration: slot(1.82, 'sec', { evidence_id: 'ev_metric' }),
    after_duration: slot(0.47, 'sec', { evidence_id: 'ev_metric' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.metric.value, 1.35);
  assert.equal(result.metric.unit, 'sec');
  assert.equal(result.metric.quantification_type, 'derived');
  assert.deepEqual(result.metric.assumptions, []);
  assert.ok(result.metric.evidence_ids.includes('ev_metric'));
});

test('time_saved_per_event rejects mismatched units', () => {
  const result = computeDerivedMetric('time_saved_per_event', {
    before_duration: slot(1.82, 'sec'),
    after_duration: slot(470, 'ms'),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'unit_mismatch');
});

test('total_time_saved: per-event savings × verified event count', () => {
  const result = computeDerivedMetric('total_time_saved', {
    time_saved_per_event: slot(1.35, 'sec', { evidence_id: 'ev_metric' }),
    event_count: slot(500, 'events', { fact_id: 'fact_events', verification_status: 'verified' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.metric.value, 675);
  assert.equal(result.metric.unit, 'sec');
  assert.equal(result.metric.quantification_type, 'derived');
});

test('annual_time_saved requires an explicit periods_per_year and is always estimated (records the annualization as an assumption)', () => {
  const result = computeDerivedMetric('annual_time_saved', {
    time_saved_per_event: slot(1.35, 'sec', { evidence_id: 'ev_metric' }),
    events_per_period: slot(500, 'events/week', { fact_id: 'fact_weekly' }),
    periods_per_year: slot(52, 'weeks/year', { fact_id: 'fact_convention' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.metric.quantification_type, 'estimated');
  assert.equal(result.metric.assumptions.length, 1);
  assert.match(result.metric.assumptions[0], /periods_per_year=52/);
  assert.equal(result.metric.value, 1.35 * 500 * 52);
});

// ---- annual_time_saved: annual_event_count path (derived vs estimated) ----

test('annual_time_saved is DERIVED when given a verified complete annual_event_count (no extrapolation)', () => {
  const result = computeDerivedMetric('annual_time_saved', {
    time_saved_per_event: slot(25, 'minutes', { evidence_id: 'ev_bench', verification_status: 'verified' }),
    annual_event_count: slot(624, 'runs/year', { fact_id: 'fact_annual', verification_status: 'verified' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.metric.quantification_type, 'derived');
  assert.deepEqual(result.metric.assumptions, []);
  assert.equal(result.metric.value, 25 * 624);
  assert.equal(result.metric.unit, 'minutes');
});

test('annual_time_saved with an unverified annual_event_count is ESTIMATED, never silently promoted', () => {
  const result = computeDerivedMetric('annual_time_saved', {
    time_saved_per_event: slot(25, 'minutes', { verification_status: 'verified' }),
    annual_event_count: slot(624, 'runs/year', { fact_id: 'fact_annual', verification_status: 'unverified' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.metric.quantification_type, 'estimated');
  assert.match(result.metric.assumptions[0], /annual_event_count/);
});

test('annual_time_saved with a self-reported annual_event_count is ESTIMATED, never DERIVED', () => {
  const result = computeDerivedMetric('annual_time_saved', {
    time_saved_per_event: slot(25, 'minutes', { verification_status: 'verified' }),
    annual_event_count: slot(624, 'runs/year', { fact_id: 'fact_annual', verification_status: 'self_reported' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.metric.quantification_type, 'estimated');
});

test('an unverified time_saved_per_event input also propagates to an estimated annual result', () => {
  const result = computeDerivedMetric('annual_time_saved', {
    time_saved_per_event: slot(25, 'minutes', { verification_status: 'self_reported' }),
    annual_event_count: slot(624, 'runs/year', { verification_status: 'verified' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.metric.quantification_type, 'estimated');
  assert.match(result.metric.assumptions[0], /time_saved_per_event/);
});

test('the events_per_period × periods_per_year extrapolation path is ALWAYS estimated, even with fully verified inputs — a future-continuation assumption, not an evidence gap', () => {
  const result = computeDerivedMetric('annual_time_saved', {
    time_saved_per_event: slot(25, 'minutes', { verification_status: 'verified' }),
    events_per_period: slot(12, 'runs/week', { verification_status: 'verified' }),
    periods_per_year: slot(52, 'weeks/year', { verification_status: 'verified' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.metric.quantification_type, 'estimated');
  assert.match(result.metric.assumptions[0], /continues for the remainder of the year/);
});

test('annual_time_saved never silently defaults periods_per_year — missing input is rejected', () => {
  const result = computeDerivedMetric('annual_time_saved', {
    time_saved_per_event: slot(1.35, 'sec'),
    events_per_period: slot(500, 'events/week'),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'missing_input');
});

test('resource_cost_savings requires currency/unit-compatible unit_cost and is derived when all inputs are verified', () => {
  const result = computeDerivedMetric('resource_cost_savings', {
    resource_reduction: slot(10, 'hour', { fact_id: 'fact_reduction', verification_status: 'verified' }),
    unit_cost: slot(50, 'USD/hour', { fact_id: 'fact_cost', verification_status: 'verified' }),
    usage_or_period: slot(4, 'weeks', { fact_id: 'fact_period', verification_status: 'verified' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.metric.value, 2000);
  assert.equal(result.metric.unit, 'USD');
  assert.equal(result.metric.quantification_type, 'derived');
});

test('resource_cost_savings downgrades to estimated when an input is not verified, never silently promoted', () => {
  const result = computeDerivedMetric('resource_cost_savings', {
    resource_reduction: slot(10, 'hour', { verification_status: 'self_reported' }),
    unit_cost: slot(50, 'USD/hour', { verification_status: 'verified' }),
    usage_or_period: slot(4, 'weeks', { verification_status: 'verified' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.metric.quantification_type, 'estimated');
  assert.match(result.metric.assumptions[0], /resource_reduction/);
});

test('resource_cost_savings rejects an incompatible resource unit (no implicit conversion)', () => {
  const result = computeDerivedMetric('resource_cost_savings', {
    resource_reduction: slot(10, 'day'),
    unit_cost: slot(50, 'USD/hour'),
    usage_or_period: slot(4, 'weeks'),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'unit_mismatch');
});

test('resource_cost_savings rejects a unit_cost without a "/" (currency/resource-unit) form', () => {
  const result = computeDerivedMetric('resource_cost_savings', {
    resource_reduction: slot(10, 'hour'),
    unit_cost: slot(50, 'USD'),
    usage_or_period: slot(4, 'weeks'),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'unit_mismatch');
});

test('an unknown formula id is rejected outright — no arbitrary formulas', () => {
  const result = computeDerivedMetric('multiply_by_pi', { x: slot(1, 'x') });
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'invalid_input');
});

test('missing inputs never fabricate a result', () => {
  const result = computeDerivedMetric('total_time_saved', { time_saved_per_event: slot(1, 'sec') });
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'missing_input');
});

test('zero/negative event_count is rejected, not silently producing zero savings', () => {
  const result = computeDerivedMetric('total_time_saved', {
    time_saved_per_event: slot(1.35, 'sec'),
    event_count: slot(0, 'events'),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'invalid_input');
});

test('FORMULA_IDS exposes the closed whitelist', () => {
  assert.deepEqual(FORMULA_IDS, ['time_saved_per_event', 'total_time_saved', 'annual_time_saved', 'resource_cost_savings']);
});

test('describeDerivationOpportunity preserves what is missing instead of fabricating a result', () => {
  const opp = describeDerivationOpportunity('total_time_saved', ['event_count']);
  assert.equal(opp.formula_id, 'total_time_saved');
  assert.deepEqual(opp.missing_inputs, ['event_count']);
  assert.match(opp.note, /event_count/);
});
