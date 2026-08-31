import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProductionMetricArtifact } from '../../src/evidence/production-metric-adapter.mjs';

test('valid canonical production metric resolves with full context preserved', () => {
  const result = parseProductionMetricArtifact({
    name: 'p95 request latency',
    before: 820,
    after: 310,
    unit: 'ms',
    direction: 'lower_is_better',
    operation: 'percentage_reduction',
    environment: 'production',
    service: 'customer-import',
    window: { before: '2026-01-01/2026-01-07', after: '2026-02-01/2026-02-07' },
    sample_size: { before: 1200000, after: 1400000 },
    source: 'exports/customer-import-latency.json',
  }, 'fixtures/prod-metric.json');

  assert.equal(result.resolution, 'resolved');
  assert.equal(result.environment, 'production');
  assert.equal(result.service, 'customer-import');
  assert.deepEqual(result.window, { before: '2026-01-01/2026-01-07', after: '2026-02-01/2026-02-07' });
  assert.deepEqual(result.sample_size, { before: 1200000, after: 1400000 });
});

test('missing before/after is unresolved — never inferred from a log sentence', () => {
  const result = parseProductionMetricArtifact({ name: 'error rate', unit: 'percent' }, 'x.json');
  assert.equal(result.resolution, 'unresolved');
  assert.match(result.reason, /before\/after/);
});

test('missing direction is unresolved — explicit direction required when "better" is ambiguous', () => {
  const result = parseProductionMetricArtifact({
    name: 'deployment frequency', before: 2, after: 5, unit: 'per_week',
  }, 'x.json');
  assert.equal(result.resolution, 'unresolved');
  assert.match(result.reason, /direction/);
});

test('environment is optional — a metric without one still resolves (the "production impact" language gate is a prompt-level rule, not a parse-time rejection)', () => {
  const result = parseProductionMetricArtifact({
    name: 'p99 latency', before: 500, after: 200, unit: 'ms', direction: 'lower_is_better',
  }, 'x.json');
  assert.equal(result.resolution, 'resolved');
  assert.equal(result.environment, null);
});

test('non-numeric sample_size is unresolved, never coerced', () => {
  const result = parseProductionMetricArtifact({
    name: 'x', before: 1, after: 2, unit: 'ms', direction: 'lower_is_better', sample_size: { before: 'a lot', after: 100 },
  }, 'x.json');
  assert.equal(result.resolution, 'unresolved');
});

test('explicit operation is passed through when valid (same rule as benchmark-adapter.mjs)', () => {
  const result = parseProductionMetricArtifact({
    name: 'cache hit rate', before: 0.6, after: 0.9, unit: 'ratio', direction: 'higher_is_better', operation: 'percentage_increase',
  }, 'x.json');
  assert.equal(result.operation, 'percentage_increase');
});

test('non-object artifact is unsupported', () => {
  const result = parseProductionMetricArtifact('just a string', 'x.json');
  assert.equal(result.resolution, 'unsupported');
});

test('aggregation method is preserved when supplied', () => {
  const result = parseProductionMetricArtifact({
    name: 'p95 request latency', before: 820, after: 310, unit: 'ms', direction: 'lower_is_better', aggregation: 'p95',
  }, 'x.json');
  assert.equal(result.aggregation, 'p95');
});

test('aggregation is null (not fabricated) when absent', () => {
  const result = parseProductionMetricArtifact({
    name: 'x', before: 1, after: 2, unit: 'ms', direction: 'lower_is_better',
  }, 'x.json');
  assert.equal(result.aggregation, null);
});

test('deployment frequency / incident count metrics still require explicit direction, same as any other metric name', () => {
  const result = parseProductionMetricArtifact({ name: 'incident count', before: 3, after: 1, unit: 'count' }, 'x.json');
  assert.equal(result.resolution, 'unresolved');
  assert.match(result.reason, /direction/);
});
