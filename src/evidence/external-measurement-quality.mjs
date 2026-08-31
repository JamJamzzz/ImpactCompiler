/**
 * evidence/external-measurement-quality.mjs — deterministic classification
 * of measurement quality for EXTERNALLY-supplied benchmark evidence
 * (`benchmark_artifact`). Never decided by an LLM.
 *
 * This is a distinct classifier from
 * src/measurement/stats-engine.mjs's classifyMeasurementQuality, which
 * classifies `controlled_benchmark` evidence from raw per-run samples
 * ImpactCompiler itself collected. A `benchmark_artifact` record instead
 * carries whatever measurement-context fields its author chose to supply
 * (see evidence/benchmark-adapter.mjs's parseMeasurementContext) — this
 * module reasons about THAT, honestly, without ever inflating confidence
 * just because an artifact exists.
 *
 * Rule priority (documented and tested; core distinction:
 * 'unknown' !== 'insufficient' — 'unknown' means no quality signal was
 * supplied at all, not that the measurement is known to be weak):
 *
 *  1. `deterministic === true` (explicitly asserted by the artifact's
 *     author, e.g. a pure/boolean function has zero variance by
 *     construction) -> 'high'. Never inferred from the numbers themselves.
 *  2. `repetitions >= 5` AND at least one variance signal is present
 *     (stddev, min/max, or raw_samples) -> 'high'.
 *  3. `repetitions >= 5` with no variance signal -> 'medium' (repeated, but
 *     the actual spread is unknown).
 *  4. `repetitions >= 2` -> 'low' (some repetition, but too little to call
 *     it a strong statistical measurement).
 *  5. `repetitions === 1` -> 'low' (a single explicit external measurement
 *     — reported, but nothing about consistency).
 *  6. `verification_status === 'self_reported'` AND no repetitions/variance/
 *     determinism signal at all -> 'insufficient' (a bare, uncorroborated
 *     anecdote — the one case genuinely worse than "unknown").
 *  7. Otherwise (no repetitions, no variance signal, no determinism flag,
 *     not explicitly self-reported) -> 'unknown' — genuinely not
 *     classified. The underlying number may be completely correct; we just
 *     have no basis to grade its statistical quality.
 *
 * @param {object} evidence - a normalized `benchmark_artifact` evidence
 *   record (evidence-normalizer.mjs's normalizeBenchmarkEvidence output).
 * @returns {'high'|'medium'|'low'|'unknown'|'insufficient'}
 */
export function classifyExternalMeasurementQuality(evidence) {
  if (evidence.deterministic === true) return 'high';

  const reps = evidence.repetitions;
  const hasVariance = Boolean(evidence.stddev || evidence.min || evidence.max || evidence.raw_samples);

  if (typeof reps === 'number' && reps >= 5) return hasVariance ? 'high' : 'medium';
  if (typeof reps === 'number' && reps >= 1) return 'low';

  if (evidence.verification_status === 'self_reported' && !hasVariance) return 'insufficient';

  return 'unknown';
}
