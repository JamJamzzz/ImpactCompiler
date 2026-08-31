/**
 * metrics/metric-validation.mjs — shape/enum validation for a Metric object,
 * and the structural defense that keeps providers (Claude) from ever
 * authoring a deterministic field. Pure, no I/O.
 */
import {
  METRIC_REQUIRED_FIELDS, METRIC_OPERATIONS, METRIC_DIRECTIONS, METRIC_CONFIDENCE_VALUES,
} from '../core/impact-schema.mjs';

function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }
function isStringArray(v) { return Array.isArray(v) && v.every((x) => typeof x === 'string'); }

/** @param {object} metric @returns {{ok:boolean, errors:string[]}} */
export function validateMetricShape(metric) {
  const errors = [];
  if (metric === null || typeof metric !== 'object') return { ok: false, errors: ['metric must be an object'] };

  for (const field of METRIC_REQUIRED_FIELDS) {
    if (metric[field] === undefined) errors.push(`metric.${field}: required`);
  }
  if (metric.operation !== undefined && !METRIC_OPERATIONS.includes(metric.operation)) {
    errors.push(`metric.operation: must be one of ${METRIC_OPERATIONS.join(', ')}`);
  }
  if (metric.direction !== undefined && !METRIC_DIRECTIONS.includes(metric.direction)) {
    errors.push(`metric.direction: must be one of ${METRIC_DIRECTIONS.join(', ')}`);
  }
  if (metric.confidence !== undefined && !METRIC_CONFIDENCE_VALUES.includes(metric.confidence)) {
    errors.push(`metric.confidence: must be one of ${METRIC_CONFIDENCE_VALUES.join(', ')}`);
  }
  if (metric.evidence_ids !== undefined && !isStringArray(metric.evidence_ids)) {
    errors.push('metric.evidence_ids: must be a string array');
  }
  if (metric.id !== undefined && !isNonEmptyString(metric.id)) errors.push('metric.id: must be a non-empty string');

  return { ok: errors.length === 0, errors };
}
