import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateClaimSemantics } from '../../src/core/claim-semantics.mjs';
import { extractNumericTokens } from '../../src/core/validation.mjs';
import { rankAndDeduplicateCandidates } from '../../src/candidates/ranking.mjs';

// V2 (Deep-hardening) regression tests. Every case here is promoted from a
// real failure category External ImpactBench — Deep found (see
// evaluations/external-impactbench-deep/FAILURE_ANALYSIS.md), but uses NEW
// synthetic fixtures, never a real corpus case id/benchmark name/PR number —
// per the task's "no cheating" rule, every fix must generalize from the
// underlying LEXICAL/SEMANTIC class, not from memorizing a specific string.

function regressionCandidate(overrides = {}) {
  return {
    outcome: 'regression',
    quality_profile: { scope_completeness: 'partial' },
    allowed_numeric_facts: [
      { name: 'relative_change', value: -10.24, display: '-10.24%', unit: 'percent', externally_claimable: true },
      { name: 'scope_workers', value: 64, display: '64', unit: null, externally_claimable: true },
      {
        name: 'before', value: 8771.509042192329, display: '8771.509042192329', display_variants: ['8,771.51', '8771.51'], unit: 'ops/sec', externally_claimable: true,
      },
    ],
    ...overrides,
  };
}

function improvementCandidate(overrides = {}) {
  return {
    outcome: 'improvement',
    quality_profile: { scope_completeness: 'partial' },
    allowed_numeric_facts: [
      { name: 'relative_change', value: 23.08, display: '23.08%', unit: 'percent', externally_claimable: true },
      { name: 'scope_queries', value: 16, display: '16', unit: null, externally_claimable: true },
    ],
    ...overrides,
  };
}

// ---- 1/2: negative percentage handling ----

test('V2-1: a valid negative percentage (matching the fact\'s own literal sign) is accepted', () => {
  const result = validateClaimSemantics('Throughput regressed -10.24% (64 workers).', regressionCandidate());
  assert.equal(result.valid, true);
  assert.deepEqual(result.violations, []);
});

test('V2-2: an unsupported negative percentage (wrong magnitude) is rejected', () => {
  const result = validateClaimSemantics('Throughput regressed -99.99% (64 workers).', regressionCandidate());
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((v) => v.type === 'unsupported_number' && v.token === '-99.99%'));
});

// ---- 3: digit-prefixed identifiers never generate spurious numeric tokens ----
// New identifiers, never appearing in the P1 corpus, same lexical shape
// (digit-letter-digit, or letter-then-digit) as the ones P1 actually found.

test('V2-3: digit-prefixed/suffixed identifiers produce zero spurious numeric tokens', () => {
  // Every one of these is either letter-before-digit (sha256/x86/h264/ipv6/
  // Python3's exact shape — already excluded by the pre-existing lookbehind)
  // or digit-letter-digit (2to3's exact shape — the new lookahead this
  // fix adds). Deliberately excludes a case like "4chan" (digit, then an
  // arbitrary trailing word, no digit after) — that shape is
  // lexically identical to a legitimate "42x"/"3ms" number+unit-suffix and
  // is a documented non-goal (see extractNumericTokens's doc comment),
  // not a silent gap: distinguishing it would require a unit-suffix
  // allowlist, which is a different, separate mechanism (the unit-category
  // table in claim-semantics.mjs), not a tokenizer-level lexical rule.
  const identifiers = ['b2b2c', 's3cr3t', 'IPv4', 'md5sum', 'utf8', 'oauth2', 'log4j', 'web3'];
  for (const id of identifiers) {
    assert.deepEqual(extractNumericTokens(`the ${id} integration works`), [], `expected no tokens from "${id}"`);
  }
});

test('V2-3b: a real number adjacent to an identifier-shaped word is still extracted', () => {
  // "oauth2 handled 42 requests" -- "2" in oauth2 must not leak, "42" must.
  assert.deepEqual(extractNumericTokens('oauth2 handled 42 requests'), ['42']);
});

// ---- 4/5: unit mismatch ----

test('V2-4: a correct number paired with a fabricated/incorrect unit is rejected', () => {
  const result = validateClaimSemantics('Latency regressed -10.24 ms (64 workers).', regressionCandidate());
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((v) => v.type === 'unit_mismatch' && v.fact_unit === 'percent' && v.claimed_unit === 'milliseconds'));
});

test('V2-5: a correct number with its own correct unit is accepted', () => {
  const result = validateClaimSemantics('Independent-file throughput reached 8,771.51 ops/sec.', regressionCandidate());
  assert.equal(result.valid, true);
});

test('V2-5b: a real scope count with a fabricated unit word is rejected', () => {
  const result = validateClaimSemantics('Measured across 64 files (not the actual worker count).', regressionCandidate());
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((v) => v.type === 'unit_mismatch' && v.fact_unit === 'workers' && v.claimed_unit === 'files'));
});

// ---- 6/7: polarity ----

test('V2-6: a polarity-flipped claim (business outcome) is rejected', () => {
  const result = validateClaimSemantics('Throughput improved -10.24% (64 workers).', regressionCandidate());
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((v) => v.type === 'polarity_mismatch' && /improvement.*regression/.test(v.detail)));
});

test('V2-6b: a polarity-flipped claim (numeric delta direction, independent of outcome wording) is rejected', () => {
  const result = validateClaimSemantics('Throughput increased -10.24% (64 workers).', regressionCandidate());
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((v) => v.type === 'polarity_mismatch' && /an increase but the fact.s value is negative/.test(v.detail)));
});

test('V2-7: a correctly-oriented claim is accepted', () => {
  const result = validateClaimSemantics('Query accuracy improved 23.08% across 16 queries.', improvementCandidate());
  assert.equal(result.valid, true);
});

test('V2-7b: "lower" is correctly NOT flagged as a polarity error when direction is lower_is_better and the outcome is genuinely an improvement', () => {
  // A lower_is_better metric whose value went down is an IMPROVEMENT -- the
  // word "lower" (a DELTA word) must be judged against the actual sign of
  // the delta, never against the English connotation of "lower".
  const candidate = improvementCandidate({
    outcome: 'improvement',
    allowed_numeric_facts: [{ name: 'relative_change', value: -15, display: '-15%', unit: 'percent', externally_claimable: true }],
  });
  const result = validateClaimSemantics('Latency is 15% lower.', candidate);
  assert.equal(result.valid, false); // "-15%" != "15%" token-wise (sign not restated) -- a genuine unsupported_number, not a polarity error
  assert.equal(result.violations.every((v) => v.type !== 'polarity_mismatch'), true, 'must never misjudge "lower" as a polarity violation for a real improvement');
});

// ---- 8/9: scope generalization ----

test('V2-8: an unsupported "overall"/universal generalization is rejected when scope is not complete', () => {
  const result = validateClaimSemantics('Overall throughput regressed -10.24%.', regressionCandidate());
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((v) => v.type === 'scope_overgeneralization' && v.phrase === 'overall'));
});

test('V2-9: an appropriately (narrowly) scoped claim is accepted', () => {
  const result = validateClaimSemantics('Independent-file throughput regressed -10.24% under a 64-worker workload.', regressionCandidate());
  assert.equal(result.valid, true);
});

test('V2-9b: a universal-sounding phrase is allowed when scope_breadth is genuinely "global" (V2.1: scope_completeness alone is NOT sufficient -- see V2.1-1 below)', () => {
  const candidate = regressionCandidate({ quality_profile: { scope_completeness: 'complete', scope_breadth: 'global' } });
  const result = validateClaimSemantics('Overall throughput regressed -10.24% (64 workers).', candidate);
  assert.equal(result.valid, true);
});

// ---- V2.1 (bounded semantic-closure pass): scope traceability vs breadth ----
// Finding: scope_completeness answers "is scope recorded/traceable?", not
// "does the evidence justify universal language?" -- a single, perfectly
// traceable benchmark measurement was classified 'complete' and could
// therefore say "overall"/"system-wide" freely. Fixed by introducing a
// SEPARATE field, scope_breadth (quality-profile.mjs's deriveScopeBreadth),
// which checkScopeGeneralization now reads instead. scope_completeness's
// own meaning/values are completely unchanged.

test('V2.1-1: the REALISTIC single-benchmark regression fixture -- scope_completeness:"complete" (traceable) but scope_breadth defaults to "specific" (not global) -- "overall" is now correctly rejected (was 0/1 caught pre-V2.1, now 1/1)', () => {
  const candidate = regressionCandidate({
    quality_profile: { scope_completeness: 'complete', scope_breadth: 'specific' },
  });
  const result = validateClaimSemantics('Overall, this improved performance across the whole interpreter: throughput regressed -10.24%.', candidate);
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((v) => v.type === 'scope_overgeneralization' && v.phrase === 'overall'));
});

test('V2.1-2: the SAME evidence, correctly narrowly scoped, is still accepted (no false rejection of a valid, appropriately-scoped claim)', () => {
  const candidate = regressionCandidate({
    quality_profile: { scope_completeness: 'complete', scope_breadth: 'specific' },
  });
  const result = validateClaimSemantics('For this specific benchmark, throughput regressed -10.24% (64 workers).', candidate);
  assert.equal(result.valid, true);
});

test('V2.1-3: scope_breadth defaults to "unknown" (not "specific") when no scope object exists at all -- still correctly rejects universal language, distinct from "missing" scope_completeness', () => {
  const candidate = {
    outcome: 'regression',
    quality_profile: { scope_completeness: 'missing' }, // deriveScopeBreadth would independently compute 'unknown' here too
    allowed_numeric_facts: [{
      name: 'relative_change', value: -10.24, display: '-10.24%', unit: 'percent', externally_claimable: true,
    }],
  };
  const result = validateClaimSemantics('System-wide, throughput regressed -10.24%.', candidate);
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((v) => v.type === 'scope_overgeneralization' && v.phrase === 'system-wide'));
});

test('V2.1-4: scope_breadth "multi_scope" (several explicitly-identified measurements) still does NOT justify universal language -- only "global" does', () => {
  const candidate = regressionCandidate({
    quality_profile: { scope_completeness: 'complete', scope_breadth: 'multi_scope' },
  });
  const result = validateClaimSemantics('Across all workloads, throughput regressed -10.24%.', candidate);
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((v) => v.type === 'scope_overgeneralization'));
});

// ---- 10: synthetic anchor cannot be asserted as an external fact ----

test('V2-10: a synthetic-anchor (ADAPTER_INTERNAL) value can never be asserted as an external fact, even though a real source fact on the same candidate validates fine', () => {
  const candidate = {
    outcome: 'regression',
    quality_profile: {},
    allowed_numeric_facts: [
      {
        name: 'before', value: 100, display: '100', unit: 'percent', externally_claimable: false, provenance_class: 'ADAPTER_INTERNAL',
      },
      { name: 'relative_change', value: 6.2, display: '6.2%', unit: 'percent', externally_claimable: true },
    ],
  };
  const leaked = validateClaimSemantics('Regressed to 100 (synthetic anchor value).', candidate);
  assert.equal(leaked.valid, false);
  assert.ok(leaked.violations.some((v) => v.type === 'adapter_internal_fact' && v.token === '100'));

  const real = validateClaimSemantics('Regressed 6.2%.', candidate);
  assert.equal(real.valid, true);
});

// ---- 11: valid rounded/comma aliases still work ----

test('V2-11: valid rounded/comma-formatted display aliases still validate', () => {
  const result = validateClaimSemantics('Reached 8,771.51 ops/sec.', regressionCandidate());
  assert.equal(result.valid, true);
});

// ---- 12: candidate preservation remains non-destructive ----

test('V2-12: candidate preservation remains non-destructive after the provenance-tagging changes', () => {
  const many = ['a', 'b', 'c', 'd', 'e'].map((id) => ({
    id,
    quantification_type: 'measured',
    impact_level: 'L2',
    metric_ids: [`metric_${id}`],
    evidence_ids: [`ev_${id}`],
    measurement: { method: 'controlled_before_after', assumptions: [] },
    quality_profile: {
      evidence_strength: 'high', measurement_quality: 'high', attribution_strength: 'strong', scope_completeness: 'complete', production_corroboration: false, conflict_status: 'none', resume_eligibility: 'strong',
    },
  }));
  const ranked = rankAndDeduplicateCandidates(many);
  assert.equal(ranked.length, 5);
});

// ---- 13: recommendation still excludes ineligible candidates ----

test('V2-13: recommendation still excludes ineligible candidates after V2 changes', () => {
  const regression = {
    id: 'reg', quantification_type: 'measured', impact_level: 'L1', metric_ids: ['metric_reg'], evidence_ids: ['ev_reg'], measurement: { method: 'controlled_before_after' }, quality_profile: { evidence_strength: 'high', measurement_quality: 'high', attribution_strength: 'strong', scope_completeness: 'complete', production_corroboration: false, conflict_status: 'none', resume_eligibility: 'ineligible' },
  };
  const ranked = rankAndDeduplicateCandidates([regression]);
  assert.equal(ranked[0].recommended, false);
});

// ---- V2.1 (bounded semantic-closure pass), Finding B: expanded polarity
// test matrix. The DEVELOPMENT-CORPUS "polarity_flipped" adversarial
// category (evaluations/external-impactbench-deep/harness/gen_run_adversarial.mjs
// line 79) was found to construct its claim text as
// `realPct < 0 ? 'regressed' : 'improved'` -- the word MATCHING the real
// sign, not an inverted one -- so that category never actually tested a
// polarity flip. That old, frozen P1 corpus fixture is NOT modified here
// (per instruction); instead this is a fresh, corrected, comprehensive
// matrix covering every semantic pair the task named, run against the real
// validator, with both a genuine flip (invalid) and its correctly-oriented
// counterpart (valid) for each pair -- never hard-coded to one exact old
// string. ----

const POLARITY_PAIRS = [
  { deltaWord: 'decreased', oppositeDeltaWord: 'increased', sign: -1 },
  { deltaWord: 'increased', oppositeDeltaWord: 'decreased', sign: 1 },
  { outcomeWord: 'faster', oppositeOutcomeWord: 'slower' },
  { outcomeWord: 'slower', oppositeOutcomeWord: 'faster' },
  { outcomeWord: 'improved', oppositeOutcomeWord: 'regressed' },
  { outcomeWord: 'regressed', oppositeOutcomeWord: 'improved' },
  { deltaWord: 'reduced', oppositeDeltaWord: 'increased', sign: -1 },
  { deltaWord: 'lowered', oppositeDeltaWord: 'raised', sign: -1 },
];

test('V2.1-5: expanded polarity test matrix -- 8 semantic pairs, each with a genuine flip (rejected) and a correct counterpart (accepted)', () => {
  let flipsRejected = 0;
  let validAccepted = 0;
  for (const pair of POLARITY_PAIRS) {
    if (pair.deltaWord) {
      // A fact whose real signed value matches `sign` (e.g. -12.5 for a
      // "decreased"/negative-direction word, +12.5 for an "increased"/
      // positive-direction word) genuinely described with the OPPOSITE
      // delta word is a real flip; described with its own correct word is
      // valid.
      const value = pair.sign * 12.5;
      const display = `${value}%`;
      const candidate = regressionCandidate({
        outcome: 'improvement',
        allowed_numeric_facts: [{ name: 'relative_change', value, display, unit: 'percent', externally_claimable: true }],
      });
      const flipped = validateClaimSemantics(`Latency ${pair.oppositeDeltaWord} ${display}.`, candidate);
      const correct = validateClaimSemantics(`Latency ${pair.deltaWord} ${display}.`, candidate);
      assert.equal(flipped.valid, false, `"${pair.oppositeDeltaWord}" must be rejected for a fact whose real direction is "${pair.deltaWord}"`);
      assert.ok(flipped.violations.some((v) => v.type === 'polarity_mismatch'));
      assert.equal(correct.valid, true, `"${pair.deltaWord}" must be accepted -- it is the fact's real direction`);
      flipsRejected += 1;
      validAccepted += 1;
    } else {
      // An outcome word describing the WRONG business outcome for the
      // candidate's real `outcome` field is a real flip.
      const isImprovementWord = pair.outcomeWord === 'faster' || pair.outcomeWord === 'improved';
      const candidateOutcome = isImprovementWord ? 'improvement' : 'regression';
      const candidate = regressionCandidate({ outcome: candidateOutcome });
      const flipped = validateClaimSemantics(`Throughput ${pair.oppositeOutcomeWord} -10.24% (64 workers).`, candidate);
      const correct = validateClaimSemantics(`Throughput ${pair.outcomeWord} -10.24% (64 workers).`, candidate);
      assert.equal(flipped.valid, false, `"${pair.oppositeOutcomeWord}" must be rejected for a candidate whose real outcome is "${candidateOutcome}"`);
      assert.ok(flipped.violations.some((v) => v.type === 'polarity_mismatch'));
      assert.equal(correct.valid, true, `"${pair.outcomeWord}" must be accepted -- it matches the candidate's real outcome "${candidateOutcome}"`);
      flipsRejected += 1;
      validAccepted += 1;
    }
  }
  assert.equal(flipsRejected, 8);
  assert.equal(validAccepted, 8);
});

test('V2.1-6: numeric delta direction and business outcome are independently checked, never collapsed -- a lower_is_better metric whose value went down (an improvement) correctly accepts "decreased" without a false polarity_mismatch', () => {
  const candidate = regressionCandidate({
    outcome: 'improvement',
    allowed_numeric_facts: [{ name: 'relative_change', value: -8.0, display: '-8%', unit: 'percent', externally_claimable: true }],
  });
  const result = validateClaimSemantics('Latency decreased -8%, an improvement.', candidate);
  assert.equal(result.valid, true);
});
