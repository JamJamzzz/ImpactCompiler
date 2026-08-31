/**
 * facts/quantitative-fact-adapter.mjs — adapts the external, user-authored
 * `--quantitative-fact <path>` JSON file shape onto
 * src/facts/quantitative-fact.mjs's existing, already-tested contract,
 * mirroring the read-parse-adapt pattern every other evidence/*-adapter.mjs
 * uses. The library contract requires an explicit `evidence_id` (a fact
 * must always trace to Evidence it came from); a CLI-supplied fact usually
 * doesn't reference some OTHER pre-existing Evidence record, so this
 * adapter auto-fills it with the fact's own about-to-be-created Evidence
 * id (self-referential — "this Evidence record IS the fact's source") only
 * when the caller didn't supply one explicitly.
 *
 * Canonical CLI input shape:
 * {
 *   "fact_id", "name", "kind"?, "value", "unit", "verification_status",
 *   "source_reference"?, "related_service"?, "related_benchmark_id"?,
 *   "observation_window"?: {"start","end"}, "scope"?, "assumptions"?
 * }
 * `observation_window` is accepted as this CLI shape's name for the
 * library's `window` field (adapted here, not renamed in the library, so
 * the already-tested pure module's field name never changes).
 */
import { createHash } from 'crypto';
import { validateQuantitativeFact, normalizeQuantitativeFact } from './quantitative-fact.mjs';

function evidenceIdFor(seed) {
  return `ev_${createHash('sha1').update(seed).digest('hex').slice(0, 12)}`;
}

/**
 * @param {object} raw - parsed JSON artifact content.
 * @param {string} sourcePath
 * @returns {{resolution:'resolved'|'unresolved'|'unsupported', reason?:string,
 *   fact?:object, raw:object, source_path:string}}
 */
export function parseQuantitativeFactArtifact(raw, sourcePath) {
  if (raw === null || typeof raw !== 'object') {
    return { resolution: 'unsupported', reason: 'artifact is not a JSON object', raw, source_path: sourcePath };
  }

  const selfEvidenceId = evidenceIdFor(`quantitative_fact:${sourcePath}:${raw.fact_id ?? ''}`);
  const adapted = {
    ...raw,
    window: raw.window ?? (raw.observation_window
      ? { before: raw.observation_window.start ?? null, after: raw.observation_window.end ?? null }
      : undefined),
    evidence_id: raw.evidence_id ?? selfEvidenceId,
  };

  const check = validateQuantitativeFact(adapted);
  if (!check.ok) {
    return {
      resolution: 'unresolved', reason: check.errors.join('; '), raw, source_path: sourcePath,
    };
  }

  return {
    resolution: 'resolved',
    fact: normalizeQuantitativeFact(adapted),
    // The fact's OWN Evidence record must be stamped with the exact same id
    // the fact declares as its evidence_id (self-referential case) so the
    // Evidence Store and the fact stay mutually consistent — never two
    // different ids for "the same source".
    selfEvidenceId: adapted.evidence_id === selfEvidenceId ? selfEvidenceId : null,
    raw,
    source_path: sourcePath,
  };
}
