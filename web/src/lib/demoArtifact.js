// Realistic demo artifact shown before a real impact.json is loaded.
// Shape mirrors actual ImpactCompiler output (src/core/impact-schema.mjs) —
// every field used here is a real field this compiler produces.
export const demoArtifact = {
  schema_version: '5.0.0',
  artifact_type: 'impact-compiler/impact-artifact',
  compiler_version: '5.0.0',
  run: { id: 'run_demo_001', started_at: '2026-08-14T10:02:00Z', analysis_status: 'analyzed' },
  evidence: [
    { id: 'ev_benchmark', type: 'controlled_benchmark', resolution: 'resolved', measurement_quality: 'high', provenance_category: 'metric' },
    { id: 'ev_commit', type: 'git_commit', resolution: 'resolved', provenance_category: 'implementation' },
    { id: 'ev_scope', type: 'benchmark_artifact', resolution: 'resolved', provenance_category: 'metric' },
  ],
  metrics: [
    {
      id: 'metric_batch_time',
      name: 'Batch processing time',
      before: 1.82,
      after: 0.47,
      unit: 'sec',
      operation: 'percentage_reduction',
      direction: 'lower_is_better',
      relative_change_percent: 74.18,
      confidence: 'high',
      evidence_ids: ['ev_benchmark', 'ev_commit'],
      result: { outcome: 'improvement' },
    },
  ],
  impact_candidates: [
    {
      id: 'cand_batch_time',
      quantification_type: 'measured',
      impact_level: 'L2',
      metric_ids: ['metric_batch_time'],
      evidence_ids: ['ev_benchmark', 'ev_commit', 'ev_scope'],
      quality_profile: {
        evidence_strength: 'high',
        measurement_quality: 'high',
        attribution_strength: 'strong',
        scope_completeness: 'complete',
        resume_eligibility: 'strong',
      },
      attribution: { strength: 'strong' },
      measurement: { run_count: 30 },
      scope: { records: 1000000 },
      recommended: true,
      rank: 1,
    },
  ],
  claims: [
    {
      id: 'claim_batch_time',
      title: 'Customer matching engine batch time',
      problem: 'Batch customer-matching runs took over a second per million-record pass, gating downstream jobs.',
      change: 'Refactored the customer-matching engine’s core comparison loop.',
      outcome: 'Reduced processing time across a one-million-record dataset.',
      statement: 'Refactored the customer-matching engine, reducing processing time across a one-million-record dataset from 1.82s to 0.47s, a 74.18% reduction.',
      confidence: 'high',
      quantification_type: 'measured',
      impact_level: 'L2',
      candidate_id: 'cand_batch_time',
      metric_ids: ['metric_batch_time'],
      evidence_ids: ['ev_benchmark', 'ev_commit', 'ev_scope'],
      attribution: { strength: 'strong' },
      scope: { records: 1000000 },
      resume_variants: {
        short: 'Optimized the customer-matching engine, reducing processing time by 74.18% across a one-million-record dataset.',
        technical: 'Refactored the customer-matching engine and, across 30 controlled runs on a one-million-record dataset, reduced median processing time from 1.82s to 0.47s, a 74.18% reduction.',
      },
    },
  ],
  impact_opportunities: [
    {
      candidate_topic: 'Customer matching engine batch time',
      status: 'open',
      missing_evidence: ['production observation window'],
      recommended_measurement: 'Add a production observation window to corroborate the benchmark.',
    },
  ],
  uncertainties: [],
  limitations: [],
};
