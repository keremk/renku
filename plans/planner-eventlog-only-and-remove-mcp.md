# Combined Plan: Event-Log-Only Runtime, Manifest Complexity Removal, and MCP Deletion

## Summary

This is the single combined plan for all related issues:

1. Make event logs + run/job records the only runtime source of truth.
2. Remove manifest from all runtime decision paths.
3. Remove MCP from the codebase.
4. Harden tests to prevent recurrence of `--up=1`, condition-leaf, and failure-replan regressions.

`plans/planner-event-log-first-simplification.md` remains unchanged as historical context.

## Core Decisions

1. No fallbacks, no alias guessing, no manifest-derived recovery.
2. Canonical IDs are mandatory end-to-end.
3. A declared artifact leaf (for example `...HasTransition[i]`) must be explicitly materialized or treated as missing.
4. Prior failed attempts are automatically scheduled next run.
5. `--up=N` is applied after dirty-root detection and graph layering, never as a global graph truncation.

## Scope

### In Scope

1. Core planner and planning service refactor.
2. Runner/runtime state resolution cleanup.
3. Viewer build/status APIs to event-log-only.
4. Export command and provider exporters removing manifest read/fallback branches.
5. Full MCP removal.
6. Integration-heavy regression suite expansion.

### Out of Scope

1. Live paid provider runs for validation.
2. Backward-compatible fallback shims for legacy behavior.

## Target Architecture

### 1) Planning Snapshot

Introduce `PlanningSnapshot` built only from:

1. `events/inputs.log`
2. `events/artefacts.log`
3. run/job attempt status records
4. expanded canonical blueprint graph

Planner API becomes:

- `computePlan({ snapshot, options })`

No manifest input to planner.

### 2) Dirty Detection Rules (Snapshot Only)

A job is dirty when any of the following is true:

1. required canonical input changed
2. any required upstream artifact missing
3. any required upstream artifact latest status failed
4. any produced artifact missing
5. latest attempt for this producer instance failed

Downstream propagation uses graph edges only.

### 3) Explain Parity

Explain output must consume scheduler reason codes directly:

1. `MISSING_OUTPUT`
2. `UPSTREAM_FAILED`
3. `UPSTREAM_DIRTY`
4. `INPUT_CHANGED`
5. `RETRY_PREVIOUS_FAILURE`

No separate explanation recomputation.

### 4) Manifest Removal from Runtime

Runtime logic must not read manifest for:

1. planning
2. explain
3. viewer artifact/status truth
4. export asset/timeline/transcription resolution
5. stage readiness calculations

If a human-readable snapshot file is still desired, it is generated from events and never used by runtime.

### 5) MCP Removal

Remove MCP server and related command/test/doc plumbing completely.

## Code Changes by Package

### Core

1. Add `PlanningSnapshot` types and builder module.
2. Refactor planner internals to snapshot-only.
3. Remove manifest parameter and manifest lookups from planning path.
4. Ensure condition artifacts are checked as explicit canonical leaves.
5. Ensure prior failed attempts always become dirty roots.

### CLI

1. Generate/explain use snapshot-only planner inputs.
2. Export command resolves required artifacts from event-derived index, not manifest.
3. Remove MCP command surface and server wiring.

### Viewer

1. Replace manifest+events merge APIs with event-derived artifact index/status APIs.
2. Stage/status derivation uses producer attempt statuses from run/event records.

### Providers

1. Remove manifest fallback resolution in FFmpeg exporter and related export paths.
2. Require canonical artifact paths from runtime/event-derived resolution and fail fast if absent.

## Implementation Phases

### Phase 1: Snapshot Infrastructure

1. Add snapshot builder with canonical validation.
2. Create event-derived artifact availability + failure maps.
3. Create producer-attempt status map.

### Phase 2: Planner Refactor

1. Switch planner to snapshot-only dirty detection.
2. Keep `--up=N` semantics layer-bounded from dirty roots.
3. Remove manifest-dependent branches and helper paths.

### Phase 3: Explain and Display Consistency

1. Wire explanation to scheduler reason outputs.
2. Guarantee plan/explain parity in job set and counts.

### Phase 4: Runtime and Export Decoupling

1. Remove runtime manifest reads in CLI/viewer/export code paths.
2. Replace with event-derived canonical artifact index.
3. Delete fallback paths and throw on missing canonical requirements.

### Phase 5: MCP Deletion

1. Delete MCP server implementation and command entrypoints.
2. Remove MCP tests/docs/config references.
3. Ensure builds and tests pass without MCP symbols.

### Phase 6: Cleanup

1. Remove dead manifest utility paths no longer used at runtime.
2. Keep only minimal optional diagnostic snapshot tooling if explicitly required.

## Test Plan

### Core Integration Fixtures

1. Missing condition leaf artifact with parent object present still schedules producer as `MISSING_OUTPUT`.
2. Latest failure on `ThenImageProducer[0]` forces retry plan next run.
3. `--up=1` includes only intended dirty window, not full graph.
4. Planned jobs and explain reasons match exactly.
5. Corrupted/deleted manifest does not affect planning outcome.

### CLI Integration

1. `generate --explain --up=1` behaves correctly from event-only state.
2. No manifest present still yields deterministic plan.
3. Previous failed job is automatically in next plan.

### Viewer Server

1. Artifact/state endpoints return event-derived truth.
2. No stale manifest can mark failed work as complete.
3. Stage readiness follows run/job attempts.

### Provider/Export

1. Asset and timeline resolution succeeds from event-derived mapping only.
2. Missing canonical artifact path fails before SDK/provider invocation.
3. No manifest fallback branch remains.

### MCP Removal Validation

1. No MCP command endpoints remain.
2. Repo type-check/tests pass with MCP code removed.

## Acceptance Criteria

1. Changing/deleting manifest files does not change runtime behavior.
2. Failed prior attempts are always auto-replanned.
3. Condition leaf artifacts are strict and explicit.
4. `--up` semantics are deterministic and layer-correct.
5. MCP code path is fully removed from source/tests/docs.

## Risks and Mitigations

1. Hidden manifest consumers remain.
   - Add CI grep checks for runtime manifest reads in targeted paths.
2. Incomplete historical run records.
   - Fail with explicit error listing missing required run/event records.
3. Export regressions while removing fallback.
   - Add fixture-driven export resolution tests before deleting fallback code.

## Assumptions

1. Event logs and run/job records are available for target builds.
2. Canonical IDs are already the enforced contract across planner/runtime/providers.
3. MCP has no production-critical dependency.
