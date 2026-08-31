import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDocumentArtifact } from '../../src/evidence/document-adapter.mjs';
import { normalizeDocumentEvidence } from '../../src/evidence/evidence-normalizer.mjs';

test('valid document with raw content resolves and computes a content_hash', () => {
  const result = parseDocumentArtifact({
    source_reference: 'docs/rollout-plan.md', title: 'Rollout Plan', author: 'jane', participants: ['jane', 'bob'], doc_type: 'rollout-plan', content: 'Designed the rollout plan and coordinated the migration across the platform team.',
  }, 'x.json');
  assert.equal(result.resolution, 'resolved');
  assert.equal(typeof result.content_hash, 'string');
  assert.ok(result.content_hash.length > 0);
});

test('a document supplying only content_hash (no raw content) still resolves', () => {
  const result = parseDocumentArtifact({ source_reference: 'docs/x.md', content_hash: 'abc123deadbeef' }, 'x.json');
  assert.equal(result.resolution, 'resolved');
  assert.equal(result.content, null);
  assert.equal(result.content_hash, 'abc123deadbeef');
});

test('the computed content_hash is deterministic for identical content', () => {
  const a = parseDocumentArtifact({ source_reference: 'a.md', content: 'same text' }, 'a.json');
  const b = parseDocumentArtifact({ source_reference: 'b.md', content: 'same text' }, 'b.json');
  assert.equal(a.content_hash, b.content_hash);
});

test('missing source_reference is unresolved', () => {
  const result = parseDocumentArtifact({ content: 'x' }, 'x.json');
  assert.equal(result.resolution, 'unresolved');
});

test('missing both content and content_hash is unresolved', () => {
  const result = parseDocumentArtifact({ source_reference: 'x.md' }, 'x.json');
  assert.equal(result.resolution, 'unresolved');
});

test('non-array participants is unresolved, never coerced', () => {
  const result = parseDocumentArtifact({ source_reference: 'x.md', content: 'x', participants: 'jane' }, 'x.json');
  assert.equal(result.resolution, 'unresolved');
});

test('document evidence is soft_context', () => {
  const parsed = parseDocumentArtifact({ source_reference: 'x.md', content: 'x' }, 'x.json');
  const evidence = normalizeDocumentEvidence(parsed);
  assert.equal(evidence.provenance_category, 'soft_context');
});

test('non-object artifact is unsupported', () => {
  const result = parseDocumentArtifact(42, 'x.json');
  assert.equal(result.resolution, 'unsupported');
});
