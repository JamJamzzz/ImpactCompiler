import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQualityProfile } from '../../src/candidates/quality-profile.mjs';

function candidate(overrides = {}) {
  return {
    quantification_type: 'measured',
    metric_ids: ['metric_1'],
    implementation_evidence_ids: ['ev_commit'],
    measurement_evidence_ids: ['ev_cb'],
    production_evidence_ids: [],
    scope: { records: 1000000, source_evidence_ids: ['ev_cb'] },
    measurement: { measurement_quality: 'high' },
    attribution: { strength: 'strong' },
    outcome: 'improvement',
    conflicting_evidence: false,
    limitations: [],
    ...overrides,
  };
}

test('a high-quality controlled benchmark with explicit scope and strong attribution is strong', () => {
  const qp = computeQualityProfile(candidate());
  assert.equal(qp.resume_eligibility, 'strong');
  assert.equal(qp.evidence_strength, 'high');
});

test('a production metric with incomplete scope may be qualified, not strong', () => {
  const qp = computeQualityProfile(candidate({ scope: null }));
  assert.equal(qp.scope_completeness, 'missing');
  assert.equal(qp.resume_eligibility, 'qualified');
});

test('an estimated result with declared assumptions cannot be strong', () => {
  const qp = computeQualityProfile(candidate({ quantification_type: 'estimated', assumptions: ['annualized using an explicit convention'] }));
  assert.notEqual(qp.resume_eligibility, 'strong');
  assert.equal(qp.resume_eligibility, 'qualified');
});

test('a regression cannot be presented as a positive resume outcome — ineligible', () => {
  const qp = computeQualityProfile(candidate({ outcome: 'regression' }));
  assert.equal(qp.resume_eligibility, 'ineligible');
});

test('an unresolved/insufficient measurement is ineligible for quantified wording', () => {
  const qp = computeQualityProfile(candidate({ measurement: { measurement_quality: 'insufficient' } }));
  assert.equal(qp.resume_eligibility, 'ineligible');
});

test('no attribution at all is ineligible', () => {
  const qp = computeQualityProfile(candidate({ attribution: { strength: 'none' } }));
  assert.equal(qp.resume_eligibility, 'ineligible');
});

test('context-only evidence (no metric_ids) cannot produce a quantified Claim', () => {
  const qp = computeQualityProfile(candidate({ metric_ids: [] }));
  assert.equal(qp.resume_eligibility, 'context_only');
});

test('self_reported quantification is always context_only, never promoted', () => {
  const qp = computeQualityProfile(candidate({ quantification_type: 'self_reported' }));
  assert.equal(qp.resume_eligibility, 'context_only');
});

test('a material conflict caps eligibility at qualified', () => {
  const qp = computeQualityProfile(candidate({ conflicting_evidence: true }));
  assert.equal(qp.conflict_status, 'material');
  assert.equal(qp.resume_eligibility, 'qualified');
});

test('evidence_strength is medium with only implementation OR only measurement evidence', () => {
  const qp1 = computeQualityProfile(candidate({ measurement_evidence_ids: [] }));
  const qp2 = computeQualityProfile(candidate({ implementation_evidence_ids: [] }));
  assert.equal(qp1.evidence_strength, 'medium');
  assert.equal(qp2.evidence_strength, 'medium');
});

test('evidence_strength is low with neither implementation nor measurement evidence', () => {
  const qp = computeQualityProfile(candidate({ implementation_evidence_ids: [], measurement_evidence_ids: [] }));
  assert.equal(qp.evidence_strength, 'low');
});

test('production_corroboration is true only when production_evidence_ids is non-empty', () => {
  const qp1 = computeQualityProfile(candidate({ production_evidence_ids: ['ev_prod'] }));
  const qp2 = computeQualityProfile(candidate());
  assert.equal(qp1.production_corroboration, true);
  assert.equal(qp2.production_corroboration, false);
});

test('non-material limitations produce a "limited" conflict_status, not "material"', () => {
  const qp = computeQualityProfile(candidate({ limitations: ['single-run corroboration only'] }));
  assert.equal(qp.conflict_status, 'limited');
  assert.notEqual(qp.resume_eligibility, 'ineligible');
});

// ---- P0-1: unknown !== insufficient ----

test('P0-1: a MISSING measurement_quality (field absent entirely) is classified "unknown", not "insufficient"', () => {
  const qp = computeQualityProfile(candidate({ measurement: {} }));
  assert.equal(qp.measurement_quality, 'unknown');
  assert.notEqual(qp.measurement_quality, 'insufficient');
});

test('P0-1: "unknown" measurement_quality does NOT force ineligible — it can still reach "qualified"', () => {
  const qp = computeQualityProfile(candidate({ measurement: {} }));
  assert.notEqual(qp.resume_eligibility, 'ineligible');
  assert.equal(qp.resume_eligibility, 'qualified');
});

test('P0-1: "unknown" measurement_quality can never reach "strong" (that still requires "high")', () => {
  const qp = computeQualityProfile(candidate({ measurement: {} }));
  assert.notEqual(qp.resume_eligibility, 'strong');
});

test('P0-1: genuinely "insufficient" measurement_quality (actively classified as bad) still forces ineligible', () => {
  const qp = computeQualityProfile(candidate({ measurement: { measurement_quality: 'insufficient' } }));
  assert.equal(qp.resume_eligibility, 'ineligible');
});

// ---- V2.1 (bounded semantic-closure pass): scope_breadth is a SEPARATE
// field from scope_completeness -- introduced because a single, perfectly
// traceable ("complete") benchmark measurement does not by itself justify
// "overall"/"system-wide" language. See core/claim-semantics.mjs's
// checkScopeGeneralization, the only consumer of this field. ----

test('V2.1: a single, traceable benchmark scope (the default fixture -- normal, expected shape) is scope_breadth "specific", NOT "global", even though scope_completeness is "complete"', () => {
  const qp = computeQualityProfile(candidate());
  assert.equal(qp.scope_completeness, 'complete');
  assert.equal(qp.scope_breadth, 'specific');
});

test('V2.1: no scope object at all is scope_breadth "unknown" (distinct from scope_completeness\'s "missing", same underlying absence)', () => {
  const qp = computeQualityProfile(candidate({ scope: null }));
  assert.equal(qp.scope_completeness, 'missing');
  assert.equal(qp.scope_breadth, 'unknown');
});

test('V2.1: scope_breadth is "global" ONLY when the evidence explicitly declares scope.coverage === "global" -- never inferred from a large numeric value', () => {
  const qpNotGlobal = computeQualityProfile(candidate({ scope: { records: 999999999, source_evidence_ids: ['ev_cb'] } }));
  assert.equal(qpNotGlobal.scope_breadth, 'specific', 'a huge number alone must never imply global coverage');

  const qpGlobal = computeQualityProfile(candidate({
    scope: {
      records: 1000000, coverage: 'global', source_evidence_ids: ['ev_cb'],
    },
  }));
  assert.equal(qpGlobal.scope_breadth, 'global');
});

test('V2.1: scope_breadth is "multi_scope" when the candidate combined more than one explicitly-identified measurement (combined_from), never "global"', () => {
  const qp = computeQualityProfile(candidate({ combined_from: ['impact_candidate_a', 'impact_candidate_b'] }));
  assert.equal(qp.scope_breadth, 'multi_scope');
});

test('V2.1: a single-entry combined_from (nothing actually combined) stays "specific", not "multi_scope"', () => {
  const qp = computeQualityProfile(candidate({ combined_from: ['impact_candidate_a'] }));
  assert.equal(qp.scope_breadth, 'specific');
});
