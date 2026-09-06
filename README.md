# ImpactCompiler

ImpactCompiler turns engineering evidence—commits, benchmarks, measurement runs, test results, and production artifacts—into structured, auditable impact claims. Deterministic code owns the metrics and traceability; optional language-model support can phrase claims, but cannot author or alter measured values.

**Live review dashboard:** [impactcompiler.com](https://impactcompiler.com/)

> The hosted dashboard reviews `impact.json` artifacts. It does not run the compiler, and files opened through the dashboard stay in the browser.

## Why ImpactCompiler

The evidence behind engineering work is usually fragmented across source history, benchmark output, tickets, and production data. That makes it easy to lose the connection between what changed, what was measured, and what a result actually supports.

ImpactCompiler produces a reviewable artifact that keeps each claim tied to:

- normalized evidence records and exact source links;
- deterministic before/after metrics;
- measurement scope and attribution;
- quality, confidence, and eligibility signals; and
- explicit limitations and opportunities for stronger evidence.

It is not just a resume-bullet generator. The primary output is an auditable data model; recruiter-facing or technical wording is a constrained presentation of that model.

## How it works

```text
commits / benchmarks / tests / production artifacts / measurement plans
                              |
                              v
                 evidence adapters and normalization
                              |
                              v
                 exact linking + deterministic metrics
                              |
                              v
              impact candidates, quality profiles, ranking,
                    and evidence opportunities
                              |
                   optional provider phrasing
                              |
                              v
                         impact.json
                         /         \
                        v           v
                  review.md    React review dashboard
```

Malformed or incomplete inputs are preserved as unresolved evidence with a reason; they are not guessed into metrics. Running without a language-model provider still produces evidence, metrics, candidates, rankings, and opportunities.

## Example output

The repository includes a synthetic customer-matching example with this measured input:

```json
{
  "name": "matching runtime",
  "before": 1.82,
  "after": 0.47,
  "unit": "sec",
  "direction": "lower_is_better"
}
```

ImpactCompiler deterministically calculates a `74.18%` reduction, retains the original before/after values and evidence IDs, and carries the result into an impact candidate. Any generated claim may reference those supported facts; it cannot replace the calculation.

The canonical `impact.json` includes run status, normalized evidence, metrics, claims, impact candidates, recommended candidate IDs, evidence opportunities, uncertainties, and limitations. `review.md` is a pure rendering of that artifact—not a second source of truth.

## Review dashboard

[Open the production dashboard](https://impactcompiler.com/) to:

- explore the included demo artifact;
- open a local `impact.json` file;
- inspect quantified before/after movement;
- trace supporting evidence; and
- review scope, attribution, quality, and open evidence opportunities.

The React/Vite application under [`web/`](web/) maps real artifact fields into a review view model. A selected file is read with the browser `FileReader` API and parsed locally; the dashboard application does not upload it or send it to a backend.

## Validation

**Current public baseline: 514/514 tests passing.**

The public suite covers:

- schema validation and backward compatibility;
- evidence adapters, normalization, and exact linking;
- deterministic metrics, statistics, derivations, and unit conversion;
- measurement-plan execution and disposable Git worktrees;
- candidate generation, quality profiles, ranking, and opportunities;
- provider boundaries and numeric-consistency checks;
- CLI and end-to-end golden cases;
- Markdown rendering; and
- dashboard assets and the Amplify build contract.

GitHub Actions runs the suite on Ubuntu and Windows with Node.js 18 and 22. CI validates deterministic behavior and traceability; it does not treat hosted-runner timing as performance evidence.

## Architecture and repository structure

| Path | Responsibility |
| --- | --- |
| `src/evidence/` | Adapts, normalizes, and links source evidence. |
| `src/measurement/` | Executes declared base/target measurement plans and computes sample statistics. |
| `src/metrics/` | Owns deterministic before/after calculations and metric validation. |
| `src/candidates/` | Builds, scores, ranks, and identifies gaps in supported impact. |
| `src/derived/` and `src/facts/` | Resolve explicit facts through whitelisted formulas and unit conversions. |
| `src/providers/` | Constrains optional claim phrasing to compiler-owned candidates and facts. |
| `src/core/` | Orchestrates compilation and validates the `impact.json` schema. |
| `src/renderers/` | Produces `review.md` from the canonical artifact. |
| `web/` | React/Vite review dashboard for existing artifacts. |
| `tests/` and `fixtures/` | Public unit, integration, end-to-end, and representative artifact coverage. |

AWS Amplify hosts the production dashboard as static assets. The root [`amplify.yml`](amplify.yml) installs the locked frontend dependencies, builds `web/` with Vite, and publishes `web/dist`.

## Running locally

ImpactCompiler requires Node.js 18 or newer.

Install and run the public core test suite:

```bash
npm ci
npm test
```

Run a CLI analysis:

```bash
node src/cli/impact-compiler.mjs analyze \
  --repo /path/to/repo \
  --commit <sha> \
  --benchmark fixtures/matching-runtime/benchmark.json \
  --output ./out \
  --provider off
```

This writes `out/impact.json` and `out/review.md`. With `--provider off`, deterministic analysis is retained with `analysis_status: "pending_llm"`, and the CLI exits with status `2` by design.

Run the review dashboard:

```bash
cd web
npm ci
npm run dev
```

Create the production frontend build with:

```bash
npm run build
```
