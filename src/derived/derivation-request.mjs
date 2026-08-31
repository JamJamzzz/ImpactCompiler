/**
 * derived/derivation-request.mjs — resolves an explicit, auditable
 * Derivation Request (the `--derivation <path>` CLI input) into the typed
 * input slots src/derived/formula-registry.mjs's computeDerivedMetric
 * expects. Every input is resolved by deterministic ID lookup ONLY:
 * benchmark_id -> controlled_benchmark Evidence -> its Metric; fact_id ->
 * Quantitative Fact; metric_id/evidence_id direct — never fuzzy matching,
 * never inferring a missing input's value. Pure given its lookup maps (no
 * I/O of its own).
 */
import { FORMULA_IDS, computeDerivedMetric } from './formula-registry.mjs';
import { convertUnit } from './unit-conversion.mjs';

function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }
function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

/**
 * @param {object} request - raw parsed derivation-request JSON.
 * @returns {{ok:true, errors:[], request:object}|{ok:false, errors:string[]}}
 */
export function validateDerivationRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { ok: false, errors: ['derivation request must be an object'] };

  if (!isNonEmptyString(request.derivation_id)) errors.push('derivation_id: required non-empty string');
  if (!FORMULA_IDS.includes(request.formula_id)) errors.push(`formula_id: must be one of ${FORMULA_IDS.join(', ')}`);
  if (!isPlainObject(request.inputs)) errors.push('inputs: required object');
  if (!isPlainObject(request.output)) {
    errors.push('output: required object');
  } else {
    if (!isNonEmptyString(request.output.name)) errors.push('output.name: required non-empty string');
    if (request.output.impact_level !== undefined && request.output.impact_level !== null && typeof request.output.impact_level !== 'string') {
      errors.push('output.impact_level: must be a string when present');
    }
    if (request.output.impact_domain !== undefined && request.output.impact_domain !== null && typeof request.output.impact_domain !== 'string') {
      errors.push('output.impact_domain: must be a string when present');
    }
    if (request.output.unit !== undefined && request.output.unit !== null && !isNonEmptyString(request.output.unit)) {
      errors.push('output.unit: must be a non-empty string when present');
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], request };
}

/** Finds the controlled_benchmark Evidence with this benchmark_id, and the
 *  Metric it produced — both required, resolved by exact id match only. */
function resolveBenchmarkDuration(benchmarkId, { evidenceById, metrics }) {
  const benchmarkEvidence = [...evidenceById.values()].find((e) => e.type === 'controlled_benchmark' && e.benchmark_id === benchmarkId);
  if (!benchmarkEvidence) return { ok: false, reason: `no controlled_benchmark evidence found with benchmark_id "${benchmarkId}"` };
  const metric = metrics.find((m) => (m.evidence_ids || []).includes(benchmarkEvidence.id));
  if (!metric) return { ok: false, reason: `controlled_benchmark "${benchmarkId}" has no computed Metric (measurement unresolved)` };
  return {
    ok: true,
    before: { value: metric.before, unit: metric.unit, evidence_id: benchmarkEvidence.id },
    after: { value: metric.after, unit: metric.unit, evidence_id: benchmarkEvidence.id },
    metricId: metric.id,
    evidenceId: benchmarkEvidence.id,
  };
}

function resolveFactSlot(factId, factsById) {
  const fact = factsById.get(factId);
  if (!fact) return null;
  return {
    value: fact.value, unit: fact.unit, fact_id: fact.fact_id, evidence_id: fact.evidence_id, verification_status: fact.verification_status,
  };
}

/**
 * @param {object} request - a validated (validateDerivationRequest) request.
 * @param {{metricsById:Map, metrics:object[], evidenceById:Map, factsById:Map}} lookups
 * @returns {{ok:true, metric:object, chainedFromMetricId:string|null, evidenceIds:string[]}|
 *   {ok:false, opportunity:{formula_id:string, missing_inputs:string[], note:string}}}
 *   Never throws — every unresolved input becomes a structured "derivation
 *   opportunity", never a fabricated Metric.
 */
export function resolveAndComputeDerivation(request, {
  metricsById, metrics, evidenceById, factsById,
}) {
  const missing = [];
  const evidenceIds = new Set();
  const resolvedInputs = {};
  let chainedFromMetricId = null;

  const rawInputs = request.inputs || {};

  // "duration_metric" is a convenience shortcut: it resolves a benchmark/
  // metric reference into a before/after pair, which is either used
  // directly (formula_id === 'time_saved_per_event') or chained through
  // that same formula as a pre-step to feed 'time_saved_per_event' into
  // total_time_saved/annual_time_saved — deterministic code, not inference:
  // the chain is a fixed, documented rule, never a guess at what the caller
  // "probably meant".
  let durationResolution = null;
  if (rawInputs.duration_metric) {
    const ref = rawInputs.duration_metric;
    if (ref.benchmark_id) durationResolution = resolveBenchmarkDuration(ref.benchmark_id, { evidenceById, metrics });
    else if (ref.metric_id) {
      const m = metricsById.get(ref.metric_id);
      durationResolution = m
        ? {
          ok: true,
          before: { value: m.before, unit: m.unit, evidence_id: (m.evidence_ids || [])[0] },
          after: { value: m.after, unit: m.unit, evidence_id: (m.evidence_ids || [])[0] },
          metricId: m.id,
          evidenceId: (m.evidence_ids || [])[0],
        }
        : { ok: false, reason: `no Metric found with id "${ref.metric_id}"` };
    } else {
      durationResolution = { ok: false, reason: '"duration_metric" must specify benchmark_id or metric_id' };
    }
    if (!durationResolution.ok) missing.push(durationResolution.reason);
  }

  if (request.formula_id === 'time_saved_per_event') {
    if (durationResolution?.ok) {
      resolvedInputs.before_duration = durationResolution.before;
      resolvedInputs.after_duration = durationResolution.after;
      evidenceIds.add(durationResolution.evidenceId);
      chainedFromMetricId = durationResolution.metricId;
    }
  } else if (['total_time_saved', 'annual_time_saved'].includes(request.formula_id) && durationResolution?.ok) {
    const perEventResult = computeDerivedMetric('time_saved_per_event', {
      before_duration: durationResolution.before, after_duration: durationResolution.after,
    });
    if (perEventResult.ok) {
      resolvedInputs.time_saved_per_event = { value: perEventResult.metric.value, unit: perEventResult.metric.unit, evidence_id: durationResolution.evidenceId };
      evidenceIds.add(durationResolution.evidenceId);
      chainedFromMetricId = durationResolution.metricId;
    } else {
      missing.push(perEventResult.error.message);
    }
  }

  // Every other input key maps directly to a formula slot of the same name.
  // A key ending "_fact_id" resolves that fact and targets the slot named
  // by stripping the suffix (e.g. "events_per_period_fact_id" -> slot
  // "events_per_period").
  for (const [key, value] of Object.entries(rawInputs)) {
    if (key === 'duration_metric') continue;
    let slotName = key;
    let ref = value;
    if (key.endsWith('_fact_id')) {
      slotName = key.slice(0, -'_fact_id'.length);
      ref = { fact_id: value };
    }
    if (resolvedInputs[slotName]) continue; // already resolved via the duration_metric chain

    if (typeof ref === 'string') ref = { fact_id: ref };

    if (ref && typeof ref === 'object' && ref.fact_id) {
      const slot = resolveFactSlot(ref.fact_id, factsById);
      if (!slot) { missing.push(`fact "${ref.fact_id}" not found for input "${slotName}"`); continue; }
      resolvedInputs[slotName] = slot;
      if (slot.evidence_id) evidenceIds.add(slot.evidence_id);
    } else if (ref && typeof ref === 'object' && ref.metric_id) {
      const m = metricsById.get(ref.metric_id);
      if (!m) { missing.push(`metric "${ref.metric_id}" not found for input "${slotName}"`); continue; }
      const evId = (m.evidence_ids || [])[0];
      resolvedInputs[slotName] = { value: m.result?.value ?? m.after, unit: m.result?.value_unit ?? m.unit, evidence_id: evId };
      if (evId) evidenceIds.add(evId);
    } else if (ref && typeof ref === 'object' && ref.evidence_id) {
      const ev = evidenceById.get(ref.evidence_id);
      if (!ev) { missing.push(`evidence "${ref.evidence_id}" not found for input "${slotName}"`); continue; }
      evidenceIds.add(ev.id);
      resolvedInputs[slotName] = { value: ref.value, unit: ref.unit, evidence_id: ev.id };
    } else if (ref && typeof ref === 'object' && typeof ref.value === 'number') {
      // an explicit literal supplied directly in the auditable request file
      // (e.g. periods_per_year: {value:52, unit:"weeks/year", source:"explicit_convention"})
      resolvedInputs[slotName] = { value: ref.value, unit: ref.unit, verification_status: 'verified' };
    } else if (ref !== undefined) {
      missing.push(`input "${slotName}" is not a recognized reference shape (expected {fact_id}, {metric_id}, {evidence_id}, or {value, unit})`);
    }
  }

  if (missing.length) {
    return {
      ok: false,
      opportunity: {
        formula_id: request.formula_id,
        missing_inputs: missing,
        note: `derivation "${request.derivation_id}" could not be computed — ${missing.join('; ')}`,
      },
    };
  }

  const result = computeDerivedMetric(request.formula_id, resolvedInputs, { evidenceIds: [...evidenceIds].filter(Boolean) });
  if (!result.ok) {
    return {
      ok: false,
      opportunity: {
        formula_id: request.formula_id,
        missing_inputs: [],
        note: `derivation "${request.derivation_id}" failed: ${result.error.message}`,
      },
    };
  }

  let { metric } = result;

  // An explicit, EXPLICITLY-requested output unit (item 2: exact unit
  // conversion is allowed only when the caller explicitly asks for it) —
  // never applied unless request.output.unit names a different unit than
  // what the formula naturally produced. A conversion that fails
  // (incompatible units, unsupported path, calendar-dependent period
  // mismatch) becomes a derivation opportunity, exactly like a missing
  // input — never a silently-kept mismatched unit.
  if (request.output.unit && request.output.unit !== metric.unit) {
    const conversion = convertUnit(metric.value, metric.unit, request.output.unit);
    if (!conversion.ok) {
      return {
        ok: false,
        opportunity: {
          formula_id: request.formula_id,
          missing_inputs: [],
          note: `derivation "${request.derivation_id}" could not convert "${metric.unit}" to the requested output unit "${request.output.unit}": ${conversion.reason}`,
        },
      };
    }
    // The calculation string always records the conversion that was
    // performed, appended to (never replacing) the original formula
    // calculation — the exact input arithmetic stays fully auditable.
    const conversionSuffix = conversion.operator ? ` ${conversion.operator} ${conversion.factor}` : '';
    metric = {
      ...metric,
      value: conversion.value,
      unit: conversion.unit,
      calculation: `(${metric.calculation})${conversionSuffix}`,
    };
  }

  return {
    ok: true, metric, chainedFromMetricId, evidenceIds: [...evidenceIds].filter(Boolean),
  };
}
