import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkEvidence } from '../../src/evidence/evidence-linker.mjs';
import { buildImpactCandidates } from '../../src/candidates/impact-candidate-builder.mjs';

// V2 (Deep-hardening, P1): benchmark_artifact <-> git_commit provenance
// linking. Fixtures A-D per the task spec.

function commitEvidence(id, sha) {
  return {
    id, type: 'git_commit', resolution: 'resolved', sha,
  };
}

function benchmarkArtifactEvidence(overrides = {}) {
  return {
    id: 'ev_bench', type: 'benchmark_artifact', resolution: 'resolved', name: 'throughput', before: 100, after: 106.2, unit: 'ops/sec', direction: 'higher_is_better', ...overrides,
  };
}

// ---- Fixture A: benchmark linked explicitly to implementation commit ----

test('Fixture A: an explicit, resolvable revision_under_test links the benchmark to its commit', () => {
  const [linked] = linkEvidence([
    benchmarkArtifactEvidence({ revision_under_test: 'a'.repeat(40) }),
    commitEvidence('ev_commit', 'a'.repeat(40)),
  ]);
  assert.deepEqual(linked.linked_evidence_ids, ['ev_commit']);
  assert.equal(linked.link_resolution, 'resolved');
});

test('Fixture A (candidate level): a linked benchmark_artifact upgrades attribution to "moderate" -- never "strong" (that tier is reserved for controlled_benchmark\'s real automated A/B comparison, never invented for an externally-supplied before/after pair)', () => {
  const evidence = [
    { ...benchmarkArtifactEvidence(), linked_evidence_ids: ['ev_commit'] },
    commitEvidence('ev_commit', 'a'.repeat(40)),
  ];
  const metrics = [{
    id: 'metric_1', name: 'throughput', unit: 'ops/sec', operation: 'percentage_increase', direction: 'higher_is_better', calculation: '(106.2 - 100) / 100 * 100', confidence: 'high', evidence_ids: ['ev_bench'], before: 100, after: 106.2, absolute_delta: 6.2, relative_change_percent: 6.2, result: { value: 6.2, value_unit: 'percent', outcome: 'improvement' },
  }];
  const candidates = buildImpactCandidates({ evidence, metrics });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].attribution.strength, 'moderate');
  assert.equal(candidates[0].attribution.method, 'linked_before_after');
});

// ---- Fixture B: benchmark and commit both present but UNLINKED ----

test('Fixture B: a benchmark_artifact with no revision_under_test declared never links to a commit merely because one exists in the same run', () => {
  const [linked] = linkEvidence([
    benchmarkArtifactEvidence(), // no revision_under_test at all
    commitEvidence('ev_commit', 'a'.repeat(40)),
  ]);
  assert.deepEqual(linked.linked_evidence_ids, []);
  assert.equal(linked.link_resolution, 'not_applicable');
});

test('Fixture B (candidate level): an unlinked benchmark_artifact stays "weak" attribution even with a commit present in the same evidence set', () => {
  const evidence = [
    { ...benchmarkArtifactEvidence(), linked_evidence_ids: [] },
    commitEvidence('ev_commit', 'a'.repeat(40)),
  ];
  const metrics = [{
    id: 'metric_1', name: 'throughput', unit: 'ops/sec', operation: 'percentage_increase', direction: 'higher_is_better', calculation: '(106.2 - 100) / 100 * 100', confidence: 'high', evidence_ids: ['ev_bench'], before: 100, after: 106.2, absolute_delta: 6.2, relative_change_percent: 6.2, result: { value: 6.2, value_unit: 'percent', outcome: 'improvement' },
  }];
  const candidates = buildImpactCandidates({ evidence, metrics });
  assert.equal(candidates[0].attribution.strength, 'weak');
  assert.equal(candidates[0].attribution.method, 'unlinked_before_after');
});

// ---- Fixture C: ambiguous / non-exact match -- do NOT guess ----

test('Fixture C: a revision_under_test that is only a SHA PREFIX of a real commit never resolves -- exact-string match only, never fuzzy/prefix matching that could guess among multiple candidates', () => {
  const fullShaOne = 'abc123def456abc123def456abc123def456ab';
  const fullShaTwo = 'abc123fff999abc123fff999abc123fff999ab';
  const [linked] = linkEvidence([
    benchmarkArtifactEvidence({ revision_under_test: 'abc123' }), // a prefix shared by both commits below
    commitEvidence('ev_commit_one', fullShaOne),
    commitEvidence('ev_commit_two', fullShaTwo),
  ]);
  assert.deepEqual(linked.linked_evidence_ids, []);
  assert.equal(linked.link_resolution, 'unresolved', 'declared-but-unmatched must be "unresolved", never silently treated as not_applicable or guessed');
});

test('Fixture C: a revision_under_test that matches no commit at all in this run is "unresolved", never dropped', () => {
  const [linked] = linkEvidence([
    benchmarkArtifactEvidence({ revision_under_test: 'c'.repeat(40) }),
    commitEvidence('ev_commit', 'a'.repeat(40)),
  ]);
  assert.equal(linked.revision_under_test, 'c'.repeat(40), 'the declared value itself is always preserved verbatim');
  assert.deepEqual(linked.linked_evidence_ids, []);
  assert.equal(linked.link_resolution, 'unresolved');
});

// ---- Fixture D: controlled_benchmark's existing behavior is unchanged ----

test('Fixture D: controlled_benchmark\'s own pre-existing base_commit/target_commit linking behavior is unaffected by the new benchmark_artifact linking path', () => {
  const cb = {
    id: 'ev_cb', type: 'controlled_benchmark', resolution: 'resolved', base_commit: 'a'.repeat(40), target_commit: 'b'.repeat(40),
  };
  const [linked] = linkEvidence([
    cb,
    commitEvidence('ev_commit_base', 'a'.repeat(40)),
    commitEvidence('ev_commit_target', 'b'.repeat(40)),
  ]);
  assert.deepEqual(new Set(linked.linked_evidence_ids), new Set(['ev_commit_base', 'ev_commit_target']));
  assert.equal(linked.link_resolution, 'resolved');
});
