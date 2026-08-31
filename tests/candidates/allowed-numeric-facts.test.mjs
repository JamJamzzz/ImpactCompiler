import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAllowedNumericFacts } from '../../src/candidates/allowed-numeric-facts.mjs';

test('builds before/after/relative_change/result_value/scope/run_count facts', () => {
  const metricsById = new Map([['metric_1', {
    id: 'metric_1', before: 1.82, after: 0.47, unit: 'sec', relative_change_percent: 74.18, result: { value: 74.18, value_unit: 'percent' },
  }]]);
  const candidate = {
    metric_ids: ['metric_1'],
    scope: { records: 1000000, dataset_name: 'synthetic-customers-v3', source_evidence_ids: ['ev_cb'] },
    measurement: { run_count: 30 },
    measurement_evidence_ids: ['ev_cb'],
  };
  const facts = buildAllowedNumericFacts(candidate, { metricsById, evidenceById: new Map() });
  const byName = Object.fromEntries(facts.map((f) => [f.name, f]));
  assert.equal(byName.before.display, '1.82');
  assert.equal(byName.after.display, '0.47');
  assert.equal(byName.relative_change.display, '74.18%');
  assert.equal(byName.result_value.display, '74.18%');
  assert.equal(byName.scope_records.display, '1,000,000');
  assert.equal(byName.run_count.display, '30');
});

test('ratio result_value does not append a percent sign', () => {
  const metricsById = new Map([['metric_1', {
    id: 'metric_1', before: 4, after: 1, unit: 'x', relative_change_percent: null, result: { value: 0.25, value_unit: 'ratio' },
  }]]);
  const candidate = { metric_ids: ['metric_1'], scope: null, measurement: {} };
  const facts = buildAllowedNumericFacts(candidate, { metricsById, evidenceById: new Map() });
  const resultFact = facts.find((f) => f.name === 'result_value');
  assert.equal(resultFact.display, '0.25');
});

test('production_summary metrics contribute their own before/after/result facts', () => {
  const candidate = {
    metric_ids: [],
    scope: null,
    measurement: {},
    production_summary: {
      window: { days: 14 },
      metrics: [{
        name: 'p95_latency', before: 100, after: 39, unit: 'ms', result_value: 61, result_unit: 'percent', evidence_id: 'ev_prod',
      }],
    },
  };
  const facts = buildAllowedNumericFacts(candidate, { metricsById: new Map(), evidenceById: new Map() });
  const byName = Object.fromEntries(facts.map((f) => [f.name, f]));
  assert.equal(byName.production_window_days.display, '14');
  assert.equal(byName.production_p95_latency_before.display, '100');
  assert.equal(byName.production_p95_latency_after.display, '39');
  assert.equal(byName.production_p95_latency_result.display, '61%');
});

test('multiple production metrics in one summary each get their own facts', () => {
  const candidate = {
    metric_ids: [],
    scope: null,
    measurement: {},
    production_summary: {
      window: { days: 14 },
      metrics: [
        {
          name: 'p95_latency', before: 100, after: 39, unit: 'ms', result_value: 61, result_unit: 'percent', evidence_id: 'ev_p95',
        },
        {
          name: 'timeout_rate', before: 2.1, after: 0.6, unit: 'percent', result_value: 71.43, result_unit: 'percent', evidence_id: 'ev_timeout',
        },
      ],
    },
  };
  const facts = buildAllowedNumericFacts(candidate, { metricsById: new Map(), evidenceById: new Map() });
  const byName = Object.fromEntries(facts.map((f) => [f.name, f]));
  assert.equal(byName.production_timeout_rate_before.display, '2.1');
  assert.equal(byName.production_timeout_rate_after.display, '0.6');
});

test('scope facts include deterministic word-form display_variants for round millions', () => {
  const candidate = {
    metric_ids: [], scope: { records: 1000000, source_evidence_ids: ['ev_cb'] }, measurement: {},
  };
  const facts = buildAllowedNumericFacts(candidate, { metricsById: new Map(), evidenceById: new Map() });
  const scopeFact = facts.find((f) => f.name === 'scope_records');
  assert.deepEqual(scopeFact.display_variants, ['1,000,000', 'one million', 'one-million', '1 million']);
});

test('1,500 gets only the comma display — no word-form or digit-word alias (not a clean million/billion multiple)', () => {
  const candidate = {
    metric_ids: [], scope: { records: 1500, source_evidence_ids: ['ev_cb'] }, measurement: {},
  };
  const facts = buildAllowedNumericFacts(candidate, { metricsById: new Map(), evidenceById: new Map() });
  const scopeFact = facts.find((f) => f.name === 'scope_records');
  assert.deepEqual(scopeFact.display_variants, ['1,500']);
});

test('1,500,000 gets a "1.5 million" digit-word alias', () => {
  const candidate = {
    metric_ids: [], scope: { records: 1500000, source_evidence_ids: ['ev_cb'] }, measurement: {},
  };
  const facts = buildAllowedNumericFacts(candidate, { metricsById: new Map(), evidenceById: new Map() });
  const scopeFact = facts.find((f) => f.name === 'scope_records');
  assert.ok(scopeFact.display_variants.includes('1.5 million'));
});

test('20,000,000 gets a "20 million" digit-word alias, not the fully spelled-out "twenty million"', () => {
  const candidate = {
    metric_ids: [], scope: { records: 20000000, source_evidence_ids: ['ev_cb'] }, measurement: {},
  };
  const facts = buildAllowedNumericFacts(candidate, { metricsById: new Map(), evidenceById: new Map() });
  const scopeFact = facts.find((f) => f.name === 'scope_records');
  assert.ok(scopeFact.display_variants.includes('20 million'));
});

test('1,000,000,000 gets a "1 billion" digit-word alias', () => {
  const candidate = {
    metric_ids: [], scope: { records: 1000000000, source_evidence_ids: ['ev_cb'] }, measurement: {},
  };
  const facts = buildAllowedNumericFacts(candidate, { metricsById: new Map(), evidenceById: new Map() });
  const scopeFact = facts.find((f) => f.name === 'scope_records');
  assert.ok(scopeFact.display_variants.includes('1 billion'));
});

test('word-form aliases are omitted for values with no clean round-number word form', () => {
  const candidate = {
    metric_ids: [], scope: { records: 1234567, source_evidence_ids: ['ev_cb'] }, measurement: {},
  };
  const facts = buildAllowedNumericFacts(candidate, { metricsById: new Map(), evidenceById: new Map() });
  const scopeFact = facts.find((f) => f.name === 'scope_records');
  assert.deepEqual(scopeFact.display_variants, ['1,234,567']);
});

test('absolute_delta is exposed as an allowed fact', () => {
  const metricsById = new Map([['metric_1', {
    id: 'metric_1', before: 1.82, after: 0.47, unit: 'sec', absolute_delta: -1.35,
  }]]);
  const candidate = { metric_ids: ['metric_1'], scope: null, measurement: {} };
  const facts = buildAllowedNumericFacts(candidate, { metricsById, evidenceById: new Map() });
  const deltaFact = facts.find((f) => f.name === 'absolute_delta');
  assert.equal(deltaFact.display, '1.35');
});

test('no facts are produced for missing/null values (never fabricated)', () => {
  const candidate = { metric_ids: [], scope: null, measurement: {} };
  const facts = buildAllowedNumericFacts(candidate, { metricsById: new Map(), evidenceById: new Map() });
  assert.deepEqual(facts, []);
});

// ---- P0-3: rounded/comma display_variants on before/after/absolute_delta/result_value ----

test('P0-3: before/after get 2-decimal and comma-formatted rounded display_variants alongside the full-precision display', () => {
  const metricsById = new Map([['metric_1', {
    id: 'metric_1', before: 8771.509042192329, after: 49336.65327896023, unit: 'ops/sec',
  }]]);
  const candidate = { metric_ids: ['metric_1'], scope: null, measurement: {} };
  const facts = buildAllowedNumericFacts(candidate, { metricsById, evidenceById: new Map() });
  const byName = Object.fromEntries(facts.map((f) => [f.name, f]));
  assert.equal(byName.before.display, '8771.509042192329', 'canonical display stays full precision');
  assert.ok(byName.before.display_variants.includes('8771.51'));
  assert.ok(byName.before.display_variants.includes('8,771.51'));
  assert.ok(byName.after.display_variants.includes('49336.65'));
  assert.ok(byName.after.display_variants.includes('49,336.65'));
});

test('P0-3: absolute_delta also gets rounded display_variants, and is labeled percentage_points (not percent) when the metric unit is percent', () => {
  const metricsById = new Map([['metric_1', {
    id: 'metric_1', before: 81.25, after: 100, unit: 'percent', absolute_delta: 18.75, relative_change_percent: 23.08,
  }]]);
  const candidate = { metric_ids: ['metric_1'], scope: null, measurement: {} };
  const facts = buildAllowedNumericFacts(candidate, { metricsById, evidenceById: new Map() });
  const byName = Object.fromEntries(facts.map((f) => [f.name, f]));
  assert.equal(byName.absolute_delta.unit, 'percentage_points');
  assert.equal(byName.relative_change.unit, 'percent');
});

test('P0-3: a value that is already a clean 2-decimal number produces no redundant duplicate alias', () => {
  const metricsById = new Map([['metric_1', {
    id: 'metric_1', before: 100, after: 47, unit: 'sec',
  }]]);
  const candidate = { metric_ids: ['metric_1'], scope: null, measurement: {} };
  const facts = buildAllowedNumericFacts(candidate, { metricsById, evidenceById: new Map() });
  const byName = Object.fromEntries(facts.map((f) => [f.name, f]));
  assert.ok(!byName.before.display_variants.includes(byName.before.display));
});

// ---- V2 (Deep-hardening): fact provenance classes ----

test('V2: a metric with no synthetic_fields produces SOURCE_FACT before/after and DERIVED_FACT absolute_delta/relative_change, all externally claimable (unchanged default)', () => {
  const metricsById = new Map([['metric_1', {
    id: 'metric_1', before: 1.82, after: 0.47, unit: 'sec', absolute_delta: -1.35, relative_change_percent: -74.18,
  }]]);
  const candidate = { metric_ids: ['metric_1'], scope: null, measurement: {} };
  const facts = buildAllowedNumericFacts(candidate, { metricsById, evidenceById: new Map() });
  const byName = Object.fromEntries(facts.map((f) => [f.name, f]));
  assert.equal(byName.before.provenance_class, 'SOURCE_FACT');
  assert.equal(byName.before.externally_claimable, true);
  assert.equal(byName.after.provenance_class, 'SOURCE_FACT');
  assert.equal(byName.absolute_delta.provenance_class, 'DERIVED_FACT');
  assert.equal(byName.relative_change.provenance_class, 'DERIVED_FACT');
  assert.equal(byName.relative_change.externally_claimable, true);
});

test('V2: a metric with synthetic_fields:["before"] tags only "before" ADAPTER_INTERNAL, and every derived fact inherits non-claimability', () => {
  const metricsById = new Map([['metric_1', {
    id: 'metric_1', before: 100, after: 106.2, unit: 'percent', absolute_delta: 6.2, relative_change_percent: 6.2, synthetic_fields: ['before'],
  }]]);
  const candidate = { metric_ids: ['metric_1'], scope: null, measurement: {} };
  const facts = buildAllowedNumericFacts(candidate, { metricsById, evidenceById: new Map() });
  const byName = Object.fromEntries(facts.map((f) => [f.name, f]));
  assert.equal(byName.before.provenance_class, 'ADAPTER_INTERNAL');
  assert.equal(byName.before.externally_claimable, false);
  // "after" was NOT declared synthetic -- it stays SOURCE_FACT/claimable on
  // its own, even though it shares a candidate with a synthetic "before".
  assert.equal(byName.after.provenance_class, 'SOURCE_FACT');
  assert.equal(byName.after.externally_claimable, true);
  // absolute_delta/relative_change are DERIVED from BOTH before and after --
  // since one side (before) is synthetic, the derived values are equally
  // unclaimable.
  assert.equal(byName.absolute_delta.provenance_class, 'ADAPTER_INTERNAL');
  assert.equal(byName.absolute_delta.externally_claimable, false);
  assert.equal(byName.relative_change.provenance_class, 'ADAPTER_INTERNAL');
  assert.equal(byName.relative_change.externally_claimable, false);
});

test('V2: scope/run_count facts default to SOURCE_FACT/claimable regardless of the metric\'s own synthetic_fields', () => {
  const metricsById = new Map([['metric_1', {
    id: 'metric_1', before: 100, after: 106.2, unit: 'percent', synthetic_fields: ['before', 'after'],
  }]]);
  const candidate = {
    metric_ids: ['metric_1'], scope: { workers: 64 }, measurement: { run_count: 9 },
  };
  const facts = buildAllowedNumericFacts(candidate, { metricsById, evidenceById: new Map() });
  const byName = Object.fromEntries(facts.map((f) => [f.name, f]));
  assert.equal(byName.scope_workers.provenance_class, 'SOURCE_FACT');
  assert.equal(byName.scope_workers.externally_claimable, true);
  assert.equal(byName.run_count.provenance_class, 'SOURCE_FACT');
  assert.equal(byName.run_count.externally_claimable, true);
});
