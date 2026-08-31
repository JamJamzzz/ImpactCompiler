/**
 * facts/quantitative-fact.mjs — the explicit contract for a Quantitative
 * Fact: a structured numeric input (execution frequency, team usage, unit
 * cost, observation period, ...) that a derived/estimated Metric may use as
 * an input (src/derived/formula-registry.mjs). Pure, no I/O.
 *
 * ImpactCompiler never parses a number out of free-text Evidence into a
 * Fact automatically — free text may only SUGGEST a fact is missing (see
 * src/derived/formula-registry.mjs's "derivation opportunity" result); a
 * Fact must always be supplied explicitly, with its own verification_status
 * honestly stated (never silently upgraded to 'verified').
 */
import { VERIFICATION_STATUSES } from '../core/impact-schema.mjs';

function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }
function isFiniteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

/**
 * @param {object} fact
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateQuantitativeFact(fact) {
  const errors = [];
  if (!isPlainObject(fact)) return { ok: false, errors: ['quantitative fact must be an object'] };

  if (!isNonEmptyString(fact.fact_id)) errors.push('fact_id: required non-empty string');
  if (!isNonEmptyString(fact.name)) errors.push('name: required non-empty string');
  if (!isFiniteNumber(fact.value)) errors.push('value: required finite number');
  if (!isNonEmptyString(fact.unit)) errors.push('unit: required non-empty string');
  if (!VERIFICATION_STATUSES.includes(fact.verification_status)) {
    errors.push(`verification_status: must be one of ${VERIFICATION_STATUSES.join(', ')}`);
  }
  if (!isNonEmptyString(fact.evidence_id)) errors.push('evidence_id: required non-empty string — a fact must always trace to the Evidence it came from');

  if (fact.source_reference !== undefined && typeof fact.source_reference !== 'string') {
    errors.push('source_reference: must be a string when present');
  }
  if (fact.window !== undefined && fact.window !== null) {
    if (!isPlainObject(fact.window)) errors.push('window: must be an object when present');
  }
  if (fact.scope !== undefined && fact.scope !== null) {
    if (!isPlainObject(fact.scope)) errors.push('scope: must be an object when present');
  }
  if (fact.assumptions !== undefined) {
    if (!(Array.isArray(fact.assumptions) && fact.assumptions.every((a) => typeof a === 'string'))) {
      errors.push('assumptions: must be an array of strings when present');
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * @param {object} fact - a fact that has already passed validateQuantitativeFact.
 * @returns {object} normalized with optional fields defaulted (never
 *   fabricates a missing required field).
 */
export function normalizeQuantitativeFact(fact) {
  return {
    fact_id: fact.fact_id,
    name: fact.name,
    value: fact.value,
    unit: fact.unit,
    verification_status: fact.verification_status,
    evidence_id: fact.evidence_id,
    source_reference: fact.source_reference ?? null,
    window: fact.window ?? null,
    scope: fact.scope ?? null,
    assumptions: fact.assumptions ?? [],
    // Resume-Impact phase, additive optional pass-through — never inferred,
    // only ever taken verbatim when the caller supplies them (e.g. the CLI
    // --quantitative-fact adapter, src/facts/quantitative-fact-adapter.mjs).
    // `kind` is free text describing what category of fact this is (e.g.
    // "event_frequency", "unit_cost") purely for human/derivation-request
    // readability — never validated against a closed enum, since the set of
    // useful kinds is open-ended and a wrong/missing kind never changes
    // whether the fact's own value/unit/verification_status are honest.
    kind: fact.kind ?? null,
    related_service: fact.related_service ?? null,
    related_benchmark_id: fact.related_benchmark_id ?? null,
  };
}
