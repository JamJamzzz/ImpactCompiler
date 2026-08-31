/**
 * evidence/production-metric-adapter.mjs — V3 input adapter for explicit
 * production/observability metrics (p95/p99 latency, error rate,
 * throughput, CPU/memory utilization, DB query count, cache hit rate,
 * deployment frequency, incident count, MTTR, queue depth, timeout rate,
 * or any other named before/after production measurement — `name` stays
 * free text, same convention as benchmark-adapter.mjs, never a closed enum).
 *
 * Same discipline as benchmark-adapter.mjs, extended with production
 * context: only an EXPLICIT structured before/after may ever become a
 * deterministic metric — this adapter never aggregates raw data itself
 * (that's log-adapter.mjs/observability-adapter.mjs's territory, and they
 * never produce a metric at all). Missing/ambiguous/invalid input is
 * preserved as evidence and marked unresolved/unsupported, never guessed.
 */
import { METRIC_DIRECTIONS, METRIC_OPERATIONS, IMPACT_LEVELS } from '../core/impact-schema.mjs';

function isFiniteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }

function parseWindow(window) {
  if (window === undefined) return { before: null, after: null };
  if (window === null || typeof window !== 'object') return null;
  return { before: window.before ?? null, after: window.after ?? null };
}

function parseSampleSize(sampleSize) {
  if (sampleSize === undefined) return { before: null, after: null };
  if (sampleSize === null || typeof sampleSize !== 'object') return null;
  const { before, after } = sampleSize;
  if (before !== undefined && before !== null && !isFiniteNumber(before)) return null;
  if (after !== undefined && after !== null && !isFiniteNumber(after)) return null;
  return { before: before ?? null, after: after ?? null };
}

/**
 * Canonical input shape:
 * {
 *   name, before, after, unit, direction, operation (optional, same default
 *   rule as benchmark-adapter.mjs), environment, service, window: {before,
 *   after}, aggregation, sample_size: {before, after}, source,
 *   verification_status
 * }
 * `environment` is preserved when given but NOT required to resolve the
 * metric itself — the deterministic calculation doesn't need it. What it
 * gates is downstream claim language ("production impact" requires a known
 * environment), enforced at the prompt layer, not here.
 * @param {object} raw
 * @param {string} sourcePath
 * @returns {{resolution:'resolved'|'unresolved'|'unsupported', reason?:string, ...}}
 */
export function parseProductionMetricArtifact(raw, sourcePath) {
  if (raw === null || typeof raw !== 'object') {
    return { resolution: 'unsupported', reason: 'artifact is not a JSON object', raw, source_path: sourcePath };
  }
  const {
    name, before, after, unit, direction, operation, environment, service, window,
    aggregation, sample_size: sampleSize, source, verification_status: verificationStatus,
    commit_sha: commitSha, impact_level: impactLevel, impact_domain: impactDomain,
    system, component,
  } = raw;

  if (!isNonEmptyString(name)) {
    return { resolution: 'unresolved', reason: 'missing or invalid "name"', raw, source_path: sourcePath };
  }
  if (before === undefined || after === undefined) {
    return {
      resolution: 'unresolved', reason: 'missing before/after — a production metric needs an explicit measured comparison, never inferred from a log', name, raw, source_path: sourcePath,
    };
  }
  if (!isFiniteNumber(before) || !isFiniteNumber(after)) {
    return { resolution: 'unresolved', reason: 'before/after must both be numeric', name, raw, source_path: sourcePath };
  }
  if (!unit || typeof unit !== 'string') {
    return { resolution: 'unresolved', reason: 'missing or invalid "unit"', name, before, after, raw, source_path: sourcePath };
  }
  if (!direction || !METRIC_DIRECTIONS.includes(direction)) {
    return {
      resolution: 'unresolved',
      reason: `missing or invalid "direction" — a production metric must state explicitly whether lower or higher is better; ambiguous "better" is never assumed. Must be one of ${METRIC_DIRECTIONS.join(', ')}`,
      name, before, after, unit, raw, source_path: sourcePath,
    };
  }
  const parsedWindow = parseWindow(window);
  if (parsedWindow === null) {
    return {
      resolution: 'unresolved', reason: '"window" must be an object with optional before/after when present', name, before, after, unit, direction, raw, source_path: sourcePath,
    };
  }
  const parsedSampleSize = parseSampleSize(sampleSize);
  if (parsedSampleSize === null) {
    return {
      resolution: 'unresolved', reason: '"sample_size.before"/"sample_size.after" must be numeric when present', name, before, after, unit, direction, raw, source_path: sourcePath,
    };
  }
  if (impactLevel !== undefined && impactLevel !== null && !IMPACT_LEVELS.includes(impactLevel)) {
    return {
      resolution: 'unresolved', reason: `"impact_level" must be one of ${IMPACT_LEVELS.join(', ')} when present`, name, before, after, unit, direction, raw, source_path: sourcePath,
    };
  }
  if (impactDomain !== undefined && impactDomain !== null && typeof impactDomain !== 'string') {
    return {
      resolution: 'unresolved', reason: '"impact_domain" must be a string when present', name, before, after, unit, direction, raw, source_path: sourcePath,
    };
  }

  const resolvedOperation = METRIC_OPERATIONS.includes(operation) ? operation : undefined;

  return {
    resolution: 'resolved',
    name,
    before,
    after,
    unit,
    direction,
    operation: resolvedOperation,
    environment: environment ?? null,
    service: service ?? null,
    window: parsedWindow,
    aggregation: aggregation ?? null,
    sample_size: parsedSampleSize,
    source: source ?? null,
    verification_status: verificationStatus,
    // Resume-Impact phase: optional explicit commit SHA this production
    // measurement is attributed to — one of the allowed explicit shared
    // identifiers (alongside service) evidence-linker.mjs uses to link a
    // controlled_benchmark to this production_metric. Never inferred —
    // only ever taken verbatim from the input.
    commit_sha: typeof commitSha === 'string' && commitSha ? commitSha : null,
    impact_level: impactLevel ?? null,
    impact_domain: impactDomain ?? null,
    system: typeof system === 'string' && system ? system : null,
    component: typeof component === 'string' && component ? component : null,
    raw,
    source_path: sourcePath,
  };
}
