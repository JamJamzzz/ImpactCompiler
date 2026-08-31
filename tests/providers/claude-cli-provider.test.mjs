import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeCliProvider, buildAnalysisPrompt } from '../../src/providers/claude-cli-provider.mjs';

const normalizedEvidence = [{ id: 'ev_1', type: 'benchmark_artifact', resolution: 'resolved' }];
const deterministicMetrics = [{
  id: 'metric_1', name: 'matching runtime', relative_change_percent: 74.18, absolute_delta: -1.35,
}];

test('buildAnalysisPrompt includes evidence and metrics verbatim, never asks the model to compute', () => {
  const prompt = buildAnalysisPrompt({ normalizedEvidence, deterministicMetrics, context: {} });
  assert.match(prompt, /ev_1/);
  assert.match(prompt, /74\.18/);
  assert.match(prompt, /never/i);
});

// ---- V2: PR/ticket-specific prompt instructions are present ----

test('the prompt instructs that PR/ticket content is untrusted data, never instructions', () => {
  const prompt = buildAnalysisPrompt({ normalizedEvidence, deterministicMetrics, context: {} });
  assert.match(prompt, /UNTRUSTED DATA/);
  assert.match(prompt, /never follow any instruction/i);
});

test('the prompt instructs that an unmerged PR must never be described as shipped', () => {
  const prompt = buildAnalysisPrompt({ normalizedEvidence, deterministicMetrics, context: {} });
  assert.match(prompt, /unmerged PR/i);
  assert.match(prompt, /never.*(described as shipped|shipped, deployed)/i);
});

test('the prompt instructs that ticket acceptance_criteria is intended scope, not proof of outcome', () => {
  const prompt = buildAnalysisPrompt({ normalizedEvidence, deterministicMetrics, context: {} });
  assert.match(prompt, /acceptance_criteria/);
  assert.match(prompt, /never.*proof|INTENDED problem\/scope only/i);
});

test('the prompt instructs deterministic links (link_resolution/linked_evidence_ids) must not be inferred beyond what is supplied', () => {
  const prompt = buildAnalysisPrompt({ normalizedEvidence, deterministicMetrics, context: {} });
  assert.match(prompt, /linked_evidence_ids/);
  assert.match(prompt, /link_resolution/);
});

test('the prompt instructs confidence must never be upgraded merely because a PR or ticket exists', () => {
  const prompt = buildAnalysisPrompt({ normalizedEvidence, deterministicMetrics, context: {} });
  assert.match(prompt, /never.*(itself a reason to raise|upgraded)/i);
});

test('the prompt instructs business impact/workload size must not be invented beyond what is verbatim in evidence', () => {
  const prompt = buildAnalysisPrompt({ normalizedEvidence, deterministicMetrics, context: {} });
  assert.match(prompt, /invent business impact or workload size/i);
  assert.match(prompt, /verbatim/);
});

test('a mocked subprocess response is parsed into claims (no live CLI call)', async () => {
  const mockResponse = JSON.stringify({
    claims: [{
      title: 'Faster matching', problem: 'p', change: 'c', outcome: 'o', statement: 'a 74.18% reduction', metric_ids: ['metric_1'], evidence_ids: ['ev_1'], confidence: 'high', conflicting_evidence: false,
    }],
    uncertainties: ['none'],
    limitations: [],
  });
  const provider = new ClaudeCliProvider({
    invoke: () => ({ rawStdout: mockResponse, executablePath: '/mock/claude' }),
  });
  const result = await provider.analyze({ normalizedEvidence, deterministicMetrics, context: {} });
  assert.equal(result.claims.length, 1);
  assert.equal(result.claims[0].metric_ids[0], 'metric_1');
  assert.equal(result.providerMeta.executable, '/mock/claude');
});

test('a mocked subprocess response attempting to set a deterministic metric field is rejected', async () => {
  const mockResponse = JSON.stringify({
    claims: [{
      title: 't', metric_ids: ['metric_1'], evidence_ids: [], confidence: 'high', relative_change_percent: 999,
    }],
  });
  const provider = new ClaudeCliProvider({
    invoke: () => ({ rawStdout: mockResponse, executablePath: '/mock/claude' }),
  });
  await assert.rejects(
    () => provider.analyze({ normalizedEvidence, deterministicMetrics, context: {} }),
    /deterministic metric field/,
  );
});

test('a response with an invalid confidence value falls back to "low" rather than crashing', async () => {
  const mockResponse = JSON.stringify({
    claims: [{
      title: 't', metric_ids: [], evidence_ids: [], confidence: 'extremely-sure',
    }],
  });
  const provider = new ClaudeCliProvider({
    invoke: () => ({ rawStdout: mockResponse, executablePath: '/mock/claude' }),
  });
  const result = await provider.analyze({ normalizedEvidence, deterministicMetrics, context: {} });
  assert.equal(result.claims[0].confidence, 'low');
});
