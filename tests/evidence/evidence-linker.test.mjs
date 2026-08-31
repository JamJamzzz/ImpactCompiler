import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkEvidence } from '../../src/evidence/evidence-linker.mjs';
import { normalizePrEvidence, normalizeTicketEvidence } from '../../src/evidence/evidence-normalizer.mjs';
import { parsePrArtifact } from '../../src/evidence/pr-adapter.mjs';
import { parseTicketArtifact } from '../../src/evidence/ticket-adapter.mjs';

function commitEvidence(sha) {
  return {
    id: `ev_commit_${sha}`, type: 'git_commit', resolution: 'resolved', provenance_category: 'implementation', sha,
  };
}

test('PR linked via merge_commit_sha resolves deterministically to the matching commit evidence id', () => {
  const pr = normalizePrEvidence(parsePrArtifact({ provider: 'github', pr_id: '1', merge_commit_sha: 'abc123' }, 'pr.json'));
  const commit = commitEvidence('abc123');
  const linked = linkEvidence([commit, pr]);
  const linkedPr = linked.find((e) => e.type === 'pull_request');

  assert.equal(linkedPr.link_resolution, 'resolved');
  assert.deepEqual(linkedPr.linked_evidence_ids, [commit.id]);
});

test('PR linked via linked_commit_shas (not merge_commit_sha) also resolves', () => {
  const pr = normalizePrEvidence(parsePrArtifact({ provider: 'github', pr_id: '1', linked_commit_shas: ['deadbeef'] }, 'pr.json'));
  const commit = commitEvidence('deadbeef');
  const linked = linkEvidence([commit, pr]);
  const linkedPr = linked.find((e) => e.type === 'pull_request');

  assert.equal(linkedPr.link_resolution, 'resolved');
  assert.deepEqual(linkedPr.linked_evidence_ids, [commit.id]);
});

test('PR with a declared SHA that matches nothing supplied in this run is unresolved, not silently dropped', () => {
  const pr = normalizePrEvidence(parsePrArtifact({ provider: 'github', pr_id: '1', merge_commit_sha: 'nonexistent-sha' }, 'pr.json'));
  const linked = linkEvidence([pr]);
  const linkedPr = linked[0];

  assert.equal(linkedPr.link_resolution, 'unresolved');
  assert.deepEqual(linkedPr.linked_evidence_ids, []);
  assert.equal(linkedPr.merge_commit_sha, 'nonexistent-sha', 'the declared reference itself is preserved, never dropped');
});

test('PR with no declared links at all is not_applicable, never invented', () => {
  const pr = normalizePrEvidence(parsePrArtifact({ provider: 'github', pr_id: '1' }, 'pr.json'));
  const linked = linkEvidence([pr]);
  assert.equal(linked[0].link_resolution, 'not_applicable');
});

test('ticket links to PR by pr_id and to a commit by SHA, both resolved deterministically', () => {
  const pr = normalizePrEvidence(parsePrArtifact({ provider: 'github', pr_id: '482' }, 'pr.json'));
  const commit = commitEvidence('abc123');
  const ticket = normalizeTicketEvidence(parseTicketArtifact({
    provider: 'jira', ticket_id: 'ENG-1', linked_pr_ids: ['482'], linked_commit_shas: ['abc123'],
  }, 'ticket.json'));

  const linked = linkEvidence([commit, pr, ticket]);
  const linkedTicket = linked.find((e) => e.type === 'ticket');

  assert.equal(linkedTicket.link_resolution, 'resolved');
  assert.equal(linkedTicket.linked_evidence_ids.length, 2);
  assert.ok(linkedTicket.linked_evidence_ids.includes(pr.id));
  assert.ok(linkedTicket.linked_evidence_ids.includes(commit.id));
});

test('ticket referencing a PR id not present in this run is unresolved — never inferred/fuzzy-matched', () => {
  const ticket = normalizeTicketEvidence(parseTicketArtifact({
    provider: 'jira', ticket_id: 'ENG-1', linked_pr_ids: ['999-does-not-exist'],
  }, 'ticket.json'));
  const linked = linkEvidence([ticket]);
  assert.equal(linked[0].link_resolution, 'unresolved');
  assert.deepEqual(linked[0].linked_evidence_ids, []);
});

test('ambiguous case: two commits, PR declares both, only one is actually supplied — resolves with exactly the one real match, never guesses the other', () => {
  const commit = commitEvidence('real-sha');
  const pr = normalizePrEvidence(parsePrArtifact({
    provider: 'github', pr_id: '1', linked_commit_shas: ['real-sha', 'phantom-sha'],
  }, 'pr.json'));
  const linked = linkEvidence([commit, pr]);
  const linkedPr = linked.find((e) => e.type === 'pull_request');

  assert.equal(linkedPr.link_resolution, 'resolved', 'at least one real match makes the overall link "resolved"');
  assert.deepEqual(linkedPr.linked_evidence_ids, [commit.id], 'only the real match is linked — the phantom SHA is not invented into a link');
});

test('non-PR/ticket evidence (a commit) passes through linkEvidence completely unchanged', () => {
  const commit = commitEvidence('abc123');
  const linked = linkEvidence([commit]);
  assert.deepEqual(linked[0], commit);
});

test('linkEvidence never mutates its input array/records', () => {
  const commit = commitEvidence('abc123');
  const pr = normalizePrEvidence(parsePrArtifact({ provider: 'github', pr_id: '1', merge_commit_sha: 'abc123' }, 'pr.json'));
  const before = JSON.stringify([commit, pr]);
  linkEvidence([commit, pr]);
  assert.equal(JSON.stringify([commit, pr]), before);
});
