/**
 * candidates/quality-profile.mjs — deterministic quality-profile
 * computation for one Impact Candidate. Pure, no I/O, no LLM. Every rule
 * here is documented inline and exercised by
 * tests/candidates/quality-profile.test.mjs — an LLM never sets or
 * influences any of these fields.
 */

/**
 * evidence_strength: 'high' when the candidate has BOTH an implementation
 * record (what changed) AND a measurement record (how it was measured) —
 * 'medium' with only one of the two, 'low' with neither (e.g. a
 * self-reported/context-only candidate).
 */
function deriveEvidenceStrength(candidate) {
  const hasImpl = (candidate.implementation_evidence_ids || []).length > 0;
  const hasMeasurement = (candidate.measurement_evidence_ids || []).length > 0;
  if (hasImpl && hasMeasurement) return 'high';
  if (hasImpl || hasMeasurement) return 'medium';
  return 'low';
}

/**
 * scope_completeness: 'missing' with no scope object at all; 'partial' when
 * a scope object exists but carries no positive numeric scale value or has
 * no traceable source; 'complete' when scope carries an explicit positive
 * numeric value AND is traceable to the Evidence it came from.
 */
function deriveScopeCompleteness(candidate) {
  const { scope } = candidate;
  if (!scope) return 'missing';
  const hasScale = Object.entries(scope).some(([k, v]) => k !== 'source_evidence_ids' && k !== 'dataset_name' && typeof v === 'number' && Number.isFinite(v) && v > 0);
  if (!hasScale) return 'missing';
  return (scope.source_evidence_ids || []).length ? 'complete' : 'partial';
}

/**
 * V2.1 (Deep-hardening, bounded semantic-closure pass): a DIFFERENT
 * question from deriveScopeCompleteness above — see impact-schema.mjs's
 * SCOPE_BREADTH_VALUES doc comment for the full rationale. Every branch
 * here is a real, deterministic, non-inferred signal:
 *  - no scope object at all -> 'unknown' (breadth genuinely can't be
 *    assessed, distinct from scope_completeness's 'missing', which is
 *    about traceability specifically).
 *  - `scope.coverage === 'global'` -> 'global', ONLY when an evidence
 *    author explicitly declared it verbatim (never inferred from a large
 *    numeric value, a big worker count, or anything else) — no current
 *    fixture in this repository declares this.
 *  - `candidate.combined_from` naming more than one underlying measurement
 *    (candidates/ranking.mjs's existing, real merge mechanism — P1-5.3
 *    same-benchmark_id merges, or production-metric combination) ->
 *    'multi_scope': several explicitly-identified measurements, never "all"
 *    of anything.
 *  - anything else with a real scope object -> 'specific': the normal,
 *    expected value for a single bounded measurement — NOT a lesser state.
 */
function deriveScopeBreadth(candidate) {
  const { scope } = candidate;
  if (!scope) return 'unknown';
  if (scope.coverage === 'global') return 'global';
  const hasScale = Object.entries(scope).some(([k, v]) => k !== 'source_evidence_ids' && k !== 'dataset_name' && k !== 'coverage' && typeof v === 'number' && Number.isFinite(v) && v > 0);
  if (!hasScale) return 'unknown';
  if ((candidate.combined_from || []).length > 1) return 'multi_scope';
  return 'specific';
}

/**
 * conflict_status: 'material' when the candidate itself is flagged
 * `conflicting_evidence: true` (a genuine factual disagreement between
 * records); 'limited' when there are non-blocking limitations recorded but
 * no material conflict; 'none' otherwise.
 */
function deriveConflictStatus(candidate) {
  if (candidate.conflicting_evidence === true) return 'material';
  if ((candidate.limitations || []).length > 0) return 'limited';
  return 'none';
}

/**
 * resume_eligibility — the single field that gates whether a candidate may
 * become a quantified resume Claim at all. Rules, in priority order
 * (documented and tested; never decided by an LLM):
 *
 *  1. A regression outcome is NEVER eligible for positive resume wording —
 *     'ineligible', full stop, regardless of every other field.
 *  2. quantification_type 'self_reported' is always 'context_only' — an
 *     unverified number never becomes a resume-quantified Claim.
 *  3. No metric_ids at all (pure context) is 'context_only'.
 *  4. 'insufficient' measurement_quality or 'none' attribution is
 *     'ineligible' — there is nothing defensible to quantify with.
 *     'unknown' measurement_quality (no quality signal was ever supplied,
 *     e.g. an externally-measured benchmark with no repetition/variance
 *     info declared) deliberately does NOT trigger this rule —
 *     'unknown' !== 'insufficient': we simply don't know how good the
 *     measurement is, which is not the same claim as knowing it's weak. An
 *     'unknown'-quality candidate can still reach 'qualified' below, just
 *     never 'strong' (rule 8 requires measurement_quality === 'high').
 *  5. A 'material' conflict caps eligibility at 'qualified' (never
 *     'strong', never bumped back up by anything else).
 *  6. An 'estimated' result with one or more declared assumptions caps at
 *     'qualified' — an estimate can never present as 'strong'.
 *  7. A 'heuristic'-sourced impact_level/impact_domain classification caps
 *     at 'qualified' — a keyword guess is never confident enough to call a
 *     candidate 'strong' (item 7: "heuristic classification should reduce
 *     quality/ranking confidence").
 *  8. Otherwise: 'strong' only when evidence_strength is 'high',
 *     measurement_quality is 'high', attribution is 'strong', and scope is
 *     not 'missing'; everything else that survives rules 1-7 is 'qualified'.
 */
function deriveResumeEligibility(candidate, {
  evidenceStrength, measurementQuality, attributionStrength, scopeCompleteness, conflictStatus,
}) {
  if (candidate.outcome === 'regression') return 'ineligible';
  if (candidate.quantification_type === 'self_reported') return 'context_only';
  if (!(candidate.metric_ids || []).length) return 'context_only';
  if (measurementQuality === 'insufficient' || attributionStrength === 'none') return 'ineligible';
  if (conflictStatus === 'material') return 'qualified';
  const assumptions = candidate.assumptions ?? candidate.measurement?.assumptions ?? [];
  if (candidate.quantification_type === 'estimated' && assumptions.length) return 'qualified';
  const levelSource = candidate.classification_source?.impact_level;
  if (levelSource === 'heuristic') return 'qualified';
  if (
    evidenceStrength === 'high'
    && measurementQuality === 'high'
    && attributionStrength === 'strong'
    && scopeCompleteness !== 'missing'
  ) return 'strong';
  return 'qualified';
}

/**
 * @param {object} candidate - a candidate from impact-candidate-builder.mjs
 *   (with `outcome`/`measurement`/`attribution`/`scope`/quantification_type
 *   already set).
 * @returns {object} the deterministic quality profile
 *   (core/impact-schema.mjs's enum lists).
 */
export function computeQualityProfile(candidate) {
  const evidenceStrength = deriveEvidenceStrength(candidate);
  // V1-hardening (P0-1): a MISSING measurement_quality means it was never
  // classified at all — 'unknown', not the worst tier ('insufficient').
  // 'insufficient' is reserved for evidence a classifier has actively
  // determined is weak (see external-measurement-quality.mjs /
  // stats-engine.mjs); the mere absence of the field must never be treated
  // as equivalent to that determination.
  const measurementQuality = candidate.measurement?.measurement_quality || 'unknown';
  const attributionStrength = candidate.attribution?.strength || 'none';
  const scopeCompleteness = deriveScopeCompleteness(candidate);
  const scopeBreadth = deriveScopeBreadth(candidate);
  const productionCorroboration = (candidate.production_evidence_ids || []).length > 0;
  const conflictStatus = deriveConflictStatus(candidate);

  const resumeEligibility = deriveResumeEligibility(candidate, {
    evidenceStrength, measurementQuality, attributionStrength, scopeCompleteness, conflictStatus,
  });

  return {
    evidence_strength: evidenceStrength,
    measurement_quality: measurementQuality,
    attribution_strength: attributionStrength,
    scope_completeness: scopeCompleteness,
    scope_breadth: scopeBreadth,
    quantification_strength: candidate.quantification_type,
    production_corroboration: productionCorroboration,
    conflict_status: conflictStatus,
    resume_eligibility: resumeEligibility,
  };
}
