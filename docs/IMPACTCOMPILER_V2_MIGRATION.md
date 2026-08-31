# ImpactCompiler V2 — Migration Notes

## Schema version: unchanged

`SCHEMA_VERSION` in `src/core/impact-schema.mjs` stayed `'5.0.0'` across the
entire V2 pass (P0 + P1 items 1–2; P1 item 3 deferred, see
`docs/IMPACTCOMPILER_V2_DESIGN.md`'s addendum). `SUPPORTED_SCHEMA_VERSIONS`
is unchanged: `['1.0.0', '2.0.0', '3.0.0', '4.0.0', '5.0.0']`. Per the design
doc's section 2 and the schema module's own frozen-contract comment, a
version bump is reserved for a change that would make an OLD artifact newly
invalid or reinterpret an existing field's meaning — nothing in V2 does
either.

## Proof: an old real artifact still validates unchanged

`evaluations/real-projects/atlas/case-a-routing/impact.json` (a real,
pre-V2-authored artifact, `schema_version: "5.0.0"`) was loaded through V2
HEAD's own `validateImpactArtifact` (`src/core/validation.mjs`):

```
schema_version: 5.0.0
valid: true
errors: []
```

Its evidence array contains `git_commit` / `document` / `controlled_benchmark`
records; its first Impact Candidate's `allowed_numeric_facts[0]` is:
```json
{"name":"before","value":81.25,"display":"81.25","unit":"percent","source_id":"metric_8b0431819dab","display_variants":[]}
```
Note the complete ABSENCE of `provenance_class`/`externally_claimable` —
exactly the "no such field at all" case `allowed-numeric-facts.mjs`'s
`pushFact` documents as defaulting to `SOURCE_FACT`/claimable. The artifact
was never re-generated, re-validated with a patch, or migrated in any way —
it validates as-is because every V2 addition is optional.

## What V2 actually added (all additive)

| Layer | New field / enum value | Absent on an old record means |
|---|---|---|
| `impact-schema.mjs` | `FACT_PROVENANCE_CLASSES` enum, `CLAIM_VIOLATION_TYPES` enum | n/a (new enums, not new required fields) |
| `impact-schema.mjs` | `EVIDENCE_TYPES` gains `'test_result'` | An old artifact simply never contains this evidence type; every existing type/value is unchanged |
| Fact (`allowed_numeric_facts[i]`) | `provenance_class`, `externally_claimable` | Treated as `SOURCE_FACT` / claimable — identical to pre-V2 behavior |
| `benchmark_artifact` evidence | `synthetic_fields` (input, optional) | No synthetic fields declared — behaves exactly as before |
| `benchmark_artifact` evidence | `revision_under_test` (input, optional) → `link_resolution`/`linked_evidence_ids` | `link_resolution: 'not_applicable'`, `linked_evidence_ids: []` — the same "nothing declared" result every other linkable type already produces for a record with no declared link |
| New evidence type | `test_result` (`src/evidence/test-result-adapter.mjs`) | An old artifact never contains one; no existing evidence type's shape changed |
| `validateAgainstAllowedNumericFacts` | now filters `externally_claimable === false` facts before building allowed sets | A V1 fact has no such field (`undefined !== false`), so nothing changes for it |
| New module | `core/claim-semantics.mjs`'s `validateClaimSemantics` | A NEW function; existing callers of `validateAgainstAllowedNumericFacts` are completely unaffected |

## What a consumer of an OLD artifact needs to know

**Nothing is required.** Every new field is optional; every new enum value
is additive; no existing required field changed meaning; no prior
`schema_version`'s contract was altered. A tool that already reads
`impact.json` via the documented shape continues to work with zero changes.

A consumer that WANTS to use the new capabilities can opt in:
- Read `evidence[i].provenance_class`/`externally_claimable` on facts if
  present (absent = pre-V2 record, treat as claimable).
- Recognize `evidence[i].type === 'test_result'` if it wants to surface
  pass/total verification counts distinctly from other evidence.
- Call `validateClaimSemantics` instead of (or in addition to)
  `validateAgainstAllowedNumericFacts` for the stricter unit/polarity/scope
  checks — this is purely additive; nothing requires switching.

## What a NEW artifact (written under this V2 HEAD) additionally contains

- Every fact in `impact_candidates[i].allowed_numeric_facts` now carries
  `provenance_class`/`externally_claimable` (always present going forward,
  even when the value is the default `SOURCE_FACT`/`true`).
- A `benchmark_artifact` evidence record now always carries
  `link_resolution`/`linked_evidence_ids` (previously these were only ever
  set by `linkPr`/`linkTicket`/etc.; `benchmark_artifact` gained a linking
  concept in P1 item 1 — an undeclared-link record gets the same
  `'not_applicable'`/`[]` pair every other zero-declared-link record gets).
- A run supplying `--test-result <path>` produces `test_result` evidence
  records (`provenance_category: 'metric'`) alongside whatever else the run
  supplied — never a Metric, never an Impact Candidate on its own.

## Aggregate/grouped evidence (P1 item 3): no schema impact

Deferred per `docs/IMPACTCOMPILER_V2_DESIGN.md`'s addendum — no
`aggregate_of` field was added to the schema, so there is nothing to migrate
for this item at all.

## Compatibility test coverage

`tests/core/allowed-numeric-facts-validation.test.mjs` and
`tests/candidates/allowed-numeric-facts.test.mjs` (from the P0 commit)
explicitly assert that a fact/artifact with no V2 fields behaves identically
to before. This migration doc's own claim above (the Atlas artifact
validating unchanged) was independently re-verified while writing this
document, not merely asserted from memory of the unit tests.
