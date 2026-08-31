import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTestResultArtifact } from '../../src/evidence/test-result-adapter.mjs';
import { normalizeTestResultEvidence } from '../../src/evidence/evidence-normalizer.mjs';

test('normalizeTestResultEvidence produces a test_result / metric-category evidence record', () => {
  const parsed = parseTestResultArtifact({
    suite_name: 'proj3 functional tests', passed: 41, total: 41, deterministic: true, verification_status: 'verified',
  }, 'fixtures/proj3/tests.json');
  const ev = normalizeTestResultEvidence(parsed);

  assert.equal(ev.type, 'test_result');
  assert.equal(ev.provenance_category, 'metric');
  assert.equal(ev.resolution, 'resolved');
  assert.equal(ev.suite_name, 'proj3 functional tests');
  assert.equal(ev.passed, 41);
  assert.equal(ev.total, 41);
  assert.equal(ev.deterministic, true);
  assert.equal(ev.verification_status, 'verified');
  assert.ok(ev.id.startsWith('ev_'));
});

test('normalizeTestResultEvidence is stable/deterministic for the same source_path+suite_name', () => {
  const parsedA = parseTestResultArtifact({ suite_name: 'x', passed: 1, total: 1 }, 'a.json');
  const parsedB = parseTestResultArtifact({ suite_name: 'x', passed: 1, total: 1 }, 'a.json');
  assert.equal(normalizeTestResultEvidence(parsedA).id, normalizeTestResultEvidence(parsedB).id);
});

test('an unresolved parse (missing passed/total) still normalizes into a preserved, never-dropped record', () => {
  const parsed = parseTestResultArtifact({ suite_name: 'x' }, 'x.json');
  const ev = normalizeTestResultEvidence(parsed);
  assert.equal(ev.resolution, 'unresolved');
  assert.equal(ev.type, 'test_result');
  assert.match(ev.reason, /passed.*total/);
});

test('absent optional fields normalize to null, not undefined (matches every other adapter\'s discipline)', () => {
  const parsed = parseTestResultArtifact({ suite_name: 'x', passed: 1, total: 1 }, 'x.json');
  const ev = normalizeTestResultEvidence(parsed);
  assert.equal(ev.failed, null);
  assert.equal(ev.suite_count, null);
  assert.equal(ev.deterministic, null);
  assert.equal(ev.environment, null);
  assert.equal(ev.scope, null);
  assert.equal(ev.verification_status, null);
  assert.deepEqual(ev.linked_evidence_ids, []);
  assert.equal(ev.link_resolution, 'not_applicable');
});
