import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarize, computeStatistics, classifyMeasurementQuality, computeBootstrapCI,
} from '../../src/measurement/stats-engine.mjs';

test('mean/median/percentiles/stddev on an odd-count sample', () => {
  const s = summarize([1, 2, 3, 4, 5]);
  assert.equal(s.count, 5);
  assert.equal(s.mean, 3);
  assert.equal(s.median, 3);
  assert.equal(s.p50, 3);
  assert.equal(s.min, 1);
  assert.equal(s.max, 5);
  // sample stddev of [1..5]: sqrt(10/4) = 1.5811388300841898
  assert.ok(Math.abs(s.standard_deviation - 1.5811388300841898) < 1e-9);
});

test('mean/median on an even-count sample (interpolated median)', () => {
  const s = summarize([1, 2, 3, 4]);
  assert.equal(s.count, 4);
  assert.equal(s.mean, 2.5);
  assert.equal(s.median, 2.5);
});

test('percentile interpolation matches numpy-style linear method', () => {
  const s = summarize([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  // p95 of 10 sorted values, idx = 0.95*9 = 8.55 -> interpolate between index 8 (90) and 9 (100):
  // 90*(1-0.55) + 100*0.55 = 95.5
  assert.ok(Math.abs(s.p95 - 95.5) < 1e-9);
});

test('single-sample input: stddev is 0 (documented convention), min=max=median=value', () => {
  const s = summarize([42]);
  assert.equal(s.count, 1);
  assert.equal(s.mean, 42);
  assert.equal(s.median, 42);
  assert.equal(s.p95, 42);
  assert.equal(s.p99, 42);
  assert.equal(s.standard_deviation, 0);
  assert.equal(s.min, 42);
  assert.equal(s.max, 42);
});

test('empty array summarizes to count:0 with null fields, never throws', () => {
  const s = summarize([]);
  assert.equal(s.count, 0);
  assert.equal(s.mean, null);
  assert.equal(s.median, null);
  assert.equal(s.standard_deviation, null);
  assert.equal(s.min, null);
  assert.equal(s.max, null);
});

test('non-finite values are rejected, never silently summarized', () => {
  assert.throws(() => summarize([1, NaN, 3]));
  assert.throws(() => summarize([1, Infinity, 3]));
  assert.throws(() => summarize('not-an-array'));
});

test('computeStatistics returns both sides independently', () => {
  const stats = computeStatistics([1, 2, 3], [10, 20, 30]);
  assert.equal(stats.before.count, 3);
  assert.equal(stats.after.count, 3);
  assert.equal(stats.before.mean, 2);
  assert.equal(stats.after.mean, 20);
});

// ---- measurement-quality classification ----

test('quality is insufficient when either side has fewer than 2 samples', () => {
  const stats = computeStatistics([1], [1, 2, 3, 4, 5]);
  assert.equal(classifyMeasurementQuality(stats), 'insufficient');
});

test('quality is insufficient on an empty side', () => {
  const stats = computeStatistics([], [1, 2, 3]);
  assert.equal(classifyMeasurementQuality(stats), 'insufficient');
});

test('quality is high with >=20 low-variance samples per side', () => {
  const low = Array.from({ length: 20 }, (_, i) => 1.0 + (i % 2) * 0.001); // near-zero variance
  const stats = computeStatistics(low, low.map((v) => v / 2));
  assert.equal(classifyMeasurementQuality(stats), 'high');
});

test('quality is medium with >=10 but <20 samples and moderate variance', () => {
  const before = [1, 1.1, 0.9, 1.05, 0.95, 1.02, 0.98, 1.03, 0.97, 1.01];
  const after = [0.5, 0.55, 0.45, 0.52, 0.48, 0.51, 0.49, 0.53, 0.47, 0.5];
  const stats = computeStatistics(before, after);
  assert.equal(classifyMeasurementQuality(stats), 'medium');
});

test('quality is low with only a handful of samples', () => {
  const stats = computeStatistics([1, 1.1, 0.9], [2, 2.2, 1.8]);
  assert.equal(classifyMeasurementQuality(stats), 'low');
});

test('quality is low (not high/medium) when variance is very high, even with enough samples', () => {
  const noisy = Array.from({ length: 25 }, (_, i) => (i % 2 === 0 ? 0.1 : 100));
  const stats = computeStatistics(noisy, noisy);
  assert.equal(classifyMeasurementQuality(stats), 'low');
});

// ---- bootstrap confidence interval (deterministic, seeded) ----

test('bootstrap CI is deterministic for a fixed seed and input', () => {
  const before = Array.from({ length: 30 }, () => 1.82);
  const after = Array.from({ length: 30 }, () => 0.47);
  const ci1 = computeBootstrapCI(before, after, { seed: 42 });
  const ci2 = computeBootstrapCI(before, after, { seed: 42 });
  assert.equal(ci1.ok, true);
  assert.deepEqual(ci1, ci2);
});

test('bootstrap CI detects a real change when before/after do not overlap', () => {
  const before = Array.from({ length: 30 }, () => 1.82);
  const after = Array.from({ length: 30 }, () => 0.47);
  const ci = computeBootstrapCI(before, after);
  assert.equal(ci.ok, true);
  assert.equal(ci.change_detected, true);
  assert.ok(ci.upper < 0, 'after < before everywhere, so the after-before delta interval should be entirely negative');
});

test('bootstrap CI returns ok:false below the minimum sample size, never fabricating an interval', () => {
  const ci = computeBootstrapCI([1, 2, 3], [4, 5, 6], { minSamples: 10 });
  assert.equal(ci.ok, false);
  assert.match(ci.reason, /at least 10 samples/);
});

test('bootstrap CI does not claim change_detected when before/after samples are identical', () => {
  const values = Array.from({ length: 15 }, () => 5);
  const ci = computeBootstrapCI(values, values, { minSamples: 10 });
  assert.equal(ci.ok, true);
  assert.equal(ci.change_detected, false);
});
