import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMetric } from '../../src/metrics/deterministic-metric-engine.mjs';

test('golden case: matching runtime 1.82 -> 0.47 sec, percentage_reduction', () => {
  const result = computeMetric({
    id: 'metric_golden',
    name: 'matching runtime',
    before: 1.82,
    after: 0.47,
    unit: 'sec',
    operation: 'percentage_reduction',
    direction: 'lower_is_better',
    evidenceIds: ['ev_1'],
    confidence: 'high',
  });
  assert.equal(result.ok, true);
  assert.equal(result.metric.absolute_delta, -1.35);
  assert.equal(result.metric.relative_change_percent, 74.18);
  assert.equal(result.metric.calculation, '(1.82 - 0.47) / 1.82 * 100');
  assert.equal(result.metric.direction, 'lower_is_better');
});

test('zero-denominator is protected, never silent Infinity', () => {
  const result = computeMetric({
    id: 'm', name: 'x', before: 0, after: 5, unit: 'count', operation: 'percentage_increase', direction: 'higher_is_better', evidenceIds: [], confidence: 'high',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'zero_denominator');
});

test('ratio operation with zero before is also protected', () => {
  const result = computeMetric({
    id: 'm', name: 'x', before: 0, after: 5, unit: 'count', operation: 'ratio', direction: 'higher_is_better', evidenceIds: [], confidence: 'high',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'zero_denominator');
});

test('missing values are rejected, not coerced', () => {
  const result = computeMetric({
    id: 'm', name: 'x', before: undefined, after: 5, unit: 'count', operation: 'absolute_delta', direction: 'higher_is_better', evidenceIds: [], confidence: 'high',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'missing_value');
});

test('unit mismatch is flagged, never coerced', () => {
  const result = computeMetric({
    id: 'm', name: 'x', before: 10, beforeUnit: 'sec', after: 5, afterUnit: 'ms', unit: 'sec', operation: 'absolute_delta', direction: 'lower_is_better', evidenceIds: [], confidence: 'high',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'unit_mismatch');
});

test('higher_is_better direction with percentage_increase', () => {
  const result = computeMetric({
    id: 'm', name: 'throughput', before: 100, after: 150, unit: 'req/s', operation: 'percentage_increase', direction: 'higher_is_better', evidenceIds: [], confidence: 'high',
  });
  assert.equal(result.ok, true);
  assert.equal(result.metric.absolute_delta, 50);
  assert.equal(result.metric.relative_change_percent, 50);
});

test('absolute_delta operation records a plain subtraction calculation', () => {
  const result = computeMetric({
    id: 'm', name: 'memory', before: 512, after: 256, unit: 'MB', operation: 'absolute_delta', direction: 'lower_is_better', evidenceIds: [], confidence: 'high',
  });
  assert.equal(result.ok, true);
  assert.equal(result.metric.calculation, '256 - 512');
  assert.equal(result.metric.absolute_delta, -256);
});

test('ratio operation records a division calculation', () => {
  const result = computeMetric({
    id: 'm', name: 'speedup', before: 4, after: 1, unit: 'x', operation: 'ratio', direction: 'lower_is_better', evidenceIds: [], confidence: 'high',
  });
  assert.equal(result.ok, true);
  assert.equal(result.metric.calculation, '1 / 4');
  assert.equal(result.metric.relative_change_percent, null);
});

test('unknown operation is rejected', () => {
  const result = computeMetric({
    id: 'm', name: 'x', before: 1, after: 2, unit: 'x', operation: 'nonsense', direction: 'lower_is_better', evidenceIds: [], confidence: 'high',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'invalid_operation');
});

test('unknown direction is rejected', () => {
  const result = computeMetric({
    id: 'm', name: 'x', before: 1, after: 2, unit: 'x', operation: 'absolute_delta', direction: 'sideways', evidenceIds: [], confidence: 'high',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'invalid_direction');
});

// ---- Quantification V1: signed percentage semantics, `result`, `outcome' ----

test('percentage_reduction regression (after > before) is NOT hidden by abs() — value is negative', () => {
  const result = computeMetric({
    id: 'm', name: 'runtime', before: 1.0, after: 1.5, unit: 'sec', operation: 'percentage_reduction', direction: 'lower_is_better', evidenceIds: [], confidence: 'high',
  });
  assert.equal(result.ok, true);
  assert.equal(result.metric.relative_change_percent, -50);
  assert.equal(result.metric.result.value, -50);
  assert.equal(result.metric.result.outcome, 'regression');
});

test('percentage_increase regression (after < before) is also negative, not hidden', () => {
  const result = computeMetric({
    id: 'm', name: 'throughput', before: 100, after: 60, unit: 'req/s', operation: 'percentage_increase', direction: 'higher_is_better', evidenceIds: [], confidence: 'high',
  });
  assert.equal(result.ok, true);
  assert.equal(result.metric.relative_change_percent, -40);
  assert.equal(result.metric.result.outcome, 'regression');
});

test('absolute_delta allows before = 0', () => {
  const result = computeMetric({
    id: 'm', name: 'errors', before: 0, after: 5, unit: 'count', operation: 'absolute_delta', direction: 'lower_is_better', evidenceIds: [], confidence: 'high',
  });
  assert.equal(result.ok, true);
  assert.equal(result.metric.absolute_delta, 5);
  assert.equal(result.metric.result.outcome, 'regression');
});

test('percentage_reduction rejects before = 0', () => {
  const result = computeMetric({
    id: 'm', name: 'x', before: 0, after: 5, unit: 'count', operation: 'percentage_reduction', direction: 'lower_is_better', evidenceIds: [], confidence: 'high',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'zero_denominator');
});

test('ratio stores its computed result explicitly, not just as a calculation string', () => {
  const result = computeMetric({
    id: 'm', name: 'speedup', before: 4, after: 1, unit: 'x', operation: 'ratio', direction: 'lower_is_better', evidenceIds: [], confidence: 'high',
  });
  assert.equal(result.ok, true);
  assert.equal(result.metric.result.value, 0.25);
  assert.equal(result.metric.result.value_unit, 'ratio');
});

test('calculation string reflects abs(before) when before is negative', () => {
  const result = computeMetric({
    id: 'm', name: 'x', before: -10, after: -15, unit: 'x', operation: 'percentage_reduction', direction: 'lower_is_better', evidenceIds: [], confidence: 'high',
  });
  assert.equal(result.ok, true);
  assert.equal(result.metric.calculation, '(-10 - -15) / 10 * 100');
});

test('outcome is no_change when before === after', () => {
  const result = computeMetric({
    id: 'm', name: 'x', before: 5, after: 5, unit: 'x', operation: 'absolute_delta', direction: 'lower_is_better', evidenceIds: [], confidence: 'high',
  });
  assert.equal(result.ok, true);
  assert.equal(result.metric.result.outcome, 'no_change');
});

test('improvement outcome for the golden case', () => {
  const result = computeMetric({
    id: 'm', name: 'runtime', before: 1.82, after: 0.47, unit: 'sec', operation: 'percentage_reduction', direction: 'lower_is_better', evidenceIds: [], confidence: 'high',
  });
  assert.equal(result.ok, true);
  assert.equal(result.metric.result.outcome, 'improvement');
  assert.equal(result.metric.result.value_unit, 'percent');
});
