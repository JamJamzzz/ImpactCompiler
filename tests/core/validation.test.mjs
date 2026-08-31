import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateImpactArtifact, validateProviderOutputHasNoMetricFields, validateClaimNumericConsistency,
} from '../../src/core/validation.mjs';
import { emptyImpactArtifact } from '../../src/core/impact-schema.mjs';

function baseArtifact() {
  const a = emptyImpactArtifact({ compilerVersion: '0.1.0', runId: 'r1', runStartedAt: new Date().toISOString() });
  a.evidence = [{ id: 'ev_1', type: 'benchmark_artifact', resolution: 'resolved' }];
  a.metrics = [{
    id: 'metric_1', name: 'matching runtime', unit: 'sec', operation: 'percentage_reduction', direction: 'lower_is_better', calculation: '(1.82 - 0.47) / 1.82 * 100', confidence: 'high', evidence_ids: ['ev_1'], before: 1.82, after: 0.47, absolute_delta: -1.35, relative_change_percent: 74.18,
  }];
  return a;
}

test('a well-formed artifact passes validation', () => {
  const a = baseArtifact();
  a.claims = [{
    id: 'claim_1', title: 't', problem: 'p', change: 'c', outcome: 'o', statement: 's', metric_ids: ['metric_1'], evidence_ids: ['ev_1'], confidence: 'high',
  }];
  const check = validateImpactArtifact(a);
  assert.equal(check.ok, true, JSON.stringify(check.errors));
});

test('wrong schema_version is rejected', () => {
  const a = baseArtifact();
  a.schema_version = '0.0.1';
  const check = validateImpactArtifact(a);
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => e.includes('schema_version')));
});

test('a claim referencing an unknown metric_id is rejected', () => {
  const a = baseArtifact();
  a.claims = [{
    id: 'claim_1', title: 't', problem: 'p', change: 'c', outcome: 'o', statement: 's', metric_ids: ['metric_does_not_exist'], evidence_ids: ['ev_1'], confidence: 'high',
  }];
  const check = validateImpactArtifact(a);
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => e.includes('unknown metric')));
});

test('Career-Graph-shaped fields (project_id etc.) are simply absent from the schema — a provider cannot inject them into a valid claim without also satisfying required generic fields', () => {
  const a = baseArtifact();
  a.claims = [{
    id: 'claim_1', title: 't', problem: 'p', change: 'c', outcome: 'o', statement: 's', metric_ids: [], evidence_ids: [], confidence: 'high', project_id: 'proj_123',
  }];
  const check = validateImpactArtifact(a);
  assert.equal(check.ok, true);
  assert.equal(a.claims[0].project_id, 'proj_123', 'extra field is not validated against, but schema never requires or defines it');
});

test('provider output attempting to set a deterministic metric field is rejected', () => {
  const check = validateProviderOutputHasNoMetricFields({
    claims: [{ id: 'c1', metric_ids: ['metric_1'] }],
    metrics: [{ id: 'metric_1', relative_change_percent: 99.9 }],
  });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => e.includes('relative_change_percent')));
});

test('provider output with only claims/uncertainties/limitations passes the guard', () => {
  const check = validateProviderOutputHasNoMetricFields({
    claims: [{ id: 'c1', statement: 'a 74.18% reduction' }], uncertainties: [], limitations: [],
  });
  assert.equal(check.ok, true);
});

test('numeric consistency: a claim citing its referenced metric\'s exact value passes silently', () => {
  const metrics = [{
    id: 'metric_1', relative_change_percent: 74.18, absolute_delta: -1.35,
  }];
  const claim = { id: 'c1', metric_ids: ['metric_1'], statement: 'a 74.18% reduction in matching runtime' };
  const flags = validateClaimNumericConsistency(claim, metrics);
  assert.deepEqual(flags, []);
});

test('numeric consistency: a claim citing a mismatched number is flagged', () => {
  const metrics = [{
    id: 'metric_1', relative_change_percent: 74.18, absolute_delta: -1.35,
  }];
  const claim = { id: 'c1', metric_ids: ['metric_1'], statement: 'a 90% reduction in matching runtime' };
  const flags = validateClaimNumericConsistency(claim, metrics);
  assert.equal(flags.length, 1);
  assert.match(flags[0], /90/);
});
