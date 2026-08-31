/**
 * candidates/ranking.mjs — combination, deduplication, and ranking of
 * Impact Candidates. Pure, no I/O, no LLM: every factor is read off fields
 * other deterministic code already set (quality-profile.mjs,
 * impact-candidate-builder.mjs). Ranking is a documented lexicographic
 * comparison, not an opaque single score — see `rankKey` below, and every
 * candidate keeps its own `quality_profile`/`impact_level` so the reason
 * for its position is always inspectable, never hidden behind one number.
 *
 * Pipeline (in this exact order — a benchmark/production combination
 * changes evidence_strength/production_corroboration/scope, so a profile
 * computed before combining would be stale and could rank the combined
 * candidate in the wrong position):
 *   build candidates (caller, impact-candidate-builder.mjs)
 *   -> compute PRELIMINARY quality_profile (caller, needed only so this
 *      module has something to read before combination touches nothing
 *      profile-related — combination itself keys off Evidence links only)
 *   -> combine deterministically linked candidates (this module)
 *   -> recompute FINAL quality_profile + allowed_numeric_facts on the
 *      post-combination candidate set (this module)
 *   -> deduplicate (this module)
 *   -> final ranking sort (this module)
 */
import { computeQualityProfile } from './quality-profile.mjs';
import { buildAllowedNumericFacts } from './allowed-numeric-facts.mjs';

/**
 * Finds EVERY production_metric-sourced candidate deterministically linked
 * to a controlled_benchmark-sourced candidate (shared service/release_id/
 * deployment_ref/commit — never mere co-occurrence in the same run) — not
 * just the first match, so a benchmark can combine with multiple production
 * Metrics (item 4: e.g. P95 latency AND timeout rate).
 */
function findLinkedProductionCandidates(benchmarkCandidate, productionCandidates, evidenceById) {
  const benchmarkEvidenceIds = new Set(benchmarkCandidate.evidence_ids);
  return productionCandidates.filter((prodCandidate) => prodCandidate.evidence_ids.some((prodId) => {
    const prodRecord = evidenceById.get(prodId);
    if (!prodRecord) return false;
    const prodLinked = new Set(prodRecord.linked_evidence_ids || []);
    if ([...benchmarkEvidenceIds].some((id) => prodLinked.has(id))) return true;
    // symmetric check: the benchmark's own evidence may declare the link instead
    return benchmarkCandidate.evidence_ids.some((benchId) => {
      const benchRecord = evidenceById.get(benchId);
      return benchRecord && (benchRecord.linked_evidence_ids || []).includes(prodId);
    });
  }));
}

function daysBetween(before, after) {
  const a = Date.parse(before);
  const b = Date.parse(after);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round(Math.abs(b - a) / 86400000);
}

/**
 * Builds the production_summary block from every linked production
 * candidate: one entry per underlying Metric (preserving metric_id/
 * evidence_id/window independently — item 4), deduplicated by metric_id,
 * ordered deterministically by name then metric_id, with same-name/
 * same-window contradictory values surfaced as `conflicts` (never silently
 * resolved by picking one) and a single common `window` only when every
 * entry's window genuinely agrees (a mismatch is recorded as
 * `window_conflict: true`, never silently merged).
 */
function buildProductionSummary(prodCandidates, evidenceById, metricsById) {
  const entries = prodCandidates.map((pc) => {
    const prodRecord = pc.measurement_evidence_ids.map((id) => evidenceById.get(id)).find((e) => e?.type === 'production_metric');
    const metric = pc.metric_ids.map((id) => metricsById.get(id)).find(Boolean);
    return {
      metric_id: metric?.id ?? null,
      evidence_id: prodRecord?.id ?? null,
      name: prodRecord?.name ?? 'production metric',
      before: pc.measurement.before,
      after: pc.measurement.after,
      unit: pc.measurement.unit,
      result_value: metric?.result?.value ?? null,
      result_unit: metric?.result?.value_unit ?? null,
      window: prodRecord?.window ?? null,
    };
  });

  // Deduplicate identical Metrics (same metric_id) — keep the first.
  const seen = new Map();
  for (const e of entries) if (!seen.has(e.metric_id)) seen.set(e.metric_id, e);
  const deduped = [...seen.values()];

  // Conflict detection: same name + same window but different before/after
  // values are never silently collapsed into one — both are preserved and
  // the disagreement is recorded explicitly.
  const byNameWindow = new Map();
  for (const e of deduped) {
    const key = `${e.name}|${JSON.stringify(e.window)}`;
    if (!byNameWindow.has(key)) byNameWindow.set(key, []);
    byNameWindow.get(key).push(e);
  }
  const conflicts = [];
  for (const group of byNameWindow.values()) {
    if (group.length <= 1) continue;
    const distinctValues = new Set(group.map((g) => `${g.before}->${g.after}`));
    if (distinctValues.size > 1) conflicts.push({ name: group[0].name, values: [...distinctValues] });
  }

  // Stable deterministic ordering: by name, then metric_id.
  deduped.sort((a, b) => {
    if (a.name !== b.name) return a.name.localeCompare(b.name);
    return String(a.metric_id).localeCompare(String(b.metric_id));
  });

  const windows = deduped.map((e) => JSON.stringify(e.window));
  const windowsAgree = windows.length > 0 && windows.every((w) => w === windows[0]) && deduped[0]?.window;
  const window = windowsAgree
    ? { days: daysBetween(deduped[0].window.before, deduped[0].window.after), before: deduped[0].window.before, after: deduped[0].window.after }
    : null;
  const windowConflict = !windowsAgree && deduped.some((e) => e.window);

  return {
    metrics: deduped, window, window_conflict: windowConflict, conflicts,
  };
}

/**
 * Combines a controlled_benchmark-sourced candidate with EVERY
 * deterministically linked production_metric-sourced candidate found for
 * it. The combined candidate keeps the benchmark candidate's identity/
 * fields and gains a `production_summary` block covering all of them; the
 * absorbed production candidates are removed from the final list so their
 * results aren't ALSO returned standalone. Unrelated production Metrics
 * from the same run (no deterministic link) are never attached.
 */
function combine(benchmarkCandidate, prodCandidates, evidenceById, metricsById) {
  const summary = buildProductionSummary(prodCandidates, evidenceById, metricsById);

  const evidenceIds = new Set(benchmarkCandidate.evidence_ids);
  const metricIds = new Set(benchmarkCandidate.metric_ids);
  const productionEvidenceIds = new Set(benchmarkCandidate.production_evidence_ids);
  for (const pc of prodCandidates) {
    pc.evidence_ids.forEach((id) => evidenceIds.add(id));
    pc.metric_ids.forEach((id) => metricIds.add(id));
    pc.production_evidence_ids.forEach((id) => productionEvidenceIds.add(id));
  }

  const conflictLimitations = summary.conflicts.map((c) => `conflicting production values for "${c.name}": ${c.values.join(' vs ')}`);
  const windowLimitation = summary.window_conflict ? ['linked production metrics report inconsistent observation windows — not merged, see production_summary.metrics for each metric\'s own window'] : [];

  const merged = {
    ...benchmarkCandidate,
    evidence_ids: [...evidenceIds],
    metric_ids: [...metricIds],
    production_evidence_ids: [...productionEvidenceIds],
    production_summary: { window: summary.window, window_conflict: summary.window_conflict, metrics: summary.metrics },
    conflicting_evidence: benchmarkCandidate.conflicting_evidence || summary.conflicts.length > 0,
    limitations: [...(benchmarkCandidate.limitations || []), ...conflictLimitations, ...windowLimitation],
    combined_from: [benchmarkCandidate.id, ...prodCandidates.map((p) => p.id)],
  };

  // The merge above changes production_evidence_ids/evidence_ids/
  // metric_ids/conflicting_evidence — every one of quality-profile.mjs's
  // inputs — so the profile (and the allowed_numeric_facts derived from
  // it) the benchmark candidate carried BEFORE combination is stale the
  // instant it's combined. Recomputed here, at combination time, so a
  // combined candidate's profile is never the pre-combination one; an
  // uncombined candidate's profile is left completely untouched (computed
  // once by the caller, still correct).
  const finalProfile = computeQualityProfile(merged);
  const withProfile = { ...merged, quality_profile: finalProfile };
  return { ...withProfile, allowed_numeric_facts: buildAllowedNumericFacts(withProfile, { metricsById, evidenceById }) };
}

/**
 * V1-hardening (P1-5.3): merges multiple controlled_benchmark-sourced
 * candidates that all trace back to the SAME underlying benchmark run
 * (same `benchmark_id` on the controlled_benchmark evidence they measured)
 * into one candidate. This is how one `stdout_json` execution's multiple
 * named outputs (e.g. a raw "13/16 -> 16/16" count Metric AND a derived
 * "81.25% -> 100%" percentage Metric from the SAME run) land on a single
 * Impact Candidate instead of two unrelated ones — a clean, additive
 * combination mechanism that reuses metric_ids' existing role in
 * allowed-numeric-facts.mjs (which already iterates every metric_id on a
 * candidate) rather than inventing a parallel "secondary metrics" concept.
 * Candidates with no benchmark_id (or the only candidate for a given one)
 * pass through completely unchanged.
 */
function mergeSameBenchmarkCandidates(controlledBenchmarkCandidates, evidenceById) {
  const groups = new Map();
  for (const c of controlledBenchmarkCandidates) {
    const ev = (c.measurement_evidence_ids || []).map((id) => evidenceById.get(id)).find((e) => e?.type === 'controlled_benchmark');
    const key = ev?.benchmark_id ? `benchmark_id:${ev.benchmark_id}` : `solo:${c.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  const merged = [];
  for (const group of groups.values()) {
    if (group.length === 1) { merged.push(group[0]); continue; }
    const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
    const [primary, ...rest] = sorted;
    const metricIds = new Set(primary.metric_ids);
    const evidenceIds = new Set(primary.evidence_ids);
    const measurementEvidenceIds = new Set(primary.measurement_evidence_ids);
    for (const c of rest) {
      c.metric_ids.forEach((id) => metricIds.add(id));
      c.evidence_ids.forEach((id) => evidenceIds.add(id));
      c.measurement_evidence_ids.forEach((id) => measurementEvidenceIds.add(id));
    }
    merged.push({
      ...primary,
      metric_ids: [...metricIds],
      evidence_ids: [...evidenceIds],
      measurement_evidence_ids: [...measurementEvidenceIds],
      combined_from: [...(primary.combined_from || [primary.id]), ...rest.map((c) => c.id)],
    });
  }
  return merged;
}

/**
 * Removes exact duplicate candidates — same metric_ids set — defensively.
 * Combination already absorbs the normal case (a production candidate
 * merged into its linked benchmark); this only catches the residual case
 * of two otherwise-independent candidates that ended up quantifying the
 * exact same Metric set (e.g. re-running candidate construction on
 * identical input). Keeps the first occurrence, deterministic by input
 * order (which is itself already deterministic — see impact-candidate-
 * builder.mjs's stable candidate ids).
 */
function deduplicateCandidates(candidates) {
  const seen = new Set();
  const result = [];
  for (const c of candidates) {
    const key = [...(c.metric_ids || [])].sort().join('|');
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    result.push(c);
  }
  return result;
}

/**
 * @param {object[]} candidates - candidates with a PRELIMINARY
 *   `quality_profile` already populated (computeQualityProfile) —
 *   combination only reads Evidence links off each candidate, never the
 *   profile, so a preliminary one is sufficient input; this function
 *   recomputes the FINAL, authoritative quality_profile and
 *   allowed_numeric_facts itself, after combination, before ranking.
 * @param {{evidenceById?:Map, metricsById?:Map, max?:number|null,
 *   recommendedMax?:number}} [opts] `max`: V1-hardening (P0-2) — when
 *   omitted (the default), NO truncation happens: every real, distinct
 *   Candidate survives into the returned array, so a caller can never
 *   silently lose the strongest positive result or an honest negative one
 *   just by calling this function the normal way. A caller that explicitly
 *   passes `max` is opting into truncation on purpose — that is now the
 *   only way any candidate is ever dropped here. `recommendedMax` (default
 *   3) never removes anything; it only marks the top N ELIGIBLE candidates
 *   (resume_eligibility in {"qualified","strong"}, by the same ranking
 *   order) with `recommended: true` as a non-destructive presentation hint —
 *   core/impact-compiler.mjs surfaces this as
 *   `artifact.recommended_candidate_ids`. An ineligible candidate is never
 *   recommended regardless of rank; if no candidate is eligible, every
 *   `recommended` is false.
 * @returns {object[]} ranked, deduplicated candidates (each carrying its
 *   final, post-combination quality_profile/allowed_numeric_facts, plus new
 *   `rank`/`recommended` fields), truncated to `max` ONLY if explicitly
 *   requested.
 */
export function rankAndDeduplicateCandidates(candidates, opts = {}) {
  const {
    evidenceById = new Map(), metricsById = new Map(), max = null, recommendedMax = 3,
  } = opts;

  const rawControlledBenchmarkCandidates = candidates.filter((c) => c.measurement?.method === 'controlled_before_after');
  const productionCandidates = candidates.filter((c) => c.measurement?.method === 'production_observed');
  const otherCandidates = candidates.filter((c) => c.measurement?.method !== 'controlled_before_after' && c.measurement?.method !== 'production_observed');

  // P1-5.3: fold multiple named outputs from the SAME benchmark run into one
  // candidate before production-linking/ranking, so they present as a
  // single result rather than fragmenting into unrelated entries.
  const mergedSameBenchmark = mergeSameBenchmarkCandidates(rawControlledBenchmarkCandidates, evidenceById);
  const controlledBenchmarkCandidates = mergedSameBenchmark.map((c) => {
    if (!c.combined_from) return c;
    const finalProfile = computeQualityProfile(c);
    const withProfile = { ...c, quality_profile: finalProfile };
    return { ...withProfile, allowed_numeric_facts: buildAllowedNumericFacts(withProfile, { metricsById, evidenceById }) };
  });

  const absorbed = new Set();
  const combined = [];

  for (const bc of controlledBenchmarkCandidates) {
    const matches = findLinkedProductionCandidates(bc, productionCandidates.filter((p) => !absorbed.has(p.id)), evidenceById);
    if (!matches.length) continue;
    matches.forEach((m) => absorbed.add(m.id));
    absorbed.add(bc.id);
    combined.push(combine(bc, matches, evidenceById, metricsById));
  }

  // combine() (above) already recomputed the FINAL quality_profile/
  // allowed_numeric_facts for every combined candidate; an uncombined
  // candidate's profile — computed once by the caller before this function
  // ran (or by the same-benchmark merge step above) — is untouched and
  // still correct, since nothing about it changed.
  const postCombination = [
    ...combined,
    ...controlledBenchmarkCandidates.filter((c) => !absorbed.has(c.id)),
    ...productionCandidates.filter((c) => !absorbed.has(c.id)),
    ...otherCandidates,
  ];

  const finalSet = deduplicateCandidates(postCombination);

  const QUANT_RANK = {
    measured: 0, derived: 1, estimated: 2, self_reported: 3,
  };
  const STRENGTH_RANK = { high: 0, medium: 1, low: 2 };
  // 'unknown' (no measurement-quality signal was ever supplied) ranks
  // between 'low' (a classifier actively assessed it as weak) and
  // 'insufficient' (the worst, actively-determined tier) — we genuinely
  // don't know how good an 'unknown' measurement is, so it's ranked
  // pessimistically without being conflated with a KNOWN-bad measurement.
  const MQ_RANK = {
    high: 0, medium: 1, low: 2, unknown: 3, insufficient: 4,
  };
  const ATTR_RANK = {
    strong: 0, moderate: 1, weak: 2, none: 3,
  };
  const SCOPE_RANK = { complete: 0, partial: 1, missing: 2 };
  const LEVEL_RANK = {
    L4: 0, L3: 1, L2: 2, L1: 3,
  };
  const CONFLICT_RANK = { none: 0, limited: 1, material: 2 };
  const ELIGIBILITY_RANK = {
    strong: 0, qualified: 1, context_only: 2, ineligible: 3,
  };
  const CLASSIFICATION_SOURCE_RANK = {
    explicit: 0, deterministic: 1, heuristic: 2, unknown: 3,
  };

  function rankKey(c) {
    const qp = c.quality_profile || {};
    const assumptionCount = (c.assumptions ?? c.measurement?.assumptions ?? []).length;
    const combinedCompleteness = c.combined_from ? -(c.combined_from.length - 1) : 0; // more absorbed production metrics ranks slightly better among equals
    return [
      ELIGIBILITY_RANK[qp.resume_eligibility] ?? 4,
      QUANT_RANK[c.quantification_type] ?? 4,
      STRENGTH_RANK[qp.evidence_strength] ?? 3,
      MQ_RANK[qp.measurement_quality] ?? 5,
      ATTR_RANK[qp.attribution_strength] ?? 4,
      SCOPE_RANK[qp.scope_completeness] ?? 3,
      qp.production_corroboration ? 0 : 1,
      LEVEL_RANK[c.impact_level] ?? 4,
      CONFLICT_RANK[qp.conflict_status] ?? 3,
      CLASSIFICATION_SOURCE_RANK[c.classification_source?.impact_level] ?? 3,
      assumptionCount,
      combinedCompleteness,
    ];
  }

  const sorted = [...finalSet].sort((a, b) => {
    const ka = rankKey(a);
    const kb = rankKey(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return ka[i] - kb[i];
    }
    return a.id.localeCompare(b.id);
  });

  // V1-hardening (P0-2): `rank`/`recommended` are informational annotations
  // only — they never remove a candidate from the array. `rank` reflects
  // the full ranking order over every candidate, ineligible ones included,
  // so a reviewer can see exactly where a regression or a weak-evidence
  // candidate sits relative to the rest.
  //
  // V1-hardening (recommendation-semantics fix, exposed by CS61C proj3):
  // `recommended` means "recommended for resume / positive-impact use" —
  // it must never mark a candidate whose own resume_eligibility is
  // "ineligible" or "context_only", no matter how high it ranks. Proj3's 15
  // regression candidates all ranked 1st-15th under the ranking key above
  // (ranking is about evidence quality, not eligibility), and the OLD
  // `i < recommendedMax` logic recommended its top 3 anyway — 3 regressions
  // marked "recommended" alongside 15 "ineligible" results, which is
  // internally contradictory. `recommended` now marks the top
  // `recommendedMax` candidates by the SAME ranking order, filtered first to
  // resume_eligibility in {"qualified", "strong"}; an ineligible candidate at
  // rank 1 is simply skipped when choosing recommendations, never promoted
  // or re-ranked. If no candidate is eligible, every `recommended` is false
  // and (via core/impact-compiler.mjs) `recommended_candidate_ids` is `[]` —
  // this is the correct, resume-safe outcome for an all-regression slate,
  // not a bug to work around.
  const RECOMMENDABLE_ELIGIBILITY = new Set(['qualified', 'strong']);
  let recommendableSeen = 0;
  const ranked = sorted.map((c, i) => {
    const eligible = RECOMMENDABLE_ELIGIBILITY.has(c.quality_profile?.resume_eligibility);
    const recommended = eligible && recommendableSeen < recommendedMax;
    if (eligible) recommendableSeen += 1;
    return { ...c, rank: i + 1, recommended };
  });

  // Only an EXPLICIT `max` truncates. The default (max === null) always
  // returns every candidate — this is the fix for the silent-candidate-loss
  // failure: core/impact-compiler.mjs's normal pipeline never passes `max`,
  // so `impact_candidates` in the canonical artifact is always complete.
  if (max == null) return ranked;
  return ranked.slice(0, max);
}

export { rankAndDeduplicateCandidates as default };
