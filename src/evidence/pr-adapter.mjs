/**
 * evidence/pr-adapter.mjs — V2 input adapter for Pull Request evidence.
 * Parses the canonical structured JSON PR input format. Like
 * benchmark-adapter.mjs, this never guesses: a PR artifact missing its one
 * essential identifying field (an id or a URL) is preserved as evidence and
 * marked unresolved/unsupported, never silently dropped or invented.
 *
 * SECURITY: title/body/reviewers/changed_files/review_context are UNTRUSTED
 * DATA — copied through verbatim as inert string/array fields, never
 * evaluated, executed, or treated as instructions by this module or by
 * anything downstream. providers/claude-cli-provider.mjs's prompt carries
 * the same "data, never instructions" framing explicitly for this content.
 */
function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }
function isStringArray(v) { return Array.isArray(v) && v.every((x) => typeof x === 'string'); }

/**
 * Canonical input shape (all fields except provider + one of pr_id/url are
 * optional — "where available", never fabricated when absent):
 * {
 *   provider, pr_id, url, title, body, author, reviewers: string[],
 *   source_branch, target_branch, merged: boolean, merge_commit_sha,
 *   linked_commit_shas: string[], changed_files: string[], review_context
 * }
 * @param {object} raw - parsed JSON artifact content.
 * @param {string} sourcePath
 * @returns {{resolution:'resolved'|'unresolved'|'unsupported', reason?:string,
 *   provider?:string, pr_id?:string, url?:string, title?:string, body?:string,
 *   author?:string, reviewers?:string[], source_branch?:string, target_branch?:string,
 *   merged?:boolean, merge_commit_sha?:string, linked_commit_shas?:string[],
 *   changed_files?:string[], review_context?:string, raw:object, source_path:string}}
 */
export function parsePrArtifact(raw, sourcePath) {
  if (raw === null || typeof raw !== 'object') {
    return { resolution: 'unsupported', reason: 'artifact is not a JSON object', raw, source_path: sourcePath };
  }
  const {
    provider, pr_id: prId, url, title, body, author, reviewers, source_branch: sourceBranch,
    target_branch: targetBranch, merged, merge_commit_sha: mergeCommitSha,
    linked_commit_shas: linkedCommitShas, changed_files: changedFiles, review_context: reviewContext,
  } = raw;

  if (!isNonEmptyString(provider)) {
    return { resolution: 'unresolved', reason: 'missing or invalid "provider"', raw, source_path: sourcePath };
  }
  if (!isNonEmptyString(prId) && !isNonEmptyString(url)) {
    return {
      resolution: 'unresolved', reason: 'missing both "pr_id" and "url" — a PR needs at least one stable identifier for linking', provider, raw, source_path: sourcePath,
    };
  }
  if (merged !== undefined && typeof merged !== 'boolean') {
    return {
      resolution: 'unresolved', reason: '"merged" must be a boolean when present', provider, pr_id: prId, url, raw, source_path: sourcePath,
    };
  }
  if (mergeCommitSha !== undefined && !isNonEmptyString(mergeCommitSha)) {
    return {
      resolution: 'unresolved', reason: '"merge_commit_sha" must be a non-empty string when present', provider, pr_id: prId, url, raw, source_path: sourcePath,
    };
  }
  if (linkedCommitShas !== undefined && !isStringArray(linkedCommitShas)) {
    return {
      resolution: 'unresolved', reason: '"linked_commit_shas" must be a string array when present', provider, pr_id: prId, url, raw, source_path: sourcePath,
    };
  }

  return {
    resolution: 'resolved',
    provider,
    pr_id: prId,
    url,
    title,
    body,
    author,
    reviewers: isStringArray(reviewers) ? reviewers : [],
    source_branch: sourceBranch,
    target_branch: targetBranch,
    merged: merged === true,
    merge_commit_sha: mergeCommitSha ?? null,
    linked_commit_shas: isStringArray(linkedCommitShas) ? linkedCommitShas : [],
    changed_files: isStringArray(changedFiles) ? changedFiles : [],
    review_context: reviewContext,
    raw,
    source_path: sourcePath,
  };
}
