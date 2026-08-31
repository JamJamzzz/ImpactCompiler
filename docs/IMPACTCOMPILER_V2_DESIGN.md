# ImpactCompiler V2 — Design Document

Targeted evaluation-driven hardening pass, motivated by concrete weaknesses found in `evaluations/external-impactbench-deep/` (see `FAILURE_ANALYSIS.md`, `ADVERSARIAL_VALIDATION_RESULTS.json`). Development baseline: commit `a762934` (`main`, 446/446 tests passing, working tree clean). This document was written before any implementation edit, per the task's own "do not edit implementation before the design exists" instruction; where an implementation detail below differs from the literal task prompt's illustrative examples, that deviation is called out explicitly (the prompt itself says "do not copy this schema blindly").

## 1. What V2 changes

1. **Fact provenance model** — every fact `buildAllowedNumericFacts` emits now carries `provenance_class` (one of `FACT_PROVENANCE_CLASSES`) and `externally_claimable` (boolean). An evidence adapter can explicitly declare specific before/after fields as artificial (`synthetic_fields`), which propagates to `ADAPTER_INTERNAL`/non-claimable on the resulting facts.
2. **Numeric tokenizer fix** (`core/validation.mjs`'s `extractNumericTokens`) — preserves a leading `-`/`+` sign, and adds a general digit-letter-digit exclusion so identifiers shaped like `2to3` never leak a spurious numeric token (identifiers shaped like `sha256`/`x86`/`h264`/`ipv6`/`Python3` were already correctly excluded by the pre-existing letter-before-digit lookbehind).
3. **`validateAgainstAllowedNumericFacts`** now excludes any fact with `externally_claimable === false` from the allowed set. Backward compatible: a V1 fact has no such field, so `undefined !== false` and nothing changes for it.
4. **New module `core/claim-semantics.mjs`** — a structured, multi-violation semantic-claim validator (`validateClaimSemantics(text, candidate)` → `{valid, violations}`) layering three new, bounded, deterministic checks on top of the existing numeric-membership check: unit consistency, polarity/direction consistency, scope-generalization.
5. **New schema enums** in `core/impact-schema.mjs`: `FACT_PROVENANCE_CLASSES`, `CLAIM_VIOLATION_TYPES`.
6. **`evidence/benchmark-adapter.mjs`** gains an optional `synthetic_fields: string[]` input field (subset of `['before','after']`), never inferred — only ever taken verbatim from what an adapter author explicitly declares.
7. **`core/impact-compiler.mjs`'s `collectBenchmarkEvidence`** threads `parsed.synthetic_fields` onto the computed `Metric` object so `allowed-numeric-facts.mjs` can read it via `metricsById`.

(P1 items — benchmark↔implementation provenance linking, first-class test-result evidence, aggregate evidence — are designed and scoped separately; see the corresponding sections below and are implemented as a second commit on top of this one, per the same additive discipline.)

## 2. What V2 does NOT change

- **Ranking/recommendation semantics** (already fixed in the prior "V1 hardening" commit) — untouched.
- **`deterministic-metric-engine.mjs`'s `computeMetric`** — still hard-requires numeric before/after. V2 does NOT add a "percentage-only metric" computation path; that would be a materially larger, riskier change to the one module where all arithmetic happens, and no External ImpactBench — Deep finding demonstrates `computeMetric` itself produces an incorrect result — the actual finding is that an EVALUATION HARNESS had to invent synthetic before/after values to satisfy this requirement for percentage-only rustc-perf data. V2's fix addresses that at the fact-provenance layer (`synthetic_fields` → `ADAPTER_INTERNAL`), which is the smaller, more targeted, more auditable fix: it makes the EXISTING synthetic-anchor pattern safe (unclaimable) rather than redesigning the metric engine to avoid needing one.
- **Every V1-hardening behavior already externally validated** (candidate preservation, scope preservation, regression preservation, polarity classification, no-fabrication for unmeasured evidence, missing-benchmark opportunity detection, synthetic-anchor non-leakage at the OLD "never appears in `allowed_numeric_facts` at all" level, deterministic numeric display aliases, full candidate retention) — none of these code paths are modified; V2 only adds new, additive checks alongside them.
- **`SCHEMA_VERSION`** stays `5.0.0` — every V2 addition is a new optional field or a new enum value, following the exact precedent already documented in `impact-schema.mjs` for the V1-hardening/Resume-Impact phases ("no version bump... additive-only").

## 3. Semantic-validation model

`validateClaimSemantics(text, candidate)` runs four independent checks and merges their findings:

1. **Numeric membership** (reuses `validateAgainstAllowedNumericFacts` verbatim) — is every cited number traceable to a claimable fact? A token matching ONLY a non-claimable fact is reported as `adapter_internal_fact` (more specific than a bare `unsupported_number`).
2. **Unit consistency** — a small, closed table of canonical unit categories (`UNIT_CATEGORIES` in `claim-semantics.mjs`: time/memory/percent/multiplier/common countable entities). For each numeric token that matches a claimable fact whose OWN unit resolves to a known category, scan a short bounded window immediately after the token (stopping at the next digit, so an adjacent DIFFERENT number's unit is never misattributed) for a claimed unit word; if it also resolves to a known category and DIFFERS, that's a `unit_mismatch`. A fact or claim whose unit isn't in the table produces no opinion — this is intentionally narrow, per the task's explicit "do not make aggressive fuzzy equivalences" instruction.
3. **Polarity/direction consistency** — two INDEPENDENT checks, deliberately kept separate per the task's own warning: (a) a DELTA-direction word (increased/decreased/rose/fell/...) must match the actual arithmetic SIGN of the matched fact's value, regardless of whether that's good or bad; (b) an OUTCOME word (improved/regressed/better/worse/...) must match the candidate's own `outcome` field (already deterministically resolved from `direction`+delta sign by the metric engine — never re-derived from the word itself).
4. **Scope generalization** — a small, closed phrase list (`UNIVERSAL_SCOPE_PHRASES`: "overall", "system-wide", "across all", "all workloads", ...). A claim containing one is a violation ONLY when `candidate.quality_profile.scope_breadth !== 'global'` — i.e. only when the evidence itself doesn't explicitly assert universal coverage. **(V2.1 correction, see §9 — this originally, incorrectly, keyed off `scope_completeness`.)**

None of these four checks is an NLU engine or an LLM call — each is a small, explicit, auditable table plus straightforward lexical proximity, matching the task's explicit non-goal list (no embeddings, no fuzzy semantic matching).

## 4. Fact-provenance model

See `FACT_PROVENANCE_CLASSES` in `impact-schema.mjs` for the full enum and rationale. Summary:

| Class | Externally claimable | Producer |
|---|---|---|
| `SOURCE_FACT` | yes | before/after values genuinely present in evidence; scope/run_count facts |
| `DERIVED_FACT` | yes | absolute_delta/relative_change/result_value computed from source facts |
| `DISPLAY_ALIAS` | inherits its parent fact | rounded/comma/word-form variants (not a separate fact record) |
| `ADAPTER_INTERNAL` | **no** | a value an adapter explicitly declared as an artificial schema-compatibility placeholder (`synthetic_fields`) |
| `IMPLEMENTATION_SCALE_FACT` | yes (but not an impact metric) | real implementation quantities (e.g. architecture facts) — forward-declared here; a live producer is wired in the P1 first-class test-result work, not this P0 pass |

Default (no `provenanceClass` passed to `pushFact`) is `SOURCE_FACT`/claimable — this is exactly what every pre-V2 call site gets, so no existing fact's claimability changes.

## 5. Compatibility requirements

- Every new field (`provenance_class`, `externally_claimable`, `synthetic_fields`) is additive and optional. An artifact/fact/evidence record from before V2 has none of them and behaves identically to its pre-V2 behavior.
- `validateAgainstAllowedNumericFacts`'s function signature and default behavior are unchanged for any caller not supplying `externally_claimable: false` facts.
- `validateClaimSemantics` is a NEW function, not a replacement — existing callers of `validateAgainstAllowedNumericFacts` are unaffected and continue to work exactly as before.

## 6. New failure modes

- A previously-passing claim could newly fail if: it cites a number whose ONLY matching fact is `ADAPTER_INTERNAL` (by design — this is the fix); it states a unit word that resolves to a DIFFERENT known category than the fact's own (by design); it uses a direction/outcome word contradicting the fact's real sign/outcome (by design); it uses universal-scope language over an incomplete-scope candidate (by design). Each of these is an intended new rejection, not a regression — see the regression-protection strategy below for how V1-valid claims are confirmed to still pass.
- A new, purely additive risk: the unit/polarity/scope checks could, in principle, misfire on a legitimate claim if a coincidental word match occurs (e.g. a benchmark actually named "seconds" might trip the unit table). This is mitigated by keeping every table small, closed, and reviewed, and by the regression test suite explicitly checking that ordinary valid phrasing (including `lower_is_better` semantics) is never misjudged (see `tests/core/claim-semantics.test.mjs`'s V2-7b).

## 7. Regression-protection strategy

1. Every V1-hardening capability (candidate preservation, scope preservation, recommendation-safety, synthetic-anchor non-leakage at the pre-V2 level, deterministic aliases) has an existing test file that must continue to pass unmodified — no existing test was deleted or weakened for V2.
2. 27 new tests added directly alongside the P0 implementation (`tests/core/claim-semantics.test.mjs`, plus targeted additions to `tests/evidence/benchmark-adapter.test.mjs`, `tests/candidates/allowed-numeric-facts.test.mjs`, `tests/core/allowed-numeric-facts-validation.test.mjs`), covering all 13 items the task's "adversarial regression tests" section names, using NEW synthetic fixtures never present in the External ImpactBench corpus (no case ids, no real benchmark names, no real PR numbers) — per the "no cheating" rule.
3. Full suite re-run after every implementation change during this pass (446 → 473 passing, zero failures at any intermediate step).
4. The development-set (External ImpactBench — Deep, now SEEN data) is used only as an additional confirmation pass AFTER the above, never as the primary correctness gate, and every result from it is labeled `DEVELOPMENT-SET ONLY / NOT BLIND VALIDATION` per the task's own instruction.

## 8. Addendum — P1 item 3 (aggregate/grouped evidence): DEFERRED

Investigated and explicitly deferred, not implemented. Rationale:

The proposed mechanism was: a `quantitative_fact` evidence record MAY
declare `aggregate_of: string[]` (other quantitative_fact ids in the same
run, explicitly named, never inferred), validated for (a) matching `unit`,
(b) "numerator/denominator semantics compatible", (c) no fact aggregated
into more than one aggregate.

Check (b) cannot be implemented honestly with the CURRENT Quantitative Fact
schema (`src/facts/quantitative-fact.mjs`). A fact today is a single scalar
`{value, unit}` pair with a free-text, unvalidated `kind` — there is no
structured numerator/denominator (or "this is a count" vs "this is a total"
vs "this is a rate") concept anywhere in the codebase (confirmed: no
`numerator`/`denominator` field exists in `quantitative-fact.mjs`,
`formula-registry.mjs`, or `derivation-request.mjs`). Same-`unit` alone is
NOT sufficient to guarantee two facts are safe to sum: two facts can
legitimately share a unit (e.g. `"tests"`) while representing incompatible
roles (`"41 tests passed"` vs `"58 tests total"`) — summing them would
silently double-count/misrepresent exactly the thing this feature exists to
prevent, with no error surfaced, because the schema has no way to express
the distinction. A same-unit-only check would be a check that LOOKS like it
enforces semantic compatibility but doesn't — worse than not implementing
it, because it would give false confidence.

Building a CORRECT version requires extending the whitelisted Quantitative
Fact schema itself (e.g. an explicit `count_role: 'numerator' | 'denominator'
| 'total' | 'independent'` field, or a structured `{numerator, denominator}`
fact shape) so aggregation could validate role-compatibility instead of
unit-string equality. That is real, non-trivial schema surface touching a
module already consumed by `formula-registry.mjs`/`derivation-request.mjs` —
a materially larger and riskier change than "a clean, small, explicit
opt-in mechanism," and out of scope for this pass.

**What a future minimal version would need**, in order:
1. A structured role/shape addition to `quantitative-fact.mjs` (additive —
   e.g. an optional `count_role` field, defaulting to `'independent'` so
   every existing fact is unaffected).
2. `aggregate_of` validation restricted to facts sharing BOTH `unit` AND a
   compatible `count_role` (e.g. only `'numerator'`-role facts may be summed
   into a combined numerator; never mixing a `'total'`-role fact into a sum
   of `'numerator'`-role facts).
3. The "no fact aggregated twice" and "same run only" rules from the
   original proposal, unchanged — those two are already cleanly
   implementable today and were not the blocker.
4. New tests proving the double-counting failure mode this defers around is
   actually caught (e.g. an attempt to sum a `'numerator'` and a `'total'`
   fact sharing the same unit is rejected, not silently summed).

No schema/code change was made for this item. See
`evaluations/impactcompiler-v2-development/V1_V2_DEVELOPMENT_REPORT.md` for
the corresponding entry in the final report.

## 9. Addendum — V2.1 (bounded semantic-closure pass, pre-P2)

Two development findings from V2's own evaluation were closed in a
tightly-scoped follow-up pass before P2, per its own explicit scope
boundary (only these two, nothing else):

**Finding A — scope traceability vs. generalization authority (real product
fix).** `quality_profile.scope_completeness` answers "is scope recorded and
traceable?", never "does the evidence justify broad/universal language?" — a
single, perfectly traceable benchmark measurement (`scope_completeness:
'complete'`) let `checkScopeGeneralization` wave through "overall"/"system-
wide" language unconditionally (reproduced 0/1 on a realistic single-
benchmark fixture). Fixed by introducing a NEW, separate field,
`quality_profile.scope_breadth` (`'specific'` | `'multi_scope'` | `'global'`
| `'unknown'` — `core/impact-schema.mjs`'s `SCOPE_BREADTH_VALUES`,
`candidates/quality-profile.mjs`'s `deriveScopeBreadth`), which
`checkScopeGeneralization` now reads instead. `scope_completeness` itself —
its values, its meaning, every one of its other consumers (`ranking.mjs`,
`impact-opportunities.mjs`, `review-renderer.mjs`) — is completely
unchanged; this is a new field, not a redefinition, per the task's explicit
"do not redefine scope_completeness" instruction. Full detail:
`docs/IMPACTCOMPILER_V2_VALIDATION_MODEL.md` §4.

**Finding B — a development-fixture-generator bug, not a `claim-semantics.mjs`
defect.** `evaluations/external-impactbench-deep/harness/gen_run_adversarial.mjs`
line 79 constructed its `'polarity_flipped'` category's claim text as the
word MATCHING the real sign, never an inverted one, so that category could
never have caught a real polarity error. The old, frozen P1 fixture was left
untouched (per instruction); a corrected, comprehensive 8-semantic-pair
matrix was added as real regression tests (`V2.1-5`/`V2.1-6` in
`tests/core/claim-semantics.test.mjs`) and a standalone development artifact
(`evaluations/impactcompiler-v2-development/V2_1_POLARITY_FIXTURES.json`).
No product code changed for this finding — the polarity check itself was
already correct.

**Schema impact:** `SCHEMA_VERSION` stayed `5.0.0` — `scope_breadth` is a new
optional field on an already-additive, unvalidated-by-shape-check part of the
artifact (`quality_profile`); no existing artifact's meaning changed.

See `evaluations/impactcompiler-v2-development/V2_1_SEMANTIC_CLOSURE_REPORT.md`
for the full pass report, and `V2_1_FREEZE.json` for the final frozen state.
