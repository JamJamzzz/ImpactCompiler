/**
 * evidence/document-adapter.mjs — V4 input adapter for an exported document
 * (a design doc, rollout plan, RFC, postmortem — a plain text/Markdown file
 * export, never a live Google Docs/Notion connector). Soft, contextual
 * evidence only.
 *
 * SECURITY: `content` is UNTRUSTED DATA — preserved verbatim, never
 * evaluated or treated as instructions.
 */
import { createHash } from 'crypto';

function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }
function isStringArray(v) { return Array.isArray(v) && v.every((x) => typeof x === 'string'); }

/**
 * Canonical input shape — supply either `content` (raw text/Markdown) or
 * `content_hash` (when the caller has already hashed a large document
 * externally and doesn't want to inline it); when `content` IS supplied,
 * `content_hash` is always computed here regardless, so a record's identity
 * is stable even if raw content is later dropped from storage.
 * {
 *   source_reference, title, author, participants: string[], timestamp,
 *   doc_type, content, content_hash, related_ticket_id, related_pr_id,
 *   related_commit_sha, verification_status
 * }
 * @param {object} raw
 * @param {string} sourcePath
 * @returns {{resolution:'resolved'|'unresolved'|'unsupported', reason?:string, ...}}
 */
export function parseDocumentArtifact(raw, sourcePath) {
  if (raw === null || typeof raw !== 'object') {
    return { resolution: 'unsupported', reason: 'artifact is not a JSON object', raw, source_path: sourcePath };
  }
  const {
    source_reference: sourceReference, title, author, participants, timestamp, doc_type: docType,
    content, content_hash: suppliedContentHash, related_ticket_id: relatedTicketId,
    related_pr_id: relatedPrId, related_commit_sha: relatedCommitSha, verification_status: verificationStatus,
  } = raw;

  if (!isNonEmptyString(sourceReference)) {
    return { resolution: 'unresolved', reason: 'missing or invalid "source_reference" — a document needs a stable reference', raw, source_path: sourcePath };
  }
  if (!isNonEmptyString(content) && !isNonEmptyString(suppliedContentHash)) {
    return {
      resolution: 'unresolved', reason: 'missing both "content" and "content_hash" — at least one is required to preserve original content or a verifiable reference to it', source_reference: sourceReference, raw, source_path: sourcePath,
    };
  }
  if (participants !== undefined && !isStringArray(participants)) {
    return { resolution: 'unresolved', reason: '"participants" must be a string array when present', source_reference: sourceReference, raw, source_path: sourcePath };
  }

  const contentHash = isNonEmptyString(content)
    ? createHash('sha1').update(content).digest('hex')
    : suppliedContentHash;

  return {
    resolution: 'resolved',
    source_reference: sourceReference,
    title: title ?? null,
    author: author ?? null,
    participants: isStringArray(participants) ? participants : [],
    timestamp: timestamp ?? null,
    doc_type: docType ?? null,
    content: content ?? null,
    content_hash: contentHash,
    related_ticket_id: relatedTicketId ?? null,
    related_pr_id: relatedPrId ?? null,
    related_commit_sha: relatedCommitSha ?? null,
    verification_status: verificationStatus,
    raw,
    source_path: sourcePath,
  };
}
