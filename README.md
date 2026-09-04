# ImpactCompiler

Deterministic, evidence-backed Impact quantification from git commits and benchmark/test
artifacts. Turns raw evidence into `impact.json` — an artifact containing normalized evidence,
deterministically-computed metrics, and Claude-authored `ImpactClaim`s that may only *reference*
those metrics, never compute or alter them.

ImpactCompiler ships two things: the CLI/engine above, and a small, dependency-free **review
dashboard** (`web/`, documented [below](#review-dashboard)) for inspecting the resulting
`impact.json`. The dashboard is a read-only presentation layer — it never computes a metric,
calls an LLM, or persists anything; selecting a local `impact.json` file is processed entirely
client-side via the browser's File API, and nothing is ever uploaded, including when the
dashboard is hosted publicly.

## Why

Given a commit that fixed a performance problem and a benchmark showing `1.82s -> 0.47s`,
ImpactCompiler computes `74.18% reduction` itself (in `src/metrics/deterministic-metric-engine.mjs`)
and hands that number to an LLM only to phrase, never to calculate. The LLM's output shape has no
field for `before`/`after`/`absolute_delta`/`relative_change_percent`/`operation`/`calculation` at
all — it cannot set them even if it tried, and if a malformed response somehow contains one, it's
rejected outright (`src/core/validation.mjs`'s `validateProviderOutputHasNoMetricFields`).

## Usage

```bash
node src/cli/impact-compiler.mjs analyze \
  --repo /path/to/repo --commit <sha> \
  --benchmark fixtures/matching-runtime/benchmark.json \
  --output ./out \
  --provider claude-cli
```

Writes `./out/impact.json` (canonical, sole source of truth) and `./out/review.md` (a pure
rendering of it — never a second source of truth). Exit codes: `0` analyzed, `1` usage/validation
error, `2` `analysis_status: "pending_llm"` (no Claude CLI runtime available — evidence and metrics
were still computed honestly; nothing was fabricated).

## Architecture

```
Git/Benchmark/Test/Measurement-Plan Input Adapters (src/evidence/, src/measurement/)
      -> [measurement-plan only] isolated base/target worktree runner (src/measurement/measurement-runner.mjs)
            -> pure statistics engine (src/measurement/stats-engine.mjs)
      -> Evidence Normalization -> Evidence Store = impact.json.evidence[] (no database)
      -> Deterministic Metric Engine (src/metrics/) — all arithmetic, Claude-proof
      -> LLMProvider interface (src/providers/llm-provider.mjs) <-> ClaudeCliProvider
      -> impact.json (src/core/impact-schema.mjs)
            -> review.md (src/renderers/review-renderer.mjs, pure)
```

## Benchmark/test artifact format

```json
{ "name": "matching runtime", "before": 1.82, "after": 0.47, "unit": "sec", "direction": "lower_is_better" }
```

`direction` is `lower_is_better` or `higher_is_better`. An optional `operation` (`absolute_delta` |
`percentage_reduction` | `percentage_increase` | `ratio`) picks the headline calculation; it
defaults to `percentage_reduction`/`percentage_increase` based on `direction`. Missing/ambiguous/
invalid artifacts are preserved as evidence and marked `unresolved`/`unsupported` — never guessed
into a metric. A passing test with no before/after is evidence only, never proof of improvement by
itself.

## Quantification V1 — automated base/target benchmark comparison

Instead of supplying an already-measured before/after pair by hand, `--measurement-plan` tells
ImpactCompiler to run the comparison itself: given a repo, a base commit, a target commit, and a
benchmark command, it checks out each commit into its own isolated, disposable git worktree, runs
the command repeatedly on both, and computes deterministic statistics from the raw samples — no
number is ever invented, inferred, or computed by an LLM.

```bash
node src/cli/impact-compiler.mjs analyze \
  --measurement-plan ./measurement-plan.json \
  --output ./out \
  --provider off
```

`measurement-plan.json` (see `fixtures/customer-matching-measurement-plan/measurement-plan.json`):

```json
{
  "version": 1,
  "benchmark_id": "customer-matching-v1",
  "repo": "/path/to/repo",
  "base_ref": "abc123",
  "target_ref": "def456",
  "command": { "executable": "node", "args": ["benchmarks/matching.mjs"], "cwd": "." },
  "setup_command": { "executable": "npm", "args": ["ci"], "cwd": "." },
  "result": {
    "mode": "stdout_json",
    "json_path": "duration_seconds",
    "name": "customer matching runtime",
    "unit": "sec",
    "direction": "lower_is_better",
    "operation": "percentage_reduction",
    "primary_statistic": "median"
  },
  "warmup_runs": 5,
  "measurement_runs": 30,
  "timeout_ms": 60000,
  "scope": { "dataset_name": "synthetic-customers-v3", "records": 1000000 }
}
```

`base_ref`/`target_ref` are resolved to full commit SHAs and verified before anything runs. Every
command is `{ executable, args, cwd }`, invoked via `execFile`/`spawn` — never a shell string,
never `shell: true` — with a timeout and an output-size cap; `setup_command` is optional and runs
once per worktree before any measurement. `warmup_runs` executions are discarded, then
`measurement_runs` executions are collected on each side, alternating base/target order to spread
machine-load/thermal drift evenly. The command's `result.mode: "stdout_json"` reads a single finite
number out of its stdout at `result.json_path`. Your working tree, branches, and uncommitted changes
are never touched — only fresh temporary worktrees, always cleaned up.

The result is a `controlled_benchmark` Evidence record carrying full provenance — resolved base/
target SHAs, every raw sample, `src/measurement/stats-engine.mjs`'s statistics (mean/median/p95/p99/
stddev per side, and an optional seeded-deterministic 95% bootstrap confidence interval on the
change), a deterministic `measurement_quality` (`high`/`medium`/`low`/`insufficient`), and a
deterministic `attribution` strength (`strong`/`moderate`/`weak`/`none`) — plus a Metric computed
from the selected `primary_statistic` (default `median`) via the same deterministic engine as every
other Metric in this project. If either side fails to produce enough valid samples, the Evidence is
preserved and marked `unresolved` with the exact reason — no Metric is produced, nothing is guessed.

## Resume-ready Impact (Impact Candidates)

Beyond raw Metrics, ImpactCompiler deterministically builds **Impact Candidates**
(`src/candidates/`) from this run's Evidence + Metrics: one candidate per quantified
measurement, cross-linked to its implementation (commit/PR) and, when an explicit shared
identifier resolves (`service`/`release_id`/`deployment_ref`/commit SHA — see
`measurement-plan.json`'s optional `link` field), to production evidence too. Each candidate
gets a deterministic `quality_profile` (evidence strength, measurement quality, attribution,
scope completeness, conflict status, resume eligibility) and a whitelisted
`allowed_numeric_facts` list — the only numbers a Claim about it may ever cite.

`impact_candidates` is always populated (even with `--provider off`) and written to
`impact.json`, along with `impact_opportunities` — structured, deterministic gaps ("missing
scope", "weak attribution", "missing production window", ...) between what the Evidence
currently supports and a stronger quantified Impact. Neither ever fabricates a number.

With a provider, `ClaudeCliProvider.analyzeCandidates()` sends the ranked candidates (plus
this run's referenced Evidence/Metrics for narrative context) and asks only for phrasing —
title/problem/change/outcome and up to three resume variants (`short`/`standard`/
`technical`). **Strict by default**: every response entry must cite a real `candidate_id`; a
missing/unknown one throws, and a duplicate throws unless `allowDuplicateCandidateIds: true`
is passed. The one escape hatch — accepting a legacy flat-claim response with no
`candidate_id` at all — requires the explicit `allowLegacyCandidateResponse: true` provider
option; it is never chosen based on what a response happens to contain. Every deterministic
field (metric_ids, evidence_ids, scope, attribution, quality_profile, quantification_type,
impact_level) is hydrated from the candidate afterward, never trusted from the provider's own
output; a resume variant citing a number outside `allowed_numeric_facts` (which also covers
deterministic word-form aliases like `"one million"` for `1,000,000`) is dropped, not the
whole claim, and logged as a limitation. `statement` is always the validated `standard`
variant.

A controlled benchmark can combine with **multiple** deterministically linked production
Metrics (e.g. P95 latency *and* timeout rate) into one candidate's `production_summary` —
each Metric/Evidence id and observation window preserved independently, contradictory values
for the same name+window flagged as a conflict rather than silently resolved, unrelated
production Metrics from the same run never attached.

Derived/estimated metrics (time saved, annualized savings, cost savings) run through a pure,
whitelisted formula engine (`src/derived/formula-registry.mjs`) — no arbitrary formulas, no
implicit unit/currency conversion, no silently-assumed annualization convention — driven by
two repeatable CLI inputs:

```bash
node src/cli/impact-compiler.mjs analyze \
  --measurement-plan ./measurement-plan.json \
  --quantitative-fact ./fact.json \
  --derivation ./derivation.json \
  --output ./out --provider off
```

`--quantitative-fact` (`src/facts/quantitative-fact-adapter.mjs`) normalizes an explicit,
verified/estimated/self-reported numeric input into Evidence; `--derivation`
(`src/derived/derivation-request.mjs`) resolves a formula's inputs by exact
`benchmark_id`/`fact_id`/`metric_id`/`evidence_id` reference — never fuzzy matching — and
either produces a Derived Metric (added to `impact_candidates` like any other) or, if an
input is missing, a structured Impact Opportunity naming exactly what's absent.

## Consuming ImpactCompiler from another system

Import specific modules directly (see `package.json`'s `exports` map) rather than only shelling out
to the CLI — e.g. `evidence/git-adapter` exposes `getRepoIdentity`/`getHeadCommit`/`commitExists` as
cheap, directly reusable read-only primitives for a host that needs a single git fact without
running the full pipeline. See Recruiting OS's `integrations/impact_compiler_adapter.mjs` for a
worked example of both the CLI-invocation and direct-import consumption patterns.

## Review dashboard

The repository includes a dependency-free static dashboard in [`web/`](web/) for reviewing an
`impact.json` artifact. Open [`web/index.html`](web/index.html) in a browser, or serve the folder
locally with:

```bash
python -m http.server 4173 --directory web
```

Then choose **Open impact.json** to inspect a run, or click **Explore demo artifact** for a
synthetic example (clearly labeled `DEMO DATA` in the UI). A local artifact you open is read with
the browser's `FileReader`/`File` APIs and rendered in place — the file is never sent over the
network, uploaded, or written anywhere; opening a malformed or unexpected artifact shows a visible
error banner instead of a broken or blank page. Keep private evaluation outputs and personal
impact records outside the public repository (the `evaluations/` directory is ignored).

### Deployment (AWS Amplify Hosting)

The dashboard is deployable as-is, unmodified, to [AWS Amplify
Hosting](https://docs.aws.amazon.com/amplify/latest/userguide/welcome.html): `amplify.yml` at the
repository root tells Amplify to publish `web/` directly, with no build step (there is nothing to
build — no bundler, no `package.json` inside `web/`). Amplify's native GitHub integration watches
`main` and redeploys automatically on every push; no separate deploy workflow or credentials are
stored in this repository for that purpose.

This adds no backend: Amplify Hosting here is a static file host and CDN, not an application
server. There is no database, no API, no authentication, and no server-side code — the same
client-only architecture described above holds whether the dashboard is opened from a local file
or the hosted URL. `impact.json` files opened through the hosted dashboard are processed in the
visitor's own browser exactly as they are locally; nothing about hosting changes that.

To deploy or update the hosted instance: in the Amplify console, create an app connected to this
GitHub repository, select `main` as the production branch, and let Amplify pick up `amplify.yml`
automatically — no manual build configuration is required.

## Testing

```bash
npm test
```

## Continuous Integration

GitHub Actions runs the complete test suite on every pull request and on every push to `main`.
The required matrix covers `ubuntu-latest` and `windows-latest` with Node.js `18.x` and `22.x`.
Linux and Windows are the meaningful supported-platform checks here: the package has no macOS-only
code path, while Windows exercises path, process, and worktree behavior independently from Linux.

Each job performs the same reproducible commands used locally:

```bash
npm ci
npm test
```

The suite protects measurement and provenance invariants including argument-safe, non-shell
benchmark execution; explicit working directories; timeout and output-limit handling; isolated
worktree cleanup; git SHA resolution; warmup and alternating base/target runs; raw-sample and
all-required-run semantics; deterministic statistics; no fabricated metrics; and rejection of
unsupported provider-authored numbers. GitHub-hosted runner timing is intentionally not used as
performance evidence and CI does not gate on absolute throughput or latency thresholds.

The workflow uses the minimum repository permission required (`contents: read`). It does not
publish packages, deploy, access secrets, or create releases. A meaningful limitation is that CI
verifies correctness and deterministic behavior in clean runners; it cannot establish production
performance, production causality, or stable wall-clock benchmark results.
