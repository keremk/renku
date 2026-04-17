# Remove Manifest, Keep Event Log Truth, Preserve Run Archives

## Summary

This plan removes the manifest as a persisted runtime source of truth while preserving the two things that are genuinely valuable today:

1. durable per-run invocation metadata such as `runConfig`
2. the exact authored `inputs.yaml` text used for a specific revision

The target state is:

1. event logs are the only runtime source of truth
2. immutable per-revision run records preserve execution metadata
3. immutable per-revision YAML snapshots preserve exact authored inputs
4. mutable `builds/<movieId>/inputs.yaml` remains the working copy for editing

This keeps the recovery and debugging benefits of the current system without keeping a stale point-in-time manifest snapshot that runtime code can accidentally trust.

## Why The Manifest Is Brittle Today

The manifest currently mixes several unrelated responsibilities into one persisted file:

1. runtime state snapshot for latest inputs and artifacts
2. scheduler baseline for dirty detection and reuse logic
3. viewer/export lookup source
4. execution metadata archive via `runConfig`
5. ad hoc inspection/debugging snapshot

That is the core design problem.

Because it is persisted and reused later, the code has to continuously account for the possibility that:

1. the event log is newer than the manifest
2. the manifest contains only the latest succeeded view and hides other useful state
3. the manifest says something is present or reusable even though later event log state says otherwise
4. the manifest no longer matches the exact authored inputs file that was actually used

The repo already shows symptoms of this split truth:

1. planning reads event logs but still compares them against manifest state
2. viewer build APIs merge manifest data with event log data
3. some execution paths resolve fresh blob paths from event logs specifically because the manifest may be stale
4. export and recovery flows still depend on manifest lookups for things that should come from the event stream or immutable run archives

The result is brittleness not because “snapshots are always bad,” but because this specific snapshot is persisted and consulted as if it were authoritative after the system has already evolved past it.

## What The Manifest Is Actually Doing Today

### 1. Runtime baseline

The manifest currently stores:

1. `inputs` with per-input hash and serialized payload digest
2. `artifacts` with latest succeeded artifact hash, blob ref, producer info, status, diagnostics, edit metadata, and `inputsHash`
3. `revision`, `baseRevision`, and `createdAt`

This data is then used in planning and execution as the “before” snapshot.

### 2. Planning baseline

The planner currently uses the manifest for:

1. deciding whether a run is “initial”
2. comparing latest input events to previous input hashes
3. comparing latest artifact events to previous artifact hashes
4. deciding whether produced outputs are missing
5. deciding whether a prior artifact is reusable
6. validating pins and regeneration targets
7. deriving `manifestBaseHash`

This is the first role that must be removed.

### 3. In-run hash propagation

During execution, the runner keeps a mutable in-memory manifest so later layers can compute content-aware `inputsHash` values using newly produced upstream artifact hashes from the same run.

This is a real need, but it does not require a persisted manifest file.

### 4. Viewer/export lookup source

The manifest is also used as a convenient lookup surface for:

1. build inspection
2. artifact listing
3. timeline lookup
4. blob streaming by canonical artifact ID
5. export and DaVinci export inputs
6. artifact materialization for local artifacts folders
7. read-only display of inputs and models when `inputs.yaml` is absent

These are read-model concerns, not runtime truth concerns.

### 5. Metadata archive

The manifest currently stores `runConfig`, which the user explicitly wants to keep.

That is a valid requirement, but it does not belong in a mutable runtime snapshot.

## Core Refactoring Principle

Split the manifest into three separate concepts and keep only the ones that are truly needed:

### A. Runtime truth

Use event logs only.

Runtime truth must come from:

1. `events/inputs.log`
2. `events/artifacts.log`

No manifest file, no pointer, no snapshot hash conflict logic, no merge of “manifest plus latest events.”

### B. Immutable per-revision archive

Store per-revision run metadata in a dedicated `RunRecord`.

This is where `runConfig` belongs.

### C. Immutable per-revision authored input snapshot

Store the exact `inputs.yaml` bytes used for a revision in an immutable snapshot.

This is how we preserve exact authored YAML for corruption recovery and forensic debugging.

## Proposed Replacement Model

### 1. EventLogState

Add a core event-derived state builder that reads the logs and produces an in-memory `EventLogState`.

Suggested shape:

```ts
interface EventLogState {
  latestRevision: RevisionId | null;
  latestInputsById: Map<string, InputEvent>;
  latestArtifactsById: Map<string, ArtifactEvent>;
  latestSucceededArtifactIds: Set<string>;
  latestFailedArtifactIds: Set<string>;
}
```

Key rules:

1. keys are canonical IDs only
2. last event wins for a given canonical ID
3. no alias reconstruction
4. no best-effort canonicalization inside runtime state accessors
5. if a caller supplies a non-canonical runtime ID, fail immediately

### 2. RunRecord

Add a new immutable record at:

`runs/<revision>-run.json`

Suggested shape:

```ts
interface RunRecord {
  revision: RevisionId;
  createdAt: IsoDatetime;
  blueprintPath?: string;
  sourceInputsPath?: string;
  inputSnapshotPath: string;
  inputSnapshotHash: string;
  planPath: string;
  runConfig: RunConfig;
  status: 'planned' | 'succeeded' | 'failed' | 'cancelled';
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

Design rules:

1. `RunRecord` is immutable once written for a revision except for explicit execution lifecycle updates if needed
2. it is archival metadata, never a scheduling baseline
3. it is revision-specific, not “current state”
4. `runConfig` is required and must always be persisted

### 3. Immutable YAML snapshot

Add a new per-revision file at:

`runs/<revision>-inputs.yaml`

This snapshot must preserve the exact original bytes of the authored YAML file used for planning.

That means:

1. preserve comments
2. preserve ordering
3. preserve formatting
4. preserve authored `models:` structure
5. preserve any unusual but valid YAML layout that may later help with corruption recovery

Important rule:

The snapshot must be taken from raw file bytes before parsing or normalization.

Do not regenerate this file from parsed inputs.

Regenerating from parsed inputs would lose the exact authored text, which is one of the main reasons the user wants to keep it.

## File Layout After Refactor

Each build directory should look conceptually like this:

```text
builds/<movieId>/
  events/
    inputs.log
    artifacts.log
  runs/
    rev-0001-plan.json
    rev-0001-inputs.yaml
    rev-0001-run.json
    rev-0002-plan.json
    rev-0002-inputs.yaml
    rev-0002-run.json
  inputs.yaml
  metadata.json
  blobs/
```

Notes:

1. `inputs.yaml` remains mutable working state for editable builds
2. `runs/<revision>-inputs.yaml` is immutable archival state
3. `runs/<revision>-run.json` is immutable archival metadata
4. event logs remain the only runtime truth
5. `manifests/` and `current.json` are removed entirely

## What Must Be Removed First

The first thing to remove is not the manifest file writer itself. The first thing to remove is the manifest’s role as the planner baseline.

That order matters.

If we delete the manifest files first without changing planner semantics, we will simply push the same assumptions into ad hoc fallback code elsewhere.

The removal sequence should be:

1. introduce `EventLogState`
2. switch planning to event-log-only baseline
3. switch runner same-run hashing support to an in-memory event-derived state
4. switch viewer/export/read APIs to event-derived state or run records
5. introduce `RunRecord` and per-revision YAML snapshots
6. delete manifest persistence and pointer logic

This sequence keeps the architecture clean while preserving functionality during the transition.

## Detailed Implementation Plan

## Phase 1: Introduce EventLogState

### Goal

Create the new authoritative runtime read model before deleting anything.

### Work

1. Add a new core module for event-derived build state, for example:
   - `core/src/runtime/event-log-state.ts`
2. Implement readers for:
   - latest input events by canonical input ID
   - latest artifact events by canonical artifact ID
   - latest succeeded artifact set
   - latest failed artifact set
   - latest revision derived from observed events and/or runs
3. Add strict validation:
   - fail on non-canonical IDs when consuming runtime identifiers
   - fail fast if required event fields are missing
4. Add a helper for revision-scoped queries if needed later:
   - current latest state
   - state up to a given revision

### Output

At the end of this phase, the codebase has an explicit event-derived state object that can replace all “load manifest then compare against events” behavior.

## Phase 2: Remove Manifest From Planning Baseline

### Goal

Make the planner depend only on event-derived state plus the canonical graph.

### Work

1. Replace manifest-based “initial run” detection with event-derived detection:
   - initial means no prior relevant input/artifact events for that build
2. Replace `determineDirtyInputs(manifest, inputs)` with logic based entirely on:
   - latest input events
   - current pending input events
   - prior produced artifact event `inputsHash` values
3. Replace `determineDirtyArtifacts(manifest, artifacts, latestFailedIds)` with logic based only on latest artifact events
4. Replace “produces missing” checks so they use latest artifact events only
5. Replace `manifestBaseHash` with a new baseline hash computed from event-derived state if still needed
6. Remove manifest from planner entrypoints and adapter signatures
7. Remove manifest-dependent branches from explanation code

### Important semantic rule

Dirty detection should be expressed in event-log terms:

1. input dirty when latest relevant input event differs from the one implied by previous artifact `inputsHash`
2. artifact dirty when latest upstream required artifact event has changed or failed
3. output missing when latest artifact event for a declared output is absent or not reusable

### Output

At the end of this phase, stale or deleted manifest files cannot affect scheduling.

## Phase 3: Replace Runner’s In-Memory Manifest

### Goal

Keep correct same-run `inputsHash` behavior without a persisted manifest concept.

### Work

1. Replace the runner’s `runningManifest` with a mutable in-memory `ExecutionState`
2. `ExecutionState` should contain:
   - latest input hashes by canonical input ID
   - latest succeeded artifact hashes by canonical artifact ID
   - any other runtime-only fields needed for same-run propagation
3. Seed `ExecutionState` from `EventLogState`
4. Update `ExecutionState` as each artifact event is appended during execution
5. Update `hashInputContents` or replace it with an event-state-driven variant that reads from `ExecutionState`
6. Remove `RunResult.buildManifest()`

### Output

Later-layer jobs still see fresh upstream hashes from the same run, but there is no manifest file involved.

## Phase 4: Add RunRecord And Immutable YAML Snapshots

### Goal

Preserve `runConfig` and exact authored YAML text without keeping a mutable persisted snapshot.

### Work

1. Add a core writer/reader for `RunRecord`
2. Decide one canonical place in the plan/build flow to create the YAML snapshot:
   - at plan persist time
3. For CLI:
   - copy raw bytes from the user-provided input file path
4. For viewer:
   - copy raw bytes from `builds/<movieId>/inputs.yaml`
5. Write `runs/<revision>-inputs.yaml`
6. Compute and store `inputSnapshotHash`
7. Write `runs/<revision>-run.json` with at least:
   - `revision`
   - `createdAt`
   - `planPath`
   - `inputSnapshotPath`
   - `inputSnapshotHash`
   - `runConfig`
   - `status: 'planned'`
8. On execution completion, update or finalize run record with:
   - actual execution status
   - timestamps
   - summary

### Important rule

Do not treat `RunRecord` as runtime truth.

It is for:

1. audit
2. recovery
3. explainability
4. debugging
5. build history inspection

It must not become the next manifest.

## Phase 5: Replace Viewer And Export Read Models

### Goal

Remove all manifest-backed inspection and export paths.

### Viewer build state API

Replace `BuildManifestResponse` and `/blueprints/manifest` with an event-derived `BuildStateResponse`.

Suggested behavior:

1. artifacts are derived from latest artifact events
2. current editable inputs come from `builds/<movieId>/inputs.yaml` if present
3. if there is no mutable `inputs.yaml`, load latest revision’s `runs/<revision>-inputs.yaml`
4. model selections should be parsed from the authored YAML source or snapshot, not inferred from manifest-flattened inputs
5. timestamps and revision metadata should come from `RunRecord` plus event state

### Export paths

Replace manifest-based export lookup logic with:

1. timeline artifact resolved from latest artifact events
2. blob refs resolved from latest artifact events
3. config metadata read from `RunRecord.runConfig` or the authored YAML snapshot if appropriate

### Blob streaming

Replace “look up artifact in manifest, then stream blob” with:

1. find latest succeeded artifact event for canonical artifact ID
2. resolve blob path from the blob ref in that event
3. stream the blob

### Artifact materialization

Replace manifest materialization with event-derived artifact materialization:

1. enumerate latest succeeded artifact events
2. materialize blobs from those events
3. preserve canonical artifact IDs and canonical producer IDs in all materialized metadata

## Phase 6: Remove Manifest Persistence And Pointer Logic

### Goal

Delete the manifest entirely once nothing authoritative depends on it.

### Work

1. delete `core/src/manifest.ts`
2. remove `Manifest`, `ManifestService`, and `ManifestPointer` types
3. remove `manifests/` directory initialization
4. remove `current.json` creation and reading
5. remove manifest hash conflict logic
6. remove manifest-specific error codes or rename them where behavior remains relevant
7. remove manifest terminology from CLI and viewer surfaces

### Revision handling

Current revision derivation should be replaced with:

1. scan `runs/*.json` or `runs/*-plan.json`
2. derive next revision from the latest existing revision

Do not keep a mutable “current revision pointer” file just to replace the manifest pointer.

That would recreate the same architectural failure mode in a smaller form.

## How To Preserve Exact Authored YAML Correctly

This needs an explicit rule because it is easy to get wrong.

### Correct approach

1. identify the source file path actually used for planning
2. read raw bytes from disk
3. write those bytes unchanged to `runs/<revision>-inputs.yaml`
4. hash those exact bytes
5. store the hash and path in the `RunRecord`

### Incorrect approaches

Do not:

1. parse and reserialize YAML
2. rebuild YAML from `InputEvent`s
3. rebuild YAML from normalized canonical inputs
4. rebuild model selections from flattened provider/model input fields

All of those approaches lose exactly the authored detail the user wants to preserve.

## How To Preserve runConfig Correctly

`runConfig` is important, so it should become required run metadata, not an optional field hidden in an unrelated snapshot.

### Correct approach

1. build `runConfig` at planning/build invocation time
2. write it into `RunRecord` for that revision
3. keep it available even if execution later fails
4. keep it available for dry-runs as well

### Why this is better than today

Today `runConfig` is written into the manifest after execution-related handling.

That means:

1. it is tied to a mutable runtime snapshot
2. it inherits all manifest-staleness risks
3. it is harder to treat as archival truth

Moving it into `RunRecord` gives it a stable, revision-scoped home.

## Canonical ID Rules

This refactor must not regress canonical ID discipline.

Rules:

1. event log readers only consume canonical IDs
2. `EventLogState` keys are canonical IDs only
3. `RunRecord` may contain canonical IDs where identifiers are stored
4. viewer/export/read APIs may provide display labels, but those are separate from identifiers
5. no route, helper, planner, exporter, or provider should “guess” canonical IDs from shortened names
6. if a required canonical ID is absent, throw immediately with a clear Renku error

This applies especially to:

1. artifact lookups
2. producer regeneration target resolution
3. pinning/reuse checks
4. blob streaming by artifact ID
5. input/model selection reconstruction from YAML snapshots

## Migration Of Existing Call Sites

### Core

Replace:

1. manifest service usage in planning
2. manifest-based dirty checks
3. manifest-based same-run accumulation
4. manifest-based artifact materialization

With:

1. `EventLogState`
2. `ExecutionState`
3. `RunRecord`

### CLI

Replace:

1. `loadCurrentManifest`
2. manifest-based export lookup
3. manifest path reporting

With:

1. latest build state reader
2. latest run record reader
3. event-derived artifact lookup

### Viewer

Replace:

1. `BuildManifestResponse`
2. manifest handler
3. manifest-backed blob lookup
4. manifest-derived read-only input/model fallback

With:

1. event-derived build state handler
2. run-snapshot-backed authored input fallback
3. artifact-event-backed blob lookup

### MCP

If MCP still remains relevant in future work, it should enumerate artifacts and timelines from event-derived state and run records, never from manifest files.

## Risks And Mitigations

### Risk 1: RunRecord accidentally becomes the next manifest

Mitigation:

1. keep `RunRecord` immutable and revision-scoped
2. do not use it for runtime scheduling decisions
3. do not store mutable “latest artifact snapshot” state in it

### Risk 2: Exact YAML snapshot is taken too late

Mitigation:

1. snapshot before parsing/normalization
2. use raw source bytes
3. add tests that assert byte-for-byte equality

### Risk 3: Read-only viewer builds lose inputs/models when `inputs.yaml` is absent

Mitigation:

1. explicitly read latest revision’s `runs/<revision>-inputs.yaml`
2. parse authored YAML snapshot for display
3. do not rely on flattened event-log inputs for preserving authored model-selection structure

### Risk 4: Same-run `inputsHash` behavior regresses

Mitigation:

1. add dedicated execution-state tests
2. verify later-layer jobs see hashes from upstream artifacts produced earlier in the same run

### Risk 5: Hidden manifest consumers remain

Mitigation:

1. grep-based audit for runtime manifest reads
2. remove all manifest exports from `core/src/index.ts`
3. add tests that pass with no manifest files present

## Acceptance Criteria

The refactor is complete when all of the following are true:

1. deleting `manifests/` and `current.json` does not change planning or execution behavior
2. planning uses only event-derived state and canonical graph state
3. same-run `inputsHash` logic still works without a manifest
4. `runConfig` is durably preserved per revision in `runs/<revision>-run.json`
5. exact authored YAML is durably preserved per revision in `runs/<revision>-inputs.yaml`
6. viewer read-only builds can still show inputs and models when mutable `inputs.yaml` is absent
7. export and blob streaming use artifact events, not manifest entries
8. no runtime code path depends on manifest files
9. canonical ID strictness is preserved end-to-end

## Execution Checklist

Use this checklist during implementation and do not mark an item complete unless the code and tests match the intended behavior.

### Architecture

- [ ] Add `EventLogState` module with strict canonical-ID keyed maps
- [ ] Add `ExecutionState` for same-run in-memory hash propagation
- [ ] Add `RunRecord` type and persistence API
- [ ] Add immutable per-revision YAML snapshot writer
- [ ] Remove manifest and pointer concepts from the architecture diagram in code/docs where applicable

### Planning

- [ ] Remove manifest loading from planning service
- [ ] Replace manifest-based dirty input checks with event-derived checks
- [ ] Replace manifest-based dirty artifact checks with event-derived checks
- [ ] Replace manifest-based missing-output checks with event-derived checks
- [ ] Replace manifest-based pin/reuse/regeneration resolution with event-derived resolution
- [ ] Remove `manifestBaseHash` or replace it with an event-derived baseline hash if still needed
- [ ] Ensure planner APIs no longer accept `manifest`

### Execution

- [ ] Remove runner dependence on persisted manifest state
- [ ] Seed `ExecutionState` from `EventLogState`
- [ ] Update `ExecutionState` as artifact events are appended
- [ ] Ensure later layers compute correct `inputsHash`
- [ ] Remove `RunResult.buildManifest()`

### Run Archives

- [ ] Write `runs/<revision>-inputs.yaml` from raw source bytes before parsing
- [ ] Compute and persist `inputSnapshotHash`
- [ ] Write `runs/<revision>-run.json` with required `runConfig`
- [ ] Persist run records for dry-runs
- [ ] Persist run records for failed executions
- [ ] Persist run records for successful executions
- [ ] Include summary/timestamps/status in run records after execution

### Viewer And Export

- [ ] Replace `/blueprints/manifest` with an event-derived build-state endpoint
- [ ] Replace manifest-backed artifact listing with event-backed listing
- [ ] Replace manifest-backed blob streaming with artifact-event-backed streaming
- [ ] Replace manifest-backed timeline lookup with artifact-event-backed lookup
- [ ] Replace manifest-backed read-only input fallback with latest YAML snapshot fallback
- [ ] Replace manifest-backed model-selection fallback with authored YAML snapshot parsing
- [ ] Replace export and DaVinci manifest lookups with event-derived artifact state and run-record metadata

### Cleanup

- [ ] Delete `core/src/manifest.ts`
- [ ] Delete manifest exports from core public API
- [ ] Remove `Manifest`, `ManifestService`, and `ManifestPointer` types
- [ ] Remove `manifests/` directory creation from storage initialization
- [ ] Remove `current.json` creation and reads
- [ ] Rename or remove manifest-specific error paths and wording
- [ ] Remove manifest-centric tests or rewrite them against event state and run archives

### Verification

- [ ] Test that exact YAML snapshots are byte-for-byte identical to the source file used for planning
- [ ] Test that `runConfig` survives success, failure, and dry-run cases
- [ ] Test that deleting manifest files does not change planner results
- [ ] Test that deleting manifest files does not break execution
- [ ] Test that deleting manifest files does not break viewer build inspection
- [ ] Test that deleting manifest files does not break export and DaVinci export
- [ ] Test that read-only builds still show inputs/models using revision snapshots
- [ ] Test that non-canonical runtime IDs still fail fast everywhere
- [ ] Run `pnpm test` from the repository root as final verification
