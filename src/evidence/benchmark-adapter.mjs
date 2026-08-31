/**
 * evidence/benchmark-adapter.mjs — parses the canonical structured JSON
 * benchmark/test-artifact input format:
 *   { name, before, after, unit, direction }
 * Missing/inconsistent/ambiguous/invalid inputs are never guessed into a
 * metric — they are preserved as evidence and marked unresolved/unsupported.
 * A passing test alone (no before/after) is evidence, never proof of
 * improvement by itself.
 */
import { METRIC_DIRECTIONS, METRIC_OPERATIONS } from '../core/impact-schema.mjs';

function isFiniteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
function isPositiveInt(v) { return typeof v === 'number' && Number.isInteger(v) && v > 0; }

/**
 * V1-hardening: optional measurement-context fields a `benchmark_artifact`
 * author MAY supply so external measurement quality can be classified
 * honestly instead of defaulting to "insufficient" for every externally-
 * measured benchmark (see external-measurement-quality.mjs). None of these
 * are required — a bare `{name, before, after, unit, direction}` artifact
 * stays valid exactly as before; this only widens what CAN be expressed.
 *  - repetitions: positive integer repeat count, if known.
 *  - statistic: free-text label for what before/after represent
 *    (e.g. "median", "mean", "p95") — documentation only, never validated
 *    against a fixed list since real tooling uses many conventions.
 *  - min/max: optional {before, after} numeric envelopes.
 *  - stddev: optional {before, after} numeric spread.
 *  - raw_samples: optional {before:number[], after:number[]}.
 *  - deterministic: optional boolean the author explicitly asserts (e.g. a
 *    pure/boolean function has zero measurement variance by construction) —
 *    NEVER inferred, only ever taken verbatim from the artifact.
 *  - environment: optional free-text/object describing the measurement
 *    environment (machine, OS, load conditions, etc).
 *  - verification_status: optional, reuses VERIFICATION_STATUSES
 *    ('verified'|'unverified'|'self_reported'|'not_attempted') to describe
 *    how the artifact's author obtained/attests to the figures.
 *  - scope: optional generic object (arbitrary keys — workers/files/
 *    requests/records/dataset size/etc, same free-form pattern as
 *    controlled_benchmark's plan.scope) describing workload context.
 */
function parseNumberPair(v) {
  if (v === null || v === undefined) return undefined;
  if (typeof v !== 'object') return undefined;
  const before = isFiniteNumber(v.before) ? v.before : undefined;
  const after = isFiniteNumber(v.after) ? v.after : undefined;
  if (before === undefined && after === undefined) return undefined;
  return { before, after };
}

function parseMeasurementContext(raw) {
  const ctx = {};
  if (isPositiveInt(raw.repetitions)) ctx.repetitions = raw.repetitions;
  if (typeof raw.statistic === 'string' && raw.statistic.trim()) ctx.statistic = raw.statistic;
  const min = parseNumberPair(raw.min);
  if (min) ctx.min = min;
  const max = parseNumberPair(raw.max);
  if (max) ctx.max = max;
  const stddev = parseNumberPair(raw.stddev);
  if (stddev) ctx.stddev = stddev;
  if (raw.raw_samples && typeof raw.raw_samples === 'object') {
    const before = Array.isArray(raw.raw_samples.before) ? raw.raw_samples.before.filter(isFiniteNumber) : undefined;
    const after = Array.isArray(raw.raw_samples.after) ? raw.raw_samples.after.filter(isFiniteNumber) : undefined;
    if (before?.length || after?.length) ctx.raw_samples = { before: before || [], after: after || [] };
  }
  if (typeof raw.deterministic === 'boolean') ctx.deterministic = raw.deterministic;
  if (raw.environment !== undefined && raw.environment !== null) ctx.environment = raw.environment;
  if (typeof raw.verification_status === 'string') ctx.verification_status = raw.verification_status;
  if (raw.scope !== null && typeof raw.scope === 'object' && Object.keys(raw.scope).length) ctx.scope = raw.scope;
  // V2 (Deep-hardening): an adapter author MAY explicitly declare that
  // before/after (or both) are artificial placeholders supplied only to
  // satisfy this parser's before/after requirement — e.g. a percentage-only
  // published report (no real before/after ever existed) gets a synthetic
  // anchor pair so a Metric can still be computed. This is NEVER inferred —
  // only ever taken verbatim from the artifact, exactly like
  // `deterministic`/`verification_status` above — and it is the ONLY way a
  // fact can ever be tagged ADAPTER_INTERNAL downstream
  // (candidates/allowed-numeric-facts.mjs). A bare artifact with no
  // `synthetic_fields` behaves exactly as before this field existed.
  if (Array.isArray(raw.synthetic_fields)) {
    const valid = raw.synthetic_fields.filter((f) => f === 'before' || f === 'after');
    if (valid.length) ctx.synthetic_fields = [...new Set(valid)];
  }
  // V2 (Deep-hardening, P1): an adapter author MAY explicitly declare the
  // single commit SHA this externally-measured benchmark claims to have
  // measured — e.g. a published performance report that names the revision
  // it benchmarked. NEVER inferred (no fuzzy title matching, no "closest
  // commit by date") — evidence/evidence-linker.mjs resolves this the exact
  // same deterministic-exact-match way it already resolves a pull_request's
  // merge_commit_sha, and only an ACTUAL resolved match can ever strengthen
  // attribution (impact-candidate-builder.mjs's extractAttribution already
  // upgrades to "moderate" attribution whenever linked implementation
  // evidence is found — this field is the only new way a benchmark_artifact
  // can ever populate that link; before this field existed, no
  // benchmark_artifact could ever be linked, so every one defaulted to
  // "weak"). A declared-but-unresolvable SHA is preserved verbatim with
  // link_resolution: "unresolved", never silently dropped or guessed.
  if (typeof raw.revision_under_test === 'string' && raw.revision_under_test.trim()) {
    ctx.revision_under_test = raw.revision_under_test.trim();
  }
  return ctx;
}

/**
 * @param {object} raw - parsed JSON artifact content.
 * @param {string} sourcePath
 * @returns {{resolution:'resolved'|'unresolved'|'unsupported', reason?:string,
 *   name?:string, before?:number, after?:number, unit?:string, direction?:string,
 *   raw:object, source_path:string}}
 */
export function parseBenchmarkArtifact(raw, sourcePath) {
  if (raw === null || typeof raw !== 'object') {
    return { resolution: 'unsupported', reason: 'artifact is not a JSON object', raw, source_path: sourcePath };
  }
  const {
    name, before, after, unit, direction, operation,
  } = raw;

  if (!name || typeof name !== 'string') {
    return { resolution: 'unresolved', reason: 'missing or invalid "name"', raw, source_path: sourcePath };
  }
  if (before === undefined || after === undefined) {
    return {
      resolution: 'unresolved',
      reason: 'missing before/after — a passing test alone is not proof of improvement',
      name,
      raw,
      source_path: sourcePath,
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
      reason: `missing or invalid "direction" — must be one of ${METRIC_DIRECTIONS.join(', ')}`,
      name, before, after, unit, raw, source_path: sourcePath,
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
    ...parseMeasurementContext(raw),
    raw,
    source_path: sourcePath,
  };
}
