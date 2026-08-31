import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeCliProvider, buildCandidateAnalysisPrompt } from '../../src/providers/claude-cli-provider.mjs';

function candidate(overrides = {}) {
  return {
    id: 'impact_candidate_abc123',
    quantification_type: 'measured',
    impact_level: 'L2',
    impact_domain: 'performance',
    metric_ids: ['metric_1'],
    evidence_ids: ['ev_cb'],
    system: { name: 'the customer-matching engine', source_evidence_id: 'ev_commit', verification_status: 'verified' },
    scope: { records: 1000000, dataset_name: 'synthetic-customers-v3', source_evidence_ids: ['ev_cb'] },
    measurement: {
      method: 'controlled_before_after', primary_statistic: 'median', before: 1.82, after: 0.47, unit: 'sec', run_count: 30, measurement_quality: 'high',
    },
    attribution: { strength: 'strong', method: 'controlled_before_after', confounders: [] },
    outcome: 'improvement',
    quality_profile: {
      evidence_strength: 'high', measurement_quality: 'high', attribution_strength: 'strong', scope_completeness: 'complete', production_corroboration: false, conflict_status: 'none', resume_eligibility: 'strong',
    },
    allowed_numeric_facts: [
      {
        name: 'before', value: 1.82, display: '1.82', unit: 'sec', source_id: 'metric_1',
      },
      {
        name: 'after', value: 0.47, display: '0.47', unit: 'sec', source_id: 'metric_1',
      },
      {
        name: 'relative_change', value: 74.18, display: '74.18%', unit: 'percent', source_id: 'metric_1',
      },
      {
        name: 'scope_records', value: 1000000, display: '1,000,000', unit: 'records', source_id: 'ev_cb',
      },
      {
        name: 'run_count', value: 30, display: '30', unit: 'runs', source_id: 'ev_cb',
      },
    ],
    limitations: [],
    conflicting_evidence: false,
    ...overrides,
  };
}

const metricsById = new Map([['metric_1', {
  id: 'metric_1', name: 'customer matching runtime', before: 1.82, after: 0.47, unit: 'sec', relative_change_percent: 74.18,
}]]);
const evidenceById = new Map([['ev_cb', { id: 'ev_cb', type: 'controlled_benchmark', resolution: 'resolved' }]]);

test('buildCandidateAnalysisPrompt includes candidates keyed by id and forbids invented numbers', () => {
  const prompt = buildCandidateAnalysisPrompt({
    candidates: [candidate()], metricsById, evidenceById, context: {},
  });
  assert.match(prompt, /impact_candidate_abc123/);
  assert.match(prompt, /candidate_id/);
  assert.match(prompt, /never invent, compute, round, convert, or estimate/i);
});

test('candidate-ID-based provider output is hydrated: deterministic fields come from the candidate, not the provider', async () => {
  const response = JSON.stringify({
    claims: [{
      candidate_id: 'impact_candidate_abc123',
      title: 'Refactored the customer-matching engine',
      problem: 'Matching was too slow at scale.',
      change: 'Replaced the matching logic with a hash-based lookup.',
      outcome: 'Matching runtime dropped substantially.',
      resume_variants: {
        short: 'Optimized the customer-matching engine, reducing processing time by 74.18% across a one-million-record dataset.',
        standard: 'Refactored the customer-matching engine, reducing processing time across a one-million-record dataset from 1.82s to 0.47s, a 74.18% reduction.',
        technical: 'Refactored the customer-matching engine and, across 30 controlled runs on a one-million-record dataset, reduced median processing time from 1.82s to 0.47s, a 74.18% reduction.',
      },
      limitations: [],
    }],
    uncertainties: [],
    limitations: [],
  });
  const provider = new ClaudeCliProvider({ invoke: () => ({ rawStdout: response, executablePath: '/mock/claude' }) });
  const result = await provider.analyzeCandidates({
    candidates: [candidate()], metricsById, evidenceById, context: {},
  });
  const claim = result.claims[0];
  assert.equal(claim.candidate_id, 'impact_candidate_abc123');
  assert.deepEqual(claim.metric_ids, ['metric_1']);
  assert.deepEqual(claim.evidence_ids, ['ev_cb']);
  assert.equal(claim.quantification_type, 'measured');
  assert.equal(claim.impact_level, 'L2');
  assert.equal(claim.attribution.strength, 'strong');
  assert.equal(claim.confidence, 'high');
  assert.equal(claim.statement, claim.resume_variants.standard);
});

test('deterministic hydration rejects provider-authored overrides of metric_ids/scope/attribution (they are simply never read from provider output)', async () => {
  const response = JSON.stringify({
    claims: [{
      candidate_id: 'impact_candidate_abc123',
      title: 't',
      metric_ids: ['metric_FAKE'],
      scope: { records: 999 },
      attribution: { strength: 'weak' },
      resume_variants: { standard: 'A modest improvement.' },
    }],
  });
  const provider = new ClaudeCliProvider({ invoke: () => ({ rawStdout: response, executablePath: '/mock/claude' }) });
  const result = await provider.analyzeCandidates({
    candidates: [candidate()], metricsById, evidenceById, context: {},
  });
  const claim = result.claims[0];
  assert.deepEqual(claim.metric_ids, ['metric_1'], 'metric_ids came from the candidate, not the provider-supplied metric_FAKE');
  assert.equal(claim.scope.records, 1000000, 'scope came from the candidate');
  assert.equal(claim.attribution.strength, 'strong', 'attribution came from the candidate, not the provider-claimed "weak"');
});

test('a resume variant citing an unsupported number is dropped, not the whole claim', async () => {
  const response = JSON.stringify({
    claims: [{
      candidate_id: 'impact_candidate_abc123',
      title: 't',
      resume_variants: {
        short: 'Reduced processing time by 99.9%.',
        standard: 'Reduced processing time from 1.82s to 0.47s, a 74.18% reduction.',
      },
    }],
  });
  const provider = new ClaudeCliProvider({ invoke: () => ({ rawStdout: response, executablePath: '/mock/claude' }) });
  const result = await provider.analyzeCandidates({
    candidates: [candidate()], metricsById, evidenceById, context: {},
  });
  const claim = result.claims[0];
  assert.equal(claim.resume_variants.short, null);
  assert.equal(claim.resume_variants.standard, 'Reduced processing time from 1.82s to 0.47s, a 74.18% reduction.');
  assert.ok(claim.limitations.some((l) => l.includes('99.9%')));
});

test('an estimated candidate whose resume text lacks qualified language is still accepted (compiler validates numbers, not adjectives) but resume_eligibility stays qualified', async () => {
  const estimatedCandidate = candidate({
    quantification_type: 'estimated',
    quality_profile: { ...candidate().quality_profile, quantification_strength: 'estimated', resume_eligibility: 'qualified' },
  });
  const response = JSON.stringify({
    claims: [{
      candidate_id: 'impact_candidate_abc123',
      title: 't',
      resume_variants: { standard: 'Estimated annual time savings of approximately 74.18% across a one-million-record dataset.' },
    }],
  });
  const provider = new ClaudeCliProvider({ invoke: () => ({ rawStdout: response, executablePath: '/mock/claude' }) });
  const result = await provider.analyzeCandidates({
    candidates: [estimatedCandidate], metricsById, evidenceById, context: {},
  });
  assert.equal(result.claims[0].quantification_type, 'estimated');
  assert.equal(result.claims[0].confidence, 'medium');
});

// ---- Strict Candidate Contract (default) ----

test('a missing candidate_id is rejected by default (strict mode)', async () => {
  const response = JSON.stringify({
    claims: [{
      title: 'legacy-style claim', metric_ids: ['metric_1'], evidence_ids: ['ev_cb'], confidence: 'high', statement: 'a legacy statement',
    }],
  });
  const provider = new ClaudeCliProvider({ invoke: () => ({ rawStdout: response, executablePath: '/mock/claude' }) });
  await assert.rejects(
    () => provider.analyzeCandidates({
      candidates: [candidate()], metricsById, evidenceById, context: {},
    }),
    /missing "candidate_id"/,
  );
});

test('an unknown candidate_id is rejected, even with legacy compatibility enabled', async () => {
  const response = JSON.stringify({
    claims: [{ candidate_id: 'impact_candidate_does_not_exist', title: 't', resume_variants: { standard: 'x' } }],
  });
  const provider = new ClaudeCliProvider({ allowLegacyCandidateResponse: true, invoke: () => ({ rawStdout: response, executablePath: '/mock/claude' }) });
  await assert.rejects(
    () => provider.analyzeCandidates({
      candidates: [candidate()], metricsById, evidenceById, context: {},
    }),
    /unknown candidate_id/,
  );
});

test('a duplicate candidate_id across two claim entries is rejected by default', async () => {
  const response = JSON.stringify({
    claims: [
      { candidate_id: 'impact_candidate_abc123', title: 'first', resume_variants: { standard: 'Reduced processing time from 1.82s to 0.47s, a 74.18% reduction.' } },
      { candidate_id: 'impact_candidate_abc123', title: 'second', resume_variants: { standard: 'Reduced processing time from 1.82s to 0.47s, a 74.18% reduction.' } },
    ],
  });
  const provider = new ClaudeCliProvider({ invoke: () => ({ rawStdout: response, executablePath: '/mock/claude' }) });
  await assert.rejects(
    () => provider.analyzeCandidates({
      candidates: [candidate()], metricsById, evidenceById, context: {},
    }),
    /more than once/,
  );
});

test('a duplicate candidate_id is accepted when allowDuplicateCandidateIds is explicitly set', async () => {
  const response = JSON.stringify({
    claims: [
      { candidate_id: 'impact_candidate_abc123', title: 'first', resume_variants: { standard: 'Reduced processing time from 1.82s to 0.47s, a 74.18% reduction.' } },
      { candidate_id: 'impact_candidate_abc123', title: 'second', resume_variants: { standard: 'Reduced processing time from 1.82s to 0.47s, a 74.18% reduction.' } },
    ],
  });
  const provider = new ClaudeCliProvider({ allowDuplicateCandidateIds: true, invoke: () => ({ rawStdout: response, executablePath: '/mock/claude' }) });
  const result = await provider.analyzeCandidates({
    candidates: [candidate()], metricsById, evidenceById, context: {},
  });
  assert.equal(result.claims.length, 2);
});

test('a legacy-shaped response is accepted ONLY with the explicit allowLegacyCandidateResponse option', async () => {
  const response = JSON.stringify({
    claims: [{
      title: 'legacy-style claim', metric_ids: ['metric_1'], evidence_ids: ['ev_cb'], confidence: 'high', statement: 'a legacy statement',
    }],
  });
  const provider = new ClaudeCliProvider({ allowLegacyCandidateResponse: true, invoke: () => ({ rawStdout: response, executablePath: '/mock/claude' }) });
  const result = await provider.analyzeCandidates({
    candidates: [candidate()], metricsById, evidenceById, context: {},
  });
  assert.equal(result.claims[0].candidate_id, undefined);
  assert.equal(result.claims[0].statement, 'a legacy statement');
});

test('the provider never chooses legacy mode based on response contents — a response with SOME candidate_id entries and one without still rejects the one without, by default', async () => {
  const response = JSON.stringify({
    claims: [
      { candidate_id: 'impact_candidate_abc123', title: 'a', resume_variants: { standard: 'Reduced processing time from 1.82s to 0.47s, a 74.18% reduction.' } },
      { title: 'legacy one snuck in', statement: 'x', metric_ids: [], evidence_ids: [] },
    ],
  });
  const provider = new ClaudeCliProvider({ invoke: () => ({ rawStdout: response, executablePath: '/mock/claude' }) });
  await assert.rejects(
    () => provider.analyzeCandidates({
      candidates: [candidate()], metricsById, evidenceById, context: {},
    }),
    /missing "candidate_id"/,
  );
});

test('the provider cannot combine two unrelated candidates into one claim — only candidate_ids that exist are hydrated, one per claim entry', async () => {
  const secondCandidate = candidate({ id: 'impact_candidate_def456', metric_ids: ['metric_2'], evidence_ids: ['ev_prod'] });
  const response = JSON.stringify({
    claims: [{ candidate_id: 'impact_candidate_abc123', title: 'a', resume_variants: { standard: 'Reduced processing time from 1.82s to 0.47s, a 74.18% reduction.' } }],
  });
  const provider = new ClaudeCliProvider({ invoke: () => ({ rawStdout: response, executablePath: '/mock/claude' }) });
  const result = await provider.analyzeCandidates({
    candidates: [candidate(), secondCandidate], metricsById, evidenceById, context: {},
  });
  assert.equal(result.claims.length, 1);
  assert.deepEqual(result.claims[0].metric_ids, ['metric_1'], 'never picks up metric_2 from the second, unreferenced candidate');
});

test('a deterministic-metric-field injection attempt in the candidate response is still rejected', async () => {
  const response = JSON.stringify({ claims: [{ candidate_id: 'impact_candidate_abc123', relative_change_percent: 999 }] });
  const provider = new ClaudeCliProvider({ invoke: () => ({ rawStdout: response, executablePath: '/mock/claude' }) });
  await assert.rejects(
    () => provider.analyzeCandidates({
      candidates: [candidate()], metricsById, evidenceById, context: {},
    }),
    /deterministic metric field/,
  );
});
