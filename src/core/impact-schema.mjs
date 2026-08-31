/**
 * core/impact-schema.mjs — enums and field lists for the generic Impact
 * artifact (impact.json). Deliberately independent of any host system's
 * domain model (e.g. Recruiting OS's Career Graph) — no project_id,
 * experience_id, ownership-enum, or storage-path fields live here. A host
 * integration maps this generic shape onto its own domain at its own
 * boundary (see Recruiting OS's integrations/impact_compiler_adapter.mjs).
 */

/**
 * Additive only, per V1/V2 closeout's frozen contract. `SCHEMA_VERSION` is
 * what NEW artifacts are stamped with; `SUPPORTED_SCHEMA_VERSIONS` is what
 * validation.mjs accepts — an older artifact has fewer optional fields, but
 * every field its own version required is still present and unchanged, so
 * it remains valid without migration. Never remove an entry from this list.
 *   1.0.0 — V1: git/benchmark/test
 *   2.0.0 — V2: + pull_request/ticket, provenance_category, linking
 *   3.0.0 — V3: + production_metric/log/observability_artifact
 *   4.0.0 — V4: + note/slack_message/document
 *   5.0.0 — V5: + controlled_benchmark (Quantification V1 — automated
 *           base/target git-commit benchmark comparisons; see
 *           src/measurement/) (current)
 *
 * No version bump for the Resume-Impact phases: `impact_candidates`,
 * `quantitative_fact` (a new EVIDENCE_TYPES value), `formula_derived` (a new
 * METRIC_OPERATIONS value), and every new optional field on Evidence/
 * Metric/Claim are additive-only — no existing required field changed
 * meaning, no prior schema_version's contract was altered, and an artifact
 * written under any prior version still validates unchanged (it simply
 * never contains these new optional pieces). A version bump is reserved for
 * a change that would make an OLD artifact newly invalid or reinterpret an
 * existing field, which none of this does.
 */
export const SCHEMA_VERSION = '5.0.0';
export const SUPPORTED_SCHEMA_VERSIONS = ['1.0.0', '2.0.0', '3.0.0', '4.0.0', '5.0.0'];
export const ARTIFACT_TYPE = 'impact-compiler/impact-artifact';

export const ANALYSIS_STATUSES = ['analyzed', 'pending_llm'];

/**
 * V3 adds 'production_metric'/'log'/'observability_artifact'; V4 adds
 * 'note'/'slack_message'/'document'; V5 adds 'controlled_benchmark' (an
 * automated, isolated base-vs-target git-commit benchmark run — distinct
 * from 'benchmark_artifact', which is an externally-supplied, already-run
 * before/after pair) — all additive, V1-V4's values are unchanged.
 */
export const EVIDENCE_TYPES = [
  'git_commit', 'git_diff', 'benchmark_artifact', 'test_artifact', 'pull_request', 'ticket',
  'production_metric', 'log', 'observability_artifact',
  'note', 'slack_message', 'document',
  'controlled_benchmark',
  // Resume-Impact phase (no schema_version bump — see impact-schema.mjs's
  // module doc note below): an explicit, structured Quantitative Fact
  // (src/facts/quantitative-fact.mjs) normalized into the Evidence Store so
  // it is traceable/linkable exactly like every other Evidence record. This
  // is purely a new closed-enum VALUE, not a change to any existing
  // required field or any prior schema_version's contract — an artifact
  // written before this phase simply never contains one, and every
  // validator here still accepts it unchanged.
  'quantitative_fact',
  // V2 P1 (Deep-hardening): a first-class representation of a plain
  // "N/M tests passed" result — see evidence/test-result-adapter.mjs. This
  // is a NEW value alongside the pre-existing 'test_artifact' (which no
  // code path actually produces — both `--benchmark` and `--test-artifact`
  // CLI flags route through benchmark-adapter.mjs's before/after-requiring
  // parser today; 'test_artifact' is left untouched/unrepurposed per V2's
  // additive-only discipline, in case another caller depends on its
  // existing shape). A test_result record NEVER computes a Metric and NEVER
  // becomes an Impact Candidate by itself — no before/after comparison
  // exists — it is evidence/context only (see
  // candidates/impact-candidate-builder.mjs's buildMeasuredCandidates,
  // which deliberately does not include 'test_result' in its measurement-
  // source type list).
  'test_result',
];

/**
 * Every evidence record carries exactly one of these, so a claim can always
 * tell — via its evidence_ids -> evidence lookup — what KIND of backing a
 * piece of evidence provides. Assigned deterministically by
 * evidence-normalizer.mjs at normalization time, never inferred by an LLM.
 *   'implementation'         — git_commit, git_diff, pull_request (what changed / how)
 *   'intent_context'         — ticket (why it was wanted / intended scope)
 *   'metric'                 — benchmark_artifact, test_artifact (quantified before/after),
 *                                test_result (V2 P1 — a quantified pass/total
 *                                verification count with no before/after)
 *   'production_observability' — production_metric, log, observability_artifact (V3)
 *   'soft_context'            — note, slack_message, document (V4 — self-reported/contextual)
 *   'verification'            — reserved for a future evidence type that corroborates
 *                                another record (e.g. an independent sign-off); no V1-V4
 *                                adapter assigns this automatically, listed here so the
 *                                enum is forward-compatible without another schema bump.
 */
export const PROVENANCE_CATEGORIES = [
  'implementation', 'intent_context', 'metric', 'production_observability', 'soft_context', 'verification',
];

/** V3/V4: how much a source's claim to correctness has actually been
 *  checked — set from adapter input when supplied, never guessed.
 *  'not_attempted' is the honest default when the input doesn't say. */
export const VERIFICATION_STATUSES = ['verified', 'unverified', 'self_reported', 'not_attempted'];

/** V2: how a PR/ticket's declared links (merge_commit_sha, linked_commit_shas,
 *  linked_pr_ids) resolved against the OTHER evidence actually supplied in
 *  this run — never against evidence outside the run, and never inferred by
 *  an LLM. 'unresolved' means a link was declared but nothing in this run's
 *  evidence matched it; the declared reference is still preserved verbatim,
 *  never dropped. */
export const LINK_RESOLUTIONS = ['resolved', 'unresolved', 'not_applicable'];

/** Evidence records that could not be turned into a metric are preserved,
 *  never silently dropped or guessed into a fabricated number. */
export const EVIDENCE_RESOLUTIONS = ['resolved', 'unresolved', 'unsupported'];

/**
 * 'formula_derived' (Resume-Impact phase, additive): a Metric produced by
 * src/derived/formula-registry.mjs's whitelisted formula engine, not by
 * src/metrics/deterministic-metric-engine.mjs's before/after computeMetric.
 * Its `calculation`/`value` still come from deterministic code only — this
 * is a new closed-enum VALUE, not a new computation pathway outside the
 * existing determinism guarantees.
 */
export const METRIC_OPERATIONS = ['absolute_delta', 'percentage_reduction', 'percentage_increase', 'ratio', 'formula_derived'];
export const METRIC_DIRECTIONS = ['lower_is_better', 'higher_is_better'];
export const METRIC_CONFIDENCE_VALUES = ['high', 'medium', 'low'];

/**
 * V5: deterministic, conservative classification of a Metric's measurement
 * quality — never decided by an LLM. Populated two ways:
 *  - controlled_benchmark: src/measurement/stats-engine.mjs's
 *    classifyMeasurementQuality, from real per-run statistics
 *    (never 'unknown' — the stats engine always has samples to reason
 *    about, so it only ever returns high/medium/low/insufficient).
 *  - benchmark_artifact (externally-measured evidence):
 *    src/evidence/external-measurement-quality.mjs's
 *    classifyExternalMeasurementQuality, from whatever measurement-context
 *    fields the artifact's author supplied (repetitions, variance,
 *    determinism, verification_status).
 *
 * V1-hardening addition: 'unknown' — the artifact supplied NO measurement-
 * context fields at all, so quality genuinely cannot be classified.
 * `'unknown' !== 'insufficient'`: 'insufficient' means the available
 * information indicates the measurement IS weak (e.g. a single self-
 * reported figure with no corroboration); 'unknown' means no information
 * about quality exists either way — the number itself may still be
 * completely correct. Candidate quality-profile.mjs treats them
 * differently: 'unknown' does not by itself block 'qualified' eligibility;
 * 'insufficient' does.
 */
export const MEASUREMENT_QUALITY_VALUES = ['high', 'medium', 'low', 'unknown', 'insufficient'];

/** V5: how strongly a controlled_benchmark's before/after comparison can be
 *  attributed to the base->target code change (src/measurement/attribution.mjs)
 *  — computed deterministically from whether commits resolved, samples were
 *  sufficient, and no execution failed. Never decided by an LLM. */
export const ATTRIBUTION_STRENGTHS = ['strong', 'moderate', 'weak', 'none'];

export const CLAIM_CONFIDENCE_VALUES = ['high', 'medium', 'low'];

/**
 * Resume-Impact phase (post-Quantification-V1): classifies HOW a numeric
 * result came to exist — never how strong it is (that's evidence_strength/
 * measurement_quality/attribution below). Assigned deterministically by
 * src/candidates/impact-candidate-builder.mjs and
 * src/derived/formula-registry.mjs; an LLM may never assign or change this.
 *   'measured'      — a controlled benchmark, an explicit before/after
 *                      benchmark_artifact, or a verified production_metric.
 *   'derived'        — computed by src/derived/formula-registry.mjs from
 *                       measured/verified structured inputs; assumptions[]
 *                       is normally empty.
 *   'estimated'      — computed from explicit structured inputs but with
 *                       one or more declared assumptions.
 *   'self_reported'  — a number that exists only in unverified free text
 *                       (a note/Slack message/document/ticket) — never
 *                       promoted to a higher type merely by repetition.
 * Ranking always prefers measured > derived > estimated > self_reported.
 */
export const QUANTIFICATION_TYPES = ['measured', 'derived', 'estimated', 'self_reported'];

/**
 * Impact Level — how far a supported result reaches, never inferred across
 * levels without explicit corroborating Evidence of that higher level (e.g.
 * a latency reduction never implies a revenue claim on its own).
 *   L1 — technical measurement (latency/runtime/memory/throughput/error rate).
 *   L2 — an L1 result with explicit scale (record count, request volume,
 *        regions, users affected, ...).
 *   L3 — operational outcome (deployment time, MTTR, alert count, manual
 *        steps, engineering time saved, cloud cost, operational workload).
 *   L4 — business outcome (conversion, retention, revenue, churn, support
 *        tickets, SLA attainment) — requires explicit supporting Evidence,
 *        never inferred from an L1/L2/L3 result.
 */
export const IMPACT_LEVELS = ['L1', 'L2', 'L3', 'L4'];

/** Deterministic Impact-Candidate quality-profile enums
 *  (src/candidates/quality-profile.mjs) — never decided by an LLM. */
export const EVIDENCE_STRENGTH_VALUES = ['high', 'medium', 'low'];
/**
 * `scope_completeness` answers "is the measurement's scope RECORDED and
 * TRACEABLE back to real evidence?" — 'complete' means a positive numeric
 * scale value exists and is linked to a source evidence record. It does
 * NOT mean, and was never intended to mean, "the evidence justifies broad/
 * universal language about this result" — a single benchmark's scope can
 * be perfectly complete/traceable (`{benchmark: "X", workers: 64}`,
 * source-linked) while still not justifying "overall"/"system-wide"
 * language. Every existing consumer of this field (ranking.mjs's
 * SCOPE_RANK, impact-opportunities.mjs's missing-scope detection,
 * review-renderer.mjs's display) genuinely means traceability, and this
 * field's values/meaning are UNCHANGED by scope_breadth below — see
 * docs/IMPACTCOMPILER_V2_VALIDATION_MODEL.md for the full history of why a
 * second field was introduced instead of redefining this one.
 */
export const SCOPE_COMPLETENESS_VALUES = ['complete', 'partial', 'missing'];
/**
 * V2.1 (Deep-hardening, bounded semantic-closure pass): answers a
 * DIFFERENT question from `scope_completeness` above — "does the evidence
 * itself justify broad/universal language about this result?" Assigned
 * deterministically by src/candidates/quality-profile.mjs's
 * deriveScopeBreadth, never inferred by an LLM, and consumed only by
 * src/core/claim-semantics.mjs's scope-generalization check.
 *   'unknown'     — no scope object at all; breadth cannot be assessed.
 *   'specific'    — a single, bounded measurement (the default for every
 *                   real evidence shape this compiler currently produces —
 *                   one benchmark, one controlled A/B run, one externally-
 *                   supplied artifact). This is NOT a lesser/incomplete
 *                   state; it is the normal, expected value for real
 *                   evidence, and the vast majority of candidates will
 *                   correctly be 'specific' forever.
 *   'multi_scope' — a candidate that deterministically combined more than
 *                   one explicitly-identified underlying measurement (see
 *                   candidates/ranking.mjs's `combined_from`, already an
 *                   existing, real signal — never inferred beyond it).
 *                   Several enumerated things, not "all" of anything.
 *   'global'      — ONLY when the evidence itself explicitly declares
 *                   universal coverage (`scope.coverage === 'global'`,
 *                   verbatim from an evidence author, never inferred from
 *                   a large-looking scope value or a big number). No
 *                   current CS61C/Atlas/SAFER-CC fixture declares this —
 *                   it exists for evidence that genuinely earns it.
 */
export const SCOPE_BREADTH_VALUES = ['specific', 'multi_scope', 'global', 'unknown'];
export const CONFLICT_STATUS_VALUES = ['none', 'limited', 'material'];
export const RESUME_ELIGIBILITY_VALUES = ['strong', 'qualified', 'context_only', 'ineligible'];

/**
 * How a candidate's impact_level/impact_domain was decided
 * (src/candidates/impact-candidate-builder.mjs's classifyImpactLevel/
 * classifyImpactDomain) — required hierarchy: 'explicit' (an author-declared
 * field, e.g. a measurement plan's result.impact_level or a derivation
 * request's output.impact_level) beats 'deterministic' (a source-type rule
 * with no keyword involved, e.g. "a controlled benchmark with scope is L2")
 * beats 'heuristic' (a keyword match on free text — NEVER authoritative
 * enough to promote to L3/L4) beats 'unknown' (nothing matched). Never
 * decided by an LLM.
 */
export const CLASSIFICATION_SOURCES = ['explicit', 'deterministic', 'heuristic', 'unknown'];

/** Required fields per entity — used by validation.mjs's shape checks. */
export const EVIDENCE_REQUIRED_FIELDS = ['id', 'type', 'resolution'];
export const METRIC_REQUIRED_FIELDS = [
  'id', 'name', 'unit', 'operation', 'direction', 'calculation', 'confidence', 'evidence_ids',
];
export const CLAIM_REQUIRED_FIELDS = [
  'id', 'title', 'problem', 'change', 'outcome', 'statement', 'metric_ids', 'evidence_ids', 'confidence',
];
/** An Impact Candidate is a deterministic package of facts, not LLM output —
 *  see src/candidates/impact-candidate-builder.mjs. */
export const IMPACT_CANDIDATE_REQUIRED_FIELDS = [
  'id', 'quantification_type', 'impact_level', 'metric_ids', 'evidence_ids',
];

/**
 * V2 (Deep-hardening phase): classifies WHERE a claimable numeric fact came
 * from, so the validator can tell a real externally-claimable number apart
 * from one that only exists for internal schema compatibility. Assigned
 * deterministically by src/candidates/allowed-numeric-facts.mjs, never by an
 * LLM. Additive: a fact with no `provenance_class` (every V1 fact) is
 * treated as if `externally_claimable` were true, exactly like before this
 * field existed.
 *   'SOURCE_FACT'              — present verbatim in the evidence an adapter
 *                                 actually parsed (a real before/after value,
 *                                 a real scope number, a real run_count).
 *   'DERIVED_FACT'              — deterministically computed FROM source
 *                                 facts (absolute_delta, relative_change,
 *                                 result_value) — real, externally claimable,
 *                                 just not itself present verbatim in the
 *                                 source.
 *   'DISPLAY_ALIAS'             — a formatting variant of a SOURCE_FACT or
 *                                 DERIVED_FACT (rounded/comma-grouped/word
 *                                 form) — same claimability as the fact it
 *                                 aliases, never a separate value.
 *   'ADAPTER_INTERNAL'          — an artificial value an evidence adapter
 *                                 supplied ONLY to satisfy an internal
 *                                 before/after schema requirement (e.g. a
 *                                 synthetic anchor manufactured because only
 *                                 a percentage was actually published) — MUST
 *                                 NEVER be treated as externally claimable,
 *                                 regardless of where else it appears.
 *   'IMPLEMENTATION_SCALE_FACT' — a real, verified implementation quantity
 *                                 (e.g. "36 instruction-decode signals") that
 *                                 is NOT itself an impact/before-after metric
 *                                 — externally claimable, just not an impact
 *                                 claim by itself.
 */
export const FACT_PROVENANCE_CLASSES = [
  'SOURCE_FACT', 'DERIVED_FACT', 'DISPLAY_ALIAS', 'ADAPTER_INTERNAL', 'IMPLEMENTATION_SCALE_FACT',
];

/**
 * V2: structured semantic-claim-validation finding types
 * (src/core/claim-semantics.mjs). A claim can fail for more than one reason
 * at once; each violation names exactly one of these.
 */
export const CLAIM_VIOLATION_TYPES = [
  'unsupported_number', 'unit_mismatch', 'polarity_mismatch',
  'scope_overgeneralization', 'adapter_internal_fact', 'numeric_tokenization_error',
];

/** Fields on a Metric that only the deterministic engine may ever set.
 *  validation.mjs rejects any provider (Claude) output that attempts to
 *  set these — the structural defense behind the numeric-output rule. */
export const METRIC_DETERMINISTIC_FIELDS = [
  'before', 'after', 'absolute_delta', 'relative_change_percent', 'operation', 'calculation', 'direction', 'result',
];

/** @returns {object} an empty, valid top-level impact.json skeleton. */
export function emptyImpactArtifact({ compilerVersion, runId, runStartedAt }) {
  return {
    schema_version: SCHEMA_VERSION,
    artifact_type: ARTIFACT_TYPE,
    compiler_version: compilerVersion,
    run: { id: runId, started_at: runStartedAt, analysis_status: 'pending_llm' },
    repositories: [],
    evidence: [],
    metrics: [],
    // Deterministic Impact Candidates (Resume-Impact phase) — an additive,
    // optional top-level array. Absent entirely on any artifact written
    // before this phase; that absence is valid, never migrated/backfilled.
    impact_candidates: [],
    // V1-hardening (P0-2): a non-destructive, additive, OPTIONAL top-N
    // presentation VIEW over impact_candidates — never a second source of
    // truth. Every id here also appears in impact_candidates (which is
    // always the complete set); this is purely "here's a good default
    // shortlist to show first," not a filter that hides anything. Absent
    // or empty is always valid.
    recommended_candidate_ids: [],
    // Structured, deterministic gaps between what Evidence currently
    // supports and a stronger quantified Impact — never fills a missing
    // value itself (src/candidates/impact-opportunities.mjs).
    impact_opportunities: [],
    claims: [],
    uncertainties: [],
    limitations: [],
  };
}
