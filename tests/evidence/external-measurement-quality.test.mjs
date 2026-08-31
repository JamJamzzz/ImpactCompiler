import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyExternalMeasurementQuality } from '../../src/evidence/external-measurement-quality.mjs';

test('P0-1: repetitions >= 5 with a variance signal (stddev/min/max/raw_samples) classifies high', () => {
  assert.equal(classifyExternalMeasurementQuality({ repetitions: 5, min: { before: 1, after: 2 } }), 'high');
  assert.equal(classifyExternalMeasurementQuality({ repetitions: 20, stddev: { before: 0.1, after: 0.2 } }), 'high');
  assert.equal(classifyExternalMeasurementQuality({ repetitions: 5, raw_samples: { before: [1, 2], after: [3, 4] } }), 'high');
});

test('P0-1: repetitions >= 5 with NO variance signal classifies medium', () => {
  assert.equal(classifyExternalMeasurementQuality({ repetitions: 5 }), 'medium');
  assert.equal(classifyExternalMeasurementQuality({ repetitions: 100 }), 'medium');
});

test('P0-1: a small number of repetitions (1-4) classifies low', () => {
  assert.equal(classifyExternalMeasurementQuality({ repetitions: 1 }), 'low');
  assert.equal(classifyExternalMeasurementQuality({ repetitions: 4, min: { before: 1, after: 2 } }), 'low');
});

test('P0-1: deterministic:true (explicitly asserted) classifies high regardless of repetitions', () => {
  assert.equal(classifyExternalMeasurementQuality({ deterministic: true }), 'high');
  assert.equal(classifyExternalMeasurementQuality({ deterministic: true, repetitions: 1 }), 'high');
});

test('P0-1: no measurement-context fields at all classifies unknown, NOT insufficient', () => {
  const result = classifyExternalMeasurementQuality({});
  assert.equal(result, 'unknown');
  assert.notEqual(result, 'insufficient');
});

test('P0-1: unknown !== insufficient — a partially-populated artifact with no repetitions is still unknown, not penalized as bad', () => {
  assert.equal(classifyExternalMeasurementQuality({ statistic: 'median', environment: { os: 'linux' } }), 'unknown');
});

test('P0-1: a bare self-reported figure with zero corroboration classifies insufficient — the one case genuinely worse than unknown', () => {
  assert.equal(classifyExternalMeasurementQuality({ verification_status: 'self_reported' }), 'insufficient');
});

test('P0-1: self_reported WITH a variance signal is not penalized to insufficient', () => {
  const result = classifyExternalMeasurementQuality({ verification_status: 'self_reported', min: { before: 1, after: 2 } });
  assert.notEqual(result, 'insufficient');
  assert.equal(result, 'unknown');
});
