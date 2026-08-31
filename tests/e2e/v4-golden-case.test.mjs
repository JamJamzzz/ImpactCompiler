// tests/e2e/v4-golden-case.test.mjs — V4 golden case exactly from the spec:
// commit ("introduce staged migration rollout") + document ("Designed the
// rollout plan and coordinated the migration across the platform team.").
// Verifies: the document is preserved as soft contextual evidence, no team
// size is invented, no quantified outcome is generated, confidence stays
// conservative, and the claim distinguishes implementation/context from
// verified outcome.
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

const FIXTURE_DIR = join(process.cwd(), 'fixtures/staged-rollout');

let repoPath;
let outputDir;
let sha;
let documentPath;

before(() => {
  repoPath = mkdtempSync(join(tmpdir(), 'impact-compiler-v4-repo-'));
  outputDir = mkdtempSync(join(tmpdir(), 'impact-compiler-v4-out-'));
  const git = (args) => execFileSync('git', ['-C', repoPath, ...args], { stdio: 'pipe' });
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  writeFileSync(join(repoPath, 'migration.js'), 'function migrate() { /* staged */ }\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'introduce staged migration rollout']);
  sha = execFileSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();

  const docRaw = readFileSync(join(FIXTURE_DIR, 'document.json'), 'utf-8').replaceAll('__COMMIT_SHA__', sha);
  documentPath = join(outputDir, 'document.json');
  writeFileSync(documentPath, docRaw);
});

afterAll(() => {
  rmSync(repoPath, { recursive: true, force: true });
  rmSync(outputDir, { recursive: true, force: true });
});

function mockedProvider(claimStatement) {
  return new ClaudeCliProvider({
    // pre-candidate test — opts into the strict-mode compatibility escape.
    allowLegacyCandidateResponse: true,
    invoke: (prompt) => {
      const evidenceIds = [...prompt.matchAll(/"id":\s*"(ev_[a-f0-9]+)"/g)].map((m) => m[1]);
      const response = JSON.stringify({
        claims: [{
          title: 'Introduced a staged migration rollout',
          problem: 'A migration needed to roll out safely across the platform.',
          change: 'Introduced a staged rollout across three regions, per the rollout plan.',
          outcome: 'The rollout plan was designed and the migration was coordinated across the platform team; no quantified outcome was measured for this run.',
          statement: claimStatement,
          metric_ids: [],
          evidence_ids: evidenceIds,
          confidence: 'medium',
          conflicting_evidence: false,
        }],
        uncertainties: ['No benchmark/test/production metric evidence was supplied for this run — no quantified outcome is claimed.'],
        limitations: [],
      });
      return { rawStdout: response, executablePath: '/mock/claude' };
    },
  });
}

test('V4 golden case: commit + document -> soft contextual evidence, no invented team size, no quantified outcome, conservative confidence', async () => {
  const provider = mockedProvider('Introduced a staged migration rollout, coordinated across the platform team per the rollout plan; no quantified outcome is claimed for this run.');

  const artifact = await analyzeImpact({
    commits: [{ repo: repoPath, sha }],
    documentPaths: [documentPath],
    provider,
  });

  // ---- document preserved as soft contextual evidence ----
  const docEv = artifact.evidence.find((e) => e.type === 'document');
  assert.ok(docEv, 'expected a document evidence record');
  assert.equal(docEv.provenance_category, 'soft_context');
  assert.match(docEv.content, /Designed the rollout plan and coordinated the migration/);
  assert.equal(typeof docEv.content_hash, 'string');

  // ---- deterministic linking to the commit via related_commit_sha ----
  const commitEv = artifact.evidence.find((e) => e.type === 'git_commit');
  assert.equal(docEv.link_resolution, 'resolved');
  assert.deepEqual(docEv.linked_evidence_ids, [commitEv.id]);

  // ---- no team size invented: the document never states a headcount, and
  // neither the evidence nor the claim statement fabricates one ----
  assert.doesNotMatch(docEv.content, /\d+\s*(engineers|people|members)/i);
  const claim = artifact.claims[0];
  assert.doesNotMatch(claim.statement, /\d+\s*(engineers|people|members)/i);

  // ---- no quantified outcome generated: zero metrics, no percentage cited ----
  assert.equal(artifact.metrics.length, 0);
  assert.doesNotMatch(claim.statement, /%/);
  assert.deepEqual(claim.metric_ids, []);

  // ---- confidence stays conservative (not "high") given only
  // implementation + soft-context evidence, no metric corroboration ----
  assert.notEqual(claim.confidence, 'high');

  // ---- the claim distinguishes implementation/context from verified
  // outcome: it explicitly says no quantified outcome is claimed ----
  assert.match(claim.statement, /no quantified outcome/i);

  // ---- impact.json / review.md ----
  const { impactJsonPath, reviewMdPath } = writeImpactArtifact(artifact, outputDir);
  const writtenJson = JSON.parse(readFileSync(impactJsonPath, 'utf-8'));
  const writtenReview = readFileSync(reviewMdPath, 'utf-8');
  assert.equal(writtenJson.evidence.find((e) => e.type === 'document').provenance_category, 'soft_context');
  assert.match(writtenReview, /Soft evidence \(context only/);
});

test('a self-reported statement in a document is never treated as independently verified — prompt-level rule verified via prompt content', async () => {
  const { buildAnalysisPrompt } = await import('../../src/providers/claude-cli-provider.mjs');
  const prompt = buildAnalysisPrompt({ normalizedEvidence: [], deterministicMetrics: [], context: {} });
  assert.match(prompt, /independently verified/i);
  assert.match(prompt, /infer team size, ownership, leadership scope/i);
});

test('prompt instructs no metric may be created from a number found only in note/Slack/document prose', async () => {
  const { buildAnalysisPrompt } = await import('../../src/providers/claude-cli-provider.mjs');
  const prompt = buildAnalysisPrompt({ normalizedEvidence: [], deterministicMetrics: [], context: {} });
  assert.match(prompt, /create a metric from a number that appears only in note\/Slack\/document prose/);
});

test('prompt instructs planned/proposed work must not be described as completed', async () => {
  const { buildAnalysisPrompt } = await import('../../src/providers/claude-cli-provider.mjs');
  const prompt = buildAnalysisPrompt({ normalizedEvidence: [], deterministicMetrics: [], context: {} });
  assert.match(prompt, /describe planned or proposed work.*as completed/i);
});

test('a document with no corroborating implementation/metric evidence at all produces zero metrics and low/medium confidence guidance is available in the prompt', async () => {
  const standaloneDocPath = join(outputDir, 'standalone-document.json');
  writeFileSync(standaloneDocPath, JSON.stringify({
    source_reference: 'docs/standalone.md', content: 'Led a migration and reduced manual operational burden significantly.',
  }));
  const artifact = await analyzeImpact({ documentPaths: [standaloneDocPath], provider: null });
  assert.equal(artifact.metrics.length, 0);
  const docEv = artifact.evidence.find((e) => e.type === 'document');
  assert.equal(docEv.link_resolution, 'not_applicable');
});
