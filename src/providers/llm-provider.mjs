/**
 * providers/llm-provider.mjs — the abstract LLMProvider contract.
 * ImpactCompiler Core depends only on this shape, never on a concrete
 * provider (e.g. Claude CLI) directly — see providers/claude-cli-provider.mjs
 * for the V1 implementation.
 *
 * A conforming provider exposes:
 *   async analyze({ normalizedEvidence, deterministicMetrics, context })
 *     -> { claims: object[], uncertainties: string[], limitations: string[], providerMeta: object }
 *
 * Responsible for: interpreting what problem the evidence addresses,
 * phrasing ImpactClaim statements, identifying uncertainty/limitations, and
 * referencing only supplied evidence_ids/metric_ids.
 *
 * Forbidden: computing/modifying any deterministic metric field (see
 * core/impact-schema.mjs's METRIC_DETERMINISTIC_FIELDS and
 * core/validation.mjs's validateProviderOutputHasNoMetricFields), inventing
 * evidence, or inventing metric_ids/evidence_ids that don't already exist.
 */

/** @returns {boolean} whether `provider` conforms to the LLMProvider shape. */
export function isLLMProvider(provider) {
  return Boolean(provider) && typeof provider.analyze === 'function';
}
