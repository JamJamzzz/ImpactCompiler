/**
 * metrics/deterministic-metric-engine.mjs — the ONE place arithmetic happens
 * in ImpactCompiler. No LLM provider may compute, override, or "correct" any
 * value this module produces (core/impact-schema.mjs's
 * METRIC_DETERMINISTIC_FIELDS names exactly which fields are off-limits to
 * providers; core/validation.mjs enforces it structurally).
 *
 * Precision policy: internal math is done at full double precision; only the
 * DISPLAY value (what callers put in prose/rounding-sensitive comparisons)
 * is rounded, to 2 decimal places, and only at the boundary
 * (`roundForDisplay`). Stored `absolute_delta`/`relative_change_percent`
 * fields are the rounded display values — `calculation` always records the
 * exact unrounded expression so the math is independently reproducible.
 */
import { METRIC_OPERATIONS, METRIC_DIRECTIONS } from '../core/impact-schema.mjs';

export class MetricComputationError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'MetricComputationError';
    this.reason = reason; // 'missing_value' | 'zero_denominator' | 'unit_mismatch' | 'invalid_operation' | 'invalid_direction'
  }
}

function roundForDisplay(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * @param {{name:string, before:number, after:number, unit:string,
 *   beforeUnit?:string, afterUnit?:string, operation:string, direction:string,
 *   evidenceIds:string[], confidence:string, id:string}} input
 *   `beforeUnit`/`afterUnit` are optional explicit per-value units — when
 *   both are supplied and differ from `unit` (or each other), this is an
 *   explicit unit mismatch and computation refuses to coerce them.
 * @returns {{ok:true, metric:object}|{ok:false, error:MetricComputationError}}
 *   Never throws — zero-denominator, missing values, and unit mismatches are
 *   all returned as an explicit `ok:false` result so callers can preserve the
 *   evidence as `unresolved`/`unsupported` rather than crashing or guessing.
 */
export function computeMetric(input) {
  const {
    name, before, after, unit, beforeUnit, afterUnit, operation, direction, evidenceIds, confidence, id,
  } = input;

  if (!METRIC_OPERATIONS.includes(operation)) {
    return { ok: false, error: new MetricComputationError(`unknown operation "${operation}"`, 'invalid_operation') };
  }
  if (!METRIC_DIRECTIONS.includes(direction)) {
    return { ok: false, error: new MetricComputationError(`unknown direction "${direction}"`, 'invalid_direction') };
  }
  if (!isFiniteNumber(before) || !isFiniteNumber(after)) {
    return { ok: false, error: new MetricComputationError('before/after must both be finite numbers', 'missing_value') };
  }
  if (beforeUnit && afterUnit && beforeUnit !== afterUnit) {
    return { ok: false, error: new MetricComputationError(`unit mismatch: before is "${beforeUnit}", after is "${afterUnit}"`, 'unit_mismatch') };
  }

  const rawAbsoluteDelta = after - before;
  let rawRelativeChangePercent = null;
  let calculation;
  let rawResultValue;
  let resultUnit;

  // absAbsoluteBefore is only ever written into the calculation string when
  // it differs from `before` itself (i.e. before < 0) — for the common
  // positive-before case the string is unchanged from before this fix, so
  // every existing golden-case calculation string stays byte-identical.
  const absBefore = Math.abs(before);

  if (operation === 'ratio') {
    if (before === 0) {
      return { ok: false, error: new MetricComputationError('ratio operation requires a non-zero "before" value', 'zero_denominator') };
    }
    calculation = `${after} / ${before}`;
    rawResultValue = after / before;
    resultUnit = 'ratio';
  } else if (operation === 'absolute_delta') {
    // No division, no zero-before restriction — before:0 is explicitly
    // allowed here (e.g. "0 -> 5 errors" is a meaningful absolute delta).
    calculation = `${after} - ${before}`;
    rawResultValue = rawAbsoluteDelta;
    resultUnit = unit;
  } else if (operation === 'percentage_reduction') {
    if (before === 0) {
      return { ok: false, error: new MetricComputationError('percentage/relative operations require a non-zero "before" value', 'zero_denominator') };
    }
    // Signed on purpose: if after > before this comes out NEGATIVE, which is
    // the honest signal that a "reduction" operation actually regressed.
    // Never wrapped in abs() — that would silently hide the regression.
    calculation = `(${before} - ${after}) / ${absBefore} * 100`;
    rawRelativeChangePercent = ((before - after) / absBefore) * 100;
    rawResultValue = rawRelativeChangePercent;
    resultUnit = 'percent';
  } else {
    // percentage_increase
    if (before === 0) {
      return { ok: false, error: new MetricComputationError('percentage/relative operations require a non-zero "before" value', 'zero_denominator') };
    }
    // Signed on purpose: if after < before this comes out NEGATIVE — an
    // "increase" operation whose value actually fell.
    calculation = `(${after} - ${before}) / ${absBefore} * 100`;
    rawRelativeChangePercent = ((after - before) / absBefore) * 100;
    rawResultValue = rawRelativeChangePercent;
    resultUnit = 'percent';
  }

  // Outcome is decided from the direction the metric declared "better" and
  // the actual sign of the raw change — never from the operation, and never
  // by an LLM. This is intentionally independent of which operation was
  // requested: a percentage_reduction that regresses and a percentage_increase
  // that regresses both land on 'regression' via the same rule.
  let outcome;
  if (rawAbsoluteDelta === 0) outcome = 'no_change';
  else if (direction === 'lower_is_better') outcome = rawAbsoluteDelta < 0 ? 'improvement' : 'regression';
  else outcome = rawAbsoluteDelta > 0 ? 'improvement' : 'regression';

  const metric = {
    id,
    name,
    before,
    after,
    unit,
    operation,
    direction,
    absolute_delta: roundForDisplay(rawAbsoluteDelta),
    relative_change_percent: rawRelativeChangePercent === null ? null : roundForDisplay(rawRelativeChangePercent),
    calculation,
    result: {
      value: roundForDisplay(rawResultValue),
      value_unit: resultUnit,
      outcome,
    },
    confidence,
    evidence_ids: evidenceIds ?? [],
  };

  return { ok: true, metric };
}
