/**
 * measurement/attribution.mjs — deterministic attribution-strength
 * classification for a controlled_benchmark. Pure, no I/O, never decided by
 * an LLM.
 *
 * measurement-runner.mjs always drives base and target through the exact
 * same measurement plan, on the same machine, in the same process — so
 * "same command", "same scope", and "same environment" are structurally
 * guaranteed by construction in this V1 runner (there is no code path that
 * could vary them between sides) and are not re-checked here. What DOES
 * vary run-to-run is: whether both refs resolved to real commits, whether
 * both sides produced enough valid samples, and whether any execution
 * failed — those are the three conditions this module evaluates.
 */
export const ATTRIBUTION_STRENGTHS = ['strong', 'moderate', 'weak', 'none'];

/**
 * @param {{baseResolved:boolean, targetResolved:boolean, enoughSamples:boolean,
 *   executionFailures?:string[], baseCommit:string|null, targetCommit:string|null}} input
 * @returns {{strength:string, method:'controlled_before_after', base_commit:string|null,
 *   target_commit:string|null, confounders:string[]}}
 */
export function computeAttribution({
  baseResolved, targetResolved, enoughSamples, executionFailures = [], baseCommit, targetCommit,
}) {
  const confounders = [];
  if (!baseResolved || !targetResolved) confounders.push('base and/or target ref could not be resolved to a real commit');
  if (!enoughSamples) confounders.push('one or both sides did not produce enough valid measurement samples');
  if (executionFailures.length) confounders.push(`${executionFailures.length} benchmark execution(s) failed`);

  let strength;
  if (baseResolved && targetResolved && enoughSamples && executionFailures.length === 0) {
    strength = 'strong';
  } else if (baseResolved && targetResolved) {
    strength = 'moderate';
  } else if (baseResolved || targetResolved) {
    strength = 'weak';
  } else {
    strength = 'none';
  }

  return {
    strength,
    method: 'controlled_before_after',
    base_commit: baseCommit,
    target_commit: targetCommit,
    confounders,
  };
}
