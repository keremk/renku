# Event-Log Run Lifecycle Refactor Plan (Option B)

## Summary

This plan moves Renku to the recommended **Option B** architecture:

1. the **event subsystem** becomes the only authoritative source of persisted run/build state
2. run lifecycle becomes explicit through **run events**
3. read models such as "current build", "build history", and "editable input fallback" are derived from event-backed projections
4. sidecar files such as `runs/<revision>-plan.json` and `runs/<revision>-inputs.yaml` remain for now, but they are no longer treated as independent sources of truth
5. `runs/<revision>-run.json` stops being the persisted authority and is eventually removed after migration

This is intentionally **not** the "delete run records and infer everything from artifact events" approach. That would still leave important user-visible states unmodelled. Instead, this plan makes those states first-class and explicit.

## Explicit Migration Decision

We are choosing a **clean migration**, not a long-lived compatibility layer.

That means:

1. existing builds under `~/videos` will be migrated forward once
2. production code should stay clean and should **not** keep fallback readers for legacy `*-run.json`
3. the migration will be implemented as a **one-time idempotent script** in the repo's `scripts/` folder
4. we will build that migration script **after the first phase of the code refactor is complete**

Reasoning:

1. the product has not shipped yet
2. all existing build data is in one known location
3. a one-time migration keeps the runtime architecture simpler
4. avoiding permanent fallback code reduces the chance that split-truth behavior reappears later

## Why This Refactor Is Needed

The recurring bugs are coming from one root problem: persisted state is split across multiple authorities.

Today:

1. `events/inputs.log` and `events/artifacts.log` represent runtime content state
2. `runs/<revision>-run.json` represents run lifecycle metadata
3. handlers often merge those sources opportunistically

That creates mixed states such as:

1. showing artifacts from `rev-0001` while showing inputs or metadata from `rev-0002`
2. leaving archival runs stuck at `planned` when execution throws
3. treating the latest run record as "current" even when no matching event-backed revision exists

The fix is not just "be more careful when reading both". The robust fix is to stop having two authorities for build/run state.

## Chosen Direction

We are choosing **Option B**:

1. model run lifecycle as explicit events
2. derive run/build projections from the event subsystem
3. keep sidecar artifacts such as plan files and input snapshots for now
4. reference those sidecars from run events instead of treating `*-run.json` as truth

This gives us one authoritative persisted state model without turning the refactor into a full storage rewrite.

## Non-Goals

This plan does **not** attempt to do the following in the same refactor:

1. move plan JSON contents into the event log itself
2. move input snapshot YAML bytes into the event log itself
3. collapse all event files into one monolithic physical log file
4. redesign provider execution semantics
5. change canonical ID rules or introduce fallback behavior

Those can be follow-up steps if they are still worth doing later.

## Architectural Principle

After this refactor, persisted truth should be understood like this:

1. `events/inputs.log` records authored/runtime inputs
2. `events/artifacts.log` records artifact outcomes
3. `events/runs.log` records run lifecycle
4. any "current build", "latest run", "build history", "editable snapshot", or "viewer state" is a **projection**

This means the codebase should stop asking:

1. "what does the latest run JSON say?"

and instead ask:

1. "what does the run projection derived from the event logs say?"

## User-Visible States That Must Be Explicit

These states must be represented directly in run lifecycle events or projections. They should never be inferred indirectly from artifact presence alone.

1. planned
2. started
3. succeeded
4. failed
5. cancelled

Why this matters:

1. a run can be planned and never started
2. a run can start and fail before any artifact event is emitted
3. a run can be cancelled before any new artifact event is emitted
4. users need build history and debugging views to show those states accurately

## Proposed Event Model

## Run Event File

Add a new authoritative log:

`builds/<movieId>/events/runs.log`

This file is append-only JSONL, matching the style of the existing event logs.

## Event Types

Introduce explicit run lifecycle events.

### 1. `RunPlannedEvent`

Written when a plan is persisted and the revision becomes real.

Suggested fields:

```ts
interface RunPlannedEvent {
  type: 'run-planned';
  revision: RevisionId;
  createdAt: IsoDatetime;
  runConfig: RunConfig;
  planPath: string;
  inputSnapshotPath: string;
  inputSnapshotHash: string;
}
```

Purpose:

1. proves the run exists
2. anchors the revision
3. records exactly which snapshot and plan belong to that revision
4. preserves invocation metadata without needing `*-run.json`

### 2. `RunStartedEvent`

Written when actual execution begins.

Suggested fields:

```ts
interface RunStartedEvent {
  type: 'run-started';
  revision: RevisionId;
  startedAt: IsoDatetime;
}
```

Purpose:

1. distinguishes "planned but not started" from "actively executed"
2. makes start timing explicit

### 3. `RunCompletedEvent`

Written when execution terminates successfully from the system's perspective, including whether jobs succeeded or failed.

Suggested fields:

```ts
interface RunCompletedEvent {
  type: 'run-completed';
  revision: RevisionId;
  completedAt: IsoDatetime;
  status: 'succeeded' | 'failed';
  summary: {
    jobCount: number;
    counts: {
      succeeded: number;
      failed: number;
      skipped: number;
    };
    layers: number;
  };
}
```

Purpose:

1. finalizes normal completion
2. preserves the user-facing build summary
3. avoids reconstructing summary in every read path

### 4. `RunCancelledEvent`

Written when execution is explicitly cancelled before or during execution.

Suggested fields:

```ts
interface RunCancelledEvent {
  type: 'run-cancelled';
  revision: RevisionId;
  completedAt: IsoDatetime;
}
```

Purpose:

1. makes cancellation explicit
2. avoids overloading `failed`
3. preserves user-visible distinction between stop and error

## Deliberate Omissions

These fields do not need to stay in a run lifecycle event unless a real reader needs them:

1. `blueprintPath`
2. `sourceInputsPath`

Today they appear mostly write-only in production code. We should not carry them forward unless a concrete runtime requirement appears.

## Proposed Projection Model

## Run Projection

Add a projection service that reads `events/runs.log` and derives per-revision run state.

Suggested shape:

```ts
interface RunProjection {
  revision: RevisionId;
  createdAt: IsoDatetime;
  runConfig: RunConfig;
  planPath: string;
  inputSnapshotPath: string;
  inputSnapshotHash: string;
  status: 'planned' | 'started' | 'succeeded' | 'failed' | 'cancelled';
  startedAt?: IsoDatetime;
  completedAt?: IsoDatetime;
  summary?: {
    jobCount: number;
    counts: {
      succeeded: number;
      failed: number;
      skipped: number;
    };
    layers: number;
  };
}
```

Rules:

1. `run-planned` creates the projection entry
2. `run-started` updates the same revision entry
3. `run-completed` finalizes it as `succeeded` or `failed`
4. `run-cancelled` finalizes it as `cancelled`
5. last lifecycle event wins for terminal state
6. projections fail fast if they encounter invalid or contradictory event data

## Combined Build Projection

For "current build" and viewer inspection, combine:

1. event-derived input/artifact state from `inputs.log` and `artifacts.log`
2. run metadata from the run projection for the **same revision**

Important rule:

1. current event-backed build state must never be promoted to a newer revision unless that revision is also supported by event-backed runtime state or the caller is explicitly asking for a run-history projection rather than current runtime state

This rule is what prevents the hybrid states we are seeing today.

## Target End State

After this refactor:

1. `core/src/build-state.ts` derives "current build" from event logs plus run projection
2. viewer build-state/list/editing handlers read projection data, not `*-run.json`
3. CLI and viewer execution append lifecycle events instead of finalizing JSON run records
4. all remaining CLI and viewer read paths use event-backed projections rather than legacy run-record truth
5. `runs/<revision>-run.json` is no longer read anywhere in production code
6. a compatibility bridge may exist temporarily for older builds, but only during migration

## Current Production Footprint

As of this plan, run-record behavior is concentrated but real:

1. about 11 non-generated production files directly depend on run-record concepts
2. the main areas are:
   - core build-state and run-record services
   - CLI planning/execution
   - viewer server planning/execution and build inspection

This is a medium refactor, not a whole-repo rewrite.

## Detailed Work Plan

## Phase 1: Introduce Run Lifecycle Events And Projection Support

### Goal

Create the new event-backed run model before removing any run-record reads.

### Work

1. extend core types with `RunPlannedEvent`, `RunStartedEvent`, `RunCompletedEvent`, and `RunCancelledEvent`
2. add a `runs.log` stream to the event-log service
3. add append/read helpers for run lifecycle events
4. add a run projection builder in core
5. add projection helpers such as:
   - `load(revision)`
   - `loadLatest()`
   - `list()`
6. make sure projection code validates event order and required fields
7. update storage initialization to create `events/runs.log`

### Likely Files

1. `core/src/types.ts`
2. `core/src/event-log.ts`
3. `core/src/storage.ts`
4. new core files for run projection logic
5. core tests for the new event/projection layer

### Exit Criteria

1. run lifecycle can be fully represented without `run-record.ts`
2. a projection can answer all current runtime questions that `RunRecordService` answers today

## Phase 2: Dual-Write During Planning And Execution

### Goal

Switch writers first so new builds stop depending on `*-run.json`, while preserving compatibility during migration.

### Work

1. in CLI planning, after plan and input snapshot persistence:
   - append `run-planned`
2. in viewer planning, do the same
3. in CLI execution:
   - append `run-started` when execution begins
   - append `run-completed` on normal completion with `succeeded` or `failed`
   - append `run-cancelled` on explicit cancellation
4. in viewer execution:
   - append `run-started`
   - append `run-completed`
   - append `run-cancelled`
5. during this phase only, optionally dual-write legacy `*-run.json` if needed for a short compatibility window

### Important Rule

Thrown execution errors must always produce a terminal run event.

Examples:

1. provider warmup throws before the first artifact event
2. `executePlanWithConcurrency()` throws
3. artifact materialization throws after execution

All of these must end in either:

1. `run-completed` with `status: failed`, or
2. `run-cancelled` if the user actually cancelled the run

### Likely Files

1. `cli/src/lib/planner.ts`
2. `viewer/server/generation/plan-handler.ts`
3. `cli/src/lib/build.ts`
4. `viewer/server/generation/execute-handler.ts`

### Exit Criteria

1. newly created runs can be reconstructed entirely from event logs plus sidecar files
2. no new build depends on `*-run.json` to reflect lifecycle transitions

## Phase 3: Migrate Readers To Projection-Based APIs

### Goal

Stop production reads from consuming `RunRecordService`.

### Work

1. replace `build-state.ts` run-record reads with run projection reads
2. keep "current build" pinned to event-backed runtime revision
3. in viewer build-state handler:
   - load snapshot inputs from the displayed revision's projection
4. in viewer list handler:
   - compute revision/history presence from run projections
5. in viewer enable-editing handler:
   - use the projection for latest editable snapshot lookup
6. in viewer plan-handler input fallback:
   - use projected snapshot path instead of latest run JSON
### Important Rule

For any read path that combines snapshot inputs and event-backed artifacts:

1. snapshot selection must come from the same revision being displayed
2. never mix latest snapshot from revision B with artifacts from revision A

### Likely Files

1. `core/src/build-state.ts`
2. `viewer/server/builds/build-state-handler.ts`
3. `viewer/server/builds/list-handler.ts`
4. `viewer/server/builds/enable-editing-handler.ts`
5. `viewer/server/generation/plan-handler.ts`

### Exit Criteria

1. production code no longer calls `createRunRecordService(...)` for reads
2. current build and viewer build history are projection-driven

## Phase 4: One-Time Migration For Existing Builds

### Goal

Migrate existing build directories to the new event-backed run lifecycle model without keeping legacy fallback readers in production code.

### Decision

Use a **one-time idempotent migration script**.

The script should:

1. scan existing builds under `~/videos`
2. read legacy `runs/<revision>-run.json`
3. append the equivalent lifecycle events into `events/runs.log`
4. preserve references to existing sidecar files such as `runs/<revision>-plan.json` and `runs/<revision>-inputs.yaml`
5. be safe to re-run without duplicating migrated lifecycle events

### Important Sequencing Rule

Do **not** build this migration script first.

The order should be:

1. first, land the code refactor that introduces run lifecycle events and projection-based readers/writers
2. then, add the one-time migration script in `scripts/`
3. then, run the migration over the local `~/videos` build set
4. finally, remove legacy run-record files and dead code once migration has been verified

### Exit Criteria

1. an idempotent migration script exists in `scripts/`
2. existing builds can be migrated into `runs.log` without keeping legacy fallback logic in production code
3. new builds are event-backed from the moment they are created

## Phase 5: Remove Legacy RunRecord Authority

### Goal

Remove `run-record.ts` from production authority after readers and writers are migrated.

### Work

1. stop production dual-write if it was temporarily enabled
2. remove `RunRecordService` from production call sites
3. delete or deprecate `RunRecord` types
4. update docs and comments so they describe run events and projections instead of run JSON files
5. only remove files after confirming no remaining production dependency

### Constraints

This repository requires explicit confirmation before deleting files. Do not delete legacy files until that confirmation is given.

### Exit Criteria

1. no production code reads or writes `runs/<revision>-run.json`
2. the event subsystem is the only authority for run lifecycle state

## Data Model Decisions To Make Up Front

These should be settled before implementation begins.

### 1. Should `started` be a separate status in projections?

Recommendation:

1. yes

Reason:

1. it distinguishes "queued/planned" from "execution actually began"
2. it improves viewer job/history accuracy

### 2. Should `run-completed` encode both success and failure?

Recommendation:

1. yes

Reason:

1. the shape is simpler
2. completion summary belongs naturally with terminal completion

### 3. Should summary be event payload or recomputed read-time?

Recommendation:

1. store it in `run-completed`

Reason:

1. it is user-facing
2. it avoids recomputation drift
3. it mirrors current behavior with less reader complexity

### 4. Should snapshot and plan paths remain sidecars for now?

Recommendation:

1. yes

Reason:

1. that keeps scope aligned with Option B
2. it avoids turning this into a binary/blob storage redesign

## Risks And Mitigations

### Risk 1: Event ordering bugs create invalid projections

Mitigation:

1. validate legal transitions
2. fail fast on impossible states such as:
   - `run-started` before `run-planned`
   - `run-completed` before `run-planned`
   - duplicate terminal events without an explicit rule

### Risk 2: Migration script is not safely re-runnable

Mitigation:

1. make the migration script idempotent by design
2. write explicit duplicate-detection rules for run lifecycle events
3. add migration tests that run the script twice and assert the second run is a no-op

### Risk 3: Readers still accidentally mix revision A runtime state with revision B snapshot metadata

Mitigation:

1. make combined projection helpers revision-aware by API design
2. avoid convenience helpers that always mean "latest"

### Risk 4: Viewer and CLI drift apart again

Mitigation:

1. centralize run projection logic in `core`
2. make CLI and viewer thin consumers of shared projection APIs

## Test Plan

## Core Event/Projection Tests

1. `run-planned` creates a projection entry
2. `run-started` updates the projection without changing revision metadata
3. `run-completed` finalizes status as `succeeded`
4. `run-completed` finalizes status as `failed`
5. `run-cancelled` finalizes status as `cancelled`
6. invalid event ordering throws clearly
7. latest run projection is chosen by revision ordering, not file iteration order

## Build-State Regression Tests

1. if latest run projection is `rev-0002` but event-backed runtime state only exists for `rev-0001`, `loadCurrent()` stays on `rev-0001`
2. run metadata only decorates current build state when the revisions match, or when there is no event-backed revision yet

## Viewer Regression Tests

1. build-state handler loads snapshot inputs from the displayed revision
2. list handler does not report a misleading mixed revision
3. enable-editing restores the correct snapshot for the chosen/latest projected revision

## CLI And Viewer Execution Regression Tests

1. CLI execution throwing before artifact emission still produces terminal failed run event
2. viewer execution throwing before artifact emission still produces terminal failed run event
3. explicit cancellation produces `run-cancelled`, not `failed`

## Compatibility Tests

1. migration converts legacy `*-run.json` files into correct `runs.log` lifecycle events
2. running the migration twice produces no duplicate lifecycle events
3. migrated builds are fully readable by the new event-backed code without fallback readers

## Suggested File-Level Refactor Order

This order reduces risk and keeps the system working after each stage.

1. core event types and log plumbing
2. core run projection service and tests
3. CLI/viewer planning writers
4. CLI/viewer execution writers
5. core build-state reader migration
6. viewer build/list/editing reader migration
7. one-time idempotent migration script in `scripts/`
8. legacy run-record cleanup

## Completion Checklist

- [ ] `events/runs.log` exists as a first-class event stream in core
- [ ] run lifecycle events are defined in shared core types
- [ ] a core run projection service exists and is covered by tests
- [ ] storage initialization creates `events/runs.log`
- [ ] CLI planning writes `run-planned`
- [ ] viewer planning writes `run-planned`
- [ ] CLI execution writes `run-started`
- [ ] viewer execution writes `run-started`
- [ ] CLI execution writes terminal `run-completed` or `run-cancelled` on every path, including thrown failures
- [ ] viewer execution writes terminal `run-completed` or `run-cancelled` on every path, including thrown failures
- [ ] `core/src/build-state.ts` reads run metadata from projections, not `RunRecordService`
- [ ] current build state never advertises a revision unsupported by event-backed runtime state
- [ ] viewer build-state input snapshots are loaded from the displayed revision, not blindly from the latest run metadata
- [ ] viewer build list is projection-driven
- [ ] viewer enable-editing snapshot fallback is projection-driven
- [ ] viewer plan-handler snapshot fallback is projection-driven
- [ ] production code no longer depends on `createRunRecordService(...)` for reads
- [ ] a one-time idempotent migration script exists in `scripts/`
- [ ] the migration script is intentionally scheduled after the first code refactor phase, not before it
- [ ] the migration script converts old `*-run.json` files into `events/runs.log`
- [ ] the migration script is covered by tests proving a second run is a no-op
- [ ] production code does not keep legacy fallback readers for old `*-run.json`
- [ ] no new production path writes `runs/<revision>-run.json` as authority
- [ ] docs/comments explain run lifecycle in terms of events and projections rather than run-record truth
- [ ] `pnpm build` passes from the repo root
- [ ] `pnpm test` passes from the repo root
