// tests/core/schema-backward-compat.test.mjs — a real V1 (schema_version
// "1.0.0") impact.json, exactly as V1 would have produced it (no
// provenance_category, no linked_evidence_ids/link_resolution, no
// pull_request/ticket evidence), must still pass V2's validator unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateImpactArtifact } from '../../src/core/validation.mjs';

const v1Artifact = {
  schema_version: '1.0.0',
  artifact_type: 'impact-compiler/impact-artifact',
  compiler_version: '0.1.0',
  run: { id: 'run_v1', started_at: '2026-01-01T00:00:00.000Z', analysis_status: 'analyzed' },
  repositories: ['local:fixture-repo'],
  evidence: [
    { id: 'ev_1', type: 'git_commit', resolution: 'resolved', sha: 'abc123' },
    { id: 'ev_2', type: 'benchmark_artifact', resolution: 'resolved', name: 'matching runtime' },
  ],
  metrics: [{
    id: 'metric_1', name: 'matching runtime', unit: 'sec', operation: 'percentage_reduction', direction: 'lower_is_better', calculation: '(1.82 - 0.47) / 1.82 * 100', confidence: 'high', evidence_ids: ['ev_2'], before: 1.82, after: 0.47, absolute_delta: -1.35, relative_change_percent: 74.18,
  }],
  claims: [{
    id: 'claim_1', title: 'Faster matching', problem: 'p', change: 'c', outcome: 'o', statement: 'a 74.18% reduction', metric_ids: ['metric_1'], evidence_ids: ['ev_1', 'ev_2'], confidence: 'high',
  }],
  uncertainties: [],
  limitations: [],
};

test('a genuine V1 (schema_version 1.0.0) impact.json still validates under V2', () => {
  const check = validateImpactArtifact(v1Artifact);
  assert.equal(check.ok, true, JSON.stringify(check.errors));
});

test('a V1 artifact with no provenance_category/link_resolution fields is not penalized for their absence', () => {
  const check = validateImpactArtifact(v1Artifact);
  assert.equal(check.errors.some((e) => e.includes('provenance_category') || e.includes('link_resolution')), false);
});

test('a genuinely unknown/future schema_version is still rejected (the version allowlist is not wide open)', () => {
  const check = validateImpactArtifact({ ...v1Artifact, schema_version: '9.9.9' });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => e.includes('schema_version')));
});

test('a new V2 artifact (schema_version 2.0.0) with provenance_category/link_resolution present also validates', () => {
  const v2Artifact = {
    ...v1Artifact,
    schema_version: '2.0.0',
    evidence: [
      { ...v1Artifact.evidence[0], provenance_category: 'implementation' },
      { ...v1Artifact.evidence[1], provenance_category: 'metric' },
      {
        id: 'ev_3', type: 'ticket', resolution: 'resolved', provenance_category: 'intent_context', link_resolution: 'not_applicable', linked_evidence_ids: [],
      },
    ],
  };
  const check = validateImpactArtifact(v2Artifact);
  assert.equal(check.ok, true, JSON.stringify(check.errors));
});

// ---- V3/V4 additive schema validation ----

test('a genuine V2 (schema_version 2.0.0) artifact — no V3/V4 fields at all — still validates unchanged', () => {
  const v2Artifact = { ...v1Artifact, schema_version: '2.0.0' };
  const check = validateImpactArtifact(v2Artifact);
  assert.equal(check.ok, true, JSON.stringify(check.errors));
});

test('a V4 artifact (schema_version 4.0.0) with production_metric/log/note/slack_message/document evidence validates', () => {
  const v4Artifact = {
    ...v1Artifact,
    schema_version: '4.0.0',
    evidence: [
      { ...v1Artifact.evidence[0], provenance_category: 'implementation' },
      { ...v1Artifact.evidence[1], provenance_category: 'metric' },
      {
        id: 'ev_prod', type: 'production_metric', resolution: 'resolved', provenance_category: 'production_observability', link_resolution: 'not_applicable', linked_evidence_ids: [], environment: 'production', verification_status: 'verified',
      },
      {
        id: 'ev_log', type: 'log', resolution: 'resolved', provenance_category: 'production_observability', link_resolution: 'not_applicable', linked_evidence_ids: [],
      },
      {
        id: 'ev_note', type: 'note', resolution: 'resolved', provenance_category: 'soft_context', link_resolution: 'not_applicable', linked_evidence_ids: [], verification_status: 'self_reported',
      },
      {
        id: 'ev_slack', type: 'slack_message', resolution: 'resolved', provenance_category: 'soft_context', link_resolution: 'not_applicable', linked_evidence_ids: [],
      },
      {
        id: 'ev_doc', type: 'document', resolution: 'resolved', provenance_category: 'soft_context', link_resolution: 'not_applicable', linked_evidence_ids: [],
      },
    ],
  };
  const check = validateImpactArtifact(v4Artifact);
  assert.equal(check.ok, true, JSON.stringify(check.errors));
});

test('an invalid verification_status is rejected (not free text)', () => {
  const artifact = {
    ...v1Artifact,
    schema_version: '4.0.0',
    evidence: [{ ...v1Artifact.evidence[0], verification_status: 'probably-true' }],
  };
  const check = validateImpactArtifact(artifact);
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => e.includes('verification_status')));
});

test('schema_version 3.0.0 (V3-only, no V4 evidence types used) is also accepted', () => {
  const check = validateImpactArtifact({ ...v1Artifact, schema_version: '3.0.0' });
  assert.equal(check.ok, true, JSON.stringify(check.errors));
});

// ---- V5 additive schema validation (Quantification V1) ----

test('a genuine V4 (schema_version 4.0.0) artifact — no V5 fields at all — still validates unchanged', () => {
  const v4Artifact = { ...v1Artifact, schema_version: '4.0.0' };
  const check = validateImpactArtifact(v4Artifact);
  assert.equal(check.ok, true, JSON.stringify(check.errors));
});

test('a V5 artifact (schema_version 5.0.0) with a controlled_benchmark evidence record and result/measurement_quality/attribution validates', () => {
  const v5Artifact = {
    ...v1Artifact,
    schema_version: '5.0.0',
    evidence: [
      { ...v1Artifact.evidence[0], provenance_category: 'implementation' },
      {
        id: 'ev_cb',
        type: 'controlled_benchmark',
        resolution: 'resolved',
        provenance_category: 'metric',
        measurement_quality: 'high',
        attribution: {
          strength: 'strong', method: 'controlled_before_after', base_commit: 'a'.repeat(40), target_commit: 'b'.repeat(40), confounders: [],
        },
        link_resolution: 'not_applicable',
        linked_evidence_ids: [],
      },
    ],
    metrics: [{
      ...v1Artifact.metrics[0],
      evidence_ids: ['ev_cb'],
      result: { value: 74.18, value_unit: 'percent', outcome: 'improvement' },
    }],
    claims: [{ ...v1Artifact.claims[0], evidence_ids: ['ev_1', 'ev_cb'] }],
  };
  const check = validateImpactArtifact(v5Artifact);
  assert.equal(check.ok, true, JSON.stringify(check.errors));
});

test('an invalid measurement_quality is rejected (not free text)', () => {
  const artifact = {
    ...v1Artifact,
    schema_version: '5.0.0',
    evidence: [{ ...v1Artifact.evidence[0], measurement_quality: 'pretty-good' }],
  };
  const check = validateImpactArtifact(artifact);
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => e.includes('measurement_quality')));
});

test('an invalid attribution.strength is rejected (not free text)', () => {
  const artifact = {
    ...v1Artifact,
    schema_version: '5.0.0',
    evidence: [{ ...v1Artifact.evidence[0], attribution: { strength: 'super-strong' } }],
  };
  const check = validateImpactArtifact(artifact);
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => e.includes('attribution.strength')));
});
