/**
 * candidates/impact-opportunities.mjs — deterministic detection of gaps
 * between what the current Evidence supports and a stronger quantified
 * Impact. Pure, no I/O, no LLM: every field here is read directly off
 * Evidence/Metrics/Candidates already in the artifact — never fabricates a
 * missing value, only names what's missing and what would strengthen it.
 * An LLM may later phrase `recommended_measurement` more naturally, but the
 * `status`/`missing_evidence` fields are decided here, by code, and must
 * never be authored by a provider.
 */

function opportunity(topic, status, missingEvidence, recommendedMeasurement) {
  return {
    candidate_topic: topic,
    status,
    missing_evidence: missingEvidence,
    recommended_measurement: recommendedMeasurement,
  };
}

/**
 * V1-hardening (P1-5.2): flags a bare git_commit/pull_request Evidence
 * record — real implementation evidence — that has NO measurement Evidence
 * linked to it anywhere, in either direction (a controlled_benchmark/
 * benchmark_artifact/test_artifact/production_metric record that names it
 * via `linked_evidence_ids`, or vice versa). This is the proactive "I found
 * something worth measuring, but I don't yet have evidence to quantify it"
 * signal — it never invents a Metric or Candidate, only names the gap.
 */
function detectUnmeasuredImplementationEvidence(evidence) {
  const measurementTypes = ['controlled_benchmark', 'benchmark_artifact', 'test_artifact', 'production_metric'];
  const linkedIds = new Set();
  for (const e of evidence) {
    if (!measurementTypes.includes(e.type)) continue;
    for (const id of e.linked_evidence_ids || []) linkedIds.add(id);
  }
  const opportunities = [];
  for (const e of evidence) {
    if (!['git_commit', 'pull_request'].includes(e.type)) continue;
    // evidence-linker.mjs always records the link on the MEASUREMENT side
    // (a controlled_benchmark/benchmark_artifact/etc's own
    // linked_evidence_ids naming the commit/PR it measured) — so checking
    // whether any measurement Evidence names this record is the complete,
    // correct test for "has a measurement."
    if (linkedIds.has(e.id)) continue;
    const label = e.type === 'git_commit' ? (e.subject || e.sha || e.id) : (e.title || e.pr_id || e.id);
    opportunities.push(opportunity(
      label,
      'missing_benchmark',
      ['a before/after measurement (a benchmark artifact or a controlled benchmark run) for this implementation change'],
      `Add a benchmark artifact or a controlled-benchmark measurement plan comparing before/after behavior to quantify the effect of "${label}".`,
    ));
  }
  return opportunities;
}

/**
 * @param {{evidence:object[], metrics:object[], candidates:object[],
 *   metricsById?:Map}} input
 * @returns {object[]} impact_opportunities — never fills a missing value,
 *   only names it.
 */
export function detectImpactOpportunities({
  evidence = [], metrics = [], candidates = [], metricsById = new Map(),
}) {
  const opportunities = [];

  opportunities.push(...detectUnmeasuredImplementationEvidence(evidence));

  // ---- unresolved/unsupported measurement evidence: missing before/after,
  // insufficient samples, or a parse failure — never silently dropped. ----
  for (const e of evidence) {
    if (!['controlled_benchmark', 'benchmark_artifact', 'test_artifact', 'production_metric'].includes(e.type)) continue;
    if (e.resolution === 'resolved') continue;
    const topic = e.name || e.benchmark_id || e.type;
    if (e.type === 'controlled_benchmark' && e.resolution === 'unresolved') {
      opportunities.push(opportunity(
        topic,
        /insufficient/i.test(e.reason || '') ? 'insufficient_samples' : 'measurement_failed',
        [e.reason || 'unknown failure'],
        'Re-run the measurement plan; verify both base and target commits produce valid samples on every requested run.',
      ));
    } else {
      opportunities.push(opportunity(
        topic,
        'missing_before_after',
        [e.reason || 'before/after could not be established'],
        'Provide an explicit, structured before/after measurement (a benchmark artifact or a controlled benchmark run).',
      ));
    }
  }

  // ---- candidates: missing scope, weak/unresolved attribution, missing
  // production window, unknown verification status, conflicting evidence. ----
  for (const c of candidates) {
    // V1-hardening (P1-5.5): prefer a readable Metric name over a raw
    // metric ID when no system.name exists — falls back to the ID only
    // when the metric itself can't be found (should not normally happen).
    const firstMetric = metricsById.get((c.metric_ids || [])[0]);
    const topic = c.system?.name || firstMetric?.name || (c.metric_ids || [])[0] || c.id;
    const qp = c.quality_profile || {};

    if (qp.scope_completeness === 'missing') {
      opportunities.push(opportunity(
        topic,
        'missing_scope',
        ['dataset size / request volume / user count or another explicit scale value'],
        'Provide a verified dataset size or controlled-benchmark scope so this result can be presented at L2.',
      ));
    }
    if (qp.attribution_strength === 'weak' || qp.attribution_strength === 'none') {
      opportunities.push(opportunity(
        topic,
        'weak_attribution',
        ['a linked implementation record (commit/PR) establishing what changed'],
        'Link the measurement to the exact commit/PR that introduced it (a controlled benchmark run does this automatically).',
      ));
    }
    if (c.production_evidence_ids?.length && !c.production_summary?.window) {
      opportunities.push(opportunity(
        topic,
        'missing_production_window',
        ['an explicit production observation window (before/after dates)'],
        'Supply window.before/window.after on the production_metric artifact so the observation period can be stated.',
      ));
    }
    if (c.quantification_type === 'self_reported') {
      opportunities.push(opportunity(
        topic,
        'unknown_verification_status',
        ['an independently verified measurement corroborating this self-reported figure'],
        'Provide a controlled benchmark, benchmark artifact, or verified production metric backing this number.',
      ));
    }
    if (qp.conflict_status === 'material') {
      opportunities.push(opportunity(
        topic,
        'conflicting_evidence',
        (c.limitations || []).filter((l) => /conflict/i.test(l)),
        'Resolve the contradictory measurements (same name/service/window with different values) before using this result.',
      ));
    }
  }

  return opportunities;
}
