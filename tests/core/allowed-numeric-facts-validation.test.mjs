import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractNumericTokens, validateAgainstAllowedNumericFacts } from '../../src/core/validation.mjs';

const allowed = [
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
];

test('extractNumericTokens finds comma-formatted, decimal, and percent numbers', () => {
  const tokens = extractNumericTokens('reduced from 1.82s to 0.47s across 1,000,000 records, a 74.18% reduction over 30 runs');
  assert.deepEqual(tokens, ['1.82', '0.47', '1,000,000', '74.18%', '30']);
});

test('before/after values are accepted', () => {
  const violations = validateAgainstAllowedNumericFacts('reduced from 1.82s to 0.47s', allowed);
  assert.deepEqual(violations, []);
});

test('comma-formatted numbers are accepted', () => {
  const violations = validateAgainstAllowedNumericFacts('across 1,000,000 records', allowed);
  assert.deepEqual(violations, []);
});

test('relative_change percent is accepted', () => {
  const violations = validateAgainstAllowedNumericFacts('a 74.18% reduction', allowed);
  assert.deepEqual(violations, []);
});

test('run_count is accepted', () => {
  const violations = validateAgainstAllowedNumericFacts('across 30 controlled runs', allowed);
  assert.deepEqual(violations, []);
});

test('a digit embedded in an identifier (e.g. "P95" in "P95 latency") is never treated as a cited number', () => {
  const tokens = extractNumericTokens('production P95 latency decreased by 61%');
  assert.deepEqual(tokens, ['61%']);
});

test('an unsupported number is rejected', () => {
  const violations = validateAgainstAllowedNumericFacts('a 99.9% reduction', allowed);
  assert.deepEqual(violations, ['99.9%']);
});

test('the raw numeric value is accepted even without the exact display formatting (e.g. bare "1000000")', () => {
  const violations = validateAgainstAllowedNumericFacts('across 1000000 records', allowed);
  assert.deepEqual(violations, []);
});

test('text with no numbers at all has no violations', () => {
  const violations = validateAgainstAllowedNumericFacts('Refactored the customer-matching engine for speed.', allowed);
  assert.deepEqual(violations, []);
});

// ---- word-form aliases (item 6: "1,000,000" / "one million" / "one-million") ----

const scopeAllowed = [{
  name: 'scope_records', value: 1000000, display: '1,000,000', unit: 'records', source_id: 'ev_cb', display_variants: ['1,000,000', 'one million', 'one-million'],
}];

test('an explicitly generated word-form alias is accepted', () => {
  const violations = validateAgainstAllowedNumericFacts('across a one-million-record dataset', scopeAllowed);
  assert.deepEqual(violations, []);
});

test('the space-separated word form is also accepted', () => {
  const violations = validateAgainstAllowedNumericFacts('across one million records', scopeAllowed);
  assert.deepEqual(violations, []);
});

test('an unsupported word-form quantity is rejected even if no digit token is present', () => {
  const violations = validateAgainstAllowedNumericFacts('across two million records', scopeAllowed);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /two million/i);
});

test('a word-form quantity is rejected when the candidate generated no aliases at all', () => {
  const violations = validateAgainstAllowedNumericFacts('across one million records', allowed);
  assert.equal(violations.length, 1);
});

// ---- digit-word aliases ("1.5 million", "20 million", "1 billion") ----

const digitWordAllowed = [{
  name: 'scope_records', value: 20000000, display: '20,000,000', unit: 'records', source_id: 'ev_cb', display_variants: ['20,000,000', '20 million'],
}];

test('an allowed digit-word alias ("20 million") is accepted, and its leading digit is not separately flagged', () => {
  const violations = validateAgainstAllowedNumericFacts('across 20 million records', digitWordAllowed);
  assert.deepEqual(violations, []);
});

test('an unsupported digit-word quantity is rejected', () => {
  const violations = validateAgainstAllowedNumericFacts('across 30 million records', digitWordAllowed);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /30 million/i);
});

test('a decimal digit-word alias ("1.5 million") is accepted when explicitly generated', () => {
  const allowedWithDecimal = [{
    name: 'scope_records', value: 1500000, display: '1,500,000', unit: 'records', source_id: 'ev_cb', display_variants: ['1,500,000', '1.5 million'],
  }];
  const violations = validateAgainstAllowedNumericFacts('across 1.5 million records', allowedWithDecimal);
  assert.deepEqual(violations, []);
});

// ---- P0-3: rounded/comma-formatted digit ALIASES (display_variants also
// feed the plain digit-token check now, not just word-form phrases) ----

const roundedAllowed = [{
  name: 'before', value: 8771.509042192329, display: '8771.509042192329', unit: 'ops/sec', source_id: 'metric_1', display_variants: ['8771.51', '8,771.51'],
}];

test('P0-3: the full-precision canonical value is always accepted (unchanged)', () => {
  const violations = validateAgainstAllowedNumericFacts('measured at 8771.509042192329 ops/sec', roundedAllowed);
  assert.deepEqual(violations, []);
});

test('P0-3: a 2-decimal rounded display alias is accepted', () => {
  const violations = validateAgainstAllowedNumericFacts('measured at 8771.51 ops/sec', roundedAllowed);
  assert.deepEqual(violations, []);
});

test('P0-3: a comma-formatted rounded display alias is accepted', () => {
  const violations = validateAgainstAllowedNumericFacts('measured at 8,771.51 ops/sec', roundedAllowed);
  assert.deepEqual(violations, []);
});

test('P0-3: a genuinely unsupported NEARBY number is still rejected — no fuzzy tolerance', () => {
  const violations = validateAgainstAllowedNumericFacts('measured at 8771.52 ops/sec', roundedAllowed);
  assert.deepEqual(violations, ['8771.52']);
});

test('P0-3: an arbitrary approximation is still rejected', () => {
  const violations = validateAgainstAllowedNumericFacts('roughly 8800 ops/sec', roundedAllowed);
  assert.deepEqual(violations, ['8800']);
});

test('P0-3: the original SAFER-CC naturally-rounded resume sentence (from the dogfooding evaluation) now validates cleanly', () => {
  const facts = [
    { name: 'before', value: 8771.509042192329, display: '8771.509042192329', unit: 'ops/sec', source_id: 'm', display_variants: ['8771.51', '8,771.51'] },
    { name: 'after', value: 49336.65327896023, display: '49336.65327896023', unit: 'ops/sec', source_id: 'm', display_variants: ['49336.65', '49,336.65'] },
    { name: 'result_value', value: 5.62, display: '5.62', unit: 'ratio', source_id: 'm' },
    { name: 'scope_workers', value: 64, display: '64', unit: null, source_id: 'ev', display_variants: ['64'] },
    { name: 'scope_files', value: 32, display: '32', unit: null, source_id: 'ev', display_variants: ['32'] },
    { name: 'run_count', value: 5, display: '5', unit: 'runs', source_id: 'ev' },
  ];
  const text = 'Improved SAFER-CC independent-file throughput to 5.62x GlobalLock '
    + '(8,771.51 to 49,336.65 ops/sec median, 64 workers / 32 files, 5 repetitions).';
  assert.deepEqual(validateAgainstAllowedNumericFacts(text, facts), []);
});

// ---- V2 (Deep-hardening): externally_claimable filtering ----

test('V2: a fact explicitly marked externally_claimable:false can never satisfy the check, even citing its exact display string', () => {
  const facts = [
    {
      name: 'before', value: 100, display: '100', unit: 'percent', source_id: 'm', externally_claimable: false,
    },
  ];
  assert.deepEqual(validateAgainstAllowedNumericFacts('Reached 100.', facts), ['100']);
});

test('V2: a fact with no externally_claimable field at all behaves exactly as before (implicitly claimable)', () => {
  const facts = [{
    name: 'before', value: 100, display: '100', unit: 'percent', source_id: 'm',
  }];
  assert.deepEqual(validateAgainstAllowedNumericFacts('Reached 100.', facts), []);
});

test('V2: extractNumericTokens preserves a leading negative sign so a genuinely negative fact (e.g. a regression\'s relative_change) can validate', () => {
  const facts = [{
    name: 'relative_change', value: -10.24, display: '-10.24%', unit: 'percent', source_id: 'm',
  }];
  assert.deepEqual(validateAgainstAllowedNumericFacts('Regressed -10.24%.', facts), []);
  // the POSITIVE form of the same magnitude must still fail -- the sign is
  // not just stripped for matching purposes, it changes the claimed value.
  assert.deepEqual(validateAgainstAllowedNumericFacts('Improved 10.24%.', facts), ['10.24%']);
});
