/**
 * renderers/review-renderer.mjs — pure function: impact.json -> review.md.
 * Never recalculates metrics, never calls Claude, never modifies facts, and
 * never adds an unsupported claim. review.md is a projection, not a second
 * source of truth — changing this file can never change impact.json.
 *
 * V2 grouped each claim's evidence by `provenance_category`
 * (core/impact-schema.mjs). V3/V4 extend that grouping to the full tier
 * list: implementation, deterministic benchmark/test, production/
 * observability, intent/context, soft evidence — plus a dedicated
 * uncertainties/conflicts section. The category itself is never decided
 * here — only grouped by a value evidence-normalizer.mjs already assigned
 * deterministically. A claim with only V1/V2 evidence renders exactly as
 * it did before V3/V4 — same per-line format, just under the same-named
 * group headings, now alongside groups that simply stay empty and absent.
 */

const PROVENANCE_LABELS = {
  implementation: 'Implementation evidence (what changed)',
  metric: 'Deterministic benchmark/test evidence',
  production_observability: 'Production / observability evidence',
  intent_context: 'Intent / context evidence (why it existed)',
  soft_context: 'Soft evidence (context only — not independently verified)',
  verification: 'Verification evidence',
};
const PROVENANCE_ORDER = ['implementation', 'metric', 'production_observability', 'intent_context', 'soft_context', 'verification'];

function measurementPlanLines(sourceEvidence) {
  const lines = [];
  if (sourceEvidence.scope) lines.push(`  - scope: ${JSON.stringify(sourceEvidence.scope)}`);
  lines.push(`  - base commit: ${sourceEvidence.base_commit ?? '(unresolved)'}`);
  lines.push(`  - target commit: ${sourceEvidence.target_commit ?? '(unresolved)'}`);
  if (sourceEvidence.statistics) {
    lines.push(`  - samples: before ${sourceEvidence.statistics.before?.count ?? 0}, after ${sourceEvidence.statistics.after?.count ?? 0}`);
  }
  if (sourceEvidence.primary_statistic) lines.push(`  - primary statistic: ${sourceEvidence.primary_statistic}`);
  lines.push(`  - measurement quality: ${sourceEvidence.measurement_quality ?? '(unknown)'}`);
  if (sourceEvidence.confidence_interval) {
    const ci = sourceEvidence.confidence_interval;
    lines.push(`  - 95% CI on change: [${ci.lower}, ${ci.upper}] (${ci.method}), change_detected: ${ci.change_detected}`);
  }
  if (sourceEvidence.attribution) {
    lines.push(`  - attribution: ${sourceEvidence.attribution.strength}${sourceEvidence.attribution.confounders?.length ? ` (${sourceEvidence.attribution.confounders.join('; ')})` : ''}`);
  }
  return lines;
}

/** environment may be a plain string (most evidence types) or, since
 *  V1-hardening's generic benchmark_artifact measurement-context fields, an
 *  arbitrary object (e.g. `{os, arch, go_version, num_cpu}`) — render it
 *  readably either way instead of letting a bare template literal collapse
 *  an object to "[object Object]". */
function formatEnvironment(env) {
  if (env === null || typeof env !== 'object') return String(env);
  return Object.entries(env).map(([k, v]) => `${k}: ${v}`).join(', ');
}

function metricLine(m, evidenceById) {
  const pct = m.relative_change_percent === null ? '' : ` (${m.relative_change_percent}%)`;
  const outcome = m.result?.outcome ? `, outcome: ${m.result.outcome}` : '';
  const lines = [`- **${m.name}**: ${m.before} -> ${m.after} ${m.unit}${pct} — ${m.direction}, operation: ${m.operation}, confidence: ${m.confidence}${outcome}`];
  lines.push(`  - calculation: \`${m.calculation}\``);
  // Time window / environment / source live on the ORIGINATING evidence
  // record (e.g. a production_metric or controlled_benchmark), not on the
  // Metric record itself — looked up here for display only, never
  // recomputed or altered.
  const sourceEvidence = (m.evidence_ids || []).map((id) => evidenceById.get(id)).find((e) => e && (e.environment !== undefined || e.window !== undefined || e.source !== undefined));
  if (sourceEvidence) {
    if (sourceEvidence.type === 'controlled_benchmark') {
      lines.push(...measurementPlanLines(sourceEvidence));
    } else {
      if (sourceEvidence.environment) lines.push(`  - environment: ${formatEnvironment(sourceEvidence.environment)}`);
      if (sourceEvidence.window && (sourceEvidence.window.before || sourceEvidence.window.after)) {
        lines.push(`  - window: before ${sourceEvidence.window.before ?? '(unknown)'}, after ${sourceEvidence.window.after ?? '(unknown)'}`);
      }
      if (sourceEvidence.service) lines.push(`  - service: ${sourceEvidence.service}`);
      if (sourceEvidence.source) lines.push(`  - source: ${sourceEvidence.source}`);
    }
  }
  lines.push(`  - evidence: ${(m.evidence_ids || []).map((id) => `\`${id}\``).join(', ') || '(none)'}`);
  return lines.join('\n');
}

function evidenceLine(e) {
  const linkNote = e.link_resolution && e.link_resolution !== 'not_applicable' ? `, link: ${e.link_resolution}` : '';
  const shipNote = e.type === 'pull_request' ? `, merged: ${e.merged === true}` : '';
  const envNote = e.environment ? `, environment: ${formatEnvironment(e.environment)}` : '';
  return `- \`${e.id}\` (${e.type}, ${e.resolution}${linkNote}${shipNote}${envNote})`;
}

/**
 * Resume-Impact phase: renders the deterministic traceability chain
 * (Claim -> candidate -> quantification/level/scope/attribution/quality)
 * for a candidate-hydrated claim only — a legacy (pre-candidate) claim has
 * none of these fields and renders exactly as it always did. Nothing here
 * is calculated; every value is read straight off the claim, which was
 * itself hydrated deterministically from its candidate
 * (providers/claude-cli-provider.mjs's hydrateClaimFromCandidate).
 */
function candidateTraceabilityLines(claim) {
  const lines = [];
  const cs = claim.classification_source;
  const levelNote = cs?.impact_level ? ` (source: ${cs.impact_level})` : '';
  const domainNote = cs?.impact_domain ? ` (source: ${cs.impact_domain})` : '';
  lines.push(`Candidate: \`${claim.candidate_id}\` — quantification: ${claim.quantification_type}, impact level: ${claim.impact_level}${levelNote}, domain: ${claim.impact_domain || '(unknown)'}${domainNote}`);
  if (claim.scope) lines.push(`Scope: ${JSON.stringify(claim.scope)}`);
  if (claim.attribution) {
    lines.push(`Attribution: ${claim.attribution.strength}${claim.attribution.confounders?.length ? ` (${claim.attribution.confounders.join('; ')})` : ''}`);
  }
  if (claim.quality_profile) {
    const qp = claim.quality_profile;
    lines.push(`Quality profile: evidence=${qp.evidence_strength}, measurement=${qp.measurement_quality}, attribution=${qp.attribution_strength}, scope=${qp.scope_completeness}, production_corroboration=${qp.production_corroboration}, conflict=${qp.conflict_status}, resume_eligibility=${qp.resume_eligibility}`);
  }
  // Derived/estimated Impact: render the formula, its inputs, calculation,
  // result, and assumptions — nothing here is recalculated, only read off
  // the Metric/measurement the candidate already carries.
  if (claim.measurement?.formula_id) {
    const m = claim.measurement;
    lines.push(`Formula: \`${m.formula_id}\` — calculation: \`${m.calculation}\` = ${m.result_value} ${m.result_unit}`);
    lines.push(`Formula inputs: ${(m.input_ids || []).map((id) => `\`${id}\``).join(', ') || '(none)'}`);
    lines.push(`Assumptions: ${(m.assumptions || []).length ? m.assumptions.join('; ') : '(none)'}`);
  }
  if (claim.production_summary) {
    const { window, metrics: prodMetrics, window_conflict: windowConflict } = claim.production_summary;
    if (window) lines.push(`Production observation window: ${window.days} days (${window.before ?? '?'} -> ${window.after ?? '?'})`);
    if (windowConflict) lines.push('Production observation windows conflict across linked metrics — see each metric below.');
    for (const pm of prodMetrics || []) {
      const resultNote = pm.result_value === null || pm.result_value === undefined ? '' : ` (${pm.result_value}${pm.result_unit === 'percent' ? '%' : ` ${pm.result_unit || ''}`})`;
      lines.push(`Production metric — ${pm.name}: ${pm.before} -> ${pm.after} ${pm.unit}${resultNote}`);
    }
  }
  if (claim.resume_variants) {
    if (claim.resume_variants.short) lines.push(`- **Short:** ${claim.resume_variants.short}`);
    lines.push(`- **Standard:** ${claim.statement}`);
    if (claim.resume_variants.technical) lines.push(`- **Technical:** ${claim.resume_variants.technical}`);
  }
  return lines;
}

function claimSection(claim, metricsById, evidenceById) {
  const lines = [`### ${claim.title || claim.id}`, ''];
  lines.push(`**Problem:** ${claim.problem || '(none)'}`);
  lines.push(`**Change:** ${claim.change || '(none)'}`);
  lines.push(`**Outcome:** ${claim.outcome || '(none)'}`);
  lines.push('');
  if (claim.candidate_id) {
    lines.push(...candidateTraceabilityLines(claim), '');
  } else {
    lines.push(`> ${claim.statement || '(no statement)'}`, '');
  }
  lines.push(`Confidence: ${claim.confidence}${claim.conflicting_evidence ? ' (conflicting evidence flagged — see Conflicting Evidence section)' : ''}`);
  lines.push('');
  if (claim.metric_ids?.length) {
    lines.push('**Metrics:**');
    for (const id of claim.metric_ids) {
      const m = metricsById.get(id);
      if (m) lines.push(metricLine(m, evidenceById));
    }
    lines.push('');
  }
  if (claim.evidence_ids?.length) {
    lines.push('**Evidence:**');
    const grouped = Object.fromEntries(PROVENANCE_ORDER.map((c) => [c, []]));
    grouped.other = [];
    for (const id of claim.evidence_ids) {
      const e = evidenceById.get(id);
      if (!e) continue;
      const bucket = PROVENANCE_LABELS[e.provenance_category] ? e.provenance_category : 'other';
      grouped[bucket].push(e);
    }
    // 'other' covers evidence written before provenance_category existed
    // (schema_version 1.0.0) — rendered as a flat, unlabeled list, exactly
    // as review-renderer.mjs did before V2.
    for (const category of PROVENANCE_ORDER) {
      if (!grouped[category].length) continue;
      lines.push(`- ${PROVENANCE_LABELS[category]}:`);
      for (const e of grouped[category]) lines.push(`  ${evidenceLine(e).slice(2)}`);
    }
    for (const e of grouped.other) lines.push(evidenceLine(e));
    lines.push('');
  }
  if (claim.limitations?.length) {
    lines.push('**Limitations:**');
    for (const l of claim.limitations) lines.push(`- ${l}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * @param {object} impactJson
 * @returns {string} review.md content.
 */
export function renderReview(impactJson) {
  const metricsById = new Map((impactJson.metrics || []).map((m) => [m.id, m]));
  const evidenceById = new Map((impactJson.evidence || []).map((e) => [e.id, e]));

  const lines = [
    '# Impact Review',
    '',
    `Run: ${impactJson.run?.id || '(unknown)'} — status: ${impactJson.run?.analysis_status || 'unknown'}`,
    `Compiler version: ${impactJson.compiler_version || '(unknown)'}`,
    '',
    '## Summary',
    '',
    `${impactJson.claims?.length || 0} claim(s), ${impactJson.metrics?.length || 0} metric(s), ${impactJson.evidence?.length || 0} evidence record(s).`,
    '',
  ];

  if (impactJson.run?.analysis_status === 'pending_llm') {
    lines.push('**Analysis is PENDING_LLM** — no Claim narrative was produced (no LLM runtime was available). Evidence and deterministic metrics below were still captured honestly.', '');
  }

  // Always rendered independent of claims — a Metric's full provenance
  // (before/after, relative change, sample counts, measurement quality,
  // attribution) must be visible even when analysis_status is
  // "pending_llm" and no Claim references it yet.
  if (impactJson.metrics?.length) {
    lines.push('## Metrics', '');
    for (const m of impactJson.metrics) lines.push(metricLine(m, evidenceById), '');
  }

  // Impact Candidates are always rendered too — even under
  // analysis_status "pending_llm", where no Claim yet references them —
  // this is the deterministic, ranked slate a provider chooses from, and
  // a reviewer should be able to see it even when no LLM ran at all.
  if (impactJson.impact_candidates?.length) {
    lines.push('## Impact Candidates', '');
    for (const c of impactJson.impact_candidates) {
      const qp = c.quality_profile || {};
      const rankPrefix = c.rank != null ? `#${c.rank}` : '(unranked)';
      const recommendedTag = c.recommended ? ', **recommended**' : '';
      const outcomeTag = c.outcome ? `, outcome: ${c.outcome}` : '';
      lines.push(`- ${rankPrefix} \`${c.id}\` — ${c.quantification_type}, ${c.impact_level}, resume_eligibility: ${qp.resume_eligibility ?? '(unknown)'}${outcomeTag}${recommendedTag}${c.combined_from ? ` (combined from ${c.combined_from.join(', ')})` : ''}`);
    }
    lines.push('');
  }

  lines.push('## Claims', '');
  for (const claim of impactJson.claims || []) lines.push(claimSection(claim, metricsById, evidenceById), '');

  // Tier 6: uncertainties and conflicts, kept as distinct sections —
  // "conflicting_evidence: true" claims are pulled out explicitly so a
  // reviewer never has to hunt through every claim to find them.
  const conflictingClaims = (impactJson.claims || []).filter((c) => c.conflicting_evidence === true);
  if (conflictingClaims.length) {
    lines.push('## Conflicting Evidence', '');
    for (const c of conflictingClaims) lines.push(`- **${c.title || c.id}**: flagged \`conflicting_evidence: true\` — investigate before relying on this claim.`);
    lines.push('');
  }

  if (impactJson.uncertainties?.length) {
    lines.push('## Uncertainties', '');
    for (const u of impactJson.uncertainties) lines.push(`- ${u}`);
    lines.push('');
  }
  if (impactJson.limitations?.length) {
    lines.push('## Limitations', '');
    for (const l of impactJson.limitations) lines.push(`- ${l}`);
    lines.push('');
  }

  // Impact Opportunities: structured gaps between what the Evidence
  // currently supports and a stronger quantified Impact
  // (src/candidates/impact-opportunities.mjs) — never a fabricated value,
  // only what's missing and what would strengthen it.
  if (impactJson.impact_opportunities?.length) {
    lines.push('## Impact Opportunities', '');
    for (const o of impactJson.impact_opportunities) {
      lines.push(`- **${o.candidate_topic}** — ${o.status}`);
      lines.push(`  - missing: ${(o.missing_evidence || []).join('; ') || '(unspecified)'}`);
      lines.push(`  - recommendation: ${o.recommended_measurement}`);
    }
    lines.push('');
  }

  lines.push('## Human Review Checklist', '');
  lines.push('- [ ] Each claim is independently defensible from its cited evidence.');
  lines.push('- [ ] No claim overstates scale or business impact beyond what the evidence shows.');
  lines.push('- [ ] Soft evidence (notes/Slack/documents) is not presented as verified outcome.');
  lines.push('- [ ] Production/observability claims state a known environment before being called "production impact".');
  lines.push('- [ ] Any `conflicting_evidence: true` claim has been investigated before use.');
  lines.push('');

  return lines.join('\n');
}
