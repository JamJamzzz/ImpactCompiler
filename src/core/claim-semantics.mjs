/**
 * core/claim-semantics.mjs — V2 (Deep-hardening phase): semantic claim
 * validation layered on top of core/validation.mjs's numeric-membership
 * check. Pure, no I/O, no LLM.
 *
 * V1's `validateAgainstAllowedNumericFacts` answers "is every number in this
 * text traceable to a real fact?" — necessary, not sufficient. A sentence can
 * cite only real, supported numbers and still misrepresent the underlying
 * result: a real number paired with the wrong unit, the wrong direction, or
 * generalized beyond what the evidence's scope actually covers. This module
 * adds three additional, deterministic, bounded checks — unit consistency,
 * polarity/direction consistency, and scope-generalization — and returns a
 * structured multi-violation result instead of a single pass/fail, per
 * impact-schema.mjs's CLAIM_VIOLATION_TYPES.
 *
 * Deliberately NOT a natural-language-understanding engine: every check here
 * is a small, explicit, auditable word/phrase table plus straightforward
 * lexical proximity — never fuzzy matching, never an LLM call, never a
 * general ontology. Anything outside these bounded tables produces no
 * opinion (no false positive), not a guess.
 */
import { normalizeNumericToken, validateAgainstAllowedNumericFacts } from './validation.mjs';

/**
 * Canonical unit-word equivalence classes. Each key is a canonical category;
 * each value lists surface forms (already lowercased) that mean it. Only
 * covers common, unambiguous physical/measurement/countable-entity units —
 * anything not listed here (most real `unit` strings in this domain are
 * free-text, e.g. "clock cycles to program completion", "source lines
 * covered") is intentionally left unclassified, so the unit check simply has
 * no opinion rather than guessing at a fuzzy equivalence.
 */
const UNIT_CATEGORIES = {
  milliseconds: ['ms', 'millisecond', 'milliseconds'],
  seconds: ['s', 'sec', 'secs', 'second', 'seconds'],
  bytes: ['b', 'byte', 'bytes'],
  kilobytes: ['kb', 'kilobyte', 'kilobytes'],
  megabytes: ['mb', 'megabyte', 'megabytes'],
  gigabytes: ['gb', 'gigabyte', 'gigabytes'],
  percent: ['%', 'percent', 'pct', 'percentage'],
  percentage_points: ['percentage_points', 'percentage points', 'pp'],
  multiplier: ['x', '×', 'times'],
  workers: ['worker', 'workers'],
  files: ['file', 'files'],
  threads: ['thread', 'threads'],
  requests: ['request', 'requests'],
  users: ['user', 'users'],
  nodes: ['node', 'nodes'],
  cores: ['core', 'cores'],
  tests: ['test', 'tests'],
  cases: ['case', 'cases'],
  samples: ['sample', 'samples'],
  runs: ['run', 'runs', 'rep', 'reps', 'repetition', 'repetitions'],
};

const SURFACE_TO_CATEGORY = new Map();
for (const [category, surfaces] of Object.entries(UNIT_CATEGORIES)) {
  for (const s of surfaces) SURFACE_TO_CATEGORY.set(s, category);
}

/** @returns {string|null} the canonical unit category for a raw unit/label
 *  string, or null if it isn't one of the known categories. */
function canonicalUnitCategory(raw) {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase();
  return SURFACE_TO_CATEGORY.get(key) ?? null;
}

/** A fact's own `unit` is a free-text label most of the time (e.g. "ops/s"),
 *  but a scope fact has `unit: null` and its category lives in its `name`
 *  instead (e.g. `scope_workers` -> "workers"). Falls back to deriving a
 *  label from `name` only when `unit` itself doesn't resolve. */
function factUnitCategory(fact) {
  const fromUnit = canonicalUnitCategory(fact.unit);
  if (fromUnit) return fromUnit;
  const nameLabel = String(fact.name || '').replace(/^scope_/, '').replace(/^production_.*_/, '');
  return canonicalUnitCategory(nameLabel);
}

/** Scans a bounded window of text immediately after a matched token's end
 *  index for the first word that resolves to a known unit category.
 *  Deliberately short-range (the unit word for a number is almost always the
 *  very next word in a resume-style sentence) to avoid picking up an
 *  unrelated unit word from later in a long sentence — and, critically,
 *  stops at the next DIGIT: "regressed -10.24% (64 workers)" must never
 *  attribute "workers" to -10.24% just because it's within the character
 *  window — "workers" belongs to the adjacent "64", a different number's
 *  unit, and scanning stops before ever reaching it. */
function claimedUnitNear(text, endIndex) {
  const window = text.slice(endIndex, endIndex + 24);
  const nextDigitIndex = window.search(/\d/);
  const boundedWindow = nextDigitIndex === -1 ? window : window.slice(0, nextDigitIndex);
  const words = boundedWindow.match(/[A-Za-z%×]+/g) || [];
  for (const w of words.slice(0, 2)) {
    const cat = canonicalUnitCategory(w);
    if (cat) return cat;
  }
  return null;
}

/**
 * Checks every numeric token in `text` that matches a claimable fact against
 * that fact's own unit category. Only fires when BOTH the fact's unit and a
 * nearby claimed unit word resolve to a KNOWN category and they DIFFER — an
 * unrecognized unit on either side produces no opinion, never a false
 * positive.
 * @returns {{type:'unit_mismatch', token:string, fact_unit:string, claimed_unit:string}[]}
 */
function checkUnitConsistency(text, claimableFacts) {
  const violations = [];
  const byValue = new Map();
  for (const f of claimableFacts) {
    const cat = factUnitCategory(f);
    if (!cat) continue;
    byValue.set(normalizeNumericToken(String(f.value)), { fact: f, category: cat });
    for (const variant of f.display_variants || []) {
      byValue.set(normalizeNumericToken(variant), { fact: f, category: cat });
    }
  }
  if (!byValue.size) return violations;
  for (const match of String(text || '').matchAll(/(?<![A-Za-z0-9+-])[+-]?\d[\d,]*(?:\.\d+)?%?/g)) {
    const token = match[0];
    const normalized = normalizeNumericToken(token);
    const entry = byValue.get(normalized);
    if (!entry) continue;
    const claimedCategory = claimedUnitNear(text, match.index + token.length);
    if (claimedCategory && claimedCategory !== entry.category) {
      violations.push({
        type: 'unit_mismatch', token, fact_unit: entry.category, claimed_unit: claimedCategory,
      });
    }
  }
  return violations;
}

const DELTA_INCREASE_WORDS = ['increase', 'increased', 'increases', 'rise', 'rose', 'grew', 'grow', 'grows', 'higher', 'raise', 'raised', 'more', 'gained', 'added', 'expanded', 'up'];
const DELTA_DECREASE_WORDS = ['decrease', 'decreased', 'decreases', 'fell', 'fall', 'falls', 'fewer', 'lower', 'lowered', 'reduce', 'reduced', 'reduction', 'dropped', 'drop', 'less', 'shrank', 'shrunk', 'down'];
const OUTCOME_IMPROVE_WORDS = ['improve', 'improved', 'improvement', 'improves', 'better', 'faster', 'gain', 'boosted', 'boost', 'enhanced', 'speedup', 'sped'];
const OUTCOME_REGRESS_WORDS = ['regress', 'regressed', 'regression', 'worse', 'slower', 'worsened', 'degrade', 'degraded', 'slowdown'];

function wordSetNear(text, index, radius = 40) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return new Set((text.slice(start, end).toLowerCase().match(/[a-z]+/g) || []));
}

/**
 * Checks direction-bearing language near a matched metric-linked fact
 * (relative_change/absolute_delta/result_value — the facts that carry a real
 * signed value) against two INDEPENDENT things, per the task's own warning
 * that these must never be conflated:
 *  - a DELTA-direction word (increased/decreased/...) must match the actual
 *    arithmetic SIGN of the fact's value — this is direction-agnostic to
 *    whether the change is good or bad.
 *  - an OUTCOME word (improved/regressed/...) must match the candidate's own
 *    `outcome` field (improvement/regression) — this is what "lower_is_better"
 *    already resolved deterministically, never re-derived from the word
 *    itself.
 * @returns {{type:'polarity_mismatch', ...}[]}
 */
function checkPolarityConsistency(text, claimableFacts, candidate) {
  const violations = [];
  const deltaFacts = claimableFacts.filter((f) => ['relative_change', 'absolute_delta', 'result_value'].includes(f.name));
  if (!deltaFacts.length) return violations;
  const byValue = new Map();
  for (const f of deltaFacts) {
    byValue.set(normalizeNumericToken(String(f.value)), f);
    for (const variant of f.display_variants || []) byValue.set(normalizeNumericToken(variant), f);
  }
  for (const match of String(text || '').matchAll(/(?<![A-Za-z0-9+-])[+-]?\d[\d,]*(?:\.\d+)?%?/g)) {
    const token = match[0];
    const fact = byValue.get(normalizeNumericToken(token));
    if (!fact) continue;
    const nearby = wordSetNear(text, match.index);
    const sign = Math.sign(fact.value);
    if (sign !== 0) {
      const claimsIncrease = DELTA_INCREASE_WORDS.some((w) => nearby.has(w));
      const claimsDecrease = DELTA_DECREASE_WORDS.some((w) => nearby.has(w));
      if (claimsIncrease && sign < 0) violations.push({ type: 'polarity_mismatch', token, detail: 'claims an increase but the fact\'s value is negative (a decrease)' });
      if (claimsDecrease && sign > 0) violations.push({ type: 'polarity_mismatch', token, detail: 'claims a decrease but the fact\'s value is positive (an increase)' });
    }
    if (candidate?.outcome === 'improvement' || candidate?.outcome === 'regression') {
      const claimsImprove = OUTCOME_IMPROVE_WORDS.some((w) => nearby.has(w));
      const claimsRegress = OUTCOME_REGRESS_WORDS.some((w) => nearby.has(w));
      if (claimsImprove && candidate.outcome === 'regression') violations.push({ type: 'polarity_mismatch', token, detail: 'claims improvement but candidate.outcome is "regression"' });
      if (claimsRegress && candidate.outcome === 'improvement') violations.push({ type: 'polarity_mismatch', token, detail: 'claims regression but candidate.outcome is "improvement"' });
    }
  }
  return violations;
}

/**
 * Bounded phrase list for unsupported scope broadening — deliberately small
 * and literal (not a general "generalization detector"). A claim containing
 * one of these phrases is only a violation when the candidate's own
 * `quality_profile.scope_breadth` is NOT "global" — narrower or
 * evidence-matching language is always allowed through unchanged.
 *
 * V2.1 fix: this used to key off `scope_completeness !== 'complete'`.
 * `scope_completeness` answers "is scope recorded and traceable?", not
 * "does the evidence justify universal language?" — a single, perfectly
 * traceable benchmark measurement (the normal, expected shape of nearly
 * every real candidate) was classified 'complete', so this check never
 * fired for it no matter how sweeping the claim's language was (found
 * during V2's development-set evaluation, reproduced 0/1 on a realistic
 * single-benchmark fixture — see
 * docs/IMPACTCOMPILER_V2_VALIDATION_MODEL.md and
 * evaluations/impactcompiler-v2-development/V2_1_SCOPE_FIXTURES.json).
 * `scope_completeness` itself is UNCHANGED (still means exactly what it
 * always meant, still used unchanged by ranking.mjs/impact-opportunities.mjs)
 * — this check now reads the new, separate `quality_profile.scope_breadth`
 * field (candidates/quality-profile.mjs's deriveScopeBreadth) instead, which
 * answers the breadth question this check actually needs answered.
 */
const UNIVERSAL_SCOPE_PHRASES = [
  'overall', 'system-wide', 'systemwide', 'system wide', 'universally', 'across all', 'across every',
  'all workloads', 'all benchmarks', 'every workload', 'every benchmark', 'in general', 'globally',
  'for all cases', 'every case', 'entirely', 'across the entire system', 'across all scenarios',
];

function checkScopeGeneralization(text, candidate) {
  const violations = [];
  const scopeBreadth = candidate?.quality_profile?.scope_breadth;
  if (scopeBreadth === 'global') return violations;
  const lower = String(text || '').toLowerCase();
  for (const phrase of UNIVERSAL_SCOPE_PHRASES) {
    if (lower.includes(phrase)) {
      violations.push({
        type: 'scope_overgeneralization',
        phrase,
        detail: `claims universal/global scope ("${phrase}") but candidate scope_breadth is "${scopeBreadth ?? 'unknown'}", not "global"`,
      });
    }
  }
  return violations;
}

/**
 * The V2 structured claim-validation entry point. Runs the existing V1
 * numeric-membership check (unchanged, still available standalone as
 * `validateAgainstAllowedNumericFacts`) plus the three new semantic checks,
 * and merges everything into one `{valid, violations}` result. A claim can
 * fail for more than one reason at once; every violation names exactly one
 * of impact-schema.mjs's CLAIM_VIOLATION_TYPES.
 * @param {string} text
 * @param {object} candidate - a full Impact Candidate (needs
 *   `allowed_numeric_facts`, `outcome`, `quality_profile.scope_breadth`).
 * @returns {{valid:boolean, violations:object[]}}
 */
export function validateClaimSemantics(text, candidate) {
  const allowedNumericFacts = candidate?.allowed_numeric_facts || [];
  const claimableFacts = allowedNumericFacts.filter((f) => f.externally_claimable !== false);
  const nonClaimableFacts = allowedNumericFacts.filter((f) => f.externally_claimable === false);

  const violations = [];

  // Numeric membership, reusing the existing V1 check verbatim (unsupported
  // numbers), then a second pass distinguishing "matches nothing" from
  // "matches only a non-claimable ADAPTER_INTERNAL fact" — the latter gets
  // its own, more specific violation type instead of a generic
  // "unsupported_number".
  const unsupported = validateAgainstAllowedNumericFacts(text, claimableFacts);
  const nonClaimableDisplays = new Set([
    ...nonClaimableFacts.map((f) => f.display),
    ...nonClaimableFacts.flatMap((f) => f.display_variants || []),
  ]);
  const nonClaimableValues = new Set(nonClaimableFacts.map((f) => normalizeNumericToken(String(f.value))));
  for (const token of unsupported) {
    const isAdapterInternal = nonClaimableDisplays.has(token) || nonClaimableValues.has(normalizeNumericToken(token));
    violations.push(
      isAdapterInternal
        ? { type: 'adapter_internal_fact', token, detail: 'value exists only as an internal schema-compatibility placeholder, never an externally-claimable source fact' }
        : { type: 'unsupported_number', token },
    );
  }

  violations.push(...checkUnitConsistency(text, claimableFacts));
  violations.push(...checkPolarityConsistency(text, claimableFacts, candidate));
  violations.push(...checkScopeGeneralization(text, candidate));

  return { valid: violations.length === 0, violations };
}

export { UNIT_CATEGORIES, UNIVERSAL_SCOPE_PHRASES };
