import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateQuantitativeFact, normalizeQuantitativeFact } from '../../src/facts/quantitative-fact.mjs';

function baseFact(overrides = {}) {
  return {
    fact_id: 'fact_runs_per_week',
    name: 'workflow runs per week',
    value: 12,
    unit: 'runs/week',
    verification_status: 'verified',
    source_reference: 'operations-report-2026-Q2',
    evidence_id: 'ev_ops_report',
    ...overrides,
  };
}

test('a valid fact passes', () => {
  const result = validateQuantitativeFact(baseFact());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test('missing fact_id is rejected', () => {
  const fact = baseFact();
  delete fact.fact_id;
  const result = validateQuantitativeFact(fact);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('fact_id')));
});

test('non-finite value is rejected', () => {
  const result = validateQuantitativeFact(baseFact({ value: NaN }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('value')));
});

test('missing unit is rejected', () => {
  const fact = baseFact();
  delete fact.unit;
  const result = validateQuantitativeFact(fact);
  assert.equal(result.ok, false);
});

test('invalid verification_status is rejected (not free text)', () => {
  const result = validateQuantitativeFact(baseFact({ verification_status: 'pretty-sure' }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('verification_status')));
});

test('missing evidence_id is rejected — a fact must always trace to Evidence', () => {
  const fact = baseFact();
  delete fact.evidence_id;
  const result = validateQuantitativeFact(fact);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('evidence_id')));
});

test('a self-reported fact is still a valid fact — verification_status honestly reflects its source, never upgraded', () => {
  const result = validateQuantitativeFact(baseFact({ verification_status: 'self_reported' }));
  assert.equal(result.ok, true);
});

test('normalizeQuantitativeFact defaults optional fields without fabricating required ones', () => {
  const normalized = normalizeQuantitativeFact(baseFact());
  assert.equal(normalized.window, null);
  assert.equal(normalized.scope, null);
  assert.deepEqual(normalized.assumptions, []);
  assert.equal(normalized.value, 12);
});

test('window/scope must be objects when present', () => {
  const result = validateQuantitativeFact(baseFact({ window: 'last week' }));
  assert.equal(result.ok, false);
});

test('assumptions must be a string array when present', () => {
  const result = validateQuantitativeFact(baseFact({ assumptions: [1, 2] }));
  assert.equal(result.ok, false);
});
