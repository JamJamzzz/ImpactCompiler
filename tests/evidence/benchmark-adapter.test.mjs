import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBenchmarkArtifact } from '../../src/evidence/benchmark-adapter.mjs';

test('valid canonical artifact resolves', () => {
  const result = parseBenchmarkArtifact({
    name: 'matching runtime', before: 1.82, after: 0.47, unit: 'sec', direction: 'lower_is_better',
  }, 'fixtures/matching-runtime/benchmark.json');
  assert.equal(result.resolution, 'resolved');
  assert.equal(result.before, 1.82);
});

test('missing before/after is unresolved, never guessed into a metric', () => {
  const result = parseBenchmarkArtifact({ name: 'some test', unit: 'sec', direction: 'lower_is_better' }, 'x.json');
  assert.equal(result.resolution, 'unresolved');
  assert.match(result.reason, /before\/after/);
});

test('ambiguous/invalid unit is unresolved', () => {
  const result = parseBenchmarkArtifact({
    name: 'x', before: 1, after: 2, direction: 'lower_is_better',
  }, 'x.json');
  assert.equal(result.resolution, 'unresolved');
  assert.match(result.reason, /unit/);
});

test('invalid numeric fields are unresolved', () => {
  const result = parseBenchmarkArtifact({
    name: 'x', before: 'not a number', after: 2, unit: 'sec', direction: 'lower_is_better',
  }, 'x.json');
  assert.equal(result.resolution, 'unresolved');
});

test('non-object artifact is unsupported', () => {
  const result = parseBenchmarkArtifact('just a string', 'x.json');
  assert.equal(result.resolution, 'unsupported');
});

test('invalid direction is unresolved', () => {
  const result = parseBenchmarkArtifact({
    name: 'x', before: 1, after: 2, unit: 'sec', direction: 'sideways',
  }, 'x.json');
  assert.equal(result.resolution, 'unresolved');
});

test('explicit operation is passed through when valid', () => {
  const result = parseBenchmarkArtifact({
    name: 'x', before: 4, after: 1, unit: 'x', direction: 'lower_is_better', operation: 'ratio',
  }, 'x.json');
  assert.equal(result.operation, 'ratio');
});

// ---- P0-1/P1-5.1: optional measurement-context/scope fields ----

test('a bare canonical artifact (no measurement-context fields) still resolves, with no measurement-context keys added', () => {
  const result = parseBenchmarkArtifact({
    name: 'x', before: 1, after: 2, unit: 'sec', direction: 'lower_is_better',
  }, 'x.json');
  assert.equal(result.resolution, 'resolved');
  assert.equal(result.repetitions, undefined);
  assert.equal(result.scope, undefined);
});

test('repetitions/statistic/min/max/stddev/deterministic/environment/verification_status/scope are all captured when supplied', () => {
  const result = parseBenchmarkArtifact({
    name: 'x',
    before: 8771.51,
    after: 49336.65,
    unit: 'ops/sec',
    direction: 'higher_is_better',
    repetitions: 5,
    statistic: 'median',
    min: { before: 8532, after: 41269 },
    max: { before: 8870, after: 50001 },
    stddev: { before: 12.3, after: 88.1 },
    deterministic: false,
    environment: { os: 'windows', num_cpu: 12 },
    verification_status: 'verified',
    scope: { workers: 64, files: 32 },
  }, 'x.json');
  assert.equal(result.repetitions, 5);
  assert.equal(result.statistic, 'median');
  assert.deepEqual(result.min, { before: 8532, after: 41269 });
  assert.deepEqual(result.max, { before: 8870, after: 50001 });
  assert.deepEqual(result.stddev, { before: 12.3, after: 88.1 });
  assert.equal(result.deterministic, false);
  assert.deepEqual(result.environment, { os: 'windows', num_cpu: 12 });
  assert.equal(result.verification_status, 'verified');
  assert.deepEqual(result.scope, { workers: 64, files: 32 });
});

test('a non-positive-integer repetitions value is ignored, never coerced', () => {
  const result = parseBenchmarkArtifact({
    name: 'x', before: 1, after: 2, unit: 'sec', direction: 'lower_is_better', repetitions: -3,
  }, 'x.json');
  assert.equal(result.repetitions, undefined);
});

test('raw_samples with non-finite entries are filtered, never coerced into fake numbers', () => {
  const result = parseBenchmarkArtifact({
    name: 'x',
    before: 1,
    after: 2,
    unit: 'sec',
    direction: 'lower_is_better',
    raw_samples: { before: [1, 'nope', 3], after: [4, null, 6] },
  }, 'x.json');
  assert.deepEqual(result.raw_samples, { before: [1, 3], after: [4, 6] });
});

test('an empty scope object is not attached (never a misleadingly "present but empty" scope)', () => {
  const result = parseBenchmarkArtifact({
    name: 'x', before: 1, after: 2, unit: 'sec', direction: 'lower_is_better', scope: {},
  }, 'x.json');
  assert.equal(result.scope, undefined);
});

// ---- V2 (Deep-hardening): explicit synthetic_fields declaration ----

test('V2: an explicit synthetic_fields declaration is preserved verbatim', () => {
  const result = parseBenchmarkArtifact({
    name: 'x', before: 100, after: 106.2, unit: 'percent', direction: 'higher_is_better', synthetic_fields: ['before', 'after'],
  }, 'x.json');
  assert.deepEqual(result.synthetic_fields, ['before', 'after']);
});

test('V2: an invalid/unrecognized synthetic_fields entry is dropped, never guessed into a valid one', () => {
  const result = parseBenchmarkArtifact({
    name: 'x', before: 1, after: 2, unit: 'sec', direction: 'lower_is_better', synthetic_fields: ['before', 'result_value', 'not_a_field'],
  }, 'x.json');
  assert.deepEqual(result.synthetic_fields, ['before']);
});

test('V2: no synthetic_fields field at all means undefined, exactly like every pre-V2 artifact', () => {
  const result = parseBenchmarkArtifact({
    name: 'x', before: 1, after: 2, unit: 'sec', direction: 'lower_is_better',
  }, 'x.json');
  assert.equal(result.synthetic_fields, undefined);
});
