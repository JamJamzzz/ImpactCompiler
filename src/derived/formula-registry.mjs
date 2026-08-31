/**
 * derived/formula-registry.mjs — the ONE whitelisted, deterministic
 * derived-metric engine in ImpactCompiler. There is no general-purpose
 * formula evaluator here and never will be: arbitrary LLM-authored formulas
 * or executable expressions are structurally impossible because this module
 * only exposes a fixed, named set of approved formula functions
 * (`FORMULAS`), each with its own explicit input contract, unit-
 * compatibility check, and assumption policy. Pure, no I/O.
 *
 * Every input is a typed slot `{value, unit, verification_status?,
 * evidence_id?}` — usually sourced from a Metric's before/after/result or a
 * Quantitative Fact (src/facts/quantitative-fact.mjs). No implicit unit or
 * currency conversion is ever performed: units must already match exactly
 * (case-insensitive), or the formula rejects the input outright.
 */

export class DerivationError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'DerivationError';
    this.reason = reason; // 'missing_input' | 'unit_mismatch' | 'zero_denominator' | 'invalid_input'
  }
}

function isFiniteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }

function normalizeUnit(u) { return String(u || '').trim().toLowerCase(); }

/** A required input slot: `{value, unit}`, both present and finite/non-empty. */
function requireSlot(inputs, name) {
  const slot = inputs[name];
  if (!slot || !isFiniteNumber(slot.value) || !slot.unit) {
    throw new DerivationError(`missing or invalid required input "${name}"`, 'missing_input');
  }
  return slot;
}

function requireSameUnit(a, aName, b, bName) {
  if (normalizeUnit(a.unit) !== normalizeUnit(b.unit)) {
    throw new DerivationError(`unit mismatch: "${aName}" is "${a.unit}", "${bName}" is "${b.unit}" — no implicit conversion is ever performed`, 'unit_mismatch');
  }
}

function collectInputIds(inputs, names) {
  return names.map((n) => inputs[n]?.evidence_id || inputs[n]?.fact_id).filter(Boolean);
}

/** time_saved_per_event: before_duration - after_duration (same unit). */
function timeSavedPerEvent(inputs) {
  const before = requireSlot(inputs, 'before_duration');
  const after = requireSlot(inputs, 'after_duration');
  requireSameUnit(before, 'before_duration', after, 'after_duration');
  const value = before.value - after.value;
  return {
    formula_id: 'time_saved_per_event',
    calculation: `${before.value} - ${after.value}`,
    value,
    unit: before.unit,
    assumptions: [],
    quantification_type: 'derived',
    input_ids: collectInputIds(inputs, ['before_duration', 'after_duration']),
  };
}

/** total_time_saved: time_saved_per_event * verified_event_count (over an actually-observed period — no extrapolation). */
function totalTimeSaved(inputs) {
  const perEvent = requireSlot(inputs, 'time_saved_per_event');
  const eventCount = requireSlot(inputs, 'event_count');
  if (eventCount.value <= 0) throw new DerivationError('"event_count" must be a positive number', 'invalid_input');
  const value = perEvent.value * eventCount.value;
  return {
    formula_id: 'total_time_saved',
    calculation: `${perEvent.value} ${perEvent.unit} × ${eventCount.value} ${eventCount.unit}`,
    value,
    unit: perEvent.unit,
    assumptions: [],
    quantification_type: 'derived',
    input_ids: collectInputIds(inputs, ['time_saved_per_event', 'event_count']),
  };
}

/**
 * annual_time_saved has two distinct input paths with different honesty
 * guarantees — never conflated:
 *
 *  1. `annual_event_count` — the caller supplies an event count that ALREADY
 *     represents a full year (an observed complete year, or an explicitly
 *     declared annual figure) — no extrapolation, no future-continuation
 *     assumption. Classified 'derived' when both `time_saved_per_event` and
 *     `annual_event_count` carry `verification_status: 'verified'` (the
 *     default when a slot doesn't state one — e.g. a controlled-benchmark-
 *     derived duration is inherently verified); classified 'estimated',
 *     with the exact unverified input(s) named, the instant either one is
 *     NOT verified (self-reported, unverified, not_attempted) — an
 *     unverified input always propagates to an unverified/estimated
 *     output, never silently promoted.
 *
 *  2. `events_per_period` × explicit `periods_per_year` — a partial-period
 *     rate extrapolated across a full year. This is ALWAYS 'estimated',
 *     regardless of how verified the rate itself is: assuming a weekly/
 *     monthly frequency continues for the rest of the year is itself the
 *     assumption, recorded explicitly in `assumptions`. `periods_per_year`
 *     is never defaulted to 52/12/365 — it must be supplied explicitly.
 *
 * Exactly one of the two input shapes must be supplied.
 */
function annualTimeSaved(inputs) {
  const perEvent = requireSlot(inputs, 'time_saved_per_event');

  if (inputs.annual_event_count) {
    const annualCount = requireSlot(inputs, 'annual_event_count');
    if (annualCount.value <= 0) throw new DerivationError('"annual_event_count" must be a positive number', 'invalid_input');
    const value = perEvent.value * annualCount.value;

    const unverified = [
      ['time_saved_per_event', perEvent], ['annual_event_count', annualCount],
    ].filter(([, slot]) => slot.verification_status && slot.verification_status !== 'verified');

    return {
      formula_id: 'annual_time_saved',
      calculation: `${perEvent.value} ${perEvent.unit} × ${annualCount.value} ${annualCount.unit}`,
      value,
      unit: perEvent.unit,
      assumptions: unverified.length
        ? [`input(s) not marked verified: ${unverified.map(([name]) => name).join(', ')} — the annual figure carries their uncertainty, not a future-continuation assumption`]
        : [],
      quantification_type: unverified.length ? 'estimated' : 'derived',
      input_ids: collectInputIds(inputs, ['time_saved_per_event', 'annual_event_count']),
    };
  }

  const eventsPerPeriod = requireSlot(inputs, 'events_per_period');
  const periodsPerYear = requireSlot(inputs, 'periods_per_year');
  if (eventsPerPeriod.value <= 0) throw new DerivationError('"events_per_period" must be a positive number', 'invalid_input');
  if (periodsPerYear.value <= 0) throw new DerivationError('"periods_per_year" must be a positive number', 'invalid_input');
  const value = perEvent.value * eventsPerPeriod.value * periodsPerYear.value;
  return {
    formula_id: 'annual_time_saved',
    calculation: `${perEvent.value} ${perEvent.unit} × ${eventsPerPeriod.value} ${eventsPerPeriod.unit} × ${periodsPerYear.value} ${periodsPerYear.unit}`,
    value,
    unit: `${perEvent.unit}/year`,
    assumptions: [
      `annualized using an explicit periods_per_year=${periodsPerYear.value} as supplied by the caller (never a silently-assumed 52-week/12-month convention) — extrapolates the observed events_per_period rate across a full year, assuming that frequency continues for the remainder of the year`,
    ],
    quantification_type: 'estimated',
    input_ids: collectInputIds(inputs, ['time_saved_per_event', 'events_per_period', 'periods_per_year']),
  };
}

/**
 * resource_cost_savings: verified_resource_reduction × verified_unit_cost ×
 * explicit_usage_or_time_period. unit_cost's unit must be
 * "<CURRENCY>/<RESOURCE_UNIT>" and resource_reduction's unit must equal
 * <RESOURCE_UNIT> exactly — this is the only unit-compatibility rule this
 * formula applies; it never infers a currency or resource-unit conversion.
 * 'derived' only when every input's verification_status is 'verified';
 * otherwise 'estimated' with the unverified inputs named as assumptions —
 * an unverified input is never silently promoted.
 */
function resourceCostSavings(inputs) {
  const reduction = requireSlot(inputs, 'resource_reduction');
  const unitCost = requireSlot(inputs, 'unit_cost');
  const period = requireSlot(inputs, 'usage_or_period');

  const costParts = String(unitCost.unit).split('/');
  if (costParts.length !== 2) {
    throw new DerivationError('"unit_cost" must have a unit of the form "<CURRENCY>/<RESOURCE_UNIT>" (e.g. "USD/hour")', 'unit_mismatch');
  }
  const [currency, perUnit] = costParts;
  if (normalizeUnit(perUnit) !== normalizeUnit(reduction.unit)) {
    throw new DerivationError(`unit mismatch: unit_cost is per "${perUnit}" but resource_reduction is in "${reduction.unit}"`, 'unit_mismatch');
  }

  const value = reduction.value * unitCost.value * period.value;
  const unverified = ['resource_reduction', 'unit_cost', 'usage_or_period']
    .filter((name) => inputs[name].verification_status && inputs[name].verification_status !== 'verified');

  return {
    formula_id: 'resource_cost_savings',
    calculation: `${reduction.value} ${reduction.unit} × ${unitCost.value} ${unitCost.unit} × ${period.value} ${period.unit}`,
    value,
    unit: currency,
    assumptions: unverified.length
      ? [`input(s) not marked verified: ${unverified.join(', ')} — cost savings figure carries their uncertainty`]
      : [],
    quantification_type: unverified.length ? 'estimated' : 'derived',
    input_ids: collectInputIds(inputs, ['resource_reduction', 'unit_cost', 'usage_or_period']),
  };
}

/** The complete, closed set of approved derived-metric formulas. */
export const FORMULAS = {
  time_saved_per_event: timeSavedPerEvent,
  total_time_saved: totalTimeSaved,
  annual_time_saved: annualTimeSaved,
  resource_cost_savings: resourceCostSavings,
};

export const FORMULA_IDS = Object.keys(FORMULAS);

/**
 * @param {string} formulaId - must be one of FORMULA_IDS.
 * @param {object} inputs - named slots, e.g. { before_duration: {value, unit, evidence_id} }.
 * @param {{evidenceIds?:string[]}} [opts] - extra evidence_ids to attach
 *   beyond what's traceable from the inputs (e.g. the Metric/Evidence the
 *   before/after values themselves came from).
 * @returns {{ok:true, metric:object}|{ok:false, error:DerivationError}}
 *   Never throws — every rejection (missing input, unit mismatch, zero/
 *   negative denominator) comes back as an explicit ok:false result so
 *   callers can preserve a "derivation opportunity" instead of crashing.
 */
export function computeDerivedMetric(formulaId, inputs, opts = {}) {
  const formula = FORMULAS[formulaId];
  if (!formula) {
    return { ok: false, error: new DerivationError(`unknown formula "${formulaId}" — not in the approved whitelist (${FORMULA_IDS.join(', ')})`, 'invalid_input') };
  }
  try {
    const result = formula(inputs);
    return {
      ok: true,
      metric: {
        ...result,
        evidence_ids: [...new Set([...(result.input_ids || []), ...(opts.evidenceIds || [])])],
      },
    };
  } catch (err) {
    if (err instanceof DerivationError) return { ok: false, error: err };
    throw err;
  }
}

/**
 * Preserves what a derivation would need instead of fabricating a result —
 * used when a caller can see a POTENTIAL derived metric (e.g. it has a
 * measured before/after but no verified event_count) but the required
 * structured input doesn't exist yet.
 * @returns {object} a "derivation opportunity" record: never a Metric,
 *   never a number — only a description of what's missing.
 */
export function describeDerivationOpportunity(formulaId, missingInputNames, { note } = {}) {
  return {
    formula_id: formulaId,
    missing_inputs: missingInputNames,
    note: note ?? `formula "${formulaId}" could not be computed — supply an explicit Quantitative Fact for: ${missingInputNames.join(', ')}`,
  };
}
