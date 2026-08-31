/**
 * evidence/ticket-adapter.mjs — V2 input adapter for Ticket evidence.
 * Parses the canonical structured JSON ticket input format. Same discipline
 * as pr-adapter.mjs/benchmark-adapter.mjs: never guesses, preserves
 * unresolvable input as evidence rather than dropping or inventing it.
 *
 * SECURITY: title/description/business_context/acceptance_criteria/scope
 * are UNTRUSTED DATA — copied through verbatim, never evaluated, executed,
 * or treated as instructions. A ticket's "acceptance criteria" describes
 * INTENDED scope, never proof that work described elsewhere actually
 * happened — enforced at the prompt layer (claude-cli-provider.mjs), not
 * here; this module only normalizes shape.
 */
function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }
function isStringArray(v) { return Array.isArray(v) && v.every((x) => typeof x === 'string'); }

/**
 * Canonical input shape (all fields except provider + one of ticket_id/url
 * are optional):
 * {
 *   provider, ticket_id, url, title, description, business_context,
 *   severity, priority, acceptance_criteria: string[], scope,
 *   linked_pr_ids: string[], linked_commit_shas: string[]
 * }
 * @param {object} raw
 * @param {string} sourcePath
 * @returns {{resolution:'resolved'|'unresolved'|'unsupported', reason?:string,
 *   provider?:string, ticket_id?:string, url?:string, title?:string,
 *   description?:string, business_context?:string, severity?:string,
 *   priority?:string, acceptance_criteria?:string[], scope?:string,
 *   linked_pr_ids?:string[], linked_commit_shas?:string[], raw:object, source_path:string}}
 */
export function parseTicketArtifact(raw, sourcePath) {
  if (raw === null || typeof raw !== 'object') {
    return { resolution: 'unsupported', reason: 'artifact is not a JSON object', raw, source_path: sourcePath };
  }
  const {
    provider, ticket_id: ticketId, url, title, description, business_context: businessContext,
    severity, priority, acceptance_criteria: acceptanceCriteria, scope,
    linked_pr_ids: linkedPrIds, linked_commit_shas: linkedCommitShas,
  } = raw;

  if (!isNonEmptyString(provider)) {
    return { resolution: 'unresolved', reason: 'missing or invalid "provider"', raw, source_path: sourcePath };
  }
  if (!isNonEmptyString(ticketId) && !isNonEmptyString(url)) {
    return {
      resolution: 'unresolved', reason: 'missing both "ticket_id" and "url" — a ticket needs at least one stable identifier for linking', provider, raw, source_path: sourcePath,
    };
  }
  if (acceptanceCriteria !== undefined && !isStringArray(acceptanceCriteria)) {
    return {
      resolution: 'unresolved', reason: '"acceptance_criteria" must be a string array when present', provider, ticket_id: ticketId, url, raw, source_path: sourcePath,
    };
  }
  if (linkedPrIds !== undefined && !isStringArray(linkedPrIds)) {
    return {
      resolution: 'unresolved', reason: '"linked_pr_ids" must be a string array when present', provider, ticket_id: ticketId, url, raw, source_path: sourcePath,
    };
  }
  if (linkedCommitShas !== undefined && !isStringArray(linkedCommitShas)) {
    return {
      resolution: 'unresolved', reason: '"linked_commit_shas" must be a string array when present', provider, ticket_id: ticketId, url, raw, source_path: sourcePath,
    };
  }

  return {
    resolution: 'resolved',
    provider,
    ticket_id: ticketId,
    url,
    title,
    description,
    business_context: businessContext,
    severity,
    priority,
    acceptance_criteria: isStringArray(acceptanceCriteria) ? acceptanceCriteria : [],
    scope,
    linked_pr_ids: isStringArray(linkedPrIds) ? linkedPrIds : [],
    linked_commit_shas: isStringArray(linkedCommitShas) ? linkedCommitShas : [],
    raw,
    source_path: sourcePath,
  };
}
