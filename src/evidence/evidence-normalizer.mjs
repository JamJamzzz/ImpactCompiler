/**
 * evidence/evidence-normalizer.mjs — turns raw git/benchmark/test/PR/ticket
 * adapter output into the uniform Evidence Store record shape
 * ({ id, type, resolution, provenance_category, ... }) that lives at
 * impact.json.evidence[]. No database — this array IS the Evidence Store;
 * every metric/claim references records here only by `id`.
 *
 * V2 adds `provenance_category` to every record (including the two V1
 * normalizers below — purely additive, existing fields unchanged) so a
 * claim can always tell, via evidence_ids -> evidence lookup, whether a
 * piece of evidence is implementation detail, business/intent context, or a
 * quantified metric (core/impact-schema.mjs's PROVENANCE_CATEGORIES).
 * Never inferred by an LLM — assigned here, deterministically, by type.
 */
import { createHash } from 'crypto';
import { EVIDENCE_TYPES } from '../core/impact-schema.mjs';

function evidenceId(seed) {
  return `ev_${createHash('sha1').update(seed).digest('hex').slice(0, 12)}`;
}

/** @param {object} commitPacket - from git-adapter.mjs's buildCommitEvidencePacket. */
export function normalizeCommitEvidence(commitPacket) {
  return {
    id: evidenceId(`git_commit:${commitPacket.repo_identity}:${commitPacket.sha}`),
    type: EVIDENCE_TYPES[0], // 'git_commit'
    resolution: 'resolved',
    provenance_category: 'implementation',
    repo_identity: commitPacket.repo_identity,
    sha: commitPacket.sha,
    subject: commitPacket.subject,
    body: commitPacket.body,
    author_name: commitPacket.author_name,
    authored_at: commitPacket.authored_at,
    files_touched: commitPacket.files_touched,
    file_stats: commitPacket.file_stats,
    patch: commitPacket.patch,
    patch_truncated: commitPacket.patch_truncated,
  };
}

/**
 * @param {object} parsedBenchmark - from benchmark-adapter.mjs's parseBenchmarkArtifact.
 *   V1-hardening: threads through the optional measurement-context fields
 *   (repetitions/statistic/min/max/stddev/raw_samples/deterministic/
 *   environment/verification_status/scope) parseBenchmarkArtifact may have
 *   extracted — all `?? null`/absent-is-fine, exactly like every other
 *   optional field in this file. These feed
 *   external-measurement-quality.mjs's classifier and
 *   impact-candidate-builder.mjs's extractScope, never the deterministic
 *   Metric computation itself.
 */
export function normalizeBenchmarkEvidence(parsedBenchmark) {
  const seed = `benchmark:${parsedBenchmark.source_path}:${parsedBenchmark.name || ''}`;
  return {
    id: evidenceId(seed),
    type: EVIDENCE_TYPES[2], // 'benchmark_artifact'
    resolution: parsedBenchmark.resolution,
    provenance_category: 'metric',
    reason: parsedBenchmark.reason,
    source_path: parsedBenchmark.source_path,
    name: parsedBenchmark.name,
    before: parsedBenchmark.before,
    after: parsedBenchmark.after,
    unit: parsedBenchmark.unit,
    direction: parsedBenchmark.direction,
    operation: parsedBenchmark.operation,
    repetitions: parsedBenchmark.repetitions ?? null,
    statistic: parsedBenchmark.statistic ?? null,
    min: parsedBenchmark.min ?? null,
    max: parsedBenchmark.max ?? null,
    stddev: parsedBenchmark.stddev ?? null,
    raw_samples: parsedBenchmark.raw_samples ?? null,
    deterministic: parsedBenchmark.deterministic ?? null,
    environment: parsedBenchmark.environment ?? null,
    verification_status: parsedBenchmark.verification_status ?? null,
    scope: parsedBenchmark.scope ?? null,
    // V2 (Deep-hardening, P1): threaded through untouched to
    // evidence-linker.mjs's linkBenchmarkArtifact, which is the only code
    // that ever reads it.
    revision_under_test: parsedBenchmark.revision_under_test ?? null,
  };
}

/**
 * @param {object} parsedPr - from pr-adapter.mjs's parsePrArtifact.
 *   `link_resolution`/`linked_evidence_ids` start as placeholders here and
 *   are the SINGLE responsibility of evidence-linker.mjs's post-normalization
 *   pass (it needs the full evidence array, which doesn't exist yet at the
 *   point any one record is normalized) — never computed twice.
 */
export function normalizePrEvidence(parsedPr) {
  const seed = `pull_request:${parsedPr.provider}:${parsedPr.pr_id || parsedPr.url}`;

  return {
    id: evidenceId(seed),
    type: 'pull_request',
    resolution: parsedPr.resolution,
    provenance_category: 'implementation',
    reason: parsedPr.reason,
    source_path: parsedPr.source_path,
    provider: parsedPr.provider,
    pr_id: parsedPr.pr_id ?? null,
    url: parsedPr.url ?? null,
    title: parsedPr.title,
    body: parsedPr.body,
    author: parsedPr.author,
    reviewers: parsedPr.reviewers || [],
    source_branch: parsedPr.source_branch,
    target_branch: parsedPr.target_branch,
    merged: parsedPr.merged === true,
    merge_commit_sha: parsedPr.merge_commit_sha ?? null,
    linked_commit_shas: parsedPr.linked_commit_shas || [],
    changed_files: parsedPr.changed_files || [],
    review_context: parsedPr.review_context,
    link_resolution: 'not_applicable',
    linked_evidence_ids: [],
  };
}

/**
 * @param {object} parsedTicket - from ticket-adapter.mjs's parseTicketArtifact.
 *   Same placeholder note as normalizePrEvidence above — evidence-linker.mjs
 *   fills `link_resolution`/`linked_evidence_ids` in one pass afterward.
 */
export function normalizeTicketEvidence(parsedTicket) {
  const seed = `ticket:${parsedTicket.provider}:${parsedTicket.ticket_id || parsedTicket.url}`;
  const declaredPrIds = parsedTicket.linked_pr_ids || [];
  const declaredShas = parsedTicket.linked_commit_shas || [];

  return {
    id: evidenceId(seed),
    type: 'ticket',
    resolution: parsedTicket.resolution,
    provenance_category: 'intent_context',
    reason: parsedTicket.reason,
    source_path: parsedTicket.source_path,
    provider: parsedTicket.provider,
    ticket_id: parsedTicket.ticket_id ?? null,
    url: parsedTicket.url ?? null,
    title: parsedTicket.title,
    description: parsedTicket.description,
    business_context: parsedTicket.business_context,
    severity: parsedTicket.severity,
    priority: parsedTicket.priority,
    acceptance_criteria: parsedTicket.acceptance_criteria || [],
    scope: parsedTicket.scope,
    linked_pr_ids: declaredPrIds,
    linked_commit_shas: declaredShas,
    link_resolution: 'not_applicable',
    linked_evidence_ids: [],
  };
}

/**
 * @param {object} parsedMetric - from production-metric-adapter.mjs's
 *   parseProductionMetricArtifact. Distinct provenance_category from
 *   benchmark/test evidence ('production_observability' vs 'metric') even
 *   though BOTH can produce a deterministic Metric record — this field
 *   describes the EVIDENCE's source kind, not whether it fed the engine.
 *   `link_resolution`/`linked_evidence_ids` filled by evidence-linker.mjs
 *   (links to a git_commit via an optional deployment/commit reference the
 *   caller may add outside this canonical shape — V3 ships the field for
 *   forward compatibility but does not require it).
 */
export function normalizeProductionMetricEvidence(parsedMetric) {
  const seed = `production_metric:${parsedMetric.source_path}:${parsedMetric.name || ''}:${parsedMetric.service || ''}`;
  return {
    id: evidenceId(seed),
    type: 'production_metric',
    resolution: parsedMetric.resolution,
    provenance_category: 'production_observability',
    reason: parsedMetric.reason,
    source_path: parsedMetric.source_path,
    name: parsedMetric.name,
    before: parsedMetric.before,
    after: parsedMetric.after,
    unit: parsedMetric.unit,
    direction: parsedMetric.direction,
    operation: parsedMetric.operation,
    environment: parsedMetric.environment,
    service: parsedMetric.service,
    window: parsedMetric.window,
    aggregation: parsedMetric.aggregation,
    sample_size: parsedMetric.sample_size,
    source: parsedMetric.source,
    verification_status: parsedMetric.verification_status,
    commit_sha: parsedMetric.commit_sha ?? null,
    // Resume-Impact phase: optional EXPLICIT classification the artifact's
    // author declared — takes priority over impact-candidate-builder.mjs's
    // deterministic/keyword-heuristic classification (item 7's required
    // hierarchy: explicit > source-type deterministic > keyword heuristic >
    // unknown). Never inferred here — passed through verbatim only when
    // production-metric-adapter.mjs's parser validated it.
    impact_level: parsedMetric.impact_level ?? null,
    impact_domain: parsedMetric.impact_domain ?? null,
    system: parsedMetric.system ?? null,
    component: parsedMetric.component ?? null,
    link_resolution: 'not_applicable',
    linked_evidence_ids: [],
  };
}

/** @param {object} parsedLog - from log-adapter.mjs's parseLogArtifact. Never a metric source. */
export function normalizeLogEvidence(parsedLog) {
  const seed = `log:${parsedLog.source_path}:${parsedLog.source || ''}`;
  return {
    id: evidenceId(seed),
    type: 'log',
    resolution: parsedLog.resolution,
    provenance_category: 'production_observability',
    reason: parsedLog.reason,
    source_path: parsedLog.source_path,
    source: parsedLog.source,
    environment: parsedLog.environment,
    service: parsedLog.service,
    window: parsedLog.window,
    content: parsedLog.content,
    summary: parsedLog.summary,
    deployment_ref: parsedLog.deployment_ref,
    commit_sha: parsedLog.commit_sha,
    verification_status: parsedLog.verification_status,
    link_resolution: 'not_applicable',
    linked_evidence_ids: [],
  };
}

/** @param {object} parsedObservability - from observability-adapter.mjs's parseObservabilityArtifact. Never a metric source. */
export function normalizeObservabilityEvidence(parsedObservability) {
  const seed = `observability_artifact:${parsedObservability.provider}:${parsedObservability.artifact_reference || parsedObservability.title || parsedObservability.source_path}`;
  return {
    id: evidenceId(seed),
    type: 'observability_artifact',
    resolution: parsedObservability.resolution,
    provenance_category: 'production_observability',
    reason: parsedObservability.reason,
    source_path: parsedObservability.source_path,
    provider: parsedObservability.provider,
    title: parsedObservability.title,
    environment: parsedObservability.environment,
    service: parsedObservability.service,
    window: parsedObservability.window,
    artifact_reference: parsedObservability.artifact_reference,
    summary: parsedObservability.summary,
    release_id: parsedObservability.release_id,
    commit_sha: parsedObservability.commit_sha,
    verification_status: parsedObservability.verification_status,
    link_resolution: 'not_applicable',
    linked_evidence_ids: [],
  };
}

/** @param {object} parsedNote - from note-adapter.mjs's parseNoteArtifact. Soft context, never a metric source. */
export function normalizeNoteEvidence(parsedNote) {
  const seed = `note:${parsedNote.source_path}:${parsedNote.source_reference || ''}`;
  return {
    id: evidenceId(seed),
    type: 'note',
    resolution: parsedNote.resolution,
    provenance_category: 'soft_context',
    reason: parsedNote.reason,
    source_path: parsedNote.source_path,
    source_reference: parsedNote.source_reference,
    author: parsedNote.author,
    timestamp: parsedNote.timestamp,
    title: parsedNote.title,
    content: parsedNote.content,
    related_ticket_id: parsedNote.related_ticket_id,
    related_pr_id: parsedNote.related_pr_id,
    related_commit_sha: parsedNote.related_commit_sha,
    verification_status: parsedNote.verification_status,
    link_resolution: 'not_applicable',
    linked_evidence_ids: [],
  };
}

/** @param {object} parsedSlack - from slack-adapter.mjs's parseSlackArtifact. Soft context, never a metric source. */
export function normalizeSlackEvidence(parsedSlack) {
  const seed = `slack_message:${parsedSlack.source_path}:${parsedSlack.permalink || parsedSlack.channel || ''}`;
  return {
    id: evidenceId(seed),
    type: 'slack_message',
    resolution: parsedSlack.resolution,
    provenance_category: 'soft_context',
    reason: parsedSlack.reason,
    source_path: parsedSlack.source_path,
    channel: parsedSlack.channel,
    author: parsedSlack.author,
    participants: parsedSlack.participants || [],
    timestamp: parsedSlack.timestamp,
    content: parsedSlack.content,
    permalink: parsedSlack.permalink,
    related_ticket_id: parsedSlack.related_ticket_id,
    related_pr_id: parsedSlack.related_pr_id,
    related_incident_id: parsedSlack.related_incident_id,
    verification_status: parsedSlack.verification_status,
    link_resolution: 'not_applicable',
    linked_evidence_ids: [],
  };
}

/**
 * V5: normalizes the result of running a measurement plan
 * (src/measurement/measurement-runner.mjs's runMeasurementPlan) into an
 * Evidence Store record. Unlike benchmark_artifact (an externally-supplied,
 * already-computed before/after pair), a controlled_benchmark record carries
 * the FULL measurement provenance ImpactCompiler itself produced by actually
 * running the plan: resolved base/target commit SHAs, raw per-run samples,
 * statistics, environment, and deterministic attribution. Always normalized
 * (even on failure — `resolution` reflects whether the run produced enough
 * valid samples to compute a Metric; the evidence itself is never dropped).
 * @param {{resolution:string, reason?:string|null, source_path:string,
 *   plan:object, base_commit?:string|null, target_commit?:string|null,
 *   raw_samples?:{before:number[], after:number[]}, statistics?:object|null,
 *   measurement_quality?:string|null, confidence_interval?:object|null,
 *   environment?:object|null, attribution?:object|null}} parsed
 */
export function normalizeMeasurementEvidence(parsed) {
  const seed = `controlled_benchmark:${parsed.source_path}:${parsed.plan?.benchmark_id || ''}`;
  return {
    id: evidenceId(seed),
    type: 'controlled_benchmark',
    resolution: parsed.resolution,
    provenance_category: 'metric',
    reason: parsed.reason ?? null,
    source_path: parsed.source_path,
    benchmark_id: parsed.plan?.benchmark_id ?? null,
    measurement_method: 'controlled_before_after',
    base_ref: parsed.plan?.base_ref ?? null,
    target_ref: parsed.plan?.target_ref ?? null,
    base_commit: parsed.base_commit ?? null,
    target_commit: parsed.target_commit ?? null,
    command: parsed.plan?.command ?? null,
    setup_command: parsed.plan?.setup_command ?? null,
    scope: parsed.plan?.scope ?? null,
    warmup_runs: parsed.plan?.warmup_runs ?? null,
    measurement_runs: parsed.plan?.measurement_runs ?? null,
    primary_statistic: parsed.plan?.result?.primary_statistic ?? null,
    raw_samples: parsed.raw_samples ?? { before: [], after: [] },
    statistics: parsed.statistics ?? null,
    measurement_quality: parsed.measurement_quality ?? null,
    confidence_interval: parsed.confidence_interval ?? null,
    environment: parsed.environment ?? null,
    attribution: parsed.attribution ?? null,
    // Resume-Impact phase: optional explicit shared identifiers a plan
    // author may declare so evidence-linker.mjs can deterministically
    // cross-link this controlled_benchmark to production_metric/log/
    // observability_artifact evidence from the SAME run — never inferred,
    // only ever taken verbatim from measurement-plan.mjs's `link` field.
    service: parsed.plan?.link?.service ?? null,
    release_id: parsed.plan?.link?.release_id ?? null,
    deployment_ref: parsed.plan?.link?.deployment_ref ?? null,
    // Resume-Impact phase: optional EXPLICIT classification declared on the
    // measurement plan's result — same explicit-beats-deterministic-beats-
    // heuristic priority as production_metric's impact_level/impact_domain.
    impact_level: parsed.plan?.result?.impact_level ?? null,
    impact_domain: parsed.plan?.result?.impact_domain ?? null,
    // The benchmark was actually executed by ImpactCompiler itself inside an
    // isolated worktree, not self-reported by a human or another system.
    verification_status: 'verified',
    link_resolution: 'not_applicable',
    linked_evidence_ids: [],
  };
}

/**
 * Resume-Impact phase: normalizes a Quantitative Fact
 * (src/facts/quantitative-fact-adapter.mjs's parseQuantitativeFactArtifact)
 * into an Evidence Store record. A fact never produces a Metric on its
 * own — it is only ever an INPUT a Derivation Request
 * (src/derived/derivation-request.mjs) may reference by `fact_id`.
 * `id` is forced to the fact's own `selfEvidenceId` when the fact is
 * self-referential (no external evidence_id supplied) so the fact and its
 * Evidence record always share one id.
 * @param {{resolution:string, reason?:string, fact?:object,
 *   selfEvidenceId?:string|null, source_path:string}} parsed
 */
export function normalizeQuantitativeFactEvidence(parsed) {
  const seed = `quantitative_fact:${parsed.source_path}:${parsed.fact?.fact_id ?? ''}`;
  const id = parsed.selfEvidenceId ?? evidenceId(seed);
  const fact = parsed.fact ?? {};
  return {
    id,
    type: 'quantitative_fact',
    resolution: parsed.resolution,
    provenance_category: 'metric',
    reason: parsed.reason ?? null,
    source_path: parsed.source_path,
    fact_id: fact.fact_id ?? null,
    name: fact.name ?? null,
    kind: fact.kind ?? null,
    value: fact.value ?? null,
    unit: fact.unit ?? null,
    verification_status: fact.verification_status ?? null,
    source_reference: fact.source_reference ?? null,
    window: fact.window ?? null,
    scope: fact.scope ?? null,
    assumptions: fact.assumptions ?? [],
    // Reuses evidence-linker.mjs's existing `service` shared-identifier
    // mechanism (withServiceLinks) — a fact declaring related_service links
    // to production_metric/log/observability_artifact/controlled_benchmark
    // evidence sharing that same service, exactly like they already link to
    // each other.
    service: fact.related_service ?? null,
    related_benchmark_id: fact.related_benchmark_id ?? null,
    link_resolution: 'not_applicable',
    linked_evidence_ids: [],
  };
}

/**
 * V2 P1 (Deep-hardening): normalizes a plain pass/total test-result record
 * (evidence/test-result-adapter.mjs's parseTestResultArtifact) into an
 * Evidence Store record. Never a metric source — there is no before/after
 * comparison here at all, so this record NEVER produces a Metric and
 * NEVER, by itself, becomes an Impact Candidate (see
 * candidates/impact-candidate-builder.mjs's buildMeasuredCandidates, which
 * deliberately omits 'test_result' from its measurement-source type list).
 * `provenance_category: 'metric'` still applies (it IS quantified
 * verification evidence, just not a before/after one) — see
 * impact-schema.mjs's PROVENANCE_CATEGORIES doc comment.
 * @param {object} parsedTestResult - from test-result-adapter.mjs's parseTestResultArtifact.
 */
export function normalizeTestResultEvidence(parsedTestResult) {
  const seed = `test_result:${parsedTestResult.source_path}:${parsedTestResult.suite_name || ''}`;
  return {
    id: evidenceId(seed),
    type: 'test_result',
    resolution: parsedTestResult.resolution,
    provenance_category: 'metric',
    reason: parsedTestResult.reason ?? null,
    source_path: parsedTestResult.source_path,
    suite_name: parsedTestResult.suite_name ?? null,
    passed: parsedTestResult.passed ?? null,
    total: parsedTestResult.total ?? null,
    failed: parsedTestResult.failed ?? null,
    suite_count: parsedTestResult.suite_count ?? null,
    deterministic: parsedTestResult.deterministic ?? null,
    environment: parsedTestResult.environment ?? null,
    scope: parsedTestResult.scope ?? null,
    verification_status: parsedTestResult.verification_status ?? null,
    link_resolution: 'not_applicable',
    linked_evidence_ids: [],
  };
}

/** @param {object} parsedDocument - from document-adapter.mjs's parseDocumentArtifact. Soft context, never a metric source. */
export function normalizeDocumentEvidence(parsedDocument) {
  const seed = `document:${parsedDocument.source_path}:${parsedDocument.source_reference || ''}`;
  return {
    id: evidenceId(seed),
    type: 'document',
    resolution: parsedDocument.resolution,
    provenance_category: 'soft_context',
    reason: parsedDocument.reason,
    source_path: parsedDocument.source_path,
    source_reference: parsedDocument.source_reference,
    title: parsedDocument.title,
    author: parsedDocument.author,
    participants: parsedDocument.participants || [],
    timestamp: parsedDocument.timestamp,
    doc_type: parsedDocument.doc_type,
    content: parsedDocument.content,
    content_hash: parsedDocument.content_hash,
    related_ticket_id: parsedDocument.related_ticket_id,
    related_pr_id: parsedDocument.related_pr_id,
    related_commit_sha: parsedDocument.related_commit_sha,
    verification_status: parsedDocument.verification_status,
    link_resolution: 'not_applicable',
    linked_evidence_ids: [],
  };
}
