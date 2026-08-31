/**
 * evidence/note-adapter.mjs — V4 input adapter for a plain note (a
 * standalone text/Markdown note, not sourced from Slack or a formal
 * document export — see slack-adapter.mjs/document-adapter.mjs for those).
 * Soft, contextual evidence only — never a source of quantified metrics or
 * verified facts (evidence-normalizer.mjs assigns it provenance_category
 * 'soft_context', never 'metric' or 'implementation').
 *
 * SECURITY: `content` is UNTRUSTED DATA — preserved verbatim, never
 * evaluated or treated as instructions, exactly like PR/ticket body text.
 */
function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }

/**
 * Canonical input shape:
 * {
 *   source_reference, author, timestamp, title, content,
 *   related_ticket_id, related_pr_id, related_commit_sha, verification_status
 * }
 * @param {object} raw
 * @param {string} sourcePath
 * @returns {{resolution:'resolved'|'unresolved'|'unsupported', reason?:string, ...}}
 */
export function parseNoteArtifact(raw, sourcePath) {
  if (raw === null || typeof raw !== 'object') {
    return { resolution: 'unsupported', reason: 'artifact is not a JSON object', raw, source_path: sourcePath };
  }
  const {
    source_reference: sourceReference, author, timestamp, title, content,
    related_ticket_id: relatedTicketId, related_pr_id: relatedPrId, related_commit_sha: relatedCommitSha,
    verification_status: verificationStatus,
  } = raw;

  if (!isNonEmptyString(sourceReference)) {
    return { resolution: 'unresolved', reason: 'missing or invalid "source_reference" — a note needs a stable reference', raw, source_path: sourcePath };
  }
  if (!isNonEmptyString(content)) {
    return { resolution: 'unresolved', reason: 'missing or invalid "content"', source_reference: sourceReference, raw, source_path: sourcePath };
  }

  return {
    resolution: 'resolved',
    source_reference: sourceReference,
    author: author ?? null,
    timestamp: timestamp ?? null,
    title: title ?? null,
    content,
    related_ticket_id: relatedTicketId ?? null,
    related_pr_id: relatedPrId ?? null,
    related_commit_sha: relatedCommitSha ?? null,
    verification_status: verificationStatus,
    raw,
    source_path: sourcePath,
  };
}
