/**
 * measurement/measurement-runner.mjs — executes a validated measurement plan
 * (measurement-plan.mjs) end to end: resolves base/target commits, creates
 * isolated detached git worktrees for each, runs an optional setup command
 * in both, runs warmup executions (discarded) then measurement executions
 * (alternating base/target order to spread thermal/load drift evenly
 * across the run instead of concentrating it on one side), and always
 * cleans up its temp worktrees in a `finally` block. Every raw sample is
 * preserved. Never modifies the caller's current working tree, branches, or
 * uncommitted/untracked files — it only ever touches its own fresh temp
 * worktrees.
 *
 * This is the runner/adapter layer: git and process execution live here,
 * NOT in core/impact-compiler.mjs (which only orchestrates) and NOT in
 * measurement/stats-engine.mjs (which stays pure).
 */
import os from 'node:os';
import { join } from 'node:path';
import {
  resolveCommitSha, createDetachedWorktree, removeWorktree,
} from './git-worktree.mjs';
import { runCommand } from './command-runner.mjs';
import { extractJsonPathValue } from './json-extractor.mjs';
import { computeStatistics, classifyMeasurementQuality, computeBootstrapCI } from './stats-engine.mjs';

const BOOTSTRAP_MIN_SAMPLES = 10;

function captureEnvironment() {
  const cpus = os.cpus();
  return {
    platform: process.platform,
    arch: process.arch,
    runtime: `node ${process.version}`,
    cpu: cpus[0]?.model ?? 'unknown',
    logical_cpu_count: cpus.length,
    total_memory_bytes: os.totalmem(),
  };
}

/** Runs one benchmark invocation in `worktreePath` and extracts its result value. */
async function runOneSample(plan, worktreePath) {
  const res = await runCommand({
    executable: plan.command.executable,
    args: plan.command.args,
    cwd: join(worktreePath, plan.command.cwd),
    timeoutMs: plan.timeout_ms,
  });
  if (!res.ok) return { ok: false, reason: res.reason };

  if (plan.result.mode === 'wall_clock') {
    // wall_clock is intentionally not used for any deterministic test
    // assertion (see measurement-plan.mjs docs) — this path exists only so
    // a real caller can opt into it; stdout_json remains the only mode
    // exercised by ImpactCompiler's own end-to-end tests.
    return { ok: false, reason: '"wall_clock" result mode is not yet implemented by measurement-runner.mjs' };
  }

  const extracted = extractJsonPathValue(res.stdout, plan.result.json_path);
  if (!extracted.ok) return { ok: false, reason: extracted.reason };
  return { ok: true, value: extracted.value };
}

async function runSetupCommand(plan, worktreePath, label) {
  if (!plan.setup_command) return { ok: true };
  const res = await runCommand({
    executable: plan.setup_command.executable,
    args: plan.setup_command.args,
    cwd: join(worktreePath, plan.setup_command.cwd),
    timeoutMs: plan.timeout_ms,
  });
  if (!res.ok) return { ok: false, reason: `setup_command failed on ${label} worktree: ${res.reason}` };
  return { ok: true };
}

/**
 * @param {object} plan - a normalized plan from measurement-plan.mjs's validateMeasurementPlan.
 * @returns {Promise<object>} a result object describing what happened —
 *   never throws for an ordinary measurement/execution failure (those come
 *   back as `resolved:false` + `reason`); only truly unexpected internal
 *   errors propagate.
 */
export async function runMeasurementPlan(plan) {
  const environment = captureEnvironment();
  const baseSha = resolveCommitSha(plan.repo, plan.base_ref);
  const targetSha = resolveCommitSha(plan.repo, plan.target_ref);

  const emptyResult = (reason) => ({
    resolved: false,
    reason,
    base_commit: baseSha,
    target_commit: targetSha,
    environment,
    raw_samples: { before: [], after: [] },
    statistics: computeStatistics([], []),
    measurement_quality: 'insufficient',
    confidence_interval: null,
    execution_failures: [],
    cleanup_limitations: [],
  });

  if (!baseSha || !targetSha) {
    const missing = [!baseSha ? `base_ref "${plan.base_ref}"` : null, !targetSha ? `target_ref "${plan.target_ref}"` : null].filter(Boolean);
    return emptyResult(`could not resolve ${missing.join(' and ')} to a real commit in "${plan.repo}"`);
  }

  let baseWorktree = null;
  let targetWorktree = null;
  const cleanupLimitations = [];
  const beforeSamples = [];
  const afterSamples = [];
  const executionFailures = [];
  let abortReason = null;

  try {
    baseWorktree = createDetachedWorktree(plan.repo, baseSha, 'base');
    targetWorktree = createDetachedWorktree(plan.repo, targetSha, 'target');

    const baseSetup = await runSetupCommand(plan, baseWorktree.worktreePath, 'base');
    if (!baseSetup.ok) { abortReason = baseSetup.reason; }
    if (!abortReason) {
      const targetSetup = await runSetupCommand(plan, targetWorktree.worktreePath, 'target');
      if (!targetSetup.ok) abortReason = targetSetup.reason;
    }

    if (!abortReason) {
      for (let i = 0; i < plan.warmup_runs; i++) {
        // eslint-disable-next-line no-await-in-loop
        await runOneSample(plan, baseWorktree.worktreePath);
        // eslint-disable-next-line no-await-in-loop
        await runOneSample(plan, targetWorktree.worktreePath);
      }

      for (let i = 0; i < plan.measurement_runs; i++) {
        // Alternate which side runs first each iteration to spread thermal/
        // machine-load drift evenly across base and target rather than
        // concentrating it on whichever side always goes first/second.
        const baseFirst = i % 2 === 0;
        let baseResult;
        let targetResult;
        if (baseFirst) {
          // eslint-disable-next-line no-await-in-loop
          baseResult = await runOneSample(plan, baseWorktree.worktreePath);
          // eslint-disable-next-line no-await-in-loop
          targetResult = await runOneSample(plan, targetWorktree.worktreePath);
        } else {
          // eslint-disable-next-line no-await-in-loop
          targetResult = await runOneSample(plan, targetWorktree.worktreePath);
          // eslint-disable-next-line no-await-in-loop
          baseResult = await runOneSample(plan, baseWorktree.worktreePath);
        }

        if (baseResult.ok) beforeSamples.push(baseResult.value);
        else executionFailures.push(`base run #${i + 1}: ${baseResult.reason}`);
        if (targetResult.ok) afterSamples.push(targetResult.value);
        else executionFailures.push(`target run #${i + 1}: ${targetResult.reason}`);
      }
    }
  } finally {
    if (baseWorktree) cleanupLimitations.push(...removeWorktree(plan.repo, baseWorktree.worktreePath, baseWorktree.parentDir));
    if (targetWorktree) cleanupLimitations.push(...removeWorktree(plan.repo, targetWorktree.worktreePath, targetWorktree.parentDir));
  }

  if (abortReason) {
    return { ...emptyResult(abortReason), cleanup_limitations: cleanupLimitations };
  }

  const statistics = computeStatistics(beforeSamples, afterSamples);
  // "Enough valid samples" is deliberately strict: every requested
  // measurement run must have produced a valid sample on both sides. A
  // partial run is preserved as evidence (raw_samples/statistics are still
  // returned below) but never silently treated as sufficient to compute a
  // Metric from.
  const enoughSamples = beforeSamples.length === plan.measurement_runs && afterSamples.length === plan.measurement_runs;
  const measurementQuality = classifyMeasurementQuality(statistics);

  let confidenceInterval = null;
  if (beforeSamples.length >= BOOTSTRAP_MIN_SAMPLES && afterSamples.length >= BOOTSTRAP_MIN_SAMPLES) {
    const ci = computeBootstrapCI(beforeSamples, afterSamples, { minSamples: BOOTSTRAP_MIN_SAMPLES });
    confidenceInterval = ci.ok ? ci : null;
  }

  const resolved = enoughSamples && executionFailures.length === 0;
  const reason = resolved
    ? null
    : (executionFailures.length
      ? `execution failures: ${executionFailures.join('; ')}`
      : `insufficient valid samples collected (before=${beforeSamples.length}, after=${afterSamples.length}, requested=${plan.measurement_runs})`);

  return {
    resolved,
    reason,
    base_commit: baseSha,
    target_commit: targetSha,
    environment,
    raw_samples: { before: beforeSamples, after: afterSamples },
    statistics,
    measurement_quality: measurementQuality,
    confidence_interval: confidenceInterval,
    execution_failures: executionFailures,
    cleanup_limitations: cleanupLimitations,
  };
}
