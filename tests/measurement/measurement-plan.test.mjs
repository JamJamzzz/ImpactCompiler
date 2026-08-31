import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMeasurementPlan } from '../../src/measurement/measurement-plan.mjs';

function basePlan(overrides = {}) {
  return {
    version: 1,
    benchmark_id: 'customer-matching-v1',
    repo: '/path/to/repo',
    base_ref: 'abc123',
    target_ref: 'def456',
    command: { executable: 'node', args: ['benchmarks/matching.mjs'], cwd: '.' },
    result: {
      mode: 'stdout_json',
      json_path: 'duration_seconds',
      name: 'customer matching runtime',
      unit: 'sec',
      direction: 'lower_is_better',
      operation: 'percentage_reduction',
      primary_statistic: 'median',
    },
    warmup_runs: 5,
    measurement_runs: 30,
    timeout_ms: 60000,
    scope: { dataset_name: 'synthetic-customers-v3', records: 1000000 },
    ...overrides,
  };
}

test('a valid plan (the README/task-spec example shape) passes', () => {
  const result = validateMeasurementPlan(basePlan());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.plan.command.executable, 'node');
  assert.equal(result.plan.result.primary_statistic, 'median');
});

test('setup_command is optional', () => {
  const result = validateMeasurementPlan(basePlan());
  assert.equal(result.ok, true);
  assert.equal(result.plan.setup_command, null);
});

test('primary_statistic defaults to median when omitted', () => {
  const plan = basePlan();
  delete plan.result.primary_statistic;
  const result = validateMeasurementPlan(plan);
  assert.equal(result.ok, true);
  assert.equal(result.plan.result.primary_statistic, 'median');
});

test('missing command is rejected', () => {
  const plan = basePlan();
  delete plan.command;
  const result = validateMeasurementPlan(plan);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('command: required')));
});

test('missing command.executable is rejected', () => {
  const plan = basePlan({ command: { args: ['x'] } });
  const result = validateMeasurementPlan(plan);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('command.executable')));
});

test('shell-string commands are rejected, never accepted as executable+args', () => {
  const plan = basePlan({ command: 'node benchmarks/matching.mjs' });
  const result = validateMeasurementPlan(plan);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('shell')));
});

test('a command object with an embedded "command" string field is rejected', () => {
  const plan = basePlan({ command: { command: 'node benchmarks/matching.mjs', executable: 'node' } });
  const result = validateMeasurementPlan(plan);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('shell-string')));
});

test('command.shell: true is rejected outright', () => {
  const plan = basePlan({ command: { executable: 'node', args: [], shell: true } });
  const result = validateMeasurementPlan(plan);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('shell')));
});

test('invalid (zero) measurement_runs is rejected', () => {
  const plan = basePlan({ measurement_runs: 0 });
  const result = validateMeasurementPlan(plan);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('measurement_runs')));
});

test('negative warmup_runs is rejected', () => {
  const plan = basePlan({ warmup_runs: -1 });
  const result = validateMeasurementPlan(plan);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('warmup_runs')));
});

test('non-integer measurement_runs is rejected', () => {
  const plan = basePlan({ measurement_runs: 2.5 });
  const result = validateMeasurementPlan(plan);
  assert.equal(result.ok, false);
});

test('missing json_path when mode is stdout_json is rejected', () => {
  const plan = basePlan();
  delete plan.result.json_path;
  const result = validateMeasurementPlan(plan);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('json_path')));
});

test('invalid result.operation is rejected', () => {
  const plan = basePlan();
  plan.result.operation = 'multiply_by_pi';
  const result = validateMeasurementPlan(plan);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('result.operation')));
});

test('invalid result.direction is rejected', () => {
  const plan = basePlan();
  plan.result.direction = 'sideways';
  const result = validateMeasurementPlan(plan);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('result.direction')));
});

test('invalid result.mode is rejected', () => {
  const plan = basePlan();
  plan.result.mode = 'telepathy';
  const result = validateMeasurementPlan(plan);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('result.mode')));
});

test('invalid scope.records (negative) is rejected', () => {
  const plan = basePlan({ scope: { dataset_name: 'x', records: -5 } });
  const result = validateMeasurementPlan(plan);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('scope.records')));
});

test('invalid scope (not an object) is rejected', () => {
  const plan = basePlan({ scope: 'a lot of records' });
  const result = validateMeasurementPlan(plan);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('scope')));
});

test('missing timeout_ms is rejected', () => {
  const plan = basePlan();
  delete plan.timeout_ms;
  const result = validateMeasurementPlan(plan);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('timeout_ms')));
});

test('missing base_ref/target_ref is rejected', () => {
  const plan = basePlan({ base_ref: '', target_ref: undefined });
  const result = validateMeasurementPlan(plan);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('base_ref')));
  assert.ok(result.errors.some((e) => e.includes('target_ref')));
});

test('a non-object plan is rejected', () => {
  const result = validateMeasurementPlan('not a plan');
  assert.equal(result.ok, false);
});
