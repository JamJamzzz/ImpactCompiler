import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTestResultArtifact } from '../../src/evidence/test-result-adapter.mjs';

test('valid canonical test-result artifact resolves', () => {
  const result = parseTestResultArtifact({ suite_name: 'proj3 functional tests', passed: 41, total: 41 }, 'fixtures/proj3/tests.json');
  assert.equal(result.resolution, 'resolved');
  assert.equal(result.passed, 41);
  assert.equal(result.total, 41);
});

test('missing suite_name is unresolved', () => {
  const result = parseTestResultArtifact({ passed: 41, total: 41 }, 'x.json');
  assert.equal(result.resolution, 'unresolved');
  assert.match(result.reason, /suite_name/);
});

test('missing passed/total is unresolved, never guessed into a count', () => {
  const result = parseTestResultArtifact({ suite_name: 'x' }, 'x.json');
  assert.equal(result.resolution, 'unresolved');
  assert.match(result.reason, /passed.*total/);
});

test('non-integer passed/total is unresolved, never coerced', () => {
  const result = parseTestResultArtifact({ suite_name: 'x', passed: 41.5, total: 41 }, 'x.json');
  assert.equal(result.resolution, 'unresolved');
});

test('negative passed/total is unresolved', () => {
  const result = parseTestResultArtifact({ suite_name: 'x', passed: -1, total: 41 }, 'x.json');
  assert.equal(result.resolution, 'unresolved');
});

test('passed greater than total is unresolved, never silently clamped', () => {
  const result = parseTestResultArtifact({ suite_name: 'x', passed: 42, total: 41 }, 'x.json');
  assert.equal(result.resolution, 'unresolved');
  assert.match(result.reason, /exceed/);
});

test('passed === total === 0 is a valid (if odd) resolved count — never rejected by fiat', () => {
  const result = parseTestResultArtifact({ suite_name: 'empty suite', passed: 0, total: 0 }, 'x.json');
  assert.equal(result.resolution, 'resolved');
});

test('non-object artifact is unsupported', () => {
  const result = parseTestResultArtifact('just a string', 'x.json');
  assert.equal(result.resolution, 'unsupported');
});

test('a bare artifact (no optional context fields) resolves with no optional keys added', () => {
  const result = parseTestResultArtifact({ suite_name: 'x', passed: 1, total: 1 }, 'x.json');
  assert.equal(result.resolution, 'resolved');
  assert.equal(result.failed, undefined);
  assert.equal(result.suite_count, undefined);
  assert.equal(result.deterministic, undefined);
  assert.equal(result.environment, undefined);
  assert.equal(result.scope, undefined);
  assert.equal(result.verification_status, undefined);
});

test('optional context fields are captured verbatim when supplied and valid', () => {
  const result = parseTestResultArtifact({
    suite_name: 'proj2 aggregate coverage',
    passed: 41,
    total: 41,
    failed: 0,
    suite_count: 3,
    deterministic: true,
    environment: { os: 'linux', ci: true },
    scope: { files: 12, test_cases: 41 },
    verification_status: 'verified',
  }, 'x.json');
  assert.equal(result.failed, 0);
  assert.equal(result.suite_count, 3);
  assert.equal(result.deterministic, true);
  assert.deepEqual(result.environment, { os: 'linux', ci: true });
  assert.deepEqual(result.scope, { files: 12, test_cases: 41 });
  assert.equal(result.verification_status, 'verified');
});

test('an invalid optional field (wrong type) is silently dropped, never coerced, and never fails the whole record', () => {
  const result = parseTestResultArtifact({
    suite_name: 'x', passed: 1, total: 1, failed: -1, suite_count: 0, deterministic: 'yes', scope: {},
  }, 'x.json');
  assert.equal(result.resolution, 'resolved');
  assert.equal(result.failed, undefined);
  assert.equal(result.suite_count, undefined);
  assert.equal(result.deterministic, undefined);
  assert.equal(result.scope, undefined, 'an empty scope object is not attached, matching benchmark-adapter.mjs\'s discipline');
});
