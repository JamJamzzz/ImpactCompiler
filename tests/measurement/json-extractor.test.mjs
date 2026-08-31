import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractStdoutJson, extractJsonPathValue } from '../../src/measurement/json-extractor.mjs';

test('extracts a finite number from a top-level key', () => {
  const result = extractJsonPathValue('{"duration_seconds": 1.82}', 'duration_seconds');
  assert.equal(result.ok, true);
  assert.equal(result.value, 1.82);
});

test('extracts a nested key via dot-path', () => {
  const result = extractJsonPathValue('{"timing": {"p50": 0.47}}', 'timing.p50');
  assert.equal(result.ok, true);
  assert.equal(result.value, 0.47);
});

test('tolerates leading/trailing whitespace and noise lines, using the last parseable JSON line', () => {
  const stdout = 'starting benchmark...\nwarming up\n{"duration_seconds": 0.47}\n';
  const result = extractJsonPathValue(stdout, 'duration_seconds');
  assert.equal(result.ok, true);
  assert.equal(result.value, 0.47);
});

test('missing json_path is a failure, not a coercion to 0/null', () => {
  const result = extractJsonPathValue('{"other_field": 1}', 'duration_seconds');
  assert.equal(result.ok, false);
  assert.match(result.reason, /not found/);
});

test('non-numeric value at json_path is a failure', () => {
  const result = extractJsonPathValue('{"duration_seconds": "fast"}', 'duration_seconds');
  assert.equal(result.ok, false);
});

test('NaN/Infinity are never valid JSON so they cannot reach here, but a non-finite-looking string is rejected too', () => {
  const result = extractJsonPathValue('{"duration_seconds": null}', 'duration_seconds');
  assert.equal(result.ok, false);
});

test('unparseable stdout is a failure with a clear reason', () => {
  const result = extractStdoutJson('this is not json at all');
  assert.equal(result.ok, false);
  assert.match(result.reason, /did not contain/);
});

test('empty stdout is a failure', () => {
  const result = extractStdoutJson('   ');
  assert.equal(result.ok, false);
});
