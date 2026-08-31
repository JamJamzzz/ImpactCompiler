/**
 * measurement/stats-engine.mjs — pure statistics for repeated benchmark
 * samples. No I/O, no git, no process execution, no LLM. The only source of
 * randomness anywhere in this module is a fixed seeded PRNG used for the
 * optional bootstrap confidence interval, so every result here is exactly
 * reproducible given the same input — required for deterministic tests and
 * for never letting an LLM "decide" a statistical result.
 */

function isFiniteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }

/**
 * Percentile via linear interpolation between the two neighboring order
 * statistics — the same method as numpy's default (`interpolation='linear'`)
 * and Excel's PERCENTILE.INC. `p` is 0-100. `sorted` must already be sorted
 * ascending and non-empty.
 */
function percentileOfSorted(sorted, p) {
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const weight = idx - lo;
  return sorted[lo] * (1 - weight) + sorted[hi] * weight;
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Sample standard deviation (n-1 denominator / Bessel's correction) — the
 * conventional choice when the collected runs are a sample of a benchmark's
 * possible executions, not its entire population. With fewer than 2 samples
 * there is no way to estimate spread; this deliberately returns 0 rather
 * than NaN so callers never have to special-case NaN downstream. Count < 2
 * is instead surfaced by `classifyMeasurementQuality` returning
 * 'insufficient' — callers must not read a 0 standard_deviation on a
 * single-sample summary as "no variability", only as "not enough data to
 * know".
 */
function sampleStandardDeviation(values, avg) {
  if (values.length < 2) return 0;
  const sumSq = values.reduce((acc, v) => acc + (v - avg) ** 2, 0);
  return Math.sqrt(sumSq / (values.length - 1));
}

/**
 * @param {number[]} samples
 * @returns {object} summary stats. An empty array yields count:0 and every
 *   other field null (a valid, non-throwing result — it's the caller's job
 *   to decide what zero samples means for resolution). Any non-finite entry
 *   throws, since a NaN/Infinity sample is a bug in the caller, never a
 *   value ImpactCompiler should silently summarize.
 */
export function summarize(samples) {
  if (!Array.isArray(samples)) throw new Error('summarize: samples must be an array');
  if (samples.some((v) => !isFiniteNumber(v))) throw new Error('summarize: all samples must be finite numbers');

  if (samples.length === 0) {
    return {
      count: 0, mean: null, median: null, p50: null, p95: null, p99: null, standard_deviation: null, min: null, max: null,
    };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const avg = mean(samples);
  const median = percentileOfSorted(sorted, 50);
  return {
    count: samples.length,
    mean: avg,
    median,
    p50: median,
    p95: percentileOfSorted(sorted, 95),
    p99: percentileOfSorted(sorted, 99),
    standard_deviation: sampleStandardDeviation(samples, avg),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

/** @returns {{before:object, after:object}} */
export function computeStatistics(beforeSamples, afterSamples) {
  return { before: summarize(beforeSamples), after: summarize(afterSamples) };
}

/**
 * Deterministic, conservative measurement-quality classification. Rules
 * (documented here and exercised by tests/measurement/stats-engine.test.mjs
 * — never decided by an LLM):
 *
 *  - 'insufficient': either side has fewer than 2 samples — can't estimate
 *    spread at all, so no quality claim is possible.
 *  - 'high': both sides have >= 20 samples AND the coefficient of variation
 *    (standard_deviation / |mean|) is <= 10% on both sides.
 *  - 'medium': both sides have >= 10 samples AND CV <= 25% on both sides.
 *  - 'low': both sides have >= 2 samples but don't clear the medium bar.
 *
 * A side's CV is treated as infinite (so it can never qualify for
 * 'high'/'medium') when its mean is exactly 0, since relative variability is
 * undefined at a zero mean.
 * @param {{before:object, after:object}} statistics - from computeStatistics.
 * @returns {'high'|'medium'|'low'|'insufficient'}
 */
export function classifyMeasurementQuality({ before, after }) {
  if (!before || !after || before.count < 2 || after.count < 2) return 'insufficient';

  const cv = (s) => (s.mean !== 0 ? Math.abs(s.standard_deviation / s.mean) : Infinity);
  const maxCv = Math.max(cv(before), cv(after));
  const minCount = Math.min(before.count, after.count);

  if (minCount >= 20 && maxCv <= 0.10) return 'high';
  if (minCount >= 10 && maxCv <= 0.25) return 'medium';
  return 'low';
}

/**
 * Deterministic PRNG (mulberry32) so a "random" bootstrap resample is
 * exactly reproducible from a fixed seed — this is the only randomness in
 * ImpactCompiler's statistics, and it is never left to `Math.random()`.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 95% bootstrap percentile confidence interval on the difference between
 * resampled `after` and `before` statistics
 * (statistic(after-resample) - statistic(before-resample)), using
 * independent resampling-with-replacement on each side and a fixed seeded
 * PRNG (never Math.random) so the exact bounds are reproducible in tests.
 *
 * Requires at least `minSamples` real samples on each side; below that this
 * returns `{ok:false, reason}` rather than fabricating an interval from too
 * little data — callers must treat that as "no confidence interval
 * computed", never as "no change detected".
 *
 * `change_detected` is true only when the [lower, upper] interval excludes
 * zero — a real interval-based test, not a bare threshold comparison, and
 * this function's result must never be described as "statistically
 * significant" by any caller; it is a bootstrap interval, not a
 * significance test.
 * @param {number[]} beforeSamples
 * @param {number[]} afterSamples
 * @param {{iterations?:number, seed?:number, statistic?:'mean'|'median', minSamples?:number}} [opts]
 */
export function computeBootstrapCI(beforeSamples, afterSamples, opts = {}) {
  const {
    iterations = 2000, seed = 42, statistic = 'median', minSamples = 10,
  } = opts;

  if (beforeSamples.length < minSamples || afterSamples.length < minSamples) {
    return {
      ok: false,
      reason: `bootstrap confidence interval requires at least ${minSamples} samples per side (got before=${beforeSamples.length}, after=${afterSamples.length})`,
    };
  }

  const rand = mulberry32(seed);
  const stat = (values) => (statistic === 'mean'
    ? mean(values)
    : percentileOfSorted([...values].sort((a, b) => a - b), 50));

  const resample = (values) => {
    const out = new Array(values.length);
    for (let i = 0; i < values.length; i++) out[i] = values[Math.floor(rand() * values.length)];
    return out;
  };

  const deltas = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    deltas[i] = stat(resample(afterSamples)) - stat(resample(beforeSamples));
  }
  deltas.sort((a, b) => a - b);

  const lower = percentileOfSorted(deltas, 2.5);
  const upper = percentileOfSorted(deltas, 97.5);

  return {
    ok: true,
    lower,
    upper,
    confidence_level: 0.95,
    method: 'bootstrap_percentile',
    statistic,
    iterations,
    seed,
    change_detected: !(lower <= 0 && upper >= 0),
  };
}

export { percentileOfSorted };
