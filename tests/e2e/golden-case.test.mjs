import { test, before, after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, writeFileSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeImpact, writeImpactArtifact } from '../../src/core/impact-compiler.mjs';
import { ClaudeCliProvider } from '../../src/providers/claude-cli-provider.mjs';

let repoPath;
let outputDir;
let sha;

before(() => {
  repoPath = mkdtempSync(join(tmpdir(), 'impact-compiler-e2e-repo-'));
  outputDir = mkdtempSync(join(tmpdir(), 'impact-compiler-e2e-out-'));
  const git = (args) => execFileSync('git', ['-C', repoPath, ...args], { stdio: 'pipe' });
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  writeFileSync(join(repoPath, 'match.js'), 'function match() { /* O(n^2) */ }\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'replace O(n^2) matching logic with a hash-based lookup']);
  sha = execFileSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
});

afterAll(() => {
  rmSync(repoPath, { recursive: true, force: true });
  rmSync(outputDir, { recursive: true, force: true });
});

test('golden case end-to-end: commit + benchmark fixture -> 74.18% reduction, referenced not recomputed', async () => {
  const mockResponse = JSON.stringify({
    claims: [{
      title: 'Faster matching via hash-based lookup',
      problem: 'Matching used an O(n^2) algorithm that was slow at scale.',
      change: 'Replaced the matching logic with a hash-based lookup.',
      outcome: 'Matching runtime dropped substantially.',
      statement: 'Replacing the O(n^2) matching logic with a hash-based lookup produced a 74.18% reduction in matching runtime.',
      metric_ids: ['__METRIC_ID__'],
      evidence_ids: ['__EVIDENCE_ID__'],
      confidence: 'high',
      conflicting_evidence: false,
    }],
    uncertainties: [],
    limitations: [],
  });

  const provider = new ClaudeCliProvider({
    // The strict-by-default candidate contract (see
    // tests/providers/claude-cli-provider-candidates.test.mjs) rejects a
    // legacy flat-claim response unless explicitly opted in — this test
    // predates Impact Candidates entirely and asserts the pre-candidate
    // claim shape/prompt content, so it opts in deliberately.
    allowLegacyCandidateResponse: true,
    invoke: (prompt) => {
      // Extract the real generated metric/evidence ids from the prompt so
      // the mocked response references IDs that actually exist — a real
      // Claude CLI response would do the same by reading the supplied context.
      const metricIdMatch = prompt.match(/"id":\s*"(metric_[a-f0-9]+)"/);
      const evidenceIdMatch = prompt.match(/"id":\s*"(ev_[a-f0-9]+)"/);
      const response = mockResponse
        .replace('__METRIC_ID__', metricIdMatch[1])
        .replace('__EVIDENCE_ID__', evidenceIdMatch[1]);
      return { rawStdout: response, executablePath: '/mock/claude' };
    },
  });

  const artifact = await analyzeImpact({
    commits: [{ repo: repoPath, sha }],
    benchmarkPaths: [join(process.cwd(), 'fixtures/matching-runtime/benchmark.json')],
    testArtifactPaths: [],
    provider,
  });

  assert.equal(artifact.run.analysis_status, 'analyzed');
  const metric = artifact.metrics.find((m) => m.name === 'matching runtime');
  assert.ok(metric, 'expected a computed metric for the benchmark fixture');
  assert.equal(metric.relative_change_percent, 74.18);
  assert.equal(metric.absolute_delta, -1.35);
  assert.equal(metric.calculation, '(1.82 - 0.47) / 1.82 * 100');

  assert.equal(artifact.claims.length, 1);
  assert.equal(artifact.claims[0].metric_ids[0], metric.id);
  assert.match(artifact.claims[0].statement, /74\.18/);

  const { impactJsonPath, reviewMdPath } = writeImpactArtifact(artifact, outputDir);
  const writtenJson = JSON.parse(readFileSync(impactJsonPath, 'utf-8'));
  const writtenReview = readFileSync(reviewMdPath, 'utf-8');

  assert.equal(writtenJson.metrics.find((m) => m.name === 'matching runtime').relative_change_percent, 74.18);
  assert.match(writtenReview, /74\.18/);
  assert.match(writtenReview, /1\.82 -> 0\.47/);
});

test('golden case without a provider: honest pending_llm, no fabricated claim', async () => {
  const artifact = await analyzeImpact({
    commits: [{ repo: repoPath, sha }],
    benchmarkPaths: [join(process.cwd(), 'fixtures/matching-runtime/benchmark.json')],
    testArtifactPaths: [],
    provider: null,
  });
  assert.equal(artifact.run.analysis_status, 'pending_llm');
  assert.equal(artifact.claims.length, 0);
  const metric = artifact.metrics.find((m) => m.name === 'matching runtime');
  assert.equal(metric.relative_change_percent, 74.18, 'deterministic metrics are still computed even with no LLM available');
});
