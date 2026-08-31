/**
 * core/validation.mjs — schema validation for impact.json, and the
 * structural defense that keeps an LLM provider from ever authoring a
 * deterministic metric field. Pure, no I/O.
 */
import {
  SUPPORTED_SCHEMA_VERSIONS, EVIDENCE_TYPES, EVIDENCE_RESOLUTIONS, CLAIM_REQUIRED_FIELDS,
  CLAIM_CONFIDENCE_VALUES, METRIC_DETERMINISTIC_FIELDS, PROVENANCE_CATEGORIES, LINK_RESOLUTIONS,
  VERIFICATION_STATUSES, MEASUREMENT_QUALITY_VALUES, ATTRIBUTION_STRENGTHS,
  QUANTIFICATION_TYPES, IMPACT_LEVELS, IMPACT_CANDIDATE_REQUIRED_FIELDS,
} from './impact-schema.mjs';
import { validateMetricShape } from '../metrics/metric-validation.mjs';

function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }
function isStringArray(v) { return Array.isArray(v) && v.every((x) => typeof x === 'string'); }

/**
 * Provider (Claude) output must never carry a deterministic metric field —
 * this is the structural defense: a claim-authoring provider's response
 * shape has no field for `before`/`after`/etc. at all, and if one somehow
 * appears (e.g. a malformed/adversarial provider response), this rejects it
 * outright rather than merging it in.
 * @param {object} providerOutput - raw parsed provider response, pre-merge.
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateProviderOutputHasNoMetricFields(providerOutput) {
  const errors = [];
  const scan = (obj, path) => {
    if (obj === null || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj)) {
      if (METRIC_DETERMINISTIC_FIELDS.includes(key)) {
        errors.push(`${path}${key}: provider output must not set a deterministic metric field`);
      }
      if (value && typeof value === 'object') scan(value, `${path}${key}.`);
    }
  };
  scan(providerOutput, '');
  return { ok: errors.length === 0, errors };
}

function validateEvidenceShape(evidence, index, errors) {
  const path = `evidence[${index}]`;
  if (!isNonEmptyString(evidence.id)) errors.push(`${path}.id: required`);
  if (!EVIDENCE_TYPES.includes(evidence.type)) errors.push(`${path}.type: must be one of ${EVIDENCE_TYPES.join(', ')}`);
  if (!EVIDENCE_RESOLUTIONS.includes(evidence.resolution)) errors.push(`${path}.resolution: must be one of ${EVIDENCE_RESOLUTIONS.join(', ')}`);

  // V2, additive: a V1 evidence record has neither field and stays valid
  // (both checks are skipped when the field is absent). When present,
  // they must be one of the real enum values — never free text.
  if (evidence.provenance_category !== undefined && !PROVENANCE_CATEGORIES.includes(evidence.provenance_category)) {
    errors.push(`${path}.provenance_category: must be one of ${PROVENANCE_CATEGORIES.join(', ')}`);
  }
  if (evidence.linked_evidence_ids !== undefined && !isStringArray(evidence.linked_evidence_ids)) {
    errors.push(`${path}.linked_evidence_ids: must be a string array`);
  }
  if (evidence.link_resolution !== undefined && !LINK_RESOLUTIONS.includes(evidence.link_resolution)) {
    errors.push(`${path}.link_resolution: must be one of ${LINK_RESOLUTIONS.join(', ')}`);
  }
  // V3/V4, additive: same absent-is-fine, present-must-be-valid discipline.
  // `null` is an honest "not supplied" value (evidence-normalizer.mjs
  // threads several optional verification_status fields through as
  // `?? null`, e.g. benchmark_artifact's — V1-hardening) and must validate
  // exactly like an absent field, matching measurement_quality/attribution
  // below — only a non-null, present value must be a real enum member.
  if (evidence.verification_status !== undefined && evidence.verification_status !== null && !VERIFICATION_STATUSES.includes(evidence.verification_status)) {
    errors.push(`${path}.verification_status: must be one of ${VERIFICATION_STATUSES.join(', ')}`);
  }
  // V5, additive: controlled_benchmark's deterministic quality/attribution
  // classifications — same absent-is-fine, present-must-be-valid discipline.
  if (evidence.measurement_quality !== undefined && evidence.measurement_quality !== null && !MEASUREMENT_QUALITY_VALUES.includes(evidence.measurement_quality)) {
    errors.push(`${path}.measurement_quality: must be one of ${MEASUREMENT_QUALITY_VALUES.join(', ')}`);
  }
  if (evidence.attribution !== undefined && evidence.attribution !== null && !ATTRIBUTION_STRENGTHS.includes(evidence.attribution.strength)) {
    errors.push(`${path}.attribution.strength: must be one of ${ATTRIBUTION_STRENGTHS.join(', ')}`);
  }
}

function validateClaimShape(claim, index, errors, knownMetricIds, knownEvidenceIds) {
  const path = `claims[${index}]`;
  for (const field of CLAIM_REQUIRED_FIELDS) {
    if (claim[field] === undefined) errors.push(`${path}.${field}: required`);
  }
  if (claim.confidence !== undefined && !CLAIM_CONFIDENCE_VALUES.includes(claim.confidence)) {
    errors.push(`${path}.confidence: must be one of ${CLAIM_CONFIDENCE_VALUES.join(', ')}`);
  }
  if (claim.metric_ids !== undefined) {
    if (!isStringArray(claim.metric_ids)) errors.push(`${path}.metric_ids: must be a string array`);
    else for (const id of claim.metric_ids) if (!knownMetricIds.has(id)) errors.push(`${path}.metric_ids: references unknown metric "${id}"`);
  }
  if (claim.evidence_ids !== undefined) {
    if (!isStringArray(claim.evidence_ids)) errors.push(`${path}.evidence_ids: must be a string array`);
    else for (const id of claim.evidence_ids) if (!knownEvidenceIds.has(id)) errors.push(`${path}.evidence_ids: references unknown evidence "${id}"`);
  }
  if (claim.conflicting_evidence !== undefined && typeof claim.conflicting_evidence !== 'boolean') {
    errors.push(`${path}.conflicting_evidence: must be a boolean`);
  }
}

/**
 * Best-effort numeric-consistency net (see README / task spec): Claude may
 * echo a deterministic value inside `statement` only if it matches a metric
 * the claim actually references. This is a safety NET, not the primary
 * guarantee — the primary guarantee is structural
 * (validateProviderOutputHasNoMetricFields: Claude's output shape has no
 * field to set a metric value in the first place). This function only
 * flags claims whose prose cites a percentage/number not explainable by any
 * referenced metric; it never blocks artifact generation by itself — callers
 * append its findings to `uncertainties`.
 * @param {object} claim
 * @param {object[]} metrics - the full metrics[] array (already computed).
 * @returns {string[]} human-readable flags, empty if nothing suspicious found.
 */
export function validateClaimNumericConsistency(claim, metrics) {
  const flags = [];
  const referencedMetrics = metrics.filter((m) => (claim.metric_ids || []).includes(m.id));
  const referencedNumbers = new Set();
  for (const m of referencedMetrics) {
    if (m.relative_change_percent !== null && m.relative_change_percent !== undefined) referencedNumbers.add(m.relative_change_percent.toFixed(2));
    if (m.absolute_delta !== null && m.absolute_delta !== undefined) referencedNumbers.add(Math.abs(m.absolute_delta).toFixed(2));
  }
  const numberPattern = /\d+(?:\.\d+)?/g;
  const cited = String(claim.statement || '').match(numberPattern) || [];
  for (const token of cited) {
    const normalized = Number(token).toFixed(2);
    if (!referencedNumbers.has(normalized)) {
      flags.push(`claim "${claim.id}" statement cites "${token}" which does not match any referenced metric's value`);
    }
  }
  return flags;
}

/**
 * Resume-Impact phase: shape validation for one Impact Candidate
 * (src/candidates/impact-candidate-builder.mjs). Candidates are additive and
 * OPTIONAL on the artifact — a pre-existing artifact with none is
 * unaffected; when present, each one's id/quantification_type/impact_level
 * must be valid, and its metric_ids/evidence_ids must resolve against this
 * same artifact's own metrics/evidence, exactly like a Claim's do.
 */
function validateCandidateShape(candidate, index, errors, knownMetricIds, knownEvidenceIds) {
  const path = `impact_candidates[${index}]`;
  for (const field of IMPACT_CANDIDATE_REQUIRED_FIELDS) {
    if (candidate[field] === undefined) errors.push(`${path}.${field}: required`);
  }
  if (candidate.quantification_type !== undefined && !QUANTIFICATION_TYPES.includes(candidate.quantification_type)) {
    errors.push(`${path}.quantification_type: must be one of ${QUANTIFICATION_TYPES.join(', ')}`);
  }
  if (candidate.impact_level !== undefined && !IMPACT_LEVELS.includes(candidate.impact_level)) {
    errors.push(`${path}.impact_level: must be one of ${IMPACT_LEVELS.join(', ')}`);
  }
  if (candidate.metric_ids !== undefined) {
    if (!isStringArray(candidate.metric_ids)) errors.push(`${path}.metric_ids: must be a string array`);
    else for (const id of candidate.metric_ids) if (!knownMetricIds.has(id)) errors.push(`${path}.metric_ids: references unknown metric "${id}"`);
  }
  if (candidate.evidence_ids !== undefined) {
    if (!isStringArray(candidate.evidence_ids)) errors.push(`${path}.evidence_ids: must be a string array`);
    else for (const id of candidate.evidence_ids) if (!knownEvidenceIds.has(id)) errors.push(`${path}.evidence_ids: references unknown evidence "${id}"`);
  }
}

/**
 * Extracts numeric-looking tokens from free text — integers/decimals,
 * optionally comma-grouped (e.g. "1,000,000"), optionally a leading sign,
 * optionally trailing "%". Used only for the allowed-numeric-facts
 * consistency check below.
 *
 * V2 (Deep-hardening) fix, two real gaps found by External ImpactBench —
 * Deep's adversarial pass:
 *  1. A leading "-"/"+" immediately before the digit run is now part of the
 *     token (e.g. "-10.24%" extracts as "-10.24%", not "10.24%") — a real,
 *     honestly-negative fact (e.g. a regression's relative_change) could
 *     never validate before this fix, because its own `display` is
 *     "-10.24%" but the extractor silently dropped the sign, so the token
 *     never matched. The sign is only consumed when it directly abuts the
 *     digit with nothing alphanumeric before IT either (so a hyphen inside
 *     a word, e.g. "well-tested", is never mistaken for a minus sign).
 *  2. A digit run is no longer extracted when it is immediately followed by
 *     one or more letters that are themselves immediately followed by
 *     another digit — i.e. a DIGIT-LETTER-DIGIT shape within one contiguous
 *     alphanumeric run. This is what a digit-prefixed identifier like
 *     "2to3" looks like (digit, then letters, then another digit) and is a
 *     GENERAL lexical rule, not a blacklist of specific identifiers: it
 *     naturally also covers any future identifier of the same shape
 *     (`s3cr3t`, `b2b2c`, ...) without naming any of them. Identifiers with
 *     the digit only at one end (`sha256`, `x86`, `h264`, `ipv6`, `Python3`)
 *     were ALREADY correctly excluded by the pre-existing "not preceded by a
 *     letter" lookbehind below (the digit run itself is preceded by a
 *     letter, so it never started a match in the first place) — this fix
 *     only closes the remaining "digit first" case that lookbehind cannot
 *     see. A legitimate trailing unit suffix with no following digit (e.g.
 *     "5.62x", "3ms") is NOT affected — nothing after the letter(s) is a
 *     digit, so the new exclusion never fires.
 * @returns {string[]}
 */
export function extractNumericTokens(text) {
  // (?<![A-Za-z0-9+-]) — the sign (if any) or the digit (if no sign) must
  // not itself be preceded by a letter, digit, or another sign character.
  // (?:[+-])? — an optional leading sign, consumed as part of the token.
  // A negative lookbehind for a letter (on the digit run itself, enforced by
  // the outer lookbehind covering the sign+digit start) excludes digits
  // embedded in an identifier (e.g. the "95" in "P95 latency" is part of a
  // metric NAME, never a cited number) — only digits that stand on their
  // own (optionally preceded by punctuation/whitespace/a sign) count as a
  // numeric citation. A negative lookahead for " thousand"/"million"/
  // "billion" excludes a digit that's really the leading half of a
  // digit+word alias (e.g. the "20" in "20 million") — that combined phrase
  // is validated separately, as a single unit, by DIGIT_WORD_RE below;
  // extracting "20" here too would flag it as a bare unsupported number even
  // when "20 million" is a legitimately allowed alias.
  // (?!\d) immediately after the digit run blocks the regex engine from
  // backtracking into a shorter digit PREFIX just to dodge the
  // million/billion exclusion below (e.g. without it, "20 million" could
  // wrongly yield a bogus "2" token: the engine finds "20" excluded by the
  // lookahead, backtracks to "2", and "2" followed by "0 million" no longer
  // matches the exclusion) — this forces the full digit run to be
  // considered as one unit before the exclusion is even checked.
  // (?!\.\d) after the optional decimal group similarly blocks backtracking
  // OUT of a matched decimal part (e.g. "1.5 million" backtracking from
  // "1.5" down to bogus "1" to dodge the exclusion below).
  // (?![A-Za-z]+\d) — the new digit-letter-digit identifier exclusion.
  return [...String(text || '').matchAll(/(?<![A-Za-z0-9+-])[+-]?\d[\d,]*(?:\.\d+)?(?!\.\d)(?!\d)(?![A-Za-z]+\d)%?(?!\s?(?:thousand|million|billion)\b)/gi)].map((m) => m[0]);
}

/**
 * Normalizes a numeric token (as extracted by extractNumericTokens, or any
 * raw fact display string) for value-equality comparison: strips commas and
 * a trailing "%", and drops a redundant leading "+" ("+5.62" and "5.62" are
 * the same value) while always preserving a leading "-" (which changes the
 * actual value). Exported for core/claim-semantics.mjs's unit/polarity
 * checks, which need the same normalization to match a token back to the
 * fact it cites.
 */
export function normalizeNumericToken(t) {
  return String(t).replace(/^\+/, '').replace(/,/g, '').replace(/%$/, '');
}

/**
 * A small, bounded whitelist of number-word phrases — "one million",
 * "twenty-five thousand", etc. — matching exactly what
 * candidates/allowed-numeric-facts.mjs's numberWordForm can ever generate
 * as a `display_variants` alias. This is NOT a general natural-language
 * number parser; it exists only to catch a word-form quantity in a resume
 * variant so it can be checked against the candidate's own explicitly
 * generated aliases, never to recognize arbitrary prose numbers.
 */
const WORD_NUMBER_RE = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[\s-](?:one|two|three|four|five|six|seven|eight|nine))?[\s-](?:thousand|million|billion)\b/gi;

/**
 * The digit-form counterpart to WORD_NUMBER_RE — "1.5 million", "20
 * million", "1 billion" — matching exactly what
 * candidates/allowed-numeric-facts.mjs's digitWordForm can ever generate.
 * Never "thousand" (digitWordForm intentionally never generates a
 * thousand-scale digit+word alias — see its own doc comment).
 */
const DIGIT_WORD_RE = /(?<![A-Za-z0-9])\d+(?:\.\d+)?\s+(?:million|billion)\b/gi;

function normalizeWordPhrase(phrase) {
  return phrase.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Resume-Impact phase: validates that every numeric token (digit-form or a
 * whitelisted word-form quantity, e.g. "one million") in `text` is
 * explainable by the candidate's own `allowed_numeric_facts` (built
 * deterministically by src/candidates/allowed-numeric-facts.mjs) — either
 * matching a fact's exact `display` string (so a comma-formatted
 * "1,000,000" or a "74.18%" is accepted verbatim), its raw numeric `value`,
 * or one of its explicitly generated `display_variants` word-form aliases.
 * This is the Resume-Impact-phase counterpart to
 * `validateClaimNumericConsistency` below (which stays in place, unchanged,
 * for the legacy metric-only flow) — a stricter check because a candidate's
 * allowed facts cover scope/run-count/production numbers a bare metric
 * lookup cannot.
 * @param {string} text
 * @param {{display:string, value:number, display_variants?:string[]}[]} allowedNumericFacts
 * @returns {string[]} unsupported tokens, empty if every number is allowed.
 */
export function validateAgainstAllowedNumericFacts(text, allowedNumericFacts) {
  // V1-hardening (P0-3): `display_variants` also feeds the plain
  // digit-token check now, not just the word-phrase checks below — a
  // deterministic rounded/comma-formatted alias (e.g. "8,771.51" for a
  // full-precision "8771.509042192329" canonical value, generated by
  // candidates/allowed-numeric-facts.mjs's roundedDisplayAliases) is exact
  // string matter here, same as `display` itself; this is still a finite,
  // deterministically-generated whitelist, never fuzzy tolerance.
  // V2 (Deep-hardening): a fact explicitly marked `externally_claimable:
  // false` (an ADAPTER_INTERNAL synthetic anchor — see
  // candidates/allowed-numeric-facts.mjs) is never added to the allowed
  // sets, no matter what internal measurement object it appears in. A V1
  // fact has no such field at all (`undefined !== false`), so this changes
  // nothing for any fact that predates this distinction.
  const claimableFacts = (allowedNumericFacts || []).filter((f) => f.externally_claimable !== false);
  const allowedDisplays = new Set([
    ...claimableFacts.map((f) => f.display),
    ...claimableFacts.flatMap((f) => f.display_variants || []),
  ]);
  const allowedValues = new Set(claimableFacts.map((f) => normalizeNumericToken(String(f.value))));
  const allowedWordPhrases = new Set(
    claimableFacts.flatMap((f) => f.display_variants || []).map(normalizeWordPhrase),
  );
  const violations = [];
  for (const token of extractNumericTokens(text)) {
    if (allowedDisplays.has(token)) continue;
    if (allowedValues.has(normalizeNumericToken(token))) continue;
    violations.push(token);
  }
  for (const match of String(text || '').matchAll(WORD_NUMBER_RE)) {
    const normalized = normalizeWordPhrase(match[0]);
    if (!allowedWordPhrases.has(normalized)) violations.push(match[0]);
  }
  for (const match of String(text || '').matchAll(DIGIT_WORD_RE)) {
    const normalized = normalizeWordPhrase(match[0]);
    if (!allowedWordPhrases.has(normalized)) violations.push(match[0]);
  }
  return violations;
}

/**
 * Full impact.json shape validation (Layer 1 — shape/enum only, no
 * referential-integrity concerns beyond claim -> metric/evidence id
 * resolution, which is intrinsic to this artifact and cheap to check here).
 * @param {object} artifact
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateImpactArtifact(artifact) {
  const errors = [];
  if (artifact === null || typeof artifact !== 'object') return { ok: false, errors: ['artifact must be an object'] };

  if (!SUPPORTED_SCHEMA_VERSIONS.includes(artifact.schema_version)) {
    errors.push(`schema_version: expected one of ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}, got "${artifact.schema_version}"`);
  }
  if (!Array.isArray(artifact.evidence)) errors.push('evidence: must be an array');
  else artifact.evidence.forEach((e, i) => validateEvidenceShape(e, i, errors));

  if (!Array.isArray(artifact.metrics)) errors.push('metrics: must be an array');
  else artifact.metrics.forEach((m) => {
    const check = validateMetricShape(m);
    errors.push(...check.errors);
  });

  const knownEvidenceIds = new Set((artifact.evidence || []).map((e) => e.id));
  const knownMetricIds = new Set((artifact.metrics || []).map((m) => m.id));

  // impact_candidates is additive/optional — absent entirely on a
  // pre-Resume-Impact artifact, which stays valid unchanged.
  if (artifact.impact_candidates !== undefined) {
    if (!Array.isArray(artifact.impact_candidates)) errors.push('impact_candidates: must be an array');
    else artifact.impact_candidates.forEach((c, i) => validateCandidateShape(c, i, errors, knownMetricIds, knownEvidenceIds));
  }

  if (!Array.isArray(artifact.claims)) errors.push('claims: must be an array');
  else artifact.claims.forEach((c, i) => validateClaimShape(c, i, errors, knownMetricIds, knownEvidenceIds));

  return { ok: errors.length === 0, errors };
}
