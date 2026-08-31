import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuantitativeFactArtifact } from '../../src/facts/quantitative-fact-adapter.mjs';

test('a verified fact resolves and self-references its own generated Evidence id', () => {
  const raw = {
    fact_id: 'fact_runs_per_week', name: 'workflow runs per week', kind: 'event_frequency', value: 12, unit: 'runs/week', verification_status: 'verified', source_reference: 'operations-report-2026-Q2', related_service: 'customer-matching', related_benchmark_id: 'customer-matching-v1',
  };
  const result = parseQuantitativeFactArtifact(raw, '/tmp/fact.json');
  assert.equal(result.resolution, 'resolved');
  assert.equal(result.fact.fact_id, 'fact_runs_per_week');
  assert.equal(result.fact.evidence_id, result.selfEvidenceId);
  assert.equal(result.fact.related_service, 'customer-matching');
  assert.equal(result.fact.related_benchmark_id, 'customer-matching-v1');
});

test('observation_window is adapted to the library\'s window {before,after} shape', () => {
  const raw = {
    fact_id: 'fact_x', name: 'x', value: 1, unit: 'x', verification_status: 'verified', observation_window: { start: '2026-04-01', end: '2026-06-30' },
  };
  const result = parseQuantitativeFactArtifact(raw, '/tmp/fact.json');
  assert.equal(result.resolution, 'resolved');
  assert.deepEqual(result.fact.window, { before: '2026-04-01', after: '2026-06-30' });
});

test('an estimated fact\'s value is preserved as an explicit self-reported estimate, never upgraded', () => {
  const raw = {
    fact_id: 'fact_y', name: 'y', value: 5, unit: 'x', verification_status: 'self_reported',
  };
  const result = parseQuantitativeFactArtifact(raw, '/tmp/fact.json');
  assert.equal(result.resolution, 'resolved');
  assert.equal(result.fact.verification_status, 'self_reported');
});

test('an explicit evidence_id supplied by the caller is preserved verbatim, not overridden', () => {
  const raw = {
    fact_id: 'fact_z', name: 'z', value: 5, unit: 'x', verification_status: 'verified', evidence_id: 'ev_some_other_record',
  };
  const result = parseQuantitativeFactArtifact(raw, '/tmp/fact.json');
  assert.equal(result.fact.evidence_id, 'ev_some_other_record');
  assert.equal(result.selfEvidenceId, null, 'not self-referential when an external evidence_id was supplied');
});

test('an invalid fact (non-finite value) is unresolved, never dropped, with the exact reason', () => {
  const raw = { fact_id: 'fact_bad', name: 'bad', value: 'twelve', unit: 'x', verification_status: 'verified' };
  const result = parseQuantitativeFactArtifact(raw, '/tmp/fact.json');
  assert.equal(result.resolution, 'unresolved');
  assert.match(result.reason, /value/);
});

test('an invalid verification_status is unresolved, not free text', () => {
  const raw = {
    fact_id: 'fact_bad2', name: 'bad', value: 1, unit: 'x', verification_status: 'super-confident',
  };
  const result = parseQuantitativeFactArtifact(raw, '/tmp/fact.json');
  assert.equal(result.resolution, 'unresolved');
});

test('a non-object artifact is unsupported', () => {
  const result = parseQuantitativeFactArtifact('not an object', '/tmp/fact.json');
  assert.equal(result.resolution, 'unsupported');
});

test('a stable, deterministic Evidence id is produced for the same source path + fact_id', () => {
  const raw = {
    fact_id: 'fact_stable', name: 'x', value: 1, unit: 'x', verification_status: 'verified',
  };
  const r1 = parseQuantitativeFactArtifact(raw, '/tmp/fact.json');
  const r2 = parseQuantitativeFactArtifact(raw, '/tmp/fact.json');
  assert.equal(r1.fact.evidence_id, r2.fact.evidence_id);
});
