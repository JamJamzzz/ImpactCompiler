/**
 * evidence/test-result-adapter.mjs — V2 P1 (Deep-hardening) input adapter
 * for a plain "N/M tests passed" result. Parses the canonical structured
 * JSON test-result input format:
 *   { suite_name, passed, total, failed?, suite_count?, deterministic?,
 *     environment?, scope?, verification_status? }
 *
 * This exists because benchmark-adapter.mjs's parseBenchmarkArtifact (used
 * for BOTH `--benchmark` and `--test-artifact`) hard-requires numeric
 * before/after, so a bare "41/41 tests passed" fact — real, quantified
 * verification evidence with no before/after comparison at all — had no
 * first-class representation and had to fall back to a generic
 * quantitative_fact. This adapter gives it one, without touching
 * benchmark-adapter.mjs or the existing (unused-by-any-caller)
 * 'test_artifact' evidence type.
 *
 * Like benchmark-adapter.mjs/pr-adapter.mjs, this never guesses: a
 * test-result artifact missing its required fields is preserved as
 * evidence and marked unresolved/unsupported, never silently dropped or
 * coerced into fabricated numbers. Passing tests are NEVER, by themselves,
 * evidence of an improvement — see core/impact-compiler.mjs's
 * collectTestResultEvidence (a straight read-normalize collector, no metric
 * computation) and candidates/impact-candidate-builder.mjs's
 * buildMeasuredCandidates (which deliberately excludes 'test_result' from
 * its measurement-source type list) for how that guarantee is enforced
 * structurally, not just by convention.
 */
function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }
function isNonNegativeInt(v) { return typeof v === 'number' && Number.isInteger(v) && v >= 0; }
function isPositiveInt(v) { return typeof v === 'number' && Number.isInteger(v) && v > 0; }

/**
 * Canonical input shape (suite_name/passed/total are required; everything
 * else is optional — "where available", never fabricated when absent, same
 * absent-is-fine discipline as benchmark-adapter.mjs's measurement-context
 * fields):
 * {
 *   suite_name: string, passed: number, total: number, failed?: number,
 *   suite_count?: number, deterministic?: boolean, environment?: object|string,
 *   scope?: object, verification_status?: string
 * }
 * @param {object} raw - parsed JSON artifact content.
 * @param {string} sourcePath
 * @returns {{resolution:'resolved'|'unresolved'|'unsupported', reason?:string,
 *   suite_name?:string, passed?:number, total?:number, failed?:number,
 *   suite_count?:number, deterministic?:boolean, environment?:object|string,
 *   scope?:object, verification_status?:string, raw:object, source_path:string}}
 */
export function parseTestResultArtifact(raw, sourcePath) {
  if (raw === null || typeof raw !== 'object') {
    return { resolution: 'unsupported', reason: 'artifact is not a JSON object', raw, source_path: sourcePath };
  }
  const {
    suite_name: suiteName, passed, total, failed, suite_count: suiteCount,
    deterministic, environment, scope, verification_status: verificationStatus,
  } = raw;

  if (!isNonEmptyString(suiteName)) {
    return { resolution: 'unresolved', reason: 'missing or invalid "suite_name"', raw, source_path: sourcePath };
  }
  if (passed === undefined || total === undefined) {
    return {
      resolution: 'unresolved',
      reason: 'missing "passed"/"total" — a suite name alone is not a verification count',
      suite_name: suiteName,
      raw,
      source_path: sourcePath,
    };
  }
  if (!isNonNegativeInt(passed) || !isNonNegativeInt(total)) {
    return {
      resolution: 'unresolved',
      reason: '"passed"/"total" must both be non-negative integers',
      suite_name: suiteName,
      raw,
      source_path: sourcePath,
    };
  }
  if (passed > total) {
    return {
      resolution: 'unresolved',
      reason: '"passed" cannot exceed "total"',
      suite_name: suiteName,
      passed,
      total,
      raw,
      source_path: sourcePath,
    };
  }

  const parsed = {
    resolution: 'resolved', suite_name: suiteName, passed, total, raw, source_path: sourcePath,
  };
  // Optional context fields — present-but-invalid is silently dropped
  // (never coerced, never causes the whole record to fail), exactly like
  // benchmark-adapter.mjs's parseMeasurementContext.
  if (isNonNegativeInt(failed)) parsed.failed = failed;
  if (isPositiveInt(suiteCount)) parsed.suite_count = suiteCount;
  if (typeof deterministic === 'boolean') parsed.deterministic = deterministic;
  if (environment !== undefined && environment !== null) parsed.environment = environment;
  if (scope !== null && typeof scope === 'object' && !Array.isArray(scope) && Object.keys(scope).length) parsed.scope = scope;
  if (typeof verificationStatus === 'string') parsed.verification_status = verificationStatus;

  return parsed;
}
