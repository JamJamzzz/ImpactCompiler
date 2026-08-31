import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReview } from '../../src/renderers/review-renderer.mjs';
import { emptyImpactArtifact } from '../../src/core/impact-schema.mjs';

function sampleArtifact() {
  const a = emptyImpactArtifact({ compilerVersion: '0.1.0', runId: 'r1', runStartedAt: '2026-01-01T00:00:00.000Z' });
  a.run.analysis_status = 'analyzed';
  a.evidence = [{
    id: 'ev_1', type: 'benchmark_artifact', resolution: 'resolved',
  }];
  a.metrics = [{
    id: 'metric_1', name: 'matching runtime', unit: 'sec', operation: 'percentage_reduction', direction: 'lower_is_better', calculation: '(1.82 - 0.47) / 1.82 * 100', confidence: 'high', evidence_ids: ['ev_1'], before: 1.82, after: 0.47, absolute_delta: -1.35, relative_change_percent: 74.18,
  }];
  a.claims = [{
    id: 'claim_1', title: 'Faster matching', problem: 'O(n^2) matching was slow', change: 'Replaced with a hash-based lookup', outcome: 'Runtime dropped substantially', statement: 'a 74.18% reduction in matching runtime', metric_ids: ['metric_1'], evidence_ids: ['ev_1'], confidence: 'high', limitations: [], conflicting_evidence: false,
  }];
  return a;
}

test('renderReview is deterministic: same input produces identical output', () => {
  const a = sampleArtifact();
  const out1 = renderReview(a);
  const out2 = renderReview(JSON.parse(JSON.stringify(a)));
  assert.equal(out1, out2);
});

test('renderReview never mutates its input', () => {
  const a = sampleArtifact();
  const before = JSON.stringify(a);
  renderReview(a);
  assert.equal(JSON.stringify(a), before);
});

test('renderReview surfaces the metric value and does not invent a different one', () => {
  const out = renderReview(sampleArtifact());
  assert.match(out, /74\.18/);
  assert.match(out, /1\.82 -> 0\.47/);
});

test('pending_llm status is surfaced honestly, not silently hidden', () => {
  const a = sampleArtifact();
  a.run.analysis_status = 'pending_llm';
  a.claims = [];
  const out = renderReview(a);
  assert.match(out, /PENDING_LLM/);
});

test('renderReview surfaces rank, recommended, and outcome for each Impact Candidate (previously JSON-only)', () => {
  const a = sampleArtifact();
  a.impact_candidates = [
    {
      id: 'impact_candidate_reg', quantification_type: 'measured', impact_level: 'L2', outcome: 'regression', rank: 1, recommended: false, quality_profile: { resume_eligibility: 'ineligible' },
    },
    {
      id: 'impact_candidate_good', quantification_type: 'measured', impact_level: 'L2', outcome: 'improvement', rank: 2, recommended: true, quality_profile: { resume_eligibility: 'qualified' },
    },
  ];
  const out = renderReview(a);
  assert.match(out, /#1 `impact_candidate_reg`.*outcome: regression/);
  assert.doesNotMatch(out.split('\n').find((l) => l.includes('impact_candidate_reg')), /recommended/i, 'a non-recommended candidate must not be tagged recommended');
  assert.match(out, /#2 `impact_candidate_good`.*outcome: improvement.*\*\*recommended\*\*/);
});
