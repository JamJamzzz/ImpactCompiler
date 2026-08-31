// tests/e2e/v2-golden-case.test.mjs — V2 golden case: ticket + PR + commit +
// benchmark, exactly the fixtures/customer-import/ scenario from the V2
// spec. fixtures/customer-import/pr.json's merge_commit_sha/linked_commit_shas
// use a "__COMMIT_SHA__" placeholder since a real SHA can't be static —
// this test substitutes the real SHA from a real temp git repo at runtime
// and writes a temp copy, so the fixture file itself stays a faithful,
// literal example of the canonical PR input format.
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
import { SUPPORTED_SCHEMA_VERSIONS } from '../../src/core/impact-schema.mjs';

const FIXTURE_DIR = join(process.cwd(), 'fixtures/customer-import');

let repoPath;
let outputDir;
let sha;
let prPath;

before(() => {
  repoPath = mkdtempSync(join(tmpdir(), 'impact-compiler-v2-repo-'));
  outputDir = mkdtempSync(join(tmpdir(), 'impact-compiler-v2-out-'));
  const git = (args) => execFileSync('git', ['-C', repoPath, ...args], { stdio: 'pipe' });
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  writeFileSync(join(repoPath, 'customer_import.js'), 'function importCustomers() { /* batched */ }\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'batch customer import records and add indexes']);
  sha = execFileSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();

  const prRaw = readFileSync(join(FIXTURE_DIR, 'pr.json'), 'utf-8').replaceAll('__COMMIT_SHA__', sha);
  prPath = join(outputDir, 'pr.json');
  writeFileSync(prPath, prRaw);
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
          title: 'Faster large customer imports via batching and indexing',
          problem: 'Customer import jobs timed out once files exceeded roughly 100k records, blocking enterprise onboarding.',
          change: 'Batched insert calls and added two indexes used by the import query.',
          outcome: 'Large customer imports now complete well within the timeout window.',
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

test('V2 golden case: ticket + merged PR + commit + benchmark -> deterministic 74.17% reduction, correctly provenanced', async () => {
  const provider = mockedProvider('Reduced large customer import latency by 74.17% for 100k-record workloads.');

  const artifact = await analyzeImpact({
    commits: [{ repo: repoPath, sha }],
    benchmarkPaths: [join(FIXTURE_DIR, 'benchmark.json')],
    prPaths: [prPath],
    ticketPaths: [join(FIXTURE_DIR, 'ticket.json')],
    provider,
  });

  // ---- deterministic metric, unaffected by PR/ticket context ----
  const metric = artifact.metrics.find((m) => m.name.includes('customer import'));
  assert.ok(metric, 'expected a deterministic metric from the benchmark fixture');
  assert.equal(metric.relative_change_percent, 74.17);
  assert.equal(metric.absolute_delta, -89);
  assert.equal(metric.calculation, '(120 - 31) / 120 * 100');

  // ---- evidence provenance: implementation / intent_context / metric, never merged ----
  const commitEv = artifact.evidence.find((e) => e.type === 'git_commit');
  const prEv = artifact.evidence.find((e) => e.type === 'pull_request');
  const ticketEv = artifact.evidence.find((e) => e.type === 'ticket');
  const benchmarkEv = artifact.evidence.find((e) => e.type === 'benchmark_artifact');

  assert.equal(commitEv.provenance_category, 'implementation');
  assert.equal(prEv.provenance_category, 'implementation');
  assert.equal(ticketEv.provenance_category, 'intent_context');
  assert.equal(benchmarkEv.provenance_category, 'metric');
  assert.notEqual(ticketEv.title, prEv.title, 'ticket and PR evidence are kept as distinct records, never merged into one');

  // ---- deterministic linking: PR -> commit (merge_commit_sha), ticket -> PR (linked_pr_ids) ----
  assert.equal(prEv.link_resolution, 'resolved');
  assert.deepEqual(prEv.linked_evidence_ids, [commitEv.id]);
  assert.equal(ticketEv.link_resolution, 'resolved');
  assert.deepEqual(ticketEv.linked_evidence_ids, [prEv.id]);

  // ---- merged state honestly recorded ----
  assert.equal(prEv.merged, true);

  // ---- the claim references the correct metric/evidence ids ----
  const claim = artifact.claims[0];
  assert.ok(claim.metric_ids.includes(metric.id));
  assert.ok(claim.evidence_ids.includes(ticketEv.id));
  assert.ok(claim.evidence_ids.includes(prEv.id));
  assert.ok(claim.evidence_ids.includes(commitEv.id));
  assert.ok(claim.evidence_ids.includes(benchmarkEv.id));

  // ---- ticket context appears only as provenance-backed context: the
  // workload figure ("100k") the claim cites is present verbatim in the
  // ticket evidence, not invented ----
  assert.match(claim.statement, /100k/);
  assert.match(ticketEv.business_context, /100k-record workloads/);

  // ---- Claude cannot alter the metric: same structural guard as V1,
  // exercised here with real PR/ticket evidence present in the prompt too ----
  const { validateProviderOutputHasNoMetricFields } = await import('../../src/core/validation.mjs');
  const tamperAttempt = { claims: [{ id: 'c1', relative_change_percent: 999 }] };
  assert.equal(validateProviderOutputHasNoMetricFields(tamperAttempt).ok, false);

  // ---- impact.json / review.md ----
  const { impactJsonPath, reviewMdPath } = writeImpactArtifact(artifact, outputDir);
  const writtenJson = JSON.parse(readFileSync(impactJsonPath, 'utf-8'));
  const writtenReview = readFileSync(reviewMdPath, 'utf-8');

  assert.ok(SUPPORTED_SCHEMA_VERSIONS.includes(writtenJson.schema_version), `schema_version "${writtenJson.schema_version}" should be a currently-supported version`);
  assert.equal(writtenJson.metrics.find((m) => m.name.includes('customer import')).relative_change_percent, 74.17);
  assert.match(writtenReview, /74\.17/);
  assert.match(writtenReview, /Implementation evidence \(what changed\)/);
  assert.match(writtenReview, /Intent \/ context evidence \(why it existed\)/);
  assert.match(writtenReview, /Deterministic benchmark\/test evidence/);
});

test('unmerged PR: honestly recorded as merged:false, not linked to a claim that describes it as shipped', async () => {
  const unmergedPrPath = join(outputDir, 'pr-unmerged.json');
  const prRaw = JSON.parse(readFileSync(prPath, 'utf-8'));
  writeFileSync(unmergedPrPath, JSON.stringify({ ...prRaw, merged: false, merge_commit_sha: null, linked_commit_shas: [] }));

  const provider = mockedProvider('A proposed change to batch customer import inserts and add supporting indexes is under review and has not been merged.');
  const artifact = await analyzeImpact({
    commits: [], benchmarkPaths: [], prPaths: [unmergedPrPath], ticketPaths: [], provider,
  });

  const prEv = artifact.evidence.find((e) => e.type === 'pull_request');
  assert.equal(prEv.merged, false);
  assert.equal(prEv.link_resolution, 'not_applicable', 'no commit evidence supplied in this run, and links were cleared — correctly not_applicable, never invented');
  assert.doesNotMatch(
    artifact.claims[0].statement,
    /\b(is shipped|has shipped|shipped to production|deployed to production|now live|released to users|in production)\b/i,
    'the mocked compliant response does not affirmatively describe unmerged work as shipped/deployed',
  );
});

test('PR context without corroborating benchmark evidence produces zero metrics — no fabricated performance claim', async () => {
  const provider = mockedProvider('Batched customer import inserts and added supporting indexes.');
  const artifact = await analyzeImpact({
    commits: [{ repo: repoPath, sha }], benchmarkPaths: [], prPaths: [prPath], ticketPaths: [], provider,
  });
  assert.equal(artifact.metrics.length, 0, 'no benchmark evidence was supplied, so no metric exists to cite');
  assert.doesNotMatch(artifact.claims[0].statement, /%/, 'no percentage is fabricated absent metric evidence');
});

test('ticket context without implementation evidence: intent/context only, no outcome fabricated', async () => {
  const provider = mockedProvider('Ticket ENG-4821 describes a timeout affecting 100k-record customer imports; no implementation evidence was supplied for this run.');
  const artifact = await analyzeImpact({
    commits: [], benchmarkPaths: [], prPaths: [], ticketPaths: [join(FIXTURE_DIR, 'ticket.json')], provider,
  });
  const ticketEv = artifact.evidence.find((e) => e.type === 'ticket');
  assert.equal(ticketEv.provenance_category, 'intent_context');
  assert.equal(artifact.metrics.length, 0);
  assert.doesNotMatch(artifact.claims[0].statement, /\bresolved\b|\bfixed\b|\bcompletes without timing out\b/i, 'the mocked compliant response does not claim the ticket\'s described outcome actually happened');
});
