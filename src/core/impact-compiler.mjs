/**
 * core/impact-compiler.mjs — orchestrates the full pipeline:
 *   collect input -> normalize evidence -> compute metrics deterministically
 *   -> validate metrics -> call LLM provider -> validate claims
 *   -> write impact.json -> render review.md
 * This is the only module that wires the other layers together; each layer
 * itself stays independently testable and ignorant of the others.
 */
import { randomUUID, createHash } from 'crypto';
import {
  readFileSync, writeFileSync, renameSync, mkdirSync,
} from 'fs';
import { buildCommitEvidencePacket, getRepoIdentity } from '../evidence/git-adapter.mjs';
import { parseBenchmarkArtifact } from '../evidence/benchmark-adapter.mjs';
import { parsePrArtifact } from '../evidence/pr-adapter.mjs';
import { parseTestResultArtifact } from '../evidence/test-result-adapter.mjs';
import { parseTicketArtifact } from '../evidence/ticket-adapter.mjs';
import { parseProductionMetricArtifact } from '../evidence/production-metric-adapter.mjs';
import { parseLogArtifact } from '../evidence/log-adapter.mjs';
import { parseObservabilityArtifact } from '../evidence/observability-adapter.mjs';
import { parseNoteArtifact } from '../evidence/note-adapter.mjs';
import { parseSlackArtifact } from '../evidence/slack-adapter.mjs';
import { parseDocumentArtifact } from '../evidence/document-adapter.mjs';
import {
  normalizeCommitEvidence, normalizeBenchmarkEvidence, normalizePrEvidence, normalizeTicketEvidence,
  normalizeProductionMetricEvidence, normalizeLogEvidence, normalizeObservabilityEvidence,
  normalizeNoteEvidence, normalizeSlackEvidence, normalizeDocumentEvidence, normalizeMeasurementEvidence,
  normalizeQuantitativeFactEvidence, normalizeTestResultEvidence,
} from '../evidence/evidence-normalizer.mjs';
import { linkEvidence } from '../evidence/evidence-linker.mjs';
import { computeMetric } from '../metrics/deterministic-metric-engine.mjs';
import { validateMetricShape } from '../metrics/metric-validation.mjs';
import { validateImpactArtifact, validateClaimNumericConsistency } from './validation.mjs';
import { emptyImpactArtifact, SCHEMA_VERSION, METRIC_DIRECTIONS } from './impact-schema.mjs';
import { renderReview } from '../renderers/review-renderer.mjs';
import { validateMeasurementPlan } from '../measurement/measurement-plan.mjs';
import { runMeasurementPlan } from '../measurement/measurement-runner.mjs';
import { computeAttribution } from '../measurement/attribution.mjs';
import { buildImpactCandidates } from '../candidates/impact-candidate-builder.mjs';
import { computeQualityProfile } from '../candidates/quality-profile.mjs';
import { buildAllowedNumericFacts } from '../candidates/allowed-numeric-facts.mjs';
import { rankAndDeduplicateCandidates } from '../candidates/ranking.mjs';
import { detectImpactOpportunities } from '../candidates/impact-opportunities.mjs';
import { parseQuantitativeFactArtifact } from '../facts/quantitative-fact-adapter.mjs';
import { validateDerivationRequest, resolveAndComputeDerivation } from '../derived/derivation-request.mjs';

export const COMPILER_VERSION = '0.1.0';

function metricIdFor(seed) {
  return `metric_${createHash('sha1').update(seed).digest('hex').slice(0, 12)}`;
}

function collectCommitEvidence(commits) {
  const evidence = [];
  const limitations = [];
  for (const { repo, sha } of commits) {
    const packet = buildCommitEvidencePacket(repo, sha);
    if (!packet) {
      limitations.push(`commit "${sha}" in repo "${repo}" does not exist — skipped, not fabricated`);
      continue;
    }
    evidence.push(normalizeCommitEvidence(packet));
  }
  return { evidence, limitations };
}

function collectBenchmarkEvidence(benchmarkPaths) {
  const evidence = [];
  const metrics = [];
  const limitations = [];
  for (const path of benchmarkPaths) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (err) {
      limitations.push(`benchmark artifact "${path}" could not be read/parsed: ${err.message}`);
      continue;
    }
    const parsed = parseBenchmarkArtifact(raw, path);
    const ev = normalizeBenchmarkEvidence(parsed);
    evidence.push(ev);

    if (parsed.resolution !== 'resolved') {
      limitations.push(`benchmark artifact "${path}" was not resolved into a metric: ${parsed.reason}`);
      continue;
    }

    const operation = parsed.operation
      ?? (parsed.direction === 'lower_is_better' ? 'percentage_reduction' : 'percentage_increase');
    const result = computeMetric({
      id: metricIdFor(`metric:${path}:${parsed.name}`),
      name: parsed.name,
      before: parsed.before,
      after: parsed.after,
      unit: parsed.unit,
      operation,
      direction: parsed.direction,
      evidenceIds: [ev.id],
      // V1-hardening: `confidence` here is NUMERIC/PARSING confidence — "the
      // before/after values were unambiguous, well-formed numbers in the
      // artifact" — always 'high' once parseBenchmarkArtifact resolves at
      // all. This is a DIFFERENT concept from
      // Candidate.quality_profile.measurement_quality (statistical/
      // methodological trust in the MEASUREMENT itself, classified by
      // evidence/external-measurement-quality.mjs from repetitions/
      // variance/determinism). The two no longer read as contradictory: a
      // benchmark_artifact with no measurement-context fields now gets
      // measurement_quality: 'unknown' (not the old 'insufficient'), which
      // sits consistently alongside a 'high' numeric-parsing confidence
      // instead of clashing with it.
      confidence: 'high',
    });
    if (!result.ok) {
      limitations.push(`benchmark artifact "${path}" ("${parsed.name}") could not be computed: ${result.error.message}`);
      continue;
    }
    const shapeCheck = validateMetricShape(result.metric);
    if (!shapeCheck.ok) {
      limitations.push(`benchmark artifact "${path}" produced an invalid metric: ${shapeCheck.errors.join('; ')}`);
      continue;
    }
    // V2 (Deep-hardening): thread the adapter's explicit synthetic_fields
    // declaration onto the computed Metric so allowed-numeric-facts.mjs can
    // tag the resulting facts ADAPTER_INTERNAL / non-claimable. Additive —
    // absent for every artifact that never declared it.
    if (parsed.synthetic_fields?.length) result.metric.synthetic_fields = parsed.synthetic_fields;
    metrics.push(result.metric);
  }
  return {
    evidence, metrics, limitations,
  };
}

/**
 * V2: PRs never produce metrics (no before/after quantification) — this is
 * a straight read-normalize-collect step, no computation, mirroring
 * collectBenchmarkEvidence's honest-degradation discipline (an unreadable/
 * malformed file becomes a limitation, never a fabricated or dropped
 * record) without the metric-computation half.
 */
function collectPrEvidence(prPaths) {
  const evidence = [];
  const limitations = [];
  for (const path of prPaths) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (err) {
      limitations.push(`PR artifact "${path}" could not be read/parsed: ${err.message}`);
      continue;
    }
    const parsed = parsePrArtifact(raw, path);
    evidence.push(normalizePrEvidence(parsed));
    if (parsed.resolution !== 'resolved') limitations.push(`PR artifact "${path}" was not fully resolved: ${parsed.reason}`);
  }
  return { evidence, limitations };
}

function collectTicketEvidence(ticketPaths) {
  const evidence = [];
  const limitations = [];
  for (const path of ticketPaths) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (err) {
      limitations.push(`ticket artifact "${path}" could not be read/parsed: ${err.message}`);
      continue;
    }
    const parsed = parseTicketArtifact(raw, path);
    evidence.push(normalizeTicketEvidence(parsed));
    if (parsed.resolution !== 'resolved') limitations.push(`ticket artifact "${path}" was not fully resolved: ${parsed.reason}`);
  }
  return { evidence, limitations };
}

/**
 * V3/V4: every evidence-only input type (log, observability_artifact, note,
 * slack_message, document) follows the identical read-parse-normalize
 * shape with no metric computation — this factory is the ONE
 * implementation of that shape, so log/observability/note/slack/document
 * collection can never quietly drift into 5 slightly-different copies of
 * the same read/error-handling logic.
 */
function makeEvidenceOnlyCollector(kindLabel, parseFn, normalizeFn) {
  return function collect(paths) {
    const evidence = [];
    const limitations = [];
    for (const path of paths) {
      let raw;
      try {
        raw = JSON.parse(readFileSync(path, 'utf-8'));
      } catch (err) {
        limitations.push(`${kindLabel} artifact "${path}" could not be read/parsed: ${err.message}`);
        continue;
      }
      const parsed = parseFn(raw, path);
      evidence.push(normalizeFn(parsed));
      if (parsed.resolution !== 'resolved') limitations.push(`${kindLabel} artifact "${path}" was not fully resolved: ${parsed.reason}`);
    }
    return { evidence, limitations };
  };
}

/**
 * V2 P1 (Deep-hardening): a plain pass/total test-result NEVER computes a
 * Metric by itself — there is no before/after comparison, so this is a
 * straight read-normalize-collect step, identical in shape to
 * collectPrEvidence/makeEvidenceOnlyCollector above. "N/N passed" is
 * evidence/context only; it only ever becomes part of a measured Impact
 * Candidate if some OTHER evidence in this run supplies a real before/after
 * baseline (candidates/impact-candidate-builder.mjs's buildMeasuredCandidates
 * never treats a test_result record itself as a measurement source).
 */
const collectTestResultEvidence = makeEvidenceOnlyCollector('test result', parseTestResultArtifact, normalizeTestResultEvidence);

const collectLogEvidence = makeEvidenceOnlyCollector('log', parseLogArtifact, normalizeLogEvidence);
const collectObservabilityEvidence = makeEvidenceOnlyCollector('observability', parseObservabilityArtifact, normalizeObservabilityEvidence);
const collectNoteEvidence = makeEvidenceOnlyCollector('note', parseNoteArtifact, normalizeNoteEvidence);
const collectSlackEvidence = makeEvidenceOnlyCollector('Slack export', parseSlackArtifact, normalizeSlackEvidence);
const collectDocumentEvidence = makeEvidenceOnlyCollector('document', parseDocumentArtifact, normalizeDocumentEvidence);

/**
 * V3: production metrics DO compute a deterministic Metric, via the exact
 * same computeMetric() engine as collectBenchmarkEvidence — no second
 * arithmetic implementation, just a second caller of the one that already
 * exists. Distinct evidence `type`/`provenance_category`
 * ('production_metric'/'production_observability') from benchmark/test
 * evidence, so a claim can always tell a production measurement from a
 * pre-production benchmark, even though both flow through the same engine.
 */
function collectProductionMetricEvidence(productionMetricPaths) {
  const evidence = [];
  const metrics = [];
  const limitations = [];
  for (const path of productionMetricPaths) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (err) {
      limitations.push(`production metric artifact "${path}" could not be read/parsed: ${err.message}`);
      continue;
    }
    const parsed = parseProductionMetricArtifact(raw, path);
    const ev = normalizeProductionMetricEvidence(parsed);
    evidence.push(ev);

    if (parsed.resolution !== 'resolved') {
      limitations.push(`production metric artifact "${path}" was not resolved into a metric: ${parsed.reason}`);
      continue;
    }

    const operation = parsed.operation
      ?? (parsed.direction === 'lower_is_better' ? 'percentage_reduction' : 'percentage_increase');
    const result = computeMetric({
      id: metricIdFor(`metric:${path}:${parsed.name}:${parsed.service || ''}`),
      name: parsed.name,
      before: parsed.before,
      after: parsed.after,
      unit: parsed.unit,
      operation,
      direction: parsed.direction,
      evidenceIds: [ev.id],
      confidence: 'high',
    });
    if (!result.ok) {
      limitations.push(`production metric artifact "${path}" ("${parsed.name}") could not be computed: ${result.error.message}`);
      continue;
    }
    const shapeCheck = validateMetricShape(result.metric);
    if (!shapeCheck.ok) {
      limitations.push(`production metric artifact "${path}" produced an invalid metric: ${shapeCheck.errors.join('; ')}`);
      continue;
    }
    metrics.push(result.metric);
  }
  return { evidence, metrics, limitations };
}

/**
 * V5: Quantification V1. Unlike every other collector in this file, this one
 * has real side effects (it runs git worktree add/remove and spawns
 * benchmark processes via measurement/measurement-runner.mjs) — that I/O is
 * confined to the runner/adapter layer; this function's own job is only to
 * read/validate the plan file, call the runner, and turn its result into an
 * Evidence record + (when enough samples exist) a deterministic Metric,
 * mirroring the honest-degradation discipline of every other collector
 * here: an invalid plan or a failed/partial measurement becomes a
 * limitation and an `unresolved`/`unsupported` evidence record, never a
 * fabricated or dropped one, and never a Metric.
 */
async function collectMeasurementPlanEvidence(measurementPlanPaths) {
  const evidence = [];
  const metrics = [];
  const limitations = [];
  const repositories = [];

  for (const path of measurementPlanPaths) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (err) {
      limitations.push(`measurement plan "${path}" could not be read/parsed: ${err.message}`);
      continue;
    }

    const validation = validateMeasurementPlan(raw);
    if (!validation.ok) {
      evidence.push(normalizeMeasurementEvidence({
        resolution: 'unsupported',
        reason: `invalid measurement plan: ${validation.errors.join('; ')}`,
        source_path: path,
        plan: raw,
      }));
      limitations.push(`measurement plan "${path}" failed validation: ${validation.errors.join('; ')}`);
      continue;
    }

    const plan = validation.plan;
    repositories.push(plan.repo);

    // eslint-disable-next-line no-await-in-loop
    const runResult = await runMeasurementPlan(plan);
    if (runResult.cleanup_limitations?.length) {
      limitations.push(...runResult.cleanup_limitations.map((l) => `measurement plan "${path}" (${plan.benchmark_id}): ${l}`));
    }

    const attribution = computeAttribution({
      baseResolved: !!runResult.base_commit,
      targetResolved: !!runResult.target_commit,
      enoughSamples: runResult.resolved,
      executionFailures: runResult.execution_failures || [],
      baseCommit: runResult.base_commit,
      targetCommit: runResult.target_commit,
    });

    const ev = normalizeMeasurementEvidence({
      resolution: runResult.resolved ? 'resolved' : 'unresolved',
      reason: runResult.reason,
      source_path: path,
      plan,
      base_commit: runResult.base_commit,
      target_commit: runResult.target_commit,
      raw_samples: runResult.raw_samples,
      statistics: runResult.statistics,
      measurement_quality: runResult.measurement_quality,
      confidence_interval: runResult.confidence_interval,
      environment: runResult.environment,
      attribution,
    });
    evidence.push(ev);

    if (!runResult.resolved) {
      limitations.push(`measurement plan "${path}" (${plan.benchmark_id}) did not produce a Metric: ${runResult.reason}`);
      continue;
    }

    const primaryStatistic = plan.result.primary_statistic;
    const before = runResult.statistics.before[primaryStatistic];
    const after = runResult.statistics.after[primaryStatistic];
    // Measurement quality feeds the Metric's confidence deterministically —
    // never guessed, never set by an LLM. 'insufficient' can't reach here
    // (runResult.resolved requires every measurement run to have succeeded
    // on both sides, which always yields at least 'low').
    const confidence = { high: 'high', medium: 'medium', low: 'low' }[runResult.measurement_quality] || 'low';

    const result = computeMetric({
      id: metricIdFor(`metric:${path}:${plan.benchmark_id}`),
      name: plan.result.name,
      before,
      after,
      unit: plan.result.unit,
      operation: plan.result.operation,
      direction: plan.result.direction,
      evidenceIds: [ev.id],
      confidence,
    });
    if (!result.ok) {
      limitations.push(`measurement plan "${path}" (${plan.benchmark_id}) could not be computed into a metric: ${result.error.message}`);
      continue;
    }
    const shapeCheck = validateMetricShape(result.metric);
    if (!shapeCheck.ok) {
      limitations.push(`measurement plan "${path}" (${plan.benchmark_id}) produced an invalid metric: ${shapeCheck.errors.join('; ')}`);
      continue;
    }
    metrics.push(result.metric);
  }
  return {
    evidence, metrics, limitations, repositories,
  };
}

/**
 * Resume-Impact phase: reads/validates explicit Quantitative Facts
 * (`--quantitative-fact <path>`, src/facts/quantitative-fact-adapter.mjs)
 * into Evidence records, and separately into a `factsById` lookup map a
 * later Derivation Request can reference by `fact_id`. A fact NEVER
 * produces a Metric on its own — only ever an input to a whitelisted
 * formula (see collectDerivedMetrics below). An invalid fact is preserved
 * as `unresolved` Evidence with its exact reason, never dropped.
 */
function collectQuantitativeFactEvidence(factPaths) {
  const evidence = [];
  const factsById = new Map();
  const limitations = [];
  for (const path of factPaths) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (err) {
      limitations.push(`quantitative fact "${path}" could not be read/parsed: ${err.message}`);
      continue;
    }
    const parsed = parseQuantitativeFactArtifact(raw, path);
    evidence.push(normalizeQuantitativeFactEvidence(parsed));
    if (parsed.resolution !== 'resolved') {
      limitations.push(`quantitative fact "${path}" was not resolved: ${parsed.reason}`);
      continue;
    }
    factsById.set(parsed.fact.fact_id, parsed.fact);
  }
  return { evidence, factsById, limitations };
}

/**
 * Resume-Impact phase: resolves each explicit Derivation Request
 * (`--derivation <path>`, src/derived/derivation-request.mjs) against
 * this run's own Metrics/Evidence/Facts and computes a derived Metric via
 * src/derived/formula-registry.mjs's whitelisted engine ONLY. A derivation
 * that cannot be resolved NEVER produces a fabricated Metric — it becomes a
 * structured Impact Opportunity instead (item 9), naming exactly what's
 * missing, plus a limitation. Runs after every other collector so it can
 * see the full Metric/Evidence/Fact set this run actually produced.
 */
function collectDerivedMetrics(derivationPaths, {
  metricsById, metrics, evidenceById, factsById,
}) {
  const derivedMetrics = [];
  const opportunities = [];
  const limitations = [];

  for (const path of derivationPaths) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (err) {
      limitations.push(`derivation request "${path}" could not be read/parsed: ${err.message}`);
      continue;
    }
    const validation = validateDerivationRequest(raw);
    if (!validation.ok) {
      limitations.push(`derivation request "${path}" failed validation: ${validation.errors.join('; ')}`);
      continue;
    }
    const { request } = validation;
    const resolved = resolveAndComputeDerivation(request, {
      metricsById, metrics, evidenceById, factsById,
    });
    if (!resolved.ok) {
      opportunities.push({
        candidate_topic: request.derivation_id,
        status: 'missing_derivation_input',
        missing_evidence: resolved.opportunity.missing_inputs,
        recommended_measurement: resolved.opportunity.note,
      });
      limitations.push(`derivation "${request.derivation_id}" (${path}) did not produce a Metric: ${resolved.opportunity.note}`);
      continue;
    }

    const direction = METRIC_DIRECTIONS.includes(request.output.direction) ? request.output.direction : 'higher_is_better';
    const metric = {
      id: metricIdFor(`derivation:${path}:${request.derivation_id}`),
      name: request.output.name,
      unit: resolved.metric.unit,
      operation: 'formula_derived',
      direction,
      calculation: resolved.metric.calculation,
      confidence: resolved.metric.quantification_type === 'derived' ? 'high' : 'medium',
      evidence_ids: resolved.evidenceIds,
      value: resolved.metric.value,
      result: { value: resolved.metric.value, value_unit: resolved.metric.unit, outcome: 'improvement' },
      quantification_type: resolved.metric.quantification_type,
      formula_id: resolved.metric.formula_id,
      input_ids: resolved.metric.input_ids,
      assumptions: resolved.metric.assumptions,
      explicit_impact_level: request.output.impact_level ?? null,
      explicit_impact_domain: request.output.impact_domain ?? null,
    };
    const shapeCheck = validateMetricShape(metric);
    if (!shapeCheck.ok) {
      limitations.push(`derivation "${request.derivation_id}" (${path}) produced an invalid metric: ${shapeCheck.errors.join('; ')}`);
      continue;
    }
    derivedMetrics.push(metric);
  }

  return { metrics: derivedMetrics, opportunities, limitations };
}

/**
 * @param {{commits?:Array<{repo:string, sha:string}>, benchmarkPaths?:string[],
 *   testArtifactPaths?:string[], testResultPaths?:string[], prPaths?:string[], ticketPaths?:string[],
 *   productionMetricPaths?:string[], logPaths?:string[], observabilityPaths?:string[],
 *   notePaths?:string[], slackPaths?:string[], documentPaths?:string[],
 *   measurementPlanPaths?:string[],
 *   provider?:import('../providers/llm-provider.mjs').default|null}} input
 * @returns {Promise<object>} a validated impact.json object (not yet written to disk).
 */
export async function analyzeImpact({
  commits = [], benchmarkPaths = [], testArtifactPaths = [], testResultPaths = [], prPaths = [], ticketPaths = [],
  productionMetricPaths = [], logPaths = [], observabilityPaths = [], notePaths = [], slackPaths = [], documentPaths = [],
  measurementPlanPaths = [], quantitativeFactPaths = [], derivationPaths = [],
  provider = null,
}) {
  const runId = randomUUID();
  const artifact = emptyImpactArtifact({
    compilerVersion: COMPILER_VERSION, runId, runStartedAt: new Date().toISOString(),
  });

  const { evidence: commitEvidence, limitations: commitLimitations } = collectCommitEvidence(commits);
  const {
    evidence: benchmarkEvidence, metrics: benchmarkMetrics, limitations: benchmarkLimitations,
  } = collectBenchmarkEvidence([...benchmarkPaths, ...testArtifactPaths]);
  const { evidence: prEvidence, limitations: prLimitations } = collectPrEvidence(prPaths);
  const { evidence: testResultEvidence, limitations: testResultLimitations } = collectTestResultEvidence(testResultPaths);
  const { evidence: ticketEvidence, limitations: ticketLimitations } = collectTicketEvidence(ticketPaths);
  const {
    evidence: productionMetricEvidence, metrics: productionMetrics, limitations: productionMetricLimitations,
  } = collectProductionMetricEvidence(productionMetricPaths);
  const { evidence: logEvidence, limitations: logLimitations } = collectLogEvidence(logPaths);
  const { evidence: observabilityEvidence, limitations: observabilityLimitations } = collectObservabilityEvidence(observabilityPaths);
  const { evidence: noteEvidence, limitations: noteLimitations } = collectNoteEvidence(notePaths);
  const { evidence: slackEvidence, limitations: slackLimitations } = collectSlackEvidence(slackPaths);
  const { evidence: documentEvidence, limitations: documentLimitations } = collectDocumentEvidence(documentPaths);
  const {
    evidence: measurementEvidence, metrics: measurementMetrics, limitations: measurementLimitations, repositories: measurementRepositories,
  } = await collectMeasurementPlanEvidence(measurementPlanPaths);
  const { evidence: factEvidence, factsById, limitations: factLimitations } = collectQuantitativeFactEvidence(quantitativeFactPaths);

  artifact.repositories = [...new Set([
    ...commits.map((c) => getRepoIdentity(c.repo)),
    ...measurementRepositories.map((repo) => getRepoIdentity(repo)),
  ])];
  // Deterministic linking (evidence-linker.mjs) runs once, after every
  // record type is normalized, so any record can be cross-referenced
  // against whatever else this same run actually supplied — never against
  // Claude's inference, never against evidence outside this run. Every
  // source type's evidence stays a separate record — this array
  // concatenation never merges two records into one.
  artifact.evidence = linkEvidence([
    ...commitEvidence, ...benchmarkEvidence, ...prEvidence, ...testResultEvidence, ...ticketEvidence,
    ...productionMetricEvidence, ...logEvidence, ...observabilityEvidence,
    ...noteEvidence, ...slackEvidence, ...documentEvidence, ...measurementEvidence,
    ...factEvidence,
  ]);
  const measuredMetrics = [...benchmarkMetrics, ...productionMetrics, ...measurementMetrics];

  // Derivation Requests (`--derivation`) run last among collectors — each
  // one resolves its inputs against the Metrics/Evidence/Facts every other
  // collector already produced, by exact ID only (benchmark_id/fact_id/
  // metric_id/evidence_id — see src/derived/derivation-request.mjs). A
  // request that can't be resolved never fabricates a Metric; it becomes a
  // structured Impact Opportunity instead.
  const evidenceByIdForDerivation = new Map(artifact.evidence.map((e) => [e.id, e]));
  const metricsByIdForDerivation = new Map(measuredMetrics.map((m) => [m.id, m]));
  const {
    metrics: derivedMetrics, opportunities: derivationOpportunities, limitations: derivationLimitations,
  } = collectDerivedMetrics(derivationPaths, {
    metricsById: metricsByIdForDerivation, metrics: measuredMetrics, evidenceById: evidenceByIdForDerivation, factsById,
  });

  artifact.metrics = [...measuredMetrics, ...derivedMetrics];
  artifact.limitations = [
    ...commitLimitations, ...benchmarkLimitations, ...prLimitations, ...testResultLimitations, ...ticketLimitations,
    ...productionMetricLimitations, ...logLimitations, ...observabilityLimitations,
    ...noteLimitations, ...slackLimitations, ...documentLimitations, ...measurementLimitations,
    ...factLimitations, ...derivationLimitations,
  ];

  // Resume-Impact phase: Impact Candidates are built deterministically from
  // this run's own Evidence + Metrics, independent of whether a provider is
  // even configured — a provider-off run still gets candidates (with their
  // quality profile and allowed_numeric_facts), just no LLM-authored Claims
  // referencing them. Never built from anything outside this run's own
  // already-linked evidence/metrics.
  const metricsById = new Map(artifact.metrics.map((m) => [m.id, m]));
  const evidenceById = new Map(artifact.evidence.map((e) => [e.id, e]));
  const rawCandidates = buildImpactCandidates({ evidence: artifact.evidence, metrics: artifact.metrics });
  // A PRELIMINARY quality_profile is computed here only because
  // candidates/ranking.mjs needs *something* to read before it combines
  // deterministically-linked candidates — combination itself keys off
  // Evidence links, never the profile. ranking.mjs recomputes the FINAL,
  // authoritative quality_profile/allowed_numeric_facts itself, on the
  // POST-combination candidate set, before ranking/deduplicating — the
  // artifact and the provider both only ever see that final, correctly
  // ordered result.
  const preCombination = rawCandidates.map((c) => {
    const withQualityProfile = { ...c, quality_profile: computeQualityProfile(c) };
    return { ...withQualityProfile, allowed_numeric_facts: buildAllowedNumericFacts(withQualityProfile, { metricsById, evidenceById }) };
  });
  // V1-hardening (P0-2): `max` is deliberately NOT passed here — the
  // canonical artifact must always retain every real Candidate. See
  // ranking.mjs's doc comment for why omitting `max` is the fix, not an
  // oversight.
  artifact.impact_candidates = rankAndDeduplicateCandidates(preCombination, { evidenceById, metricsById });
  // Non-destructive top-N view over the complete impact_candidates array
  // above — every id here also exists in impact_candidates.
  artifact.recommended_candidate_ids = artifact.impact_candidates.filter((c) => c.recommended).map((c) => c.id);

  // Structured, deterministic gaps (item 9) — combines derivation-input
  // gaps discovered above with gaps found by inspecting the final Evidence/
  // Candidates (missing scope, weak attribution, missing production
  // window, self-reported quantification, material conflicts). Never fills
  // a missing value; only names it.
  artifact.impact_opportunities = [
    ...derivationOpportunities,
    ...detectImpactOpportunities({
      evidence: artifact.evidence, metrics: artifact.metrics, candidates: artifact.impact_candidates, metricsById,
    }),
  ];

  if (!provider) {
    artifact.run.analysis_status = 'pending_llm';
    return artifact;
  }

  let claims;
  let uncertainties;
  let providerLimitations;
  let providerMeta;
  if (typeof provider.analyzeCandidates === 'function') {
    ({
      claims, uncertainties, limitations: providerLimitations, providerMeta,
    } = await provider.analyzeCandidates({
      candidates: artifact.impact_candidates,
      metricsById,
      evidenceById,
      context: { run_id: runId },
    }));
  } else {
    ({
      claims, uncertainties, limitations: providerLimitations, providerMeta,
    } = await provider.analyze({
      normalizedEvidence: artifact.evidence,
      deterministicMetrics: artifact.metrics,
      context: { run_id: runId },
    }));
  }

  artifact.run.analysis_status = 'analyzed';
  artifact.run.provider = providerMeta;
  artifact.claims = claims;
  artifact.uncertainties = [
    ...uncertainties,
    // The legacy metric-only numeric-consistency net only applies to
    // legacy-shaped claims (no candidate_id) — a candidate-hydrated claim
    // was already validated against its own allowed_numeric_facts inside
    // hydrateClaimFromCandidate (claude-cli-provider.mjs), which also knows
    // about scope/run-count/production numbers the legacy metric-only check
    // does not, so re-running the legacy check on it would only produce
    // false-positive "unsupported number" noise.
    ...claims.filter((c) => !c.candidate_id).flatMap((c) => validateClaimNumericConsistency(c, artifact.metrics)),
  ];
  artifact.limitations = [...artifact.limitations, ...providerLimitations];

  const check = validateImpactArtifact(artifact);
  if (!check.ok) throw new Error(`generated impact artifact failed validation: ${check.errors.join('; ')}`);

  return artifact;
}

function atomicWrite(path, content) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, path);
}

/**
 * Writes impact.json (validated) and review.md (rendered) atomically.
 * @param {object} artifact
 * @param {string} outputDir
 * @returns {{impactJsonPath:string, reviewMdPath:string}}
 */
export function writeImpactArtifact(artifact, outputDir) {
  const check = validateImpactArtifact(artifact);
  if (!check.ok) throw new Error(`refusing to write invalid impact artifact: ${check.errors.join('; ')}`);

  mkdirSync(outputDir, { recursive: true });
  const impactJsonPath = `${outputDir}/impact.json`;
  const reviewMdPath = `${outputDir}/review.md`;
  atomicWrite(impactJsonPath, `${JSON.stringify(artifact, null, 2)}\n`);
  atomicWrite(reviewMdPath, renderReview(artifact));
  return { impactJsonPath, reviewMdPath };
}

export { SCHEMA_VERSION };
