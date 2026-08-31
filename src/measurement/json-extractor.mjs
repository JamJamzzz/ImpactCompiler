/**
 * measurement/json-extractor.mjs — extracts a single finite numeric value
 * from a benchmark command's stdout for `result.mode: "stdout_json"`. Pure,
 * no I/O. A benchmark's stdout may contain other lines (progress output,
 * warnings) before its final JSON result line, so this tries the whole
 * trimmed stdout as JSON first, then falls back to scanning from the last
 * non-empty line backward for the first line that parses as JSON.
 */

function tryParseJson(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}

/** @returns {{ok:true, value:object}|{ok:false, reason:string}} */
export function extractStdoutJson(stdout) {
  const trimmed = (stdout || '').trim();
  if (!trimmed) return { ok: false, reason: 'stdout was empty — expected a JSON object' };

  const whole = tryParseJson(trimmed);
  if (whole !== undefined) return { ok: true, value: whole };

  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = tryParseJson(lines[i]);
    if (parsed !== undefined) return { ok: true, value: parsed };
  }
  return { ok: false, reason: 'stdout did not contain a parseable JSON object' };
}

/**
 * @param {string} stdout
 * @param {string} jsonPath - dot-separated path, e.g. "duration_seconds" or "timing.p50".
 * @returns {{ok:true, value:number}|{ok:false, reason:string}}
 */
export function extractJsonPathValue(stdout, jsonPath) {
  const parsedResult = extractStdoutJson(stdout);
  if (!parsedResult.ok) return parsedResult;

  const keys = jsonPath.split('.');
  let cursor = parsedResult.value;
  for (const key of keys) {
    if (cursor === null || typeof cursor !== 'object' || !(key in cursor)) {
      return { ok: false, reason: `json_path "${jsonPath}" not found in benchmark stdout JSON` };
    }
    cursor = cursor[key];
  }
  if (typeof cursor !== 'number' || !Number.isFinite(cursor)) {
    return { ok: false, reason: `json_path "${jsonPath}" did not resolve to a finite number (got ${JSON.stringify(cursor)})` };
  }
  return { ok: true, value: cursor };
}
