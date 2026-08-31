/**
 * candidates/impact-candidate-builder.mjs — deterministic Impact Candidate
 * generation. An Impact Candidate is NOT LLM output: it is a pure package
 * of already-established facts (Evidence + Metrics, cross-linked by
 * evidence-linker.mjs) that MAY support one final ImpactClaim. Pure, no I/O,
 * no LLM. `quality_profile`/`allowed_numeric_facts` are filled in by the
 * caller afterward (candidates/quality-profile.mjs,
 * candidates/allowed-numeric-facts.mjs) once the full candidate shape
 * exists, since both need to read fields this module sets.
 *
 * Two build paths:
 *  - buildMeasuredCandidates: one candidate per "measured" Metric (from
 *    controlled_benchmark/benchmark_artifact/test_artifact/production_metric
 *    Evidence) — the original Resume-Impact-phase-1 path, unchanged.
 *  - buildDerivedCandidates: one candidate per derived/estimated Metric
 *    (src/derived/formula-registry.mjs output, produced by
 *    core/impact-compiler.mjs's derivation collector) — new in this phase.
 * buildImpactCandidates runs both and concatenates the result.
 */
import { createHash } from 'crypto';
import { IMPACT_LEVELS } from '../core/impact-schema.mjs';
import { classifyExternalMeasurementQuality } from '../evidence/external-measurement-quality.mjs';

function candidateId(seed) {
  return `impact_candidate_${createHash('sha1').update(seed).digest('hex').slice(0, 12)}`;
}

function isFiniteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }

/**
 * Deterministic impact_domain KEYWORD classification from a Metric's own
 * name/unit text — a HEURISTIC hint only (see classifyImpactDomain below
 * for the full explicit > deterministic > heuristic > unknown hierarchy).
 * Never an LLM judgment call, and never, on its own, authoritative enough
 * to promote impact_level.
 */
const DOMAIN_RULES = [
  { test: /error|timeout|failure|reliability|uptime|incident/i, domain: 'reliability' },
  { test: /cost|spend|\$|usd/i, domain: 'cost' },
  { test: /conversion|retention|revenue|churn|\bsla\b|ticket/i, domain: 'business' },
  { test: /latency|runtime|duration|throughput|memory|response time|processing time|matching/i, domain: 'performance' },
];
function classifyDomainKeyword(metric) {
  const haystack = `${metric.name} ${metric.unit}`;
  for (const rule of DOMAIN_RULES) if (rule.test.test(haystack)) return rule.domain;
  return 'unknown';
}

/**
 * Every derived-metric formula in the whitelist (src/derived/
 * formula-registry.mjs) represents an operational-efficiency or cost
 * outcome BY CONSTRUCTION — this is a source-type ("deterministic") rule,
 * not a keyword match on free text, so it may promote to L3 even though a
 * keyword match on a metric's NAME never may.
 */
const OPERATIONAL_FORMULA_IDS = ['time_saved_per_event', 'total_time_saved', 'annual_time_saved', 'resource_cost_savings'];

export function hasPositiveScope(scope) {
  if (!scope || typeof scope !== 'object') return false;
  return Object.entries(scope).some(([k, v]) => k !== 'source_evidence_ids' && k !== 'dataset_name' && typeof v === 'number' && Number.isFinite(v) && v > 0);
}

/**
 * Required hierarchy (item 7): explicit structured classification beats
 * source-type deterministic rules beats keyword heuristic beats unknown.
 * Keywords NEVER promote L1/L2 to L3/L4 — only an explicit declaration or a
 * whitelisted operational-formula derivation can reach L3, and only an
 * explicit declaration can ever reach L4 (there is no deterministic
 * business-outcome rule; a business outcome always requires an author to
 * say so).
 * @returns {{impact_level:string, source:'explicit'|'deterministic'}}
 */
function classifyImpactLevel({
  metric, measurementEvidence, scope,
}) {
  const explicitLevel = measurementEvidence?.impact_level;
  if (explicitLevel && IMPACT_LEVELS.includes(explicitLevel)) {
    return { impact_level: explicitLevel, source: 'explicit' };
  }
  if (metric.formula_id && OPERATIONAL_FORMULA_IDS.includes(metric.formula_id)) {
    return { impact_level: 'L3', source: 'deterministic' };
  }
  return { impact_level: hasPositiveScope(scope) ? 'L2' : 'L1', source: 'deterministic' };
}

/** @returns {{impact_domain:string, source:'explicit'|'deterministic'|'heuristic'|'unknown'}} */
function classifyImpactDomain({ metric, measurementEvidence }) {
  const explicitDomain = measurementEvidence?.impact_domain;
  if (explicitDomain) return { impact_domain: explicitDomain, source: 'explicit' };
  if (metric.formula_id && OPERATIONAL_FORMULA_IDS.includes(metric.formula_id)) {
    return { impact_domain: 'operational_efficiency', source: 'deterministic' };
  }
  const domain = classifyDomainKeyword(metric);
  return { impact_domain: domain, source: domain === 'unknown' ? 'unknown' : 'heuristic' };
}

/** system.name: the most specific EXPLICIT text available — an evidence
 *  record's own `system`/`component` field when the artifact's author
 *  declared one, else a linked PR's title, else a linked commit's subject
 *  line, verbatim. Never inferred/summarized — only ever literal text
 *  already present in Evidence. */
function extractSystem(evidence, evidenceById) {
  if (evidence.system) return { name: evidence.system, source_evidence_id: evidence.id, verification_status: 'verified' };
  const linkedIds = evidence.linked_evidence_ids || [];
  const linkedPr = linkedIds.map((id) => evidenceById.get(id)).find((e) => e?.type === 'pull_request');
  if (linkedPr?.title) return { name: linkedPr.title, source_evidence_id: linkedPr.id, verification_status: 'verified' };
  const linkedCommit = linkedIds.map((id) => evidenceById.get(id)).find((e) => e?.type === 'git_commit');
  if (linkedCommit?.subject) return { name: linkedCommit.subject, source_evidence_id: linkedCommit.id, verification_status: 'verified' };
  return { name: null, source_evidence_id: null, verification_status: 'unverified' };
}

/** scope: only ever copied verbatim from the measurement Evidence's own
 *  `scope` object (controlled_benchmark, or — V1-hardening — an externally-
 *  supplied benchmark_artifact that declared one) — never inferred from
 *  code, filenames, or evidence outside this candidate's own measurement
 *  source. Deliberately generic: whatever keys the source scope object
 *  carries (workers/files/requests/records/dataset size/anything else) pass
 *  through untouched — no domain-specific key is hardcoded here. */
function extractScope(evidence) {
  if (['controlled_benchmark', 'benchmark_artifact'].includes(evidence.type) && evidence.scope && Object.keys(evidence.scope).length) {
    return { ...evidence.scope, source_evidence_ids: [evidence.id] };
  }
  return null;
}

/**
 * measurement: the method/statistics block, sourced only from the
 * measurement Evidence record and the Metric it produced.
 *
 * V1-hardening (P0-1): `measurement_quality` for a `benchmark_artifact` no
 * longer passes through `evidence.measurement_quality` (a field only
 * controlled_benchmark ever actually populates — always `null` for an
 * externally-supplied artifact). It is now classified deterministically by
 * external-measurement-quality.mjs from whatever measurement-context fields
 * the artifact's author supplied, so a real external benchmark with
 * repetitions/variance data recorded is no longer indistinguishable from
 * one with zero measurement context at all.
 */
function extractMeasurement(evidence, metric) {
  const isControlled = evidence.type === 'controlled_benchmark';
  const isExternalBenchmark = evidence.type === 'benchmark_artifact';
  const measurementQuality = isExternalBenchmark
    ? classifyExternalMeasurementQuality(evidence)
    : (evidence.measurement_quality ?? null);
  return {
    method: isControlled ? 'controlled_before_after' : (evidence.type === 'production_metric' ? 'production_observed' : 'explicit_before_after'),
    primary_statistic: evidence.primary_statistic ?? evidence.statistic ?? null,
    before: metric.before,
    after: metric.after,
    unit: metric.unit,
    result_value: metric.result?.value ?? null,
    result_unit: metric.result?.value_unit ?? null,
    run_count: evidence.measurement_runs ?? evidence.repetitions ?? (evidence.raw_samples?.before?.length || null),
    measurement_quality: measurementQuality,
    confidence_interval: evidence.confidence_interval ?? null,
    window: evidence.window ?? null,
    assumptions: [],
    ...(isExternalBenchmark ? {
      min: evidence.min ?? null,
      max: evidence.max ?? null,
      stddev: evidence.stddev ?? null,
      deterministic: evidence.deterministic ?? null,
      environment: evidence.environment ?? null,
      verification_status: evidence.verification_status ?? null,
    } : {}),
  };
}

/** attribution: the controlled_benchmark's own deterministic attribution
 *  when present; otherwise a conservative deterministic default reflecting
 *  whether an implementation record is even linked — never invented. */
function extractAttribution(evidence, linkedImplementationIds) {
  if (evidence.attribution) return evidence.attribution;
  if (linkedImplementationIds.length) {
    return {
      strength: 'moderate',
      method: 'linked_before_after',
      base_commit: null,
      target_commit: null,
      confounders: ['before/after pair supplied externally, not a controlled multi-run benchmark'],
    };
  }
  return {
    strength: 'weak',
    method: 'unlinked_before_after',
    base_commit: null,
    target_commit: null,
    confounders: ['no linked implementation evidence establishing what changed'],
  };
}

/** context_evidence_ids: linked ticket/note/slack/document/quantitative_fact
 *  records — soft/intent context that explains WHY, never itself a number
 *  source, kept structurally separate from implementation/measurement/
 *  production evidence. */
function extractContextEvidenceIds(linkedIds, evidenceById) {
  return linkedIds
    .map((id) => evidenceById.get(id))
    .filter((e) => e && ['ticket', 'note', 'slack_message', 'document', 'quantitative_fact'].includes(e.type))
    .map((e) => e.id);
}

function buildMeasuredCandidates(metrics, evidenceById) {
  const candidates = [];
  for (const metric of metrics) {
    if (metric.quantification_type) continue; // derived/estimated metrics are handled by buildDerivedCandidates

    const measurementEvidence = (metric.evidence_ids || [])
      .map((id) => evidenceById.get(id))
      .find((e) => e && ['controlled_benchmark', 'benchmark_artifact', 'test_artifact', 'production_metric'].includes(e.type));
    if (!measurementEvidence) continue; // a Metric must always trace to a real measurement source

    const linkedIds = measurementEvidence.linked_evidence_ids || [];
    const implementationEvidenceIds = linkedIds
      .map((id) => evidenceById.get(id))
      .filter((e) => e && ['git_commit', 'git_diff', 'pull_request'].includes(e.type))
      .map((e) => e.id);
    const productionEvidenceIds = linkedIds
      .map((id) => evidenceById.get(id))
      .filter((e) => e && e.provenance_category === 'production_observability' && e.id !== measurementEvidence.id)
      .map((e) => e.id);
    const isProductionMeasurement = measurementEvidence.type === 'production_metric';
    if (isProductionMeasurement) productionEvidenceIds.push(measurementEvidence.id);
    const contextEvidenceIds = extractContextEvidenceIds(linkedIds, evidenceById);

    const scope = extractScope(measurementEvidence);
    const system = extractSystem(measurementEvidence, evidenceById);
    const measurement = extractMeasurement(measurementEvidence, metric);
    const attribution = extractAttribution(measurementEvidence, implementationEvidenceIds);
    const level = classifyImpactLevel({ metric, measurementEvidence, scope });
    const domain = classifyImpactDomain({ metric, measurementEvidence });

    const allEvidenceIds = [...new Set([
      measurementEvidence.id, ...implementationEvidenceIds, ...productionEvidenceIds, ...contextEvidenceIds,
    ])];

    const seed = `impact_candidate:${metric.id}:${measurementEvidence.id}`;
    candidates.push({
      id: candidateId(seed),
      quantification_type: 'measured',
      impact_level: level.impact_level,
      impact_domain: domain.impact_domain,
      classification_source: { impact_level: level.source, impact_domain: domain.source },
      metric_ids: [metric.id],
      evidence_ids: allEvidenceIds,
      implementation_evidence_ids: implementationEvidenceIds,
      measurement_evidence_ids: [measurementEvidence.id],
      context_evidence_ids: contextEvidenceIds,
      production_evidence_ids: productionEvidenceIds,
      system,
      scope,
      measurement,
      attribution,
      outcome: metric.result?.outcome ?? null,
      // filled in by the caller once the candidate is complete:
      quality_profile: null,
      allowed_numeric_facts: [],
      limitations: [],
      conflicting_evidence: false,
    });
  }
  return candidates;
}

/**
 * One candidate per derived/estimated Metric (core/impact-compiler.mjs's
 * derivation collector sets `metric.quantification_type`,
 * `metric.formula_id`, `metric.input_ids`, `metric.assumptions` on such a
 * Metric — see src/derived/formula-registry.mjs). A derived Metric has no
 * single "measurement Evidence" the way a benchmark does; instead its
 * evidence_ids collectively constitute how the number was computed
 * (typically a controlled_benchmark plus one or more quantitative_fact
 * records), so ALL of them become measurement_evidence_ids here.
 */
function buildDerivedCandidates(metrics, evidenceById) {
  const candidates = [];
  for (const metric of metrics) {
    if (!metric.quantification_type) continue;

    const evidenceRecords = (metric.evidence_ids || []).map((id) => evidenceById.get(id)).filter(Boolean);
    const implementationEvidenceIds = evidenceRecords.filter((e) => ['git_commit', 'git_diff', 'pull_request'].includes(e.type)).map((e) => e.id);
    const productionEvidenceIds = evidenceRecords.filter((e) => e.provenance_category === 'production_observability').map((e) => e.id);
    const measurementEvidenceIds = evidenceRecords.filter((e) => !implementationEvidenceIds.includes(e.id) && !productionEvidenceIds.includes(e.id)).map((e) => e.id);

    // Explicit classification for a derived metric comes from the
    // derivation request's own `output.impact_level`/`output.impact_domain`
    // (threaded onto the Metric by core/impact-compiler.mjs's collector as
    // metric.explicit_impact_level/metric.explicit_impact_domain).
    const level = metric.explicit_impact_level && IMPACT_LEVELS.includes(metric.explicit_impact_level)
      ? { impact_level: metric.explicit_impact_level, source: 'explicit' }
      : classifyImpactLevel({ metric, measurementEvidence: null, scope: null });
    const domain = metric.explicit_impact_domain
      ? { impact_domain: metric.explicit_impact_domain, source: 'explicit' }
      : classifyImpactDomain({ metric, measurementEvidence: null });

    // system.name: the primary (first) source evidence's own system/PR/
    // commit text when traceable, exactly like the measured path.
    const primaryEvidence = evidenceRecords.find((e) => e.type === 'controlled_benchmark') || evidenceRecords[0] || null;
    const system = primaryEvidence ? extractSystem(primaryEvidence, evidenceById) : { name: null, source_evidence_id: null, verification_status: 'unverified' };
    const scope = primaryEvidence ? extractScope(primaryEvidence) : null;

    const seed = `impact_candidate:derived:${metric.id}`;
    candidates.push({
      id: candidateId(seed),
      quantification_type: metric.quantification_type,
      impact_level: level.impact_level,
      impact_domain: domain.impact_domain,
      classification_source: { impact_level: level.source, impact_domain: domain.source },
      metric_ids: [metric.id],
      evidence_ids: [...new Set(metric.evidence_ids || [])],
      implementation_evidence_ids: implementationEvidenceIds,
      measurement_evidence_ids: measurementEvidenceIds,
      context_evidence_ids: [],
      production_evidence_ids: productionEvidenceIds,
      system,
      scope,
      measurement: {
        method: 'formula_derived',
        primary_statistic: null,
        before: null,
        after: null,
        unit: metric.unit,
        result_value: metric.value ?? null,
        result_unit: metric.unit,
        run_count: null,
        // A derivation is only ever as trustworthy as the measured/verified
        // inputs it chains from — 'high' when built with zero declared
        // assumptions, 'medium' otherwise. Never decided by an LLM.
        measurement_quality: (metric.assumptions || []).length ? 'medium' : 'high',
        confidence_interval: null,
        window: null,
        assumptions: metric.assumptions || [],
        formula_id: metric.formula_id,
        input_ids: metric.input_ids || [],
        calculation: metric.calculation,
      },
      attribution: {
        strength: (metric.assumptions || []).length ? 'moderate' : 'strong',
        method: 'formula_derived',
        base_commit: null,
        target_commit: null,
        confounders: (metric.assumptions || []).length ? [...metric.assumptions] : [],
      },
      outcome: 'improvement', // every whitelisted formula represents a savings/reduction, i.e. an improvement by construction
      quality_profile: null,
      allowed_numeric_facts: [],
      limitations: [],
      conflicting_evidence: false,
    });
  }
  return candidates;
}

/**
 * @param {{evidence:object[], metrics:object[]}} input - the full,
 *   already-linked Evidence array and the deterministically-computed
 *   Metrics array (both from core/impact-compiler.mjs's pipeline).
 * @returns {object[]} one Impact Candidate per quantified Metric (measured
 *   OR derived/estimated). `quality_profile` is `null` and
 *   `allowed_numeric_facts` is `[]` here — the caller fills both in once the
 *   candidate exists (see core/impact-compiler.mjs).
 */
export function buildImpactCandidates({ evidence = [], metrics = [] }) {
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  return [
    ...buildMeasuredCandidates(metrics, evidenceById),
    ...buildDerivedCandidates(metrics, evidenceById),
  ];
}

export { isFiniteNumber };
