/**
 * evidence/slack-adapter.mjs — V4 input adapter for an exported Slack
 * message/thread (a structured export file, never a live Slack API call —
 * V4 explicitly excludes live connectors). Soft, contextual evidence only.
 *
 * SECURITY: `content` is UNTRUSTED DATA — preserved verbatim, never
 * evaluated or treated as instructions. A message claiming to be a system
 * instruction, an admin directive, or addressed to "the AI" is still just
 * message text.
 */
function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }
function isStringArray(v) { return Array.isArray(v) && v.every((x) => typeof x === 'string'); }

/**
 * Canonical input shape:
 * {
 *   channel, author, participants: string[], timestamp, content,
 *   permalink, related_ticket_id, related_pr_id, related_incident_id,
 *   verification_status
 * }
 * @param {object} raw
 * @param {string} sourcePath
 * @returns {{resolution:'resolved'|'unresolved'|'unsupported', reason?:string, ...}}
 */
export function parseSlackArtifact(raw, sourcePath) {
  if (raw === null || typeof raw !== 'object') {
    return { resolution: 'unsupported', reason: 'artifact is not a JSON object', raw, source_path: sourcePath };
  }
  const {
    channel, author, participants, timestamp, content, permalink,
    related_ticket_id: relatedTicketId, related_pr_id: relatedPrId, related_incident_id: relatedIncidentId,
    verification_status: verificationStatus,
  } = raw;

  if (!isNonEmptyString(channel) && !isNonEmptyString(permalink)) {
    return { resolution: 'unresolved', reason: 'missing both "channel" and "permalink" — needs at least one stable reference', raw, source_path: sourcePath };
  }
  if (!isNonEmptyString(content)) {
    return { resolution: 'unresolved', reason: 'missing or invalid "content"', channel, raw, source_path: sourcePath };
  }
  if (participants !== undefined && !isStringArray(participants)) {
    return { resolution: 'unresolved', reason: '"participants" must be a string array when present', channel, raw, source_path: sourcePath };
  }

  return {
    resolution: 'resolved',
    channel: channel ?? null,
    author: author ?? null,
    participants: isStringArray(participants) ? participants : [],
    timestamp: timestamp ?? null,
    content,
    permalink: permalink ?? null,
    related_ticket_id: relatedTicketId ?? null,
    related_pr_id: relatedPrId ?? null,
    related_incident_id: relatedIncidentId ?? null,
    verification_status: verificationStatus,
    raw,
    source_path: sourcePath,
  };
}
