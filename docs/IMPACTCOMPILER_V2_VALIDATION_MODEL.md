# ImpactCompiler V2 — Semantic Claim Validation Model

Focused reference for `validateClaimSemantics(text, candidate)`
(`src/core/claim-semantics.mjs`). This documents every violation type it can
produce, exactly what triggers it, exactly what does **not** trigger it, and
reproduces its closed tables verbatim so a reader never has to open the
source to know the boundaries. Companion to `docs/IMPACTCOMPILER_V2_DESIGN.md`
(architecture/rationale) — this doc is the exhaustive behavioral reference.

`validateClaimSemantics` is not an NLU engine, not an LLM call, and not a
fuzzy matcher. It runs four independent, deterministic checks over a claim's
free text against one Impact Candidate's `allowed_numeric_facts` /
`outcome` / `quality_profile.scope_breadth`, and merges their findings
into `{valid: boolean, violations: object[]}`. A claim can fail for more than
one reason at once. Anything outside a check's bounded table produces **no
opinion** — never a guess, never a false positive.

**V2.1 note** (bounded semantic-closure pass, pre-P2): the scope-generalization
check originally keyed off `quality_profile.scope_completeness`; §4 below now
documents why that was wrong and describes the corrected `scope_breadth`
field it uses instead. Every other section is unchanged from V2's original
release.

## Violation types (`CLAIM_VIOLATION_TYPES`)

| type | produced by |
|---|---|
| `unsupported_number` | numeric membership (reused verbatim from V1's `validateAgainstAllowedNumericFacts`) |
| `adapter_internal_fact` | numeric membership, refined — the number matches ONLY a non-claimable (`ADAPTER_INTERNAL`) fact |
| `unit_mismatch` | unit consistency check |
| `polarity_mismatch` | polarity/direction consistency check (two independent sub-checks) |
| `scope_overgeneralization` | scope-generalization check |
| `numeric_tokenization_error` | reserved for a future tokenizer-level structural failure; no current check assigns it |

## 1. Numeric membership (`unsupported_number` / `adapter_internal_fact`)

**Triggers when:** a numeric token extracted from the text (via
`extractNumericTokens`) does not exactly match any claimable fact's `display`,
raw `value`, or an explicitly generated `display_variants` entry.
- If the token matches ONLY a fact tagged `externally_claimable: false`
  (i.e. `provenance_class: 'ADAPTER_INTERNAL'` — a synthetic
  schema-compatibility anchor), the violation is the more specific
  `adapter_internal_fact`, not a bare `unsupported_number`.

**Does NOT trigger when:**
- The number matches any claimable fact's `display`, raw `value` (via
  `normalizeNumericToken`, which strips commas/a trailing `%`/a redundant
  leading `+`, and always preserves a leading `-`), or a generated
  `display_variants` alias (rounded 2-decimal / comma-grouped / word-form /
  digit+word-form — see `candidates/allowed-numeric-facts.mjs`).
- A whitelisted word-form quantity ("one million", "twenty-five thousand")
  matches a fact's own generated word-form alias.

**Exact-match discipline (important, not fuzzy):** matching is always
**exact string equality** after normalization, never numeric tolerance. A
fact whose `value` is `-5.0` stringifies to `"-5"` (JS drops the trailing
`.0`) — claim text citing `"-5.0%"` would NOT match it, even though the two
are numerically identical. Never round, never coerce; the fact's own
generated aliases are the only escape hatch, and they too are exact strings.

## 2. Unit consistency (`unit_mismatch`)

**Triggers when:** a numeric token matches a claimable fact whose own unit
resolves to a known category (see `UNIT_CATEGORIES` below), AND a unit word
found in a short bounded window immediately after the token ALSO resolves to
a known category, AND the two categories differ.

- The window is `text.slice(tokenEndIndex, tokenEndIndex + 24)`, truncated at
  the next digit found in that window (so an adjacent DIFFERENT number's unit
  is never misattributed — e.g. "regressed -10.24% (64 workers)" never
  attributes "workers" to -10.24%). Only the first 1–2 words in the truncated
  window are checked.
- A scope fact (`unit: null`) derives its category from its `name` instead
  (`scope_workers` → `workers`, stripping a `scope_`/`production_..._` prefix).

**Does NOT trigger when:**
- The fact's own unit does not resolve to a known category (most real `unit`
  strings — e.g. `"ops/s"`, `"clock cycles to program completion"` — are
  intentionally unclassified; the check has no opinion rather than guessing
  a fuzzy equivalence).
- The nearby claimed unit word does not resolve to a known category either.
- The two resolved categories are the same.

**`UNIT_CATEGORIES` (verbatim, from `src/core/claim-semantics.mjs`):**
```
milliseconds:      ms, millisecond, milliseconds
seconds:           s, sec, secs, second, seconds
bytes:             b, byte, bytes
kilobytes:         kb, kilobyte, kilobytes
megabytes:         mb, megabyte, megabytes
gigabytes:         gb, gigabyte, gigabytes
percent:           %, percent, pct, percentage
percentage_points: percentage_points, percentage points, pp
multiplier:        x, ×, times
workers:           worker, workers
files:             file, files
threads:           thread, threads
requests:          request, requests
users:             user, users
nodes:             node, nodes
cores:             core, cores
tests:             test, tests
cases:             case, cases
samples:           sample, samples
runs:               run, runs, rep, reps, repetition, repetitions
```
This table is small and closed by design (task instruction: "do not make
aggressive fuzzy equivalences"). Adding a unit requires an explicit edit here,
never an inferred equivalence.

## 3. Polarity / direction consistency (`polarity_mismatch`)

Two **independent** sub-checks — deliberately never conflated:

**(a) Delta-direction check.** Only runs on numeric tokens matching a fact
named `relative_change`, `absolute_delta`, or `result_value` (the facts that
carry a real signed value). Triggers when:
- A word from `DELTA_INCREASE_WORDS` appears within a 40-character radius of
  the token AND the fact's value is negative, OR
- A word from `DELTA_DECREASE_WORDS` appears within that radius AND the
  fact's value is positive.

This is **direction-agnostic to business outcome** — "decreased" paired with
a negative `lower_is_better` value (an improvement) is correct, never
flagged; see `UNIT_CATEGORIES`'s sibling test V2-7b.

`DELTA_INCREASE_WORDS`: `increase, increased, increases, rise, rose, grew, grow, grows, higher, raise, raised, more, gained, added, expanded, up`
`DELTA_DECREASE_WORDS`: `decrease, decreased, decreases, fell, fall, falls, fewer, lower, lowered, reduce, reduced, reduction, dropped, drop, less, shrank, shrunk, down`

**(b) Outcome-word check.** Runs only when `candidate.outcome` is
`'improvement'` or `'regression'` (never re-derived from the claim's own
words — always read from the metric engine's already-resolved value).
Triggers when:
- A word from `OUTCOME_IMPROVE_WORDS` appears nearby AND
  `candidate.outcome === 'regression'`, OR
- A word from `OUTCOME_REGRESS_WORDS` appears nearby AND
  `candidate.outcome === 'improvement'`.

`OUTCOME_IMPROVE_WORDS`: `improve, improved, improvement, improves, better, faster, gain, boosted, boost, enhanced, speedup, sped`
`OUTCOME_REGRESS_WORDS`: `regress, regressed, regression, worse, slower, worsened, degrade, degraded, slowdown`

**Does NOT trigger when:**
- The cited token doesn't match a delta-bearing fact at all (e.g. it matches
  `before`/`after`/a scope fact instead) — those are excluded from this
  check by construction.
- No word from either list appears within the 40-character radius.
- **Critical exact-match precondition:** because this check keys off the
  SAME exact-string fact lookup as numeric membership, a claim restating a
  negative fact's magnitude WITHOUT its sign (e.g. "15% lower" for a fact
  whose value is `-15`) never reaches this check at all — `"15"` doesn't
  match `"-15"`, so the token fails numeric membership first and no
  `polarity_mismatch` is ever produced (it becomes a plain
  `unsupported_number` instead). This is a known, documented shape, not a
  gap the check tries to close.

**V2.1 finding (bounded semantic-closure pass) — an EVALUATION-TOOLING bug,
not a `claim-semantics.mjs` defect:** `evaluations/external-impactbench-deep/harness/gen_run_adversarial.mjs`
line 79 constructed its `'polarity_flipped'` adversarial-fixture claim text as
`` realPct < 0 ? 'regressed' : 'improved' `` — the word MATCHING the real
sign, not an inverted one — so that entire development-corpus category never
actually exercised a polarity flip (0/116 "caught" because there was nothing
wrong to catch). This frozen P1 fixture was NOT modified retroactively (per
instruction); a corrected, comprehensive replacement matrix — 8 genuine
semantic-pair flips (`decreased`↔`increased`, `faster`↔`slower`,
`improved`↔`regressed`, `reduced`↔`increased`, `lowered`↔`raised`), each with
its correctly-oriented valid counterpart — is `V2.1-5`/`V2.1-6` in
`tests/core/claim-semantics.test.mjs` and
`evaluations/impactcompiler-v2-development/V2_1_POLARITY_FIXTURES.json`. The
check itself required no code change — it was already correct, as the
original P0 tests (`V2-6`/`V2-6b`) already demonstrated with real flips; only
the OLD corpus fixture's construction was broken.

## 4. Scope generalization (`scope_overgeneralization`)

**V2.1 fix (bounded semantic-closure pass):** this check originally keyed off
`candidate.quality_profile.scope_completeness !== 'complete'`. That field
answers "is scope recorded and traceable back to evidence?" — it does NOT
answer "does the evidence justify universal/broad language?" A single,
perfectly traceable benchmark measurement (the normal, expected shape of
nearly every real candidate) was classified `scope_completeness: 'complete'`,
so this check never fired for it no matter how sweeping the claim's language
was — reproduced 0/1 on a realistic single-benchmark fixture during V2's
development-set evaluation (`evaluations/impactcompiler-v2-development/SYNTHETIC_CLAIM_FIXTURES_RESULTS.json`'s
`scope_6_KNOWN_GAP_single_benchmark_scope_classified_complete`).

**The fix**: a NEW, separate field, `quality_profile.scope_breadth`
(`candidates/quality-profile.mjs`'s `deriveScopeBreadth`,
`core/impact-schema.mjs`'s `SCOPE_BREADTH_VALUES`), answering the breadth
question directly — `scope_completeness` itself is completely unchanged
(same values, same meaning, same consumers: `ranking.mjs`'s `SCOPE_RANK`,
`impact-opportunities.mjs`'s missing-scope detection, `review-renderer.mjs`'s
display), per the explicit instruction not to redefine a historical field.

**`scope_breadth` values** (deterministic, never inferred by an LLM):
- `'unknown'` — no `scope` object at all.
- `'specific'` — a single, bounded measurement. **This is the default,
  expected value for nearly every real candidate this compiler produces
  today** — one benchmark, one controlled A/B run, one externally-supplied
  artifact. It is not a lesser state; most real evidence will correctly stay
  `'specific'` forever.
- `'multi_scope'` — a candidate whose `combined_from` (an already-existing,
  real mechanism — `ranking.mjs`'s same-`benchmark_id`/production-metric
  merges) names more than one underlying measurement. Several explicitly-
  identified things, never "all" of anything.
- `'global'` — ONLY when the evidence's own `scope.coverage` field is
  literally `'global'`, verbatim from an evidence author. Never inferred from
  a large numeric value, a big worker count, or anything else. No current
  Atlas/SAFER-CC/CS61C/CS61C fixture declares this.

**Triggers when:** the claim text (lowercased) contains one of the phrases
below, AND `candidate.quality_profile.scope_breadth !== 'global'`.

`UNIVERSAL_SCOPE_PHRASES` (verbatim, V2.1 additions in *italics* — added to
match the task's own example list): `overall, system-wide, systemwide, system wide, universally, across all, across every, all workloads, *all benchmarks*, every workload, *every benchmark*, in general, globally, for all cases, every case, entirely, *across the entire system*, *across all scenarios*`

**Does NOT trigger when:**
- None of the phrases appear.
- `scope_breadth === 'global'` — narrower, evidence-matching, or even
  literally universal-sounding language is allowed through unchanged, but
  ONLY once the evidence itself explicitly declares full coverage.
  `scope_breadth === 'specific'` or `'multi_scope'` — no matter how
  traceable/complete that scope otherwise is — still correctly rejects
  universal language.

**Verified via the realistic fixture that originally exposed the gap:**
`evaluations/impactcompiler-v2-development/V2_1_SCOPE_FIXTURES.json`'s
corrected single-benchmark case now catches the same claim 1/1 (was 0/1),
while the same evidence stated narrowly (e.g. "for this specific benchmark")
is still correctly accepted — see
`tests/core/claim-semantics.test.mjs`'s `V2.1-1`/`V2.1-2`.

## 5. What none of these checks do (explicit non-goals)

- No embeddings, no LLM call, no fuzzy/approximate string matching anywhere.
- No general natural-language number parser — only whitelisted word-form
  quantities matching what `allowed-numeric-facts.mjs` can itself generate.
- No unit-conversion/algebra (e.g. never infers "1024 MB = 1 GB").
- No cross-claim consistency checking — each call validates one claim
  against one candidate in isolation.
- Never mutates or drops a claim itself — callers decide what to do with
  `{valid, violations}` (see `providers/claude-cli-provider.mjs`'s use of
  `validateAgainstAllowedNumericFacts` for the per-token drop behavior it
  already had; `validateClaimSemantics` is available as a stricter,
  additive check without changing that existing behavior).

## 6. Real numbers behind this model

See `evaluations/impactcompiler-v2-development/SEMANTIC_VALIDATION_BREAKDOWN.json`
(new, hand-built synthetic fixtures — clean, isolated, per-violation-type
counts) and `V2_ADVERSARIAL_VALIDATION_RESULTS.json` (re-running the
already-existing, real, 1259-variant External ImpactBench — Deep adversarial
claim set — now SEEN DEVELOPMENT DATA — through this validator). Both are
referenced in full in `evaluations/impactcompiler-v2-development/V1_V2_DEVELOPMENT_REPORT.md`.
