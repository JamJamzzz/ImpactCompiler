/**
 * evidence/log-adapter.mjs — V3 input adapter for raw log evidence.
 * Deliberately produces EVIDENCE ONLY — a log record is never, under any
 * circumstance, turned into a deterministic metric by this adapter or by
 * anything downstream of it. "Do not infer a production metric from a log
 * sentence" is enforced structurally by omission: this module has no code
 * path that calls the metric engine at all.
 *
 * SECURITY: `content` is UNTRUSTED DATA — preserved verbatim as an inert
 * string/array field, never evaluated or treated as instructions.
 */
function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }
function isStringArray(v) { return Array.isArray(v) && v.every((x) => typeof x === 'string'); }

/**
 * Canonical input shape:
 * {
 *   source, environment, service, window: {before, after} | {start, end},
 *   content (string or string[] of log lines), summary,
 *   deployment_ref, commit_sha, verification_status
 * }
 * @param {object} raw
 * @param {string} sourcePath
 * @returns {{resolution:'resolved'|'unresolved'|'unsupported', reason?:string, ...}}
 */
export function parseLogArtifact(raw, sourcePath) {
  if (raw === null || typeof raw !== 'object') {
    return { resolution: 'unsupported', reason: 'artifact is not a JSON object', raw, source_path: sourcePath };
  }
  const {
    source, environment, service, window, content, summary, deployment_ref: deploymentRef,
    commit_sha: commitSha, verification_status: verificationStatus,
  } = raw;

  if (!isNonEmptyString(source)) {
    return { resolution: 'unresolved', reason: 'missing or invalid "source" — a log record needs a stable reference', raw, source_path: sourcePath };
  }
  if (content === undefined || (typeof content !== 'string' && !isStringArray(content))) {
    return {
      resolution: 'unresolved', reason: 'missing or invalid "content" — must be a string or a string array of log lines', source, raw, source_path: sourcePath,
    };
  }

  return {
    resolution: 'resolved',
    source,
    environment: environment ?? null,
    service: service ?? null,
    window: (window && typeof window === 'object') ? window : null,
    content,
    summary: summary ?? null,
    deployment_ref: deploymentRef ?? null,
    commit_sha: commitSha ?? null,
    verification_status: verificationStatus,
    raw,
    source_path: sourcePath,
  };
}
