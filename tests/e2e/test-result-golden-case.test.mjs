// tests/e2e/test-result-golden-case.test.mjs — V2 P1: first-class
// test_result evidence. Confirms a plain "N/N passed" fact contributes a
// real, inspectable, citable evidence record to the artifact but NEVER, by
// itself, produces a Metric or an Impact Candidate — "N/N passed" is
// evidence/context only, never automatically an improvement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeImpact } from '../../src/core/impact-compiler.mjs';

let outputDir;

test('a test_result artifact alone contributes evidence[] but zero metrics and zero impact_candidates', async () => {
  outputDir = mkdtempSync(join(tmpdir(), 'impact-compiler-test-result-'));
  try {
    const path = join(outputDir, 'tests.json');
    writeFileSync(path, JSON.stringify({
      suite_name: 'proj3 functional correctness suite', passed: 41, total: 41, deterministic: true, verification_status: 'verified',
    }));

    const artifact = await analyzeImpact({ testResultPaths: [path], provider: null });

    const ev = artifact.evidence.find((e) => e.type === 'test_result');
    assert.ok(ev, 'expected a test_result evidence record');
    assert.equal(ev.resolution, 'resolved');
    assert.equal(ev.provenance_category, 'metric');
    assert.equal(ev.passed, 41);
    assert.equal(ev.total, 41);

    assert.equal(artifact.metrics.length, 0, 'a bare pass/total count never computes a Metric — there is no before/after');
    assert.equal(artifact.impact_candidates.length, 0, 'no measurement evidence exists, so no Impact Candidate can be built');
    assert.equal(artifact.limitations.length, 0, 'a fully resolved test_result produces no limitation');
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('an unresolved test_result artifact (missing passed/total) is preserved as evidence with an honest limitation, never dropped or fabricated', async () => {
  outputDir = mkdtempSync(join(tmpdir(), 'impact-compiler-test-result-bad-'));
  try {
    const path = join(outputDir, 'tests.json');
    writeFileSync(path, JSON.stringify({ suite_name: 'incomplete suite report' }));

    const artifact = await analyzeImpact({ testResultPaths: [path], provider: null });

    const ev = artifact.evidence.find((e) => e.type === 'test_result');
    assert.ok(ev);
    assert.equal(ev.resolution, 'unresolved');
    assert.equal(artifact.metrics.length, 0);
    assert.equal(artifact.impact_candidates.length, 0);
    assert.ok(artifact.limitations.some((l) => l.includes('test result') && l.includes(path)));
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('a test_result alongside a REAL before/after benchmark still only produces a candidate from the benchmark — test_result is never picked up as a measurement source', async () => {
  outputDir = mkdtempSync(join(tmpdir(), 'impact-compiler-test-result-mixed-'));
  try {
    const testResultPath = join(outputDir, 'tests.json');
    writeFileSync(testResultPath, JSON.stringify({ suite_name: 'proj2 tests', passed: 41, total: 41 }));
    const benchmarkPath = join(outputDir, 'benchmark.json');
    writeFileSync(benchmarkPath, JSON.stringify({
      name: 'proj2 matrix multiply', before: 12.4, after: 6.2, unit: 'sec', direction: 'lower_is_better',
    }));

    const artifact = await analyzeImpact({ testResultPaths: [testResultPath], benchmarkPaths: [benchmarkPath], provider: null });

    assert.equal(artifact.metrics.length, 1, 'exactly one Metric, from the benchmark_artifact — test_result contributes none');
    assert.equal(artifact.impact_candidates.length, 1, 'exactly one Impact Candidate, from the benchmark measurement');
    const candidate = artifact.impact_candidates[0];
    assert.equal(candidate.measurement_evidence_ids.length, 1);
    const measurementEv = artifact.evidence.find((e) => e.id === candidate.measurement_evidence_ids[0]);
    assert.equal(measurementEv.type, 'benchmark_artifact', 'the candidate\'s measurement evidence is the benchmark, never the test_result');
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});
