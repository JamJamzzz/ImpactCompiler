/**
 * evidence/evidence-linker.mjs — the ONE deterministic linking pass across
 * every evidence type (git/PR/ticket from V2; production metric/log/
 * observability/note/Slack/document from V3/V4). Pure function of the full
 * normalized evidence array; no I/O, no LLM call. Runs AFTER every evidence
 * record has been normalized (core/impact-compiler.mjs's pipeline step
 * between normalization and metric computation) so any record can be
 * cross-referenced against whatever else was actually supplied in this run.
 *
 * Deterministic identifier matching ONLY — exact string equality on commit
 * SHA, merge commit SHA, PR id, ticket id, release id/deployment ref, or
 * service/component name. Never fuzzy-matched, never inferred from prose,
 * never left to Claude. When a declared link doesn't match anything
 * supplied in this run, the evidence record is preserved exactly as parsed
 * and `link_resolution` is set to 'unresolved' — never dropped, never
 * silently marked resolved.
 */
import { LINK_RESOLUTIONS } from '../core/impact-schema.mjs';

const [RESOLVED, UNRESOLVED, NOT_APPLICABLE] = LINK_RESOLUTIONS;

function resolutionFor(declaredCount, matchedCount) {
  if (declaredCount === 0) return NOT_APPLICABLE;
  return matchedCount > 0 ? RESOLVED : UNRESOLVED;
}

function indexBy(records, types, field) {
  const map = new Map();
  for (const r of records) {
    if (types.includes(r.type) && r[field]) map.set(r[field], r);
  }
  return map;
}

/**
 * @param {object[]} evidenceRecords - the full normalized evidence array
 *   (mutated copies returned, originals untouched).
 * @returns {object[]} the same records, with `linked_evidence_ids` and
 *   `link_resolution` set on every linkable record type. Types with no
 *   linking concept at all (git_commit, test_artifact) are returned
 *   unchanged. V2 (Deep-hardening, P1): benchmark_artifact now ALSO has a
 *   linking concept, handled exactly like pull_request/ticket's declared-
 *   link pattern — a record with no `revision_under_test` declared gets
 *   `linked_evidence_ids: []`/`link_resolution: 'not_applicable'` (the same
 *   "nothing was declared" result every other linkable type already
 *   produces), so downstream attribution logic (which already treats
 *   `undefined` and `[]` identically) is completely unaffected for every
 *   pre-V2 fixture — only a record that explicitly declares
 *   `revision_under_test` can ever get a non-empty link.
 */
/** V5/Resume-Impact: sha -> pull_request evidence id, from each PR's OWN
 *  declared merge_commit_sha/linked_commit_shas — used so a
 *  controlled_benchmark can deterministically find "the PR that introduced
 *  the target commit" without any fuzzy title/prose matching. */
function indexPrsByCommitSha(evidenceRecords) {
  const map = new Map();
  for (const r of evidenceRecords) {
    if (r.type !== 'pull_request') continue;
    for (const sha of [r.merge_commit_sha, ...(r.linked_commit_shas || [])].filter(Boolean)) {
      map.set(sha, r.id);
    }
  }
  return map;
}

export function linkEvidence(evidenceRecords) {
  const commitBySha = indexBy(evidenceRecords, ['git_commit'], 'sha');
  const prById = indexBy(evidenceRecords, ['pull_request'], 'pr_id');
  const ticketById = indexBy(evidenceRecords, ['ticket'], 'ticket_id');
  const prByCommitSha = indexPrsByCommitSha(evidenceRecords);
  // A "release identifier" space: observability_artifact.release_id and
  // log/observability's deployment_ref are treated as the same identifier
  // kind — a deployment/release is deployment/release, however it's spelled
  // in the source system, and matching them is exact-string only.
  const releaseIds = new Map();
  for (const r of evidenceRecords) {
    if (r.type === 'observability_artifact' && r.release_id) releaseIds.set(r.release_id, r);
  }
  // Same-service/component grouping among production_metric/log/
  // observability_artifact/controlled_benchmark records — an explicit
  // shared identifier (service/component name), not an inference.
  // controlled_benchmark joined this group in the Resume-Impact phase so a
  // measurement-plan author's optional `link.service` deterministically
  // cross-links to production evidence sharing the same service, exactly
  // like production_metric/log/observability already do with each other.
  const sameServiceTypes = ['production_metric', 'log', 'observability_artifact', 'controlled_benchmark', 'quantitative_fact'];

  // Resume-Impact phase: benchmark_id -> controlled_benchmark evidence id,
  // from each controlled_benchmark's OWN benchmark_id — used so a
  // Quantitative Fact declaring `related_benchmark_id` links to the exact
  // benchmark it describes, exact-identifier match only.
  const benchmarkIdMap = new Map();
  for (const r of evidenceRecords) {
    if (r.type === 'controlled_benchmark' && r.benchmark_id) benchmarkIdMap.set(r.benchmark_id, r.id);
  }

  return evidenceRecords.map((record) => {
    switch (record.type) {
      case 'benchmark_artifact': return linkBenchmarkArtifact(record, commitBySha);
      case 'pull_request': return linkPr(record, commitBySha);
      case 'ticket': return linkTicket(record, prById, commitBySha);
      case 'log': return linkLog(record, commitBySha, releaseIds, evidenceRecords, sameServiceTypes);
      case 'observability_artifact': return linkObservability(record, commitBySha, releaseIds, evidenceRecords, sameServiceTypes);
      case 'production_metric': return linkByService(record, commitBySha, evidenceRecords, sameServiceTypes);
      case 'controlled_benchmark': return linkControlledBenchmark(record, commitBySha, prByCommitSha, releaseIds, evidenceRecords, sameServiceTypes);
      case 'quantitative_fact': return linkQuantitativeFact(record, benchmarkIdMap, evidenceRecords, sameServiceTypes);
      case 'note':
      case 'document': return linkNoteOrDocument(record, ticketById, prById, commitBySha);
      case 'slack_message': return linkSlack(record, ticketById, prById);
      default: return record;
    }
  });
}

/**
 * Resume-Impact phase: quantitative_fact -> the controlled_benchmark it
 * declares via `related_benchmark_id`, plus same-service grouping (a fact's
 * `service` field is populated from its `related_service` at normalization
 * time) — exact-identifier match only, never inferred from being in the
 * same run.
 */
function linkQuantitativeFact(record, benchmarkIdMap, allRecords, sameServiceTypes) {
  const declared = [record.related_benchmark_id].filter(Boolean);
  const benchmarkLink = record.related_benchmark_id ? benchmarkIdMap.get(record.related_benchmark_id) : null;
  const baseLinks = benchmarkLink ? [benchmarkLink] : [];
  const withService = withServiceLinks(record, allRecords, sameServiceTypes, baseLinks);
  return { ...record, linked_evidence_ids: [...new Set(withService)], link_resolution: resolutionFor(declared.length + (record.service ? 1 : 0), withService.length) };
}

/**
 * V2 (Deep-hardening, P1): benchmark_artifact -> git_commit, via the
 * artifact's OWN declared `revision_under_test` (evidence/benchmark-
 * adapter.mjs) — exact commit-SHA match only, identical in spirit to
 * linkPr's merge_commit_sha resolution just above. A declared SHA that
 * doesn't resolve against any git_commit evidence actually supplied in this
 * run is preserved as `link_resolution: 'unresolved'`, never dropped and
 * never treated as if it had matched. This is the ONLY way a
 * benchmark_artifact can ever gain implementation attribution — nothing
 * here infers a link from temporal proximity, a matching name, or any other
 * heuristic; ambiguity (this function only ever considers ONE declared
 * revision) is handled by construction, not by picking among several
 * candidates.
 */
function linkBenchmarkArtifact(record, commitBySha) {
  const declared = record.revision_under_test ? [record.revision_under_test] : [];
  const linkedIds = declared.map((sha) => commitBySha.get(sha)?.id).filter(Boolean);
  return { ...record, linked_evidence_ids: [...new Set(linkedIds)], link_resolution: resolutionFor(declared.length, linkedIds.length) };
}

function linkPr(pr, commitBySha) {
  const declaredShas = [
    ...(pr.merge_commit_sha ? [pr.merge_commit_sha] : []),
    ...(pr.linked_commit_shas || []),
  ];
  const linkedIds = declaredShas.map((sha) => commitBySha.get(sha)?.id).filter(Boolean);
  return { ...pr, linked_evidence_ids: [...new Set(linkedIds)], link_resolution: resolutionFor(declaredShas.length, linkedIds.length) };
}

function linkTicket(ticket, prById, commitBySha) {
  const prIds = (ticket.linked_pr_ids || []).map((id) => prById.get(id)?.id).filter(Boolean);
  const commitIds = (ticket.linked_commit_shas || []).map((sha) => commitBySha.get(sha)?.id).filter(Boolean);
  const declaredCount = (ticket.linked_pr_ids || []).length + (ticket.linked_commit_shas || []).length;
  const linkedIds = [...prIds, ...commitIds];
  return { ...ticket, linked_evidence_ids: [...new Set(linkedIds)], link_resolution: resolutionFor(declaredCount, linkedIds.length) };
}

/** V4: note/document -> ticket/PR/commit via explicit related_* fields. */
function linkNoteOrDocument(record, ticketById, prById, commitBySha) {
  const declared = [record.related_ticket_id, record.related_pr_id, record.related_commit_sha].filter(Boolean);
  const linkedIds = [
    record.related_ticket_id ? ticketById.get(record.related_ticket_id)?.id : null,
    record.related_pr_id ? prById.get(record.related_pr_id)?.id : null,
    record.related_commit_sha ? commitBySha.get(record.related_commit_sha)?.id : null,
  ].filter(Boolean);
  return { ...record, linked_evidence_ids: [...new Set(linkedIds)], link_resolution: resolutionFor(declared.length, linkedIds.length) };
}

/** V4: Slack message -> ticket/PR via explicit related_* fields. related_incident_id
 *  is preserved but has no modeled evidence type to resolve against in V3/V4 — it
 *  contributes to `declared` (so an unmatched incident id is honestly 'unresolved',
 *  never silently ignored) but can never itself produce a match. */
function linkSlack(record, ticketById, prById) {
  const declared = [record.related_ticket_id, record.related_pr_id, record.related_incident_id].filter(Boolean);
  const linkedIds = [
    record.related_ticket_id ? ticketById.get(record.related_ticket_id)?.id : null,
    record.related_pr_id ? prById.get(record.related_pr_id)?.id : null,
  ].filter(Boolean);
  return { ...record, linked_evidence_ids: [...new Set(linkedIds)], link_resolution: resolutionFor(declared.length, linkedIds.length) };
}

/** V3: log -> commit_sha / deployment_ref (matched against release ids), plus same-service grouping. */
function linkLog(record, commitBySha, releaseIds, allRecords, sameServiceTypes) {
  const declared = [record.commit_sha, record.deployment_ref].filter(Boolean);
  const linkedIds = [
    record.commit_sha ? commitBySha.get(record.commit_sha)?.id : null,
    record.deployment_ref ? releaseIds.get(record.deployment_ref)?.id : null,
  ].filter(Boolean);
  const withService = withServiceLinks(record, allRecords, sameServiceTypes, linkedIds);
  return { ...record, linked_evidence_ids: withService, link_resolution: resolutionFor(declared.length + (record.service ? 1 : 0), withService.length) };
}

/** V3: observability artifact -> commit_sha, plus same-service/release grouping. */
function linkObservability(record, commitBySha, releaseIds, allRecords, sameServiceTypes) {
  const declared = [record.commit_sha].filter(Boolean);
  const linkedIds = [record.commit_sha ? commitBySha.get(record.commit_sha)?.id : null].filter(Boolean);
  const withService = withServiceLinks(record, allRecords, sameServiceTypes, linkedIds);
  return { ...record, linked_evidence_ids: withService, link_resolution: resolutionFor(declared.length + (record.service ? 1 : 0), withService.length) };
}

/**
 * Resume-Impact phase: controlled_benchmark -> its exact base_commit and
 * target_commit git_commit evidence (only when those commits were ALSO
 * separately supplied to this run — never assumed), the PR that
 * deterministically declares the target commit as its own
 * merge_commit_sha/linked_commit_shas, and production evidence sharing an
 * explicit service/release_id/deployment_ref identifier. No fuzzy
 * title/prose matching anywhere in this function — every link here is
 * exact-identifier equality.
 */
function linkControlledBenchmark(record, commitBySha, prByCommitSha, releaseIds, allRecords, sameServiceTypes) {
  const declaredShas = [record.base_commit, record.target_commit].filter(Boolean);
  const commitLinks = declaredShas.map((sha) => commitBySha.get(sha)?.id).filter(Boolean);
  const prLink = record.target_commit ? prByCommitSha.get(record.target_commit) : null;
  const releaseLink = record.release_id ? releaseIds.get(record.release_id)?.id : null;
  const declaredCount = declaredShas.length + (record.release_id ? 1 : 0) + (record.service ? 1 : 0);
  const baseLinks = [...commitLinks, ...(prLink ? [prLink] : []), ...(releaseLink ? [releaseLink] : [])];
  const withService = withServiceLinks(record, allRecords, sameServiceTypes, baseLinks);
  return { ...record, linked_evidence_ids: [...new Set(withService)], link_resolution: resolutionFor(declaredCount, withService.length) };
}

/**
 * V3: production_metric -> same-service/component grouping. Resume-Impact
 * phase adds an optional explicit `commit_sha` match against git_commit
 * evidence (mirroring log/observability_artifact's existing commit_sha
 * linking) — the same shared-identifier discipline, not an inference.
 */
function linkByService(record, commitBySha, allRecords, sameServiceTypes) {
  const declared = [record.commit_sha].filter(Boolean);
  const commitLinks = [record.commit_sha ? commitBySha.get(record.commit_sha)?.id : null].filter(Boolean);
  const linkedIds = withServiceLinks(record, allRecords, sameServiceTypes, commitLinks);
  return { ...record, linked_evidence_ids: linkedIds, link_resolution: resolutionFor(declared.length + (record.service ? 1 : 0), linkedIds.length) };
}

function withServiceLinks(record, allRecords, sameServiceTypes, existingLinkedIds) {
  if (!record.service) return [...new Set(existingLinkedIds)];
  const serviceMatches = allRecords
    .filter((r) => r.id !== record.id && sameServiceTypes.includes(r.type) && r.service === record.service)
    .map((r) => r.id);
  return [...new Set([...existingLinkedIds, ...serviceMatches])];
}
