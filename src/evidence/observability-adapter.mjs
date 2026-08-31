/**
 * evidence/observability-adapter.mjs — V3 input adapter for exported
 * observability artifacts (a dashboard export, a monitoring config
 * snapshot, an alert/runbook export — metadata ABOUT observability, not a
 * quantified before/after itself). Evidence only, same discipline as
 * log-adapter.mjs: never produces a metric. A quantified before/after
 * belongs in production-metric-adapter.mjs's canonical shape instead.
 */
function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }

/**
 * Canonical input shape:
 * {
 *   provider, title, environment, service, window: {before, after},
 *   artifact_reference, summary, release_id, commit_sha, verification_status
 * }
 * @param {object} raw
 * @param {string} sourcePath
 * @returns {{resolution:'resolved'|'unresolved'|'unsupported', reason?:string, ...}}
 */
export function parseObservabilityArtifact(raw, sourcePath) {
  if (raw === null || typeof raw !== 'object') {
    return { resolution: 'unsupported', reason: 'artifact is not a JSON object', raw, source_path: sourcePath };
  }
  const {
    provider, title, environment, service, window, artifact_reference: artifactReference,
    summary, release_id: releaseId, commit_sha: commitSha, verification_status: verificationStatus,
  } = raw;

  if (!isNonEmptyString(provider)) {
    return { resolution: 'unresolved', reason: 'missing or invalid "provider"', raw, source_path: sourcePath };
  }
  if (!isNonEmptyString(title) && !isNonEmptyString(artifactReference)) {
    return {
      resolution: 'unresolved', reason: 'missing both "title" and "artifact_reference" — needs at least one stable identifier', provider, raw, source_path: sourcePath,
    };
  }

  return {
    resolution: 'resolved',
    provider,
    title: title ?? null,
    environment: environment ?? null,
    service: service ?? null,
    window: (window && typeof window === 'object') ? window : null,
    artifact_reference: artifactReference ?? null,
    summary: summary ?? null,
    release_id: releaseId ?? null,
    commit_sha: commitSha ?? null,
    verification_status: verificationStatus,
    raw,
    source_path: sourcePath,
  };
}
