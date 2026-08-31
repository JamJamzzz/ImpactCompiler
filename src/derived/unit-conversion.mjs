/**
 * derived/unit-conversion.mjs — the ONE whitelisted, deterministic unit
 * conversion registry in ImpactCompiler. This exists to let a Derivation
 * Request (src/derived/derivation-request.mjs) EXPLICITLY ask for a
 * different (but genuinely compatible) output unit — e.g. "give me this
 * result in hours/year, not minutes/year" — without opening the door to
 * implicit conversion anywhere else in the system. A conversion only ever
 * happens when:
 *   - the caller explicitly names the target unit (never inferred);
 *   - the source and target units belong to the SAME family (time, or
 *     data size) — never cross-family, never currency, never a calendar-
 *     dependent guess (e.g. "weeks" -> "months" is refused: a month has no
 *     fixed number of weeks);
 *   - an exact factor exists in this table;
 *   - the arithmetic is performed here, by deterministic code, and the
 *     calculation string always records exactly what was done.
 * No LLM ever performs or proposes this arithmetic.
 */

/** Every time unit's size in seconds — the family's base unit. */
const TIME_SECONDS = {
  ms: 0.001,
  millisecond: 0.001,
  milliseconds: 0.001,
  sec: 1,
  secs: 1,
  second: 1,
  seconds: 1,
  s: 1,
  min: 60,
  mins: 60,
  minute: 60,
  minutes: 60,
  hour: 3600,
  hours: 3600,
  hr: 3600,
  day: 86400,
  days: 86400,
};

/**
 * Every data-size unit's size in bytes — binary (1024-based) convention,
 * documented explicitly here (never silently switched to a 1000-based
 * convention): 1 KB = 1024 bytes, 1 MB = 1024 KB, 1 GB = 1024 MB.
 */
const DATA_BYTES = {
  byte: 1,
  bytes: 1,
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
};

const FAMILIES = [
  { name: 'time', table: TIME_SECONDS },
  { name: 'data_size', table: DATA_BYTES },
];

function normalizeUnitWord(u) {
  return String(u || '').trim().toLowerCase();
}

/**
 * Splits a unit like "minutes/year" into { base: "minutes", period: "year" }.
 * A unit with no "/" has period `null`.
 */
function splitRateUnit(unit) {
  const parts = String(unit || '').split('/');
  if (parts.length === 1) return { base: normalizeUnitWord(parts[0]), period: null };
  if (parts.length === 2) return { base: normalizeUnitWord(parts[0]), period: normalizeUnitWord(parts[1]) };
  return { base: normalizeUnitWord(unit), period: undefined }; // more than one "/" — not a supported rate-unit shape
}

function findFamily(unitWord) {
  return FAMILIES.find((f) => Object.prototype.hasOwnProperty.call(f.table, unitWord));
}

/**
 * @param {number} value
 * @param {string} fromUnit - e.g. "minutes/year" or "ms".
 * @param {string} toUnit - e.g. "hours/year" or "sec". Must be EXPLICITLY
 *   requested by the caller — this function never infers a target unit.
 * @returns {{ok:true, value:number, unit:string, calculation:string}|
 *   {ok:false, reason:string}}
 *   Never throws. Rejects incompatible families, mismatched rate periods
 *   (a calendar-dependent conversion like weeks->months is never assumed),
 *   and any unit not in the whitelist table.
 */
export function convertUnit(value, fromUnit, toUnit) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, reason: 'convertUnit requires a finite numeric value' };
  }
  const from = splitRateUnit(fromUnit);
  const to = splitRateUnit(toUnit);

  if (from.period === undefined || to.period === undefined) {
    return { ok: false, reason: `unsupported unit shape: "${fromUnit}" -> "${toUnit}" (at most one "/" is supported, e.g. "minutes/year")` };
  }
  if (from.period !== to.period) {
    return {
      ok: false,
      reason: `refusing a calendar-dependent conversion: the period differs ("${from.period ?? '(none)'}" vs "${to.period ?? '(none)'}") — periods are never assumed convertible (e.g. weeks/months have no fixed exact ratio)`,
    };
  }

  if (from.base === to.base) {
    // Same unit — a trivial, exact "conversion": no arithmetic needed.
    return {
      ok: true, value, unit: toUnit, operator: null, factor: 1,
    };
  }

  const fromFamily = findFamily(from.base);
  const toFamily = findFamily(to.base);
  if (!fromFamily || !toFamily) {
    return { ok: false, reason: `unsupported conversion path: "${fromUnit}" -> "${toUnit}" is not in the whitelisted unit-conversion registry` };
  }
  if (fromFamily.name !== toFamily.name) {
    return { ok: false, reason: `incompatible units: "${fromUnit}" (${fromFamily.name}) cannot convert to "${toUnit}" (${toFamily.name})` };
  }

  const fromFactor = fromFamily.table[from.base];
  const toFactor = toFamily.table[to.base];
  const ratio = fromFactor / toFactor;
  const converted = value * ratio;

  // `operator`/`factor` describe the exact arithmetic performed — a caller
  // with the ORIGINAL (pre-conversion) calculation string can compose a
  // single audit trail, e.g. "(<original calculation>) / 60", rather than
  // this module inventing its own disconnected calculation text.
  const operator = ratio >= 1 ? '×' : '/';
  const factor = ratio >= 1 ? ratio : 1 / ratio;

  return {
    ok: true, value: converted, unit: toUnit, operator, factor,
  };
}

export { TIME_SECONDS, DATA_BYTES };
