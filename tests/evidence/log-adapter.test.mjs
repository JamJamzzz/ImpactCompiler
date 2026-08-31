import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLogArtifact } from '../../src/evidence/log-adapter.mjs';
import { normalizeLogEvidence } from '../../src/evidence/evidence-normalizer.mjs';

test('valid log artifact resolves and preserves environment/service/window', () => {
  const result = parseLogArtifact({
    source: 'exports/app-logs-2026-02-01.jsonl',
    environment: 'production',
    service: 'customer-import',
    window: { start: '2026-02-01T00:00:00Z', end: '2026-02-01T23:59:59Z' },
    content: ['2026-02-01T10:00:00Z INFO import completed in 812ms', '2026-02-01T10:01:00Z INFO import completed in 305ms'],
  }, 'x.json');

  assert.equal(result.resolution, 'resolved');
  assert.equal(result.environment, 'production');
  assert.deepEqual(result.window, { start: '2026-02-01T00:00:00Z', end: '2026-02-01T23:59:59Z' });
});

test('missing source is unresolved', () => {
  const result = parseLogArtifact({ content: 'some log line' }, 'x.json');
  assert.equal(result.resolution, 'unresolved');
});

test('missing content is unresolved', () => {
  const result = parseLogArtifact({ source: 'x.log' }, 'x.json');
  assert.equal(result.resolution, 'unresolved');
});

test('a raw log line containing numbers never produces a metric — log evidence has no metric-computation code path at all', () => {
  const parsed = parseLogArtifact({
    source: 'x.log', content: 'import went from 820ms to 310ms, a huge improvement',
  }, 'x.json');
  const evidence = normalizeLogEvidence(parsed);
  assert.equal(evidence.type, 'log');
  assert.equal(evidence.provenance_category, 'production_observability');
  assert.equal('before' in evidence, false, 'log evidence has no before/after fields at all');
  assert.equal('after' in evidence, false);
});

test('non-object artifact is unsupported', () => {
  const result = parseLogArtifact('raw text', 'x.json');
  assert.equal(result.resolution, 'unsupported');
});
