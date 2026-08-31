/**
 * candidates/allowed-numeric-facts.mjs — deterministically builds the list
 * of numbers a resume-ready statement about one Impact Candidate is allowed
 * to cite. Pure, no I/O, no LLM. This is what
 * core/validation.mjs's validateAgainstAllowedNumericFacts checks provider
 * text against — the LLM must copy a `display` value (or an explicitly
 * generated `display_variants` word-form alias) verbatim, never round,
 * convert, abbreviate, or recompute it.
 */

/** @returns {string} a display string; comma-grouped for integers >= 1000, plain otherwise. */
function formatNumber(value, { commas = false } = {}) {
  if (commas && Number.isInteger(value)) return value.toLocaleString('en-US');
  return String(value);
}

/**
 * V1-hardening (P0-3): deterministic, resume-safe ROUNDED display aliases
 * for a full-precision canonical value (e.g. `8771.509042192329`). The
 * canonical `value`/`display` (built by formatNumber above) always stays
 * full precision — these are ADDITIONAL entries in a fact's
 * `display_variants`, never a replacement. Ordinary 2-decimal-place
 * rounding (matching how absolute_delta/result_value already round
 * elsewhere in this file) plus a comma-grouped form of that same rounding —
 * both exact string matches, never fuzzy/tolerance-based. This is
 * deliberately narrow: it only recognizes the ONE standard rounding a
 * resume would naturally use, never an arbitrary nearby approximation, so a
 * genuinely unsupported number still fails validation exactly as before.
 * @returns {string[]}
 */
function roundedDisplayAliases(value) {
  if (!Number.isFinite(value)) return [];
  const rounded2 = Math.round((value + Number.EPSILON) * 100) / 100;
  const variants = new Set();
  variants.add(String(rounded2));
  variants.add(rounded2.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  if (Number.isInteger(rounded2)) {
    variants.add(rounded2.toLocaleString('en-US'));
  } else {
    variants.add(rounded2.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  }
  // Never generate an alias equal to the raw, already-allowed full-precision
  // value — display_variants is additive, not a duplicate of `display`.
  variants.delete(String(value));
  return [...variants];
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function smallNumberWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
  return null;
}

/**
 * Deterministic, intentionally bounded whole-number-to-words conversion —
 * only exact multiples of one thousand/million/billion with a multiplier
 * under 1000 are supported (e.g. 1,000,000 -> "one million",
 * 2,500,000 -> "two hundred fifty thousand..." is NOT supported — this is
 * a small, auditable table, not a general number-to-words engine). Returns
 * null when the value isn't a clean round figure this function recognizes.
 */
function numberWordForm(value) {
  if (!Number.isInteger(value) || value <= 0) return null;
  const scales = [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
  for (const [scale, word] of scales) {
    if (value % scale === 0 && value / scale < 1000) {
      const words = smallNumberWords(value / scale);
      if (words) return `${words} ${word}`;
    }
  }
  return null;
}

/**
 * Deterministic "digit + scale-word" alias — the common resume-safe form
 * for large round-ish figures: "1.5 million", "20 million", "1 billion".
 * Deliberately narrower than numberWordForm: only million/billion scales
 * (never thousand — 1,500 stays "1,500", not "1.5 thousand", matching how
 * these forms are actually used in prose), and only when the multiplier is
 * exact to at most one decimal place (1,500,000 -> 1.5 exactly; a value
 * like 1,234,567 has no clean one-decimal multiplier and gets no alias).
 * Returns null when the value doesn't reduce this cleanly.
 */
function digitWordForm(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const scales = [[1e9, 'billion'], [1e6, 'million']];
  for (const [scale, word] of scales) {
    const multiplier = value / scale;
    if (multiplier < 1 || multiplier >= 1000) continue;
    const rounded = Math.round(multiplier * 10) / 10;
    if (Math.abs(rounded * scale - value) > 1e-6) continue; // not an exact one-decimal multiple
    return `${rounded} ${word}`;
  }
  return null;
}

/** @returns {string[]} deterministic display aliases for a scope-scale
 *  value — comma form is always included; a full word form ("one million"),
 *  its hyphenated variant ("one-million"), and/or a digit+word form
 *  ("1.5 million", "20 million") are added only when the corresponding
 *  generator recognizes the value. Only values explicitly generated here
 *  may ever appear in a Claim (see core/validation.mjs's
 *  validateAgainstAllowedNumericFacts). */
function displayVariantsFor(value) {
  const variants = [formatNumber(value, { commas: true })];
  const words = numberWordForm(value);
  if (words) variants.push(words, words.replace(/ /g, '-'));
  const digitWords = digitWordForm(value);
  if (digitWords && !variants.includes(digitWords)) variants.push(digitWords);
  return variants;
}

function daysBetween(before, after) {
  const a = Date.parse(before);
  const b = Date.parse(after);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round(Math.abs(b - a) / 86400000);
}

/**
 * V2 (Deep-hardening): every fact is stamped with `provenance_class` (see
 * impact-schema.mjs's FACT_PROVENANCE_CLASSES) and `externally_claimable`.
 * Defaults to `SOURCE_FACT`/claimable when the caller doesn't say otherwise
 * — this is what every pre-V2 call site gets, unchanged. Only a caller that
 * explicitly passes `provenanceClass: 'ADAPTER_INTERNAL'` produces a
 * non-claimable fact; nothing here can newly downgrade a fact that used to
 * be claimable.
 */
function pushFact(facts, name, value, display, unit, sourceId, extra = {}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return;
  const { provenanceClass, ...rest } = extra;
  const resolvedClass = provenanceClass || 'SOURCE_FACT';
  facts.push({
    name,
    value,
    display,
    unit,
    source_id: sourceId ?? null,
    provenance_class: resolvedClass,
    externally_claimable: resolvedClass !== 'ADAPTER_INTERNAL',
    ...rest,
  });
}

/**
 * @param {object} candidate - a candidate with metric_ids/scope/measurement
 *   already populated (quality_profile may or may not be set yet — unused
 *   here).
 * @param {{metricsById:Map, evidenceById:Map}} lookups
 * @returns {object[]} allowed numeric facts, e.g.
 *   [{name:'before', value:1.82, display:'1.82', unit:'sec', source_id:'metric_xxx'}, ...]
 */
export function buildAllowedNumericFacts(candidate, { metricsById, evidenceById } = new Map()) {
  const facts = [];

  for (const metricId of candidate.metric_ids || []) {
    const m = metricsById?.get(metricId);
    if (!m) continue;
    // V2 (Deep-hardening): a metric's `synthetic_fields` (set only when an
    // evidence adapter EXPLICITLY declared before/after as an artificial
    // schema-compatibility anchor — see evidence/benchmark-adapter.mjs) means
    // that specific value is never externally claimable. Any value DERIVED
    // from an anchor (absolute_delta/relative_change/result_value) inherits
    // the same non-claimability if EITHER side of the comparison was
    // synthetic — a percentage computed from one real and one fake endpoint
    // is just as unclaimable as the fake endpoint itself.
    const syntheticFields = new Set(m.synthetic_fields || []);
    const beforeClass = syntheticFields.has('before') ? 'ADAPTER_INTERNAL' : 'SOURCE_FACT';
    const afterClass = syntheticFields.has('after') ? 'ADAPTER_INTERNAL' : 'SOURCE_FACT';
    const derivedClass = syntheticFields.size ? 'ADAPTER_INTERNAL' : 'DERIVED_FACT';
    pushFact(facts, 'before', m.before, formatNumber(m.before), m.unit, m.id, {
      display_variants: roundedDisplayAliases(m.before),
      provenanceClass: beforeClass,
    });
    pushFact(facts, 'after', m.after, formatNumber(m.after), m.unit, m.id, {
      display_variants: roundedDisplayAliases(m.after),
      provenanceClass: afterClass,
    });
    // P1-5.4: when the metric's own unit is itself "percent" (e.g. an
    // accuracy metric going from 81.25% to 100%), absolute_delta is
    // PERCENTAGE POINTS, a different kind of number from
    // relative_change_percent's relative-percent-change below — labeling
    // both "percent" invites exactly the misreading the dogfooding
    // evaluation flagged. Every other unit (ops/s, ms, count, ...) keeps
    // the metric's own unit unchanged, since absolute_delta there is just
    // "the same unit, before minus after."
    const deltaUnit = m.unit === 'percent' ? 'percentage_points' : m.unit;
    pushFact(facts, 'absolute_delta', m.absolute_delta, formatNumber(Math.abs(m.absolute_delta ?? 0)), deltaUnit, m.id, {
      display_variants: roundedDisplayAliases(Math.abs(m.absolute_delta ?? 0)),
      provenanceClass: derivedClass,
    });
    if (m.relative_change_percent !== null && m.relative_change_percent !== undefined) {
      pushFact(facts, 'relative_change', m.relative_change_percent, `${formatNumber(m.relative_change_percent)}%`, 'percent', m.id, {
        provenanceClass: derivedClass,
      });
    }
    if (m.result) {
      const display = m.result.value_unit === 'percent' ? `${formatNumber(m.result.value)}%` : formatNumber(m.result.value);
      pushFact(facts, 'result_value', m.result.value, display, m.result.value_unit, m.id, {
        display_variants: roundedDisplayAliases(m.result.value),
        provenanceClass: derivedClass,
      });
    }
  }

  if (candidate.scope) {
    const scopeSourceId = (candidate.scope.source_evidence_ids || [])[0] || null;
    for (const [key, value] of Object.entries(candidate.scope)) {
      if (key === 'source_evidence_ids' || typeof value !== 'number' || !Number.isFinite(value)) continue;
      pushFact(facts, `scope_${key}`, value, formatNumber(value, { commas: true }), null, scopeSourceId, {
        display_variants: displayVariantsFor(value),
      });
    }
  }

  if (candidate.measurement?.run_count) {
    pushFact(facts, 'run_count', candidate.measurement.run_count, String(candidate.measurement.run_count), 'runs', candidate.measurement_evidence_ids?.[0] ?? null);
  }

  // A standalone (non-combined) candidate's own observation window, when
  // its measurement Evidence carries one (e.g. a lone production_metric).
  if (candidate.measurement?.window?.before && candidate.measurement?.window?.after) {
    const days = daysBetween(candidate.measurement.window.before, candidate.measurement.window.after);
    if (days !== null) pushFact(facts, 'window_days', days, String(days), 'days', candidate.measurement_evidence_ids?.[0] ?? null);
  }

  if (candidate.production_summary) {
    if (candidate.production_summary.window?.days !== undefined && candidate.production_summary.window?.days !== null) {
      pushFact(facts, 'production_window_days', candidate.production_summary.window.days, String(candidate.production_summary.window.days), 'days', null);
    }
    for (const pm of candidate.production_summary.metrics || []) {
      pushFact(facts, `production_${pm.name}_before`, pm.before, formatNumber(pm.before), pm.unit, pm.evidence_id ?? pm.source_id, {
        display_variants: roundedDisplayAliases(pm.before),
      });
      pushFact(facts, `production_${pm.name}_after`, pm.after, formatNumber(pm.after), pm.unit, pm.evidence_id ?? pm.source_id, {
        display_variants: roundedDisplayAliases(pm.after),
      });
      const resultDisplay = pm.result_unit === 'percent' ? `${formatNumber(pm.result_value)}%` : formatNumber(pm.result_value);
      pushFact(facts, `production_${pm.name}_result`, pm.result_value, resultDisplay, pm.result_unit, pm.evidence_id ?? pm.source_id, {
        display_variants: roundedDisplayAliases(pm.result_value),
      });
    }
  }

  return facts;
}
