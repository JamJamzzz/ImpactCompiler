// tests/evidence/evidence-linker-v3v4.test.mjs — V3/V4 deterministic
// linking: log/observability -> commit/release, production_metric/log/
// observability same-service grouping, note/document -> ticket/PR/commit,
// Slack -> ticket/PR (incident id has no modeled target, stays honest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkEvidence } from '../../src/evidence/evidence-linker.mjs';
import {
  normalizeLogEvidence, normalizeObservabilityEvidence, normalizeProductionMetricEvidence,
  normalizeNoteEvidence, normalizeDocumentEvidence, normalizeSlackEvidence,
} from '../../src/evidence/evidence-normalizer.mjs';
import { parseLogArtifact } from '../../src/evidence/log-adapter.mjs';
import { parseObservabilityArtifact } from '../../src/evidence/observability-adapter.mjs';
import { parseProductionMetricArtifact } from '../../src/evidence/production-metric-adapter.mjs';
import { parseNoteArtifact } from '../../src/evidence/note-adapter.mjs';
import { parseDocumentArtifact } from '../../src/evidence/document-adapter.mjs';
import { parseSlackArtifact } from '../../src/evidence/slack-adapter.mjs';
import { parsePrArtifact } from '../../src/evidence/pr-adapter.mjs';
import { parseTicketArtifact } from '../../src/evidence/ticket-adapter.mjs';
import { normalizePrEvidence, normalizeTicketEvidence } from '../../src/evidence/evidence-normalizer.mjs';

function commitEvidence(sha) {
  return {
    id: `ev_commit_${sha}`, type: 'git_commit', resolution: 'resolved', provenance_category: 'implementation', sha,
  };
}

test('log evidence links to a commit via commit_sha', () => {
  const log = normalizeLogEvidence(parseLogArtifact({ source: 'x.log', content: 'x', commit_sha: 'abc123' }, 'x.json'));
  const commit = commitEvidence('abc123');
  const linked = linkEvidence([commit, log]);
  const linkedLog = linked.find((e) => e.type === 'log');
  assert.equal(linkedLog.link_resolution, 'resolved');
  assert.deepEqual(linkedLog.linked_evidence_ids, [commit.id]);
});

test('log with a deployment_ref not matching anything supplied is unresolved, never invented', () => {
  const log = normalizeLogEvidence(parseLogArtifact({ source: 'x.log', content: 'x', deployment_ref: 'deploy-999' }, 'x.json'));
  const linked = linkEvidence([log]);
  assert.equal(linked[0].link_resolution, 'unresolved');
  assert.deepEqual(linked[0].linked_evidence_ids, []);
});

test('observability artifact links to a matching release_id declared by a log deployment_ref', () => {
  const observability = normalizeObservabilityEvidence(parseObservabilityArtifact({
    provider: 'grafana', title: 'dash', release_id: 'rel-482',
  }, 'x.json'));
  const log = normalizeLogEvidence(parseLogArtifact({ source: 'x.log', content: 'x', deployment_ref: 'rel-482' }, 'x.json'));
  const linked = linkEvidence([observability, log]);
  const linkedLog = linked.find((e) => e.type === 'log');
  assert.equal(linkedLog.link_resolution, 'resolved');
  assert.deepEqual(linkedLog.linked_evidence_ids, [observability.id]);
});

test('production_metric, log, and observability_artifact sharing the same "service" are linked to each other (explicit shared identifier, not inference)', () => {
  const metric = normalizeProductionMetricEvidence(parseProductionMetricArtifact({
    name: 'p95 latency', before: 1, after: 2, unit: 'ms', direction: 'lower_is_better', service: 'customer-import',
  }, 'x.json'));
  const log = normalizeLogEvidence(parseLogArtifact({ source: 'x.log', content: 'x', service: 'customer-import' }, 'x.json'));
  const unrelated = normalizeProductionMetricEvidence(parseProductionMetricArtifact({
    name: 'error rate', before: 1, after: 2, unit: 'percent', direction: 'lower_is_better', service: 'unrelated-service',
  }, 'y.json'));

  const linked = linkEvidence([metric, log, unrelated]);
  const linkedMetric = linked.find((e) => e.id === metric.id);
  const linkedLog = linked.find((e) => e.id === log.id);
  const linkedUnrelated = linked.find((e) => e.id === unrelated.id);

  assert.ok(linkedMetric.linked_evidence_ids.includes(log.id));
  assert.ok(linkedLog.linked_evidence_ids.includes(metric.id));
  assert.equal(linkedMetric.linked_evidence_ids.includes(unrelated.id), false, 'a different service is never linked');
  assert.equal(linkedUnrelated.link_resolution, 'unresolved', 'declares a service but nothing else in this run shares it — no match invented');
});

test('production_metric with a service value but no other matching-service evidence is unresolved, never invented', () => {
  const metric = normalizeProductionMetricEvidence(parseProductionMetricArtifact({
    name: 'p95 latency', before: 1, after: 2, unit: 'ms', direction: 'lower_is_better', service: 'lonely-service',
  }, 'x.json'));
  const linked = linkEvidence([metric]);
  assert.equal(linked[0].link_resolution, 'unresolved');
  assert.deepEqual(linked[0].linked_evidence_ids, []);
});

test('production_metric with no service at all is not_applicable', () => {
  const metric = normalizeProductionMetricEvidence(parseProductionMetricArtifact({
    name: 'p95 latency', before: 1, after: 2, unit: 'ms', direction: 'lower_is_better',
  }, 'x.json'));
  const linked = linkEvidence([metric]);
  assert.equal(linked[0].link_resolution, 'not_applicable');
});

test('note links to a ticket and a commit via related_ticket_id/related_commit_sha', () => {
  const ticket = normalizeTicketEvidence(parseTicketArtifact({ provider: 'jira', ticket_id: 'ENG-1' }, 'x.json'));
  const commit = commitEvidence('abc123');
  const note = normalizeNoteEvidence(parseNoteArtifact({
    source_reference: 'n.md', content: 'x', related_ticket_id: 'ENG-1', related_commit_sha: 'abc123',
  }, 'x.json'));
  const linked = linkEvidence([ticket, commit, note]);
  const linkedNote = linked.find((e) => e.type === 'note');
  assert.equal(linkedNote.link_resolution, 'resolved');
  assert.equal(linkedNote.linked_evidence_ids.length, 2);
});

test('document links to a PR via related_pr_id', () => {
  const pr = normalizePrEvidence(parsePrArtifact({ provider: 'github', pr_id: '482' }, 'x.json'));
  const doc = normalizeDocumentEvidence(parseDocumentArtifact({
    source_reference: 'd.md', content: 'x', related_pr_id: '482',
  }, 'x.json'));
  const linked = linkEvidence([pr, doc]);
  const linkedDoc = linked.find((e) => e.type === 'document');
  assert.equal(linkedDoc.link_resolution, 'resolved');
  assert.deepEqual(linkedDoc.linked_evidence_ids, [pr.id]);
});

test('Slack message links to a ticket via related_ticket_id', () => {
  const ticket = normalizeTicketEvidence(parseTicketArtifact({ provider: 'jira', ticket_id: 'ENG-1' }, 'x.json'));
  const slack = normalizeSlackEvidence(parseSlackArtifact({ channel: '#eng', content: 'x', related_ticket_id: 'ENG-1' }, 'x.json'));
  const linked = linkEvidence([ticket, slack]);
  const linkedSlack = linked.find((e) => e.type === 'slack_message');
  assert.equal(linkedSlack.link_resolution, 'resolved');
});

test('Slack message with only a related_incident_id (no modeled incident evidence type) stays honestly unresolved, never invented', () => {
  const slack = normalizeSlackEvidence(parseSlackArtifact({ channel: '#eng', content: 'x', related_incident_id: 'INC-1' }, 'x.json'));
  const linked = linkEvidence([slack]);
  assert.equal(linked[0].link_resolution, 'unresolved');
  assert.deepEqual(linked[0].linked_evidence_ids, []);
  assert.equal(linked[0].related_incident_id, 'INC-1', 'the declared incident id is still preserved, never dropped');
});

test('note/document/slack with no declared links at all are not_applicable', () => {
  const note = normalizeNoteEvidence(parseNoteArtifact({ source_reference: 'n.md', content: 'x' }, 'x.json'));
  const linked = linkEvidence([note]);
  assert.equal(linked[0].link_resolution, 'not_applicable');
});
