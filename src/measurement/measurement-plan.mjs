/**
 * measurement/measurement-plan.mjs — shape/enum validation and
 * normalization for a Quantification V1 measurement plan (the input to
 * measurement-runner.mjs). Pure, no I/O.
 *
 * A measurement plan describes HOW to run an automated base-vs-target git
 * commit benchmark comparison: which repo/refs, which command, how many
 * warmup/measurement runs, and how to extract a single numeric result from
 * the command's stdout. Every command is represented as
 * `{ executable, args, cwd }` and is later invoked via execFile/spawn
 * (measurement/command-runner.mjs) — never a shell string, never
 * `shell: true` — so this validator explicitly rejects any plan that tries
 * to smuggle a shell command string in instead.
 */
import { METRIC_OPERATIONS, METRIC_DIRECTIONS, IMPACT_LEVELS } from '../core/impact-schema.mjs';

export const MEASUREMENT_RESULT_MODES = ['stdout_json', 'wall_clock'];
export const PRIMARY_STATISTICS = ['mean', 'median', 'p50', 'p95', 'p99'];

function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }
function isFiniteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function validateCommand(cmd, field, errors, { required }) {
  if (cmd === undefined) {
    if (required) errors.push(`${field}: required`);
    return;
  }
  if (!isPlainObject(cmd)) {
    errors.push(`${field}: must be an object with { executable, args, cwd } — shell-string commands are not supported`);
    return;
  }
  if (typeof cmd.command === 'string' || cmd.shell === true) {
    errors.push(`${field}: shell-string commands ("command"/"shell: true") are not supported — use { executable, args, cwd } invoked without a shell`);
  }
  if (!isNonEmptyString(cmd.executable)) errors.push(`${field}.executable: required non-empty string`);
  if (cmd.args !== undefined && !(Array.isArray(cmd.args) && cmd.args.every((a) => typeof a === 'string'))) {
    errors.push(`${field}.args: must be an array of strings`);
  }
  if (cmd.cwd !== undefined && typeof cmd.cwd !== 'string') errors.push(`${field}.cwd: must be a string`);
}

function validateLink(link, errors) {
  if (link === undefined) return;
  if (!isPlainObject(link)) { errors.push('link: must be an object'); return; }
  for (const key of ['service', 'release_id', 'deployment_ref']) {
    if (link[key] !== undefined && typeof link[key] !== 'string') errors.push(`link.${key}: must be a string when present`);
  }
}

function validateScope(scope, errors) {
  if (scope === undefined) return;
  if (!isPlainObject(scope)) { errors.push('scope: must be an object'); return; }
  if (scope.records !== undefined && (!isFiniteNumber(scope.records) || scope.records < 0)) {
    errors.push('scope.records: must be a non-negative finite number when present');
  }
  if (scope.dataset_name !== undefined && typeof scope.dataset_name !== 'string') {
    errors.push('scope.dataset_name: must be a string when present');
  }
}

/**
 * @param {object} plan - raw parsed measurement-plan JSON.
 * @returns {{ok:true, errors:[], plan:object}|{ok:false, errors:string[]}}
 *   On success, `plan` is normalized: `args`/`cwd` defaults filled in,
 *   `setup_command` explicitly null when absent, `primary_statistic`
 *   defaulted to 'median', `scope` defaulted to `{}`.
 */
export function validateMeasurementPlan(plan) {
  const errors = [];
  if (!isPlainObject(plan)) return { ok: false, errors: ['measurement plan must be a JSON object'] };

  if (plan.version !== 1) errors.push('version: must be 1');
  if (!isNonEmptyString(plan.benchmark_id)) errors.push('benchmark_id: required non-empty string');
  if (!isNonEmptyString(plan.repo)) errors.push('repo: required non-empty string');
  if (!isNonEmptyString(plan.base_ref)) errors.push('base_ref: required non-empty string');
  if (!isNonEmptyString(plan.target_ref)) errors.push('target_ref: required non-empty string');

  validateCommand(plan.command, 'command', errors, { required: true });
  if (plan.setup_command !== undefined) validateCommand(plan.setup_command, 'setup_command', errors, { required: false });

  if (!isPlainObject(plan.result)) {
    errors.push('result: required object');
  } else {
    const r = plan.result;
    if (!MEASUREMENT_RESULT_MODES.includes(r.mode)) errors.push(`result.mode: must be one of ${MEASUREMENT_RESULT_MODES.join(', ')}`);
    if (r.mode === 'stdout_json' && !isNonEmptyString(r.json_path)) errors.push('result.json_path: required non-empty string when result.mode is "stdout_json"');
    if (!isNonEmptyString(r.name)) errors.push('result.name: required non-empty string');
    if (!isNonEmptyString(r.unit)) errors.push('result.unit: required non-empty string');
    if (!METRIC_DIRECTIONS.includes(r.direction)) errors.push(`result.direction: must be one of ${METRIC_DIRECTIONS.join(', ')}`);
    if (!METRIC_OPERATIONS.includes(r.operation)) errors.push(`result.operation: must be one of ${METRIC_OPERATIONS.join(', ')}`);
    if (r.primary_statistic !== undefined && !PRIMARY_STATISTICS.includes(r.primary_statistic)) {
      errors.push(`result.primary_statistic: must be one of ${PRIMARY_STATISTICS.join(', ')}`);
    }
    // Resume-Impact phase: optional EXPLICIT classification — see
    // impact-candidate-builder.mjs's classification-source hierarchy.
    if (r.impact_level !== undefined && r.impact_level !== null && !IMPACT_LEVELS.includes(r.impact_level)) {
      errors.push(`result.impact_level: must be one of ${IMPACT_LEVELS.join(', ')} when present`);
    }
    if (r.impact_domain !== undefined && r.impact_domain !== null && typeof r.impact_domain !== 'string') {
      errors.push('result.impact_domain: must be a string when present');
    }
  }

  if (plan.warmup_runs !== undefined && (!Number.isInteger(plan.warmup_runs) || plan.warmup_runs < 0)) {
    errors.push('warmup_runs: must be a non-negative integer');
  }
  if (!Number.isInteger(plan.measurement_runs) || plan.measurement_runs < 1) {
    errors.push('measurement_runs: must be a positive integer (>= 1)');
  }
  if (!isFiniteNumber(plan.timeout_ms) || plan.timeout_ms <= 0) {
    errors.push('timeout_ms: must be a positive number');
  }

  validateScope(plan.scope, errors);
  validateLink(plan.link, errors);

  if (errors.length) return { ok: false, errors };

  const normalized = {
    version: 1,
    benchmark_id: plan.benchmark_id,
    repo: plan.repo,
    base_ref: plan.base_ref,
    target_ref: plan.target_ref,
    command: {
      executable: plan.command.executable,
      args: plan.command.args || [],
      cwd: plan.command.cwd || '.',
    },
    setup_command: plan.setup_command
      ? {
        executable: plan.setup_command.executable,
        args: plan.setup_command.args || [],
        cwd: plan.setup_command.cwd || '.',
      }
      : null,
    result: {
      mode: plan.result.mode,
      json_path: plan.result.json_path ?? null,
      name: plan.result.name,
      unit: plan.result.unit,
      direction: plan.result.direction,
      operation: plan.result.operation,
      primary_statistic: plan.result.primary_statistic || 'median',
      impact_level: plan.result.impact_level ?? null,
      impact_domain: plan.result.impact_domain ?? null,
    },
    warmup_runs: plan.warmup_runs ?? 0,
    measurement_runs: plan.measurement_runs,
    timeout_ms: plan.timeout_ms,
    scope: plan.scope ?? {},
    // Optional explicit shared identifiers for cross-linking this
    // controlled_benchmark to production evidence from the same run
    // (evidence-linker.mjs) — never a link ImpactCompiler infers itself.
    link: plan.link
      ? {
        service: plan.link.service ?? null,
        release_id: plan.link.release_id ?? null,
        deployment_ref: plan.link.deployment_ref ?? null,
      }
      : null,
  };
  return { ok: true, errors: [], plan: normalized };
}
