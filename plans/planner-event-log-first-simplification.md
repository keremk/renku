# Planner Simplification: Event-Log-First Architecture

## Summary

Replace the planner's current mixed-source behavior (manifest + inferred mappings + condition leaf special cases) with a single authoritative runtime state model derived from event logs and run status records. Keep manifests as an optional derived cache for UX/inspection only, never as planner truth. This removes alias/fallback complexity, makes `--up=N` semantics deterministic, and fixes "missing artifact but planner says all caught up" and source-image propagation blind spots by enforcing canonical IDs and explicit failure/availability states end-to-end.

## Goals

1. Make planning deterministic from canonical IDs only.
2. Remove planner dependence on manifest shape and implicit leaf-path inference.
3. Ensure prior run failures always make affected jobs dirty in the next plan.
4. Preserve regeneration UX (`--up=1` and layer reruns) without deleting builds.
5. Make explanation output match actual scheduling reasons exactly.
6. Add robust, low-mock integration-style tests that would have caught the regressions.

## Non-Goals

1. No silent fallback or alias-based lookup for missing canonical IDs.
2. No provider-level behavior changes unrelated to input binding/planning semantics.
3. No "compat shim" that keeps old ambiguous artifact-resolution behavior.

## Target Architecture

### 1) Single planning snapshot (authoritative)

Introduce a `PlanningSnapshot` assembled before scheduling:

1. `availableArtifacts`: canonical artifact node IDs that are successfully materialized.
2. `failedArtifacts`: canonical artifact node IDs tied to failed job attempts in latest relevant revision lineage.
3. `latestProducerStatus`: per producer instance (`succeeded | failed | never-run | running`), derived from run/job events.
4. `inputState`: canonical input IDs + hashes/versions.
5. `dependencyGraph`: canonical producer/input/artifact graph from blueprint expansion.

Planner must consume only this snapshot and never read manifest structures directly.

### 2) Planner purity rules

For each producer job:

1. Dirty if any required canonical input changed.
2. Dirty if any required upstream canonical artifact is in `failedArtifacts` or unavailable.
3. Dirty if any produced canonical artifact is unavailable.
4. Dirty if prior attempt for this exact producer instance failed.
5. Otherwise clean.

Propagation logic uses graph dependencies only, not ad-hoc reason propagation.

### 3) Manifest demotion

Manifest remains useful for human inspection and UI quick views, but:

1. It is written from canonical runtime records.
2. It is never queried by planner for scheduling truth.
3. Missing manifest keys cannot make planner invent/mask artifact availability.

### 4) Condition artifacts and nested leaves

Treat `HasTransition` (and similar leaves) as first-class canonical artifact IDs if blueprint declares them. No parent-object success implies child-leaf success. If leaf is declared, it must be explicitly materialized and recorded as available; otherwise producer is considered missing outputs and scheduled (or failed if contract violation).

### 5) Planning service side-effect cleanup

Separate concerns in CLI/core planning endpoint:

1. `buildPlanningSnapshot(...)`
2. `computeExecutionPlan(snapshot, options)`
3. `renderExplain(plan, snapshot, reasons)`

No implicit "augment missing artifacts from manifest" step anywhere.

## Public API / Type Changes

### Core package

Add:

1. `PlanningSnapshot` type in `core/src/planning/types.ts`.
2. `buildPlanningSnapshot(params)` in `core/src/planning/snapshot.ts`.
3. `ArtifactAvailabilityRecord` and `ProducerAttemptRecord` canonical event-derived types.

Update:

1. Planner entrypoint signature from mixed inputs to snapshot-based:
   - From: `planExecution({ blueprint, manifest, events, ... })`
   - To: `planExecution({ snapshot, options })`
2. Explanation builder to consume computed reason enums (not recompute from manifest).

Deprecate:

1. Any helper that resolves missing leaf artifacts by manifest-object traversal.
2. Any helper that maps alias IDs to canonical IDs inside planner.

### CLI package

Update explain flow:

1. Load snapshot summary for display.
2. Print deterministic reason categories:
   - `MISSING_OUTPUT`
   - `UPSTREAM_FAILED`
   - `UPSTREAM_DIRTY`
   - `INPUT_CHANGED`
   - `RETRY_PREVIOUS_FAILURE`

## Implementation Steps

1. Inventory current planner data sources:
   - Trace every callsite feeding planner (CLI generate, viewer execution path, tests).
   - Document and remove manifest-dependent branches in planner/explanation code.

2. Build snapshot module:
   - Parse event logs + run metadata into canonical availability/failure maps.
   - Determine latest attempt state per producer instance.
   - Validate canonical ID integrity; throw on malformed/missing declared IDs.

3. Refactor scheduler to snapshot-only:
   - Replace current dirty-derivation with purity rules above.
   - Ensure `--up=N` applies after dirty root selection and topological layering, not before.
   - Guarantee failed jobs from previous run are selected as dirty roots automatically.

4. Refactor explanation generator:
   - Use scheduler-produced reason codes.
   - Remove any independent recomputation that can diverge.
   - Ensure totals/layers and reason list are derived from the exact planned job set.

5. Remove fallback code paths:
   - Delete leaf-artifact manifest inference paths.
   - Delete alias-to-canonical recovery in planner/runtime binding.
   - Keep strict throws for missing canonical bindings.

6. Validate source-image binding path end-to-end (diagnostic pass in code):
   - Ensure `Input:CelebrityThenImages[i]`/`Input:CelebrityNowImages[i]` canonical IDs are bound into jobs.
   - Ensure provider payload construction reads bound canonical source artifacts/inputs only.
   - Add explicit throw if expected source image binding missing.

7. Tighten viewer/CLI run-state behavior:
   - If job fails, persist failure state in records used by snapshot.
   - Next plan automatically includes retry candidate even if some artifacts exist.

## Test Plan (Robust, Low-Mock)

### A) Core planner integration fixtures (minimal mocking)

Create fixture-based tests under `core/src/planning/__tests__/integration/` using real blueprint fragments + synthetic event logs.

1. Missing leaf artifact test:
   - Declared outputs include `...HasTransition[0]`.
   - Event log has parent script artifact only.
   - Expect: producer dirty with `MISSING_OUTPUT`, no fallback success.

2. Prior failure retry test:
   - Previous revision has `ThenImageProducer[0]` failed.
   - No subsequent success for its output.
   - Expect: next plan includes this job with `RETRY_PREVIOUS_FAILURE`.

3. `--up=1` boundary test:
   - Dirty roots in layer 1+, clean layer 0.
   - Expect only first dirty layer from roots upward, never full graph.

4. Upstream failure propagation test:
   - Upstream failed; downstream outputs missing.
   - Expect downstream scheduled with `UPSTREAM_FAILED`/`UPSTREAM_DIRTY`.

5. Explanation parity test:
   - Compare planned jobs vs explained jobs/reasons 1:1.
   - Fail if explanation includes non-planned jobs or misses planned ones.

### B) CLI explain contract tests

Under `cli` tests with fixture run directories:

1. `renku generate --explain --up=1` outputs only expected producer subset.
2. Explanation summary counts/layers match plan JSON exactly.
3. No "all caught up" when latest relevant job attempt failed.

### C) Provider binding regression tests (targeted, contract-style)

Under `providers` tests with fixed payload fixtures:

1. Then/Now image producers receive user-provided source image references in expected slots.
2. Missing canonical source binding throws before SDK call.
3. No alias fallback accepted.

### D) Anti-mock guardrails

1. Prefer fixture files over deep unit mocks.
2. Assert full reason codes and canonical IDs, not just job counts.
3. Add snapshot tests for generated plan JSON and explain JSON (normalized timestamps).

## Rollout Plan

1. Land snapshot builder + planner refactor behind temporary internal flag:
   - `RENKU_PLANNER_V2_STRICT=1` (default on in tests, opt-in locally for quick bisect).
2. Run full package tests:
   - `pnpm test:core`
   - `pnpm test:cli`
   - `pnpm --filter renku-providers test`
3. Remove flag after parity + regression suite passes; make strict snapshot planner default.
4. Add migration note in docs: manifests are observational, not authoritative for scheduling.

## Risks and Mitigations

1. Risk: historical run directories missing enough event detail.
   - Mitigation: define strict minimum event contract; if absent, fail with actionable error explaining missing records.

2. Risk: short-term breakage in viewer assumptions around manifest completeness.
   - Mitigation: keep manifest writer, but driven from snapshot records so UI still renders existing cards.

3. Risk: performance hit while constructing snapshot from large logs.
   - Mitigation: index/cache parsed event records per revision in memory during one command run.

## Assumptions and Defaults

1. Canonical IDs are the only valid IDs across planner, runtime bindings, providers.
2. Missing declared artifact/materialization is an error condition, never silently ignored.
3. Previous failed attempts should bias toward retry planning automatically.
4. Correctness and deterministic planning semantics take priority over preserving legacy explain-output quirks.
5. No live paid runs are required for validation; fixture/event-log based tests are sufficient for regression coverage.
