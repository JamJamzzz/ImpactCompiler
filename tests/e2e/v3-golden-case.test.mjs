// tests/e2e/v3-golden-case.test.mjs — V3 golden case exactly from the spec:
// commit + ticket + production metric (p95 latency 120s -> 31s, production,
// service customer-import). Verifies: deterministic percentage computed by
// the program; the claim may say 74.17% only because it references the
// metric id; the 100k workload figure is used only because it exists in
// the ticket; production context (environment/service/window) is
// preserved; no causality is claimed beyond the evidence.
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

const FIXTURE_DIR = join(process.cwd(), 'fixtures/customer-import');

let repoPath;
let outputDir;
let sha;

before(() => {
  repoPath = mkdtempSync(join(tmpdir(), 'impact-compiler-v3-repo-'));
  outputDir = mkdtempSync(join(tmpdir(), 'impact-compiler-v3-out-'));
  const git = (args) => execFileSync('git', ['-C', repoPath, ...args], { stdio: 'pipe' });
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  writeFileSync(join(repoPath, 'customer_import.js'), 'function importCustomers() { /* batched */ }\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'batch customer import records and add indexes']);
  sha = execFileSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
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
      const metricId = prompt.match(/"id":\s*"(metric_[a-f0-9]+)"/)?.[1];
      const evidenceIds = [...prompt.matchAll(/"id":\s*"(ev_[a-f0-9]+)"/g)].map((m) => m[1]);
      const response = JSON.stringify({
        claims: [{
          title: 'Reduced customer import latency in production',
          problem: 'Customer import jobs timed out once files exceeded roughly 100k records.',
          change: 'Batched insert calls and added two indexes used by the import query.',
          outcome: 'p95 import latency in production dropped substantially over the measured window.',
          statement: claimStatement,
          metric_ids: metricId ? [metricId] : [],
          evidence_ids: evidenceIds,
          confidence: 'high',
          conflicting_evidence: false,
        }],
        uncertainties: [],
        limitations: [],
      });
      return { rawStdout: response, executablePath: '/mock/claude' };
    },
  });
}

test('V3 golden case: commit + ticket + production metric -> deterministic 74.17%, production context preserved, no invented causality', async () => {
  const provider = mockedProvider('Reduced p95 customer import latency in production by 74.17% for 100k-record workloads, measured 2026-02-01/2026-02-07 vs. 2026-01-01/2026-01-07.');

  const artifact = await analyzeImpact({
    commits: [{ repo: repoPath, sha }],
    ticketPaths: [join(FIXTURE_DIR, 'ticket.json')],
    productionMetricPaths: [join(FIXTURE_DIR, 'production-metric.json')],
    provider,
  });

  // ---- deterministic metric, computed by the program ----
  const metric = artifact.metrics.find((m) => m.name === 'p95 request latency');
  assert.ok(metric, 'expected a deterministic metric from the production-metric fixture');
  assert.equal(metric.relative_change_percent, 74.17);
  assert.equal(metric.absolute_delta, -89);
  assert.equal(metric.calculation, '(120 - 31) / 120 * 100');

  // ---- production context preserved on the evidence record ----
  const metricEv = artifact.evidence.find((e) => e.type === 'production_metric');
  assert.equal(metricEv.environment, 'production');
  assert.equal(metricEv.service, 'customer-import');
  assert.deepEqual(metricEv.window, { before: '2026-01-01/2026-01-07', after: '2026-02-01/2026-02-07' });
  assert.deepEqual(metricEv.sample_size, { before: 1200000, after: 1400000 });
  assert.equal(metricEv.provenance_category, 'production_observability');

  // ---- the claim references the metric id, and cites the workload figure
  // only because it exists verbatim in the ticket ----
  const claim = artifact.claims[0];
  assert.ok(claim.metric_ids.includes(metric.id));
  const ticketEv = artifact.evidence.find((e) => e.type === 'ticket');
  assert.match(claim.statement, /100k/);
  assert.match(ticketEv.business_context, /100k-record workloads/);

  // ---- no causality claimed beyond available evidence: the statement
  // does not assert the deployment CAUSED the change beyond citing the
  // deterministic metric + its own measured window ----
  assert.doesNotMatch(claim.statement, /\bcaused\b|\bproves\b/i);

  // ---- Claude cannot alter the metric ----
  const { validateProviderOutputHasNoMetricFields } = await import('../../src/core/validation.mjs');
  assert.equal(validateProviderOutputHasNoMetricFields({ claims: [{ id: 'c1', relative_change_percent: 999 }] }).ok, false);

  // ---- impact.json / review.md ----
  const { impactJsonPath, reviewMdPath } = writeImpactArtifact(artifact, outputDir);
  const writtenJson = JSON.parse(readFileSync(impactJsonPath, 'utf-8'));
  const writtenReview = readFileSync(reviewMdPath, 'utf-8');
  assert.equal(writtenJson.metrics.find((m) => m.name === 'p95 request latency').relative_change_percent, 74.17);
  assert.match(writtenReview, /74\.17/);
  assert.match(writtenReview, /environment: production/);
  assert.match(writtenReview, /Production \/ observability evidence/);
});

test('a production metric with unknown environment is never described as "production impact" — prompt-level rule verified via prompt content', async () => {
  const { buildAnalysisPrompt } = await import('../../src/providers/claude-cli-provider.mjs');
  const prompt = buildAnalysisPrompt({ normalizedEvidence: [], deterministicMetrics: [], context: {} });
  assert.match(prompt, /Do not call a result "production impact" unless/);
});

test('conflicting production evidence: two production_metric records for the same name/service/window with contradictory values are both preserved, never merged or silently resolved', async () => {
  const metricA = join(outputDir, 'metric-a.json');
  const metricB = join(outputDir, 'metric-b.json');
  writeFileSync(metricA, JSON.stringify({
    name: 'p95 request latency', before: 120, after: 31, unit: 'sec', direction: 'lower_is_better', service: 'customer-import', environment: 'production',
  }));
  writeFileSync(metricB, JSON.stringify({
    name: 'p95 request latency', before: 120, after: 95, unit: 'sec', direction: 'lower_is_better', service: 'customer-import', environment: 'production',
  }));
  const provider = mockedProvider('Reduced p95 customer import latency, though two production measurements disagree on the magnitude.');
  const artifact = await analyzeImpact({ productionMetricPaths: [metricA, metricB], provider });

  const prodMetrics = artifact.metrics.filter((m) => m.name === 'p95 request latency');
  assert.equal(prodMetrics.length, 2, 'both metrics are preserved as distinct records, never merged into one');
  assert.notEqual(prodMetrics[0].relative_change_percent, prodMetrics[1].relative_change_percent);
});

test('prompt instructs no causality inferred merely because a metric changed after a deployment/commit', async () => {
  const { buildAnalysisPrompt } = await import('../../src/providers/claude-cli-provider.mjs');
  const prompt = buildAnalysisPrompt({ normalizedEvidence: [], deterministicMetrics: [], context: {} });
  assert.match(prompt, /Do not infer causality merely because a metric changed after a deployment\/commit/);
});

test('prompt instructs deployment frequency / incident count are directionally ambiguous without explicit direction', async () => {
  const { buildAnalysisPrompt } = await import('../../src/providers/claude-cli-provider.mjs');
  const prompt = buildAnalysisPrompt({ normalizedEvidence: [], deterministicMetrics: [], context: {} });
  assert.match(prompt, /deployment frequency.*incident count/i);
});

test('a log/observability record with unresolved links is not described as tied to a deployment — deterministic linking is honest', async () => {
  const logPath = join(outputDir, 'log.json');
  writeFileSync(logPath, JSON.stringify({
    source: 'exports/app.log', environment: 'production', service: 'customer-import', content: 'some log line', deployment_ref: 'deploy-does-not-exist',
  }));
  const artifact = await analyzeImpact({ logPaths: [logPath], provider: null });
  const logEv = artifact.evidence.find((e) => e.type === 'log');
  assert.equal(logEv.link_resolution, 'unresolved');
  assert.deepEqual(logEv.linked_evidence_ids, []);
  assert.equal(artifact.metrics.length, 0, 'a log never produces a metric, regardless of what it contains');
});
