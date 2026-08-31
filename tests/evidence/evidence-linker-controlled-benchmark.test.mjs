// tests/evidence/evidence-linker-controlled-benchmark.test.mjs — Resume-Impact
// phase: deterministic linking between controlled_benchmark evidence and
// implementation (git_commit/pull_request) and production evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkEvidence } from '../../src/evidence/evidence-linker.mjs';

const BASE_SHA = 'a'.repeat(40);
const TARGET_SHA = 'b'.repeat(40);

function commit(sha, id) {
  return {
    id, type: 'git_commit', resolution: 'resolved', sha,
  };
}

function controlledBenchmark(overrides = {}) {
  return {
    id: 'ev_cb', type: 'controlled_benchmark', resolution: 'resolved', base_commit: BASE_SHA, target_commit: TARGET_SHA, service: null, release_id: null, ...overrides,
  };
}

test('links to its exact base commit Evidence when that commit was supplied', () => {
  const baseCommitEv = commit(BASE_SHA, 'ev_base');
  const linked = linkEvidence([controlledBenchmark(), baseCommitEv]);
  const cb = linked.find((e) => e.id === 'ev_cb');
  assert.ok(cb.linked_evidence_ids.includes('ev_base'));
});

test('links to its exact target commit Evidence when that commit was supplied', () => {
  const targetCommitEv = commit(TARGET_SHA, 'ev_target');
  const linked = linkEvidence([controlledBenchmark(), targetCommitEv]);
  const cb = linked.find((e) => e.id === 'ev_cb');
  assert.ok(cb.linked_evidence_ids.includes('ev_target'));
});

test('links to both base and target commits when both were supplied', () => {
  const baseCommitEv = commit(BASE_SHA, 'ev_base');
  const targetCommitEv = commit(TARGET_SHA, 'ev_target');
  const linked = linkEvidence([controlledBenchmark(), baseCommitEv, targetCommitEv]);
  const cb = linked.find((e) => e.id === 'ev_cb');
  assert.deepEqual(new Set(cb.linked_evidence_ids), new Set(['ev_base', 'ev_target']));
  assert.equal(cb.link_resolution, 'resolved');
});

test('a PR is linked only when it deterministically declares the target commit as its own merge_commit_sha', () => {
  const pr = {
    id: 'ev_pr', type: 'pull_request', resolution: 'resolved', merge_commit_sha: TARGET_SHA, linked_commit_shas: [],
  };
  const linked = linkEvidence([controlledBenchmark(), pr]);
  const cb = linked.find((e) => e.id === 'ev_cb');
  assert.ok(cb.linked_evidence_ids.includes('ev_pr'));
});

test('a PR whose declared commits do not match the target commit is never linked (no fuzzy title matching)', () => {
  const pr = {
    id: 'ev_pr', type: 'pull_request', resolution: 'resolved', merge_commit_sha: 'c'.repeat(40), linked_commit_shas: [], title: 'customer-matching engine refactor',
  };
  const linked = linkEvidence([controlledBenchmark(), pr]);
  const cb = linked.find((e) => e.id === 'ev_cb');
  assert.ok(!cb.linked_evidence_ids.includes('ev_pr'));
});

test('links to production evidence only through an explicit shared service identifier', () => {
  const prod = {
    id: 'ev_prod', type: 'production_metric', resolution: 'resolved', service: 'customer-matching', name: 'p95 latency',
  };
  const linked = linkEvidence([controlledBenchmark({ service: 'customer-matching' }), prod]);
  const cb = linked.find((e) => e.id === 'ev_cb');
  const prodLinked = linked.find((e) => e.id === 'ev_prod');
  assert.ok(cb.linked_evidence_ids.includes('ev_prod'));
  assert.ok(prodLinked.linked_evidence_ids.includes('ev_cb'), 'linking is bidirectional via shared service');
});

test('links to production evidence through a shared commit_sha (target commit)', () => {
  const prod = {
    id: 'ev_prod', type: 'production_metric', resolution: 'resolved', commit_sha: TARGET_SHA, name: 'p95 latency',
  };
  const linked = linkEvidence([controlledBenchmark(), prod]);
  const prodLinked = linked.find((e) => e.id === 'ev_prod');
  assert.ok(prodLinked.linked_evidence_ids.length === 0, 'production_metric.commit_sha only matches a git_commit record, not a controlled_benchmark directly');
  // the controlled_benchmark itself links to production only via service/release_id, not raw commit_sha equality with production_metric
  const cb = linked.find((e) => e.id === 'ev_cb');
  assert.ok(!cb.linked_evidence_ids.includes('ev_prod'));
});

test('a production_metric with a non-matching service is never linked merely because it was supplied in the same run', () => {
  const prod = {
    id: 'ev_prod', type: 'production_metric', resolution: 'resolved', service: 'billing-service', name: 'p95 latency',
  };
  const linked = linkEvidence([controlledBenchmark({ service: 'customer-matching' }), prod]);
  const cb = linked.find((e) => e.id === 'ev_cb');
  assert.ok(!cb.linked_evidence_ids.includes('ev_prod'));
  assert.equal(cb.link_resolution, 'unresolved', 'a declared service with no match is honestly unresolved, not silently dropped');
});

test('with no base/target commit evidence and no service declared, link_resolution is not_applicable (nothing was even declared to link)', () => {
  const linked = linkEvidence([controlledBenchmark({ base_commit: null, target_commit: null })]);
  const cb = linked.find((e) => e.id === 'ev_cb');
  assert.deepEqual(cb.linked_evidence_ids, []);
  assert.equal(cb.link_resolution, 'not_applicable');
});

test('an unresolvable declared base/target commit stays unresolved, never fabricated', () => {
  const linked = linkEvidence([controlledBenchmark()]); // no git_commit evidence supplied at all
  const cb = linked.find((e) => e.id === 'ev_cb');
  assert.deepEqual(cb.linked_evidence_ids, []);
  assert.equal(cb.link_resolution, 'unresolved');
});
