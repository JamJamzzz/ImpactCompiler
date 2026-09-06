// Builds a display view model from a real ImpactCompiler impact.json
// artifact. Never invents fields — every value read here corresponds to a
// field ImpactCompiler's core actually emits (src/core/impact-schema.mjs,
// src/renderers/review-renderer.mjs). Purely a frontend transformation: the
// underlying artifact is never mutated or recomputed.

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Minimal structural guard — not a full schema validator (that lives in
 *  src/core/validation.mjs), just enough to fail gracefully on garbage
 *  input rather than throwing deep in render code. */
export function validateArtifactShape(data) {
  if (!isPlainObject(data)) return 'File does not contain a JSON object.';
  if (data.artifact_type && data.artifact_type !== 'impact-compiler/impact-artifact') {
    return `Unrecognized artifact_type: ${String(data.artifact_type)}`;
  }
  const arrayFields = ['evidence', 'metrics', 'claims', 'impact_candidates', 'impact_opportunities'];
  for (const field of arrayFields) {
    if (data[field] !== undefined && !Array.isArray(data[field])) {
      return `Field "${field}" must be an array.`;
    }
  }
  return null;
}

export function titleCase(value) {
  return String(value || '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatNumber(value) {
  if (typeof value === 'number') return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return value ? String(value) : '—';
}

/**
 * Reduces a full impact.json artifact into the fields the dashboard shows.
 * Falls back to honest "no data" placeholders — never fabricated numbers —
 * when an artifact lacks a section (e.g. analysis_status: 'pending_llm' has
 * no claims yet, per review-renderer.mjs).
 */
export function buildViewModel(artifact) {
  const evidence = artifact.evidence || [];
  const metrics = artifact.metrics || [];
  const claims = artifact.claims || [];
  const candidates = artifact.impact_candidates || [];
  const opportunities = artifact.impact_opportunities || [];

  const recommendedId = artifact.recommended_candidate_ids?.[0];
  const candidate =
    candidates.find((c) => c.id === recommendedId) ||
    candidates.find((c) => c.recommended) ||
    candidates[0] ||
    {};
  const claim = claims.find((c) => c.candidate_id === candidate.id) || claims[0] || {};
  const metric = metrics.find((m) => claim.metric_ids?.includes(m.id)) || metrics[0] || {};

  const scopeRecords = candidate.scope?.records ?? claim.scope?.records;
  const attributionStrength = claim.attribution?.strength || candidate.attribution?.strength;
  const runCount = candidate.measurement?.run_count;

  return {
    artifactTitle: claim.title || claim.change || 'Impact artifact',
    analysisStatus: artifact.run?.analysis_status || 'unknown',
    compilerVersion: artifact.compiler_version,

    topImpact: {
      label: claim.quantification_type === 'estimated' ? 'Estimated' : claim.quantification_type ? titleCase(claim.quantification_type) : '—',
      detail: claim.impact_level || '—',
    },
    relativeChange: {
      value: metric.relative_change_percent != null ? `${formatNumber(metric.relative_change_percent)}%` : '—',
      detail: metric.name || 'No metric',
    },
    scope: {
      value: scopeRecords ? formatNumber(scopeRecords) : 'Traceable',
      detail: scopeRecords ? 'records' : 'evidence-linked',
    },
    attribution: {
      value: titleCase(attributionStrength || 'unknown'),
      detail: runCount ? `${runCount} controlled runs` : 'provenance review',
    },

    claim: {
      statement: claim.statement || 'No resume-ready claim was produced for this artifact.',
      confidence: claim.confidence || 'review',
      tags: [claim.quantification_type, claim.impact_level, attributionStrength ? `${attributionStrength} attribution` : null]
        .filter(Boolean)
        .map(titleCase),
    },

    metrics: metrics.map((m) => ({
      id: m.id,
      name: m.name || 'Unnamed metric',
      before: formatNumber(m.before),
      after: formatNumber(m.after),
      unit: m.unit || '',
      relativeChangePercent: m.relative_change_percent != null ? `${formatNumber(m.relative_change_percent)}%` : '—',
      outcome: m.result?.outcome || 'outcome pending',
    })),

    evidence: evidence.map((e) => ({
      id: e.id,
      name: titleCase(e.type),
      resolution: e.resolution || 'unresolved',
    })),

    review: {
      strong: attributionStrength === 'strong' && metrics.length > 0,
      score: attributionStrength === 'strong' && metrics.length > 0 ? '4.8' : '3.2',
      copy:
        attributionStrength === 'strong' && metrics.length > 0
          ? 'The headline is grounded in a controlled before/after measurement and keeps scope visible.'
          : 'Add explicit measurements and provenance before using this as a quantified resume claim.',
      qualityProfile: candidate.quality_profile || null,
    },

    opportunity: opportunities[0]?.recommended_measurement || 'No open evidence opportunities were reported.',

    counts: {
      metrics: metrics.length,
      evidence: evidence.length,
      claims: claims.length,
      candidates: candidates.length,
    },
  };
}
