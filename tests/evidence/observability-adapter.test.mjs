import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseObservabilityArtifact } from '../../src/evidence/observability-adapter.mjs';
import { normalizeObservabilityEvidence } from '../../src/evidence/evidence-normalizer.mjs';

test('valid observability artifact resolves', () => {
  const result = parseObservabilityArtifact({
    provider: 'grafana-export', title: 'customer-import latency dashboard', environment: 'production', service: 'customer-import', artifact_reference: 'exports/dashboard-2026-02.json', release_id: 'rel-482',
  }, 'x.json');
  assert.equal(result.resolution, 'resolved');
  assert.equal(result.release_id, 'rel-482');
});

test('missing provider is unresolved', () => {
  const result = parseObservabilityArtifact({ title: 'x' }, 'x.json');
  assert.equal(result.resolution, 'unresolved');
});

test('missing both title and artifact_reference is unresolved', () => {
  const result = parseObservabilityArtifact({ provider: 'grafana-export' }, 'x.json');
  assert.equal(result.resolution, 'unresolved');
});

test('observability evidence never produces a metric', () => {
  const parsed = parseObservabilityArtifact({ provider: 'grafana-export', title: 'x' }, 'x.json');
  const evidence = normalizeObservabilityEvidence(parsed);
  assert.equal(evidence.provenance_category, 'production_observability');
  assert.equal('before' in evidence, false);
});

test('non-object artifact is unsupported', () => {
  const result = parseObservabilityArtifact(null, 'x.json');
  assert.equal(result.resolution, 'unsupported');
});
