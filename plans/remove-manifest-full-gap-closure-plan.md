# Remove Manifest Follow-Up: Full Gap Closure Plan

## Summary

This plan closes every remaining gap between the intended end state in
`plans/remove-manifest-eventlog-run-records-plan.md` and the current repository
state.

The goal is not to "mostly" remove the manifest. The goal is to finish the job:

1. event logs become the only runtime source of truth
2. run records and YAML snapshots remain as immutable archives
3. no planner, runner, export path, viewer path, error name, test, or doc still
   depends on manifest-era concepts
4. no public API, response type, or UI contract still presents the build as a
   "manifest"

This follow-up plan is intentionally exhaustive. If an item below is still
present in the codebase, the refactor is not complete.

## Current Status

Runtime behavior is now migrated much further than when this plan was written:

1. planning, execution, viewer plan/execute flows, CLI exports, and build-state
   inspection are now event-log/run-record driven
2. `ExecutionState` is threaded through the main execution paths so `inputsHash`
   propagation works correctly for fresh runs, dry-runs, retries, surgical
   reruns, and partial reruns
3. the repository-level verification command `pnpm test` passes

The remaining gaps are mostly cleanup and compatibility work:

1. `core/src/manifest.ts` and its compatibility exports still exist
2. a number of tests still use manifest-era helper names through the
   compatibility layer
3. some docs and plan notes still mention `current.json`, `manifests/`, and
   manifest-era terminology

One explicit constraint also applies in this repository: file deletion requires
explicit user confirmation. That means fully removing compatibility files still
needs a follow-up confirmation step before those files can be deleted.

## Why A Follow-Up Plan Is Needed

The repository already contains some of the new foundation:

1. `EventLogState` exists
2. `RunRecord` exists
3. immutable `runs/<revision>-inputs.yaml` snapshots are written
4. `runs/<revision>-run.json` records are written and finalized
5. storage initialization already creates `events/`, `runs/`, and `blobs/`
   instead of `manifests/`

But the repository is still in a hybrid state.

The main remaining problem is that the old manifest model still survives as a
live adapter and many call sites still depend on it:

1. planning still loads and compares `manifest`
2. runner still carries a mutable in-memory `runningManifest`
3. `RunResult.buildManifest()` still exists
4. CLI export paths still load the current manifest
5. viewer client/server APIs still use `/blueprints/manifest`,
   `BuildManifestResponse`, `useBuildManifest`, and `hasManifest`
6. docs, tests, errors, and readme text still describe the old design

That means the original migration is not done yet.

## Current Remaining Gaps

### 1. Core runtime model is still manifest-shaped

The following remaining patterns must be removed:

1. `core/src/manifest.ts` still exists and still defines `ManifestService`
2. `core/src/index.ts` still exports `./manifest.js`
3. `Manifest`, `ManifestService`, and manifest-centric result fields still
   appear in core public types
4. `ManifestNotFoundError`, `ManifestConflictError`,
   `RuntimeErrorCode.MANIFEST_*`, and `RuntimeErrorCode.ARTIFACT_NOT_IN_MANIFEST`
   still exist
5. comments and helper names still describe build state as a manifest even when
   the data is event-derived

### 2. Planning still uses manifest as the baseline contract

The planner refactor is incomplete because:

1. planning still calls `loadOrCreateManifest(...)`
2. planner entrypoints still accept `manifest`
3. dirty input checks still compare against `manifest.inputs`
4. dirty artifact checks still compare against `manifest.artifacts`
5. missing-output checks still inspect manifest state
6. pin/reuse/regeneration resolution still consumes manifest state
7. `manifestBaseHash` still exists and is still computed from a manifest-shaped
   object
8. plan explanation and planning controls still use manifest terminology and
   manifest inputs

### 3. Execution still depends on a mutable manifest

The execution refactor is incomplete because:

1. runner execution context still requires `manifest`
2. runner still maintains `runningManifest`
3. same-run `inputsHash` propagation still relies on manifest mutation
4. `RunResult.buildManifest()` still exists in both the main runner and
   execution helpers
5. CLI and viewer execution handlers still call `run.buildManifest()`
6. artifact materialization is still driven by `Manifest.artifacts`

### 4. Viewer and CLI read models are only partially migrated

Some read paths already use event logs, but the public surface is still
manifest-era:

1. viewer route is still `/blueprints/manifest`
2. viewer types still expose `BuildManifestResponse`
3. viewer hooks and state still use `useBuildManifest`
4. build list types still expose `hasManifest`
5. CLI artifact views still call `loadCurrentManifest(...)`
6. export and DaVinci export still load a manifest and use manifest-specific
   errors/messages
7. read-only input/model fallback behavior exists, but it is still wrapped in a
   manifest-named API

### 5. Tests and docs still preserve the old mental model

The cleanup is incomplete because:

1. `core/src/manifest.test.ts` still exists
2. many planner/runner/integration/e2e tests still construct or assert
   manifests
3. viewer tests still mention `current.json`, `manifests/`, and
   `getBuildManifest`
4. docs still describe `current.json`, `manifests/<revision>.json`, and
   manifest fetch flows
5. README text still refers to `manifests/`
6. generated/bundled server files still contain manifest-era code and must be
   regenerated or otherwise brought into sync after source changes

### 6. Verification coverage is still incomplete

The final verification is incomplete because the test suite does not yet
explicitly prove all of the intended guarantees:

1. byte-for-byte YAML snapshot preservation
2. `runConfig` persistence across planned, dry-run, failed, and successful runs
3. planner behavior without manifest files
4. execution behavior without manifest files
5. viewer inspection behavior without manifest files
6. export and DaVinci export behavior without manifest files
7. read-only builds loading inputs/models from revision snapshots
8. non-canonical runtime IDs failing fast across all new build-state accessors

## Target End State

After this plan is complete, the codebase should look like this conceptually:

1. runtime truth:
   - `events/inputs.log`
   - `events/artifacts.log`
2. immutable archives:
   - `runs/<revision>-plan.json`
   - `runs/<revision>-inputs.yaml`
   - `runs/<revision>-run.json`
3. mutable working copy:
   - `builds/<movieId>/inputs.yaml`
4. no `manifests/`
5. no `current.json`
6. no manifest types, APIs, route names, or errors in production code

## Detailed Work Plan

## Phase 1: Replace Manifest With Explicit Build-State Concepts

### Goal

Remove manifest from core public architecture before touching outer layers.

### Work

1. Introduce explicit build-state/read-model naming in core.
2. Add a dedicated event-derived runtime state service that returns:
   - latest revision
   - latest inputs by canonical input ID
   - latest artifact events by canonical artifact ID
   - latest succeeded artifact IDs
   - latest failed artifact IDs
3. Replace `ManifestService` with an explicitly named read-model service only if
   a compatibility layer is still needed during transition.
4. Remove any runtime result fields that still expose `manifest` or
   `manifestHash`.
5. Rename manifest-specific error codes/messages to build-state or artifact-state
   wording where the behavior still exists.
6. Remove manifest terminology from comments, helper names, and type docs.

### Files To Change

1. `core/src/manifest.ts`
2. `core/src/index.ts`
3. `core/src/types.ts`
4. `core/src/errors/codes.ts`
5. `core/src/event-log-state.ts`
6. any callers that import manifest exports

### Exit Criteria

1. production code no longer imports `createManifestService`
2. `core/src/manifest.ts` is deleted
3. core public exports do not expose manifest APIs

## Phase 2: Make Planning Event-Log-Only

### Goal

Remove manifest from the planning baseline completely.

### Work

1. Replace `loadOrCreateManifest(...)` with event-log and run-record loading.
2. Derive next revision from `runs/*.json` and `runs/*-plan.json`, not from a
   manifest revision.
3. Replace dirty input detection with event-derived comparison logic.
4. Replace dirty artifact detection with event-derived comparison logic.
5. Replace missing-output checks with event-derived artifact checks.
6. Replace pin/reuse/regeneration resolution with event-derived state and
   canonical graph metadata.
7. Remove `manifestBaseHash` or replace it with an event-derived baseline hash
   that is no longer called "manifest".
8. Remove `manifest` from planner, plan adapter, planning service, planning
   controls, plan helpers, and explanation contracts.
9. Ensure all reasoning still fails fast on missing canonical IDs. Do not add
   alias fallback logic.

### Files To Change

1. `core/src/orchestration/planning-service.ts`
2. `core/src/planning/planner.ts`
3. `core/src/planning/adapter.ts`
4. `core/src/planning/explanation.ts`
5. `core/src/orchestration/planning-controls.ts`
6. `core/src/orchestration/plan-helpers.ts`
7. any CLI/viewer wrappers passing `manifest` into planning

### Exit Criteria

1. planner APIs no longer accept `manifest`
2. no planning code path compares current state against `manifest.inputs` or
   `manifest.artifacts`
3. deleting legacy manifest files cannot change planner output

## Phase 3: Replace Runner Manifest Mutation With ExecutionState

### Goal

Keep same-run hash propagation without keeping a manifest-shaped runner state.

### Work

1. Add a core `ExecutionState` for in-memory execution-only hash propagation.
2. Seed `ExecutionState` from `EventLogState`.
3. Track:
   - latest input hashes by canonical input ID
   - latest succeeded artifact hashes by canonical artifact ID
   - any additional runtime-only fields needed by `hashInputContents`
4. Update `hashInputContents` or replace it with an execution-state-aware
   implementation.
5. Replace runner `runningManifest` mutation with `ExecutionState` updates as
   artifact events are appended.
6. Remove `RunResult.buildManifest()`.
7. Update execution result types so downstream code consumes event-derived
   summaries or run-record data instead of asking the runner to rebuild a
   manifest.

### Files To Change

1. `core/src/runner.ts`
2. `core/src/execution/plan-runner.ts`
3. `core/src/execution/types.ts`
4. `core/src/hashing.ts`
5. `core/src/types.ts`
6. CLI/viewer execution handlers that still expect a manifest from the run

### Exit Criteria

1. no runner context requires `manifest`
2. no runner code keeps `runningManifest`
3. `RunResult.buildManifest()` is gone everywhere
4. later layers still compute correct `inputsHash`

## Phase 4: Finish Run Archive Semantics

### Goal

Make run records and snapshots the only persisted archival layer.

### Work

1. Keep YAML snapshot creation at plan persist time.
2. Ensure snapshots are always written from raw source bytes:
   - CLI: source inputs path used for planning
   - viewer: `builds/<movieId>/inputs.yaml`
3. Make `runConfig` required in every stored run record, including empty object
   cases.
4. Persist planned records before execution.
5. Finalize records after dry-run execution.
6. Finalize records after failed execution.
7. Finalize records after successful execution.
8. Include timestamps and summary fields consistently.
9. Ensure any code reading build metadata uses run records directly instead of
   going through a manifest-shaped adapter.

### Files To Change

1. `core/src/run-record.ts`
2. `cli/src/lib/planner.ts`
3. `cli/src/lib/build.ts`
4. `viewer/server/generation/plan-handler.ts`
5. `viewer/server/generation/execute-handler.ts`
6. any tests asserting optional or missing `runConfig`

### Exit Criteria

1. every revision with a saved plan has a matching `-run.json` and
   `-inputs.yaml`
2. `runConfig` is preserved for planned, dry-run, failed, and successful cases

## Phase 5: Replace Viewer Build-State APIs Completely

### Goal

Finish the viewer migration so the public surface no longer uses manifest terms.

### Work

1. Replace `/blueprints/manifest` with a build-state route.
2. Rename `getBuildManifest` to a build-state reader.
3. Rename `BuildManifestResponse` to a build-state response.
4. Rename `useBuildManifest` and related client helpers.
5. Rename `hasManifest` to a build-state/archive-oriented field such as
   `hasRunRecord` if that is the actual meaning.
6. Keep artifact listing event-backed.
7. Keep timeline lookup event-backed.
8. Keep blob streaming by canonical artifact ID event-backed.
9. Keep read-only input fallback pointed at latest revision snapshot.
10. Keep model-selection fallback pointed at authored YAML parsing, not flattened
    manifest inputs.
11. Remove remaining compatibility wording in component props, data hooks, and
    server handler names.

### Files To Change

1. `viewer/server/builds/manifest-handler.ts`
2. `viewer/server/builds/index.ts`
3. `viewer/server/builds/types.ts`
4. `viewer/src/types/builds.ts`
5. `viewer/src/data/blueprint-client.ts`
6. `viewer/src/services/use-build-manifest.ts`
7. `viewer/src/app.tsx`
8. `viewer/src/components/blueprint/workspace-layout.tsx`
9. any tests that still mention manifest routes or types

### Exit Criteria

1. viewer no longer exposes `/blueprints/manifest`
2. no viewer API/type/hook name still uses "manifest"
3. read-only builds still display inputs/models from revision snapshots

## Phase 6: Replace CLI Export And Artifact Read Models

### Goal

Remove manifest from CLI inspection/export flows.

### Work

1. Replace `loadCurrentManifest(...)` with a build-state loader.
2. Replace artifact materialization with event-derived artifact materialization.
3. Update export command to:
   - resolve timeline artifact from latest artifact events
   - resolve blob refs from latest artifact events
   - read config metadata from authored YAML snapshot or run record as
     appropriate
4. Update DaVinci export command to use event-derived timeline resolution and
   run-record metadata.
5. Remove manifest-specific error codes/messages from export paths.
6. Update CLI output labels such as `manifestPath` / `manifestRevision`.
7. Update CLI explain/read flows that still mention manifest state.

### Files To Change

1. `cli/src/lib/artifacts-view.ts`
2. `core/src/artifact-materialization.ts`
3. `cli/src/commands/export.ts`
4. `cli/src/commands/export-davinci.ts`
5. `cli/src/commands/generate.ts`
6. `cli/src/commands/execute.ts`
7. `cli/src/commands/explain.ts`
8. any related summaries or result interfaces

### Exit Criteria

1. export and DaVinci export work with no manifest files present
2. no CLI result type or message still treats the build as a manifest

## Phase 7: Remove Legacy Manifest Artifacts From Tests, Docs, And Bundles

### Goal

Finish the cleanup so the repository no longer teaches or tests the old model.

### Work

1. Delete `core/src/manifest.test.ts` or rewrite it around event state and run
   records under a new name.
2. Rewrite planner/runner tests that seed or assert manifests as planning
   baselines.
3. Rewrite viewer tests that create `current.json` and `manifests/`.
4. Rewrite e2e tests that rely on stale manifest fixtures so they simulate stale
   or changed event state instead.
5. Update docs:
   - `viewer/docs/design.md`
   - `viewer/docs/architecture.md`
   - `viewer/README.md`
   - `cli/README.md`
   - any other manifest-era explanation docs
6. Regenerate or remove committed bundle artifacts that still contain manifest
   terminology, for example tracked server bundle outputs, after source changes
   are complete.

### Exit Criteria

1. repository docs no longer describe `current.json` or `manifests/`
2. tracked generated artifacts are in sync with source
3. test names and fixtures no longer assume manifest persistence

## Phase 8: Add Missing Verification Coverage

### Goal

Prove the migration, not just implement it.

### Work

Add explicit tests for all remaining guarantees:

1. YAML snapshot bytes are exactly identical to the source file used for
   planning
2. `inputSnapshotHash` matches the exact raw snapshot bytes
3. `runConfig` survives:
   - planned-only case
   - dry-run case
   - failed execution case
   - successful execution case
4. deleting manifest files does not change planner results
5. deleting manifest files does not break execution
6. deleting manifest files does not break viewer build inspection
7. deleting manifest files does not break export
8. deleting manifest files does not break DaVinci export
9. read-only builds still show inputs/models using revision snapshots
10. non-canonical runtime IDs fail fast in all new build-state accessors
11. event-derived artifact materialization still preserves canonical artifact and
    producer IDs

### Final Verification

1. run focused tests while implementing
2. run `pnpm test` from the repository root as the final verification step

## Acceptance Criteria

This follow-up plan is complete only when all of the following are true:

1. there is no `core/src/manifest.ts`
2. there are no production imports of manifest APIs
3. planner and runner contracts no longer accept or return manifest-shaped
   runtime state
4. viewer and CLI public APIs no longer use manifest naming
5. export and DaVinci export no longer read manifest state
6. artifact materialization is event-derived
7. docs and readmes no longer describe `current.json` or `manifests/`
8. test coverage explicitly proves the new guarantees
9. `pnpm test` passes from the repository root

## Execution Checklist

Use this checklist to drive implementation. Do not mark an item complete until
the code, tests, and naming all match the intended behavior.

### Architecture

- [ ] Delete `core/src/manifest.ts`
- [ ] Remove manifest exports from `core/src/index.ts`
- [ ] Remove `ManifestService` from production code
- [ ] Remove manifest-specific runtime error codes and rename surviving errors
- [ ] Remove manifest terminology from core comments and type docs
- [ ] Regenerate tracked bundles after source cleanup if the repo keeps them

### Planning

- [ ] Remove manifest loading from planning service
- [ ] Derive next revision from `runs/*.json` and/or `runs/*-plan.json`
- [ ] Remove `manifest` from planner and plan-adapter args
- [ ] Replace dirty input checks with event-derived checks
- [ ] Replace dirty artifact checks with event-derived checks
- [ ] Replace missing-output checks with event-derived checks
- [ ] Replace pin/reuse/regeneration resolution with event-derived resolution
- [ ] Remove or rename `manifestBaseHash`
- [ ] Remove manifest wording from planning explanations and helper names

### Execution

- [ ] Add core `ExecutionState` for same-run hash propagation
- [ ] Seed `ExecutionState` from `EventLogState`
- [ ] Update `ExecutionState` as artifact events are appended
- [ ] Replace `runningManifest` mutation with `ExecutionState`
- [ ] Ensure later layers still compute correct `inputsHash`
- [ ] Remove `RunResult.buildManifest()`
- [ ] Remove manifest from runner execution context and result contracts

### Run Archives

- [ ] Keep writing `runs/<revision>-inputs.yaml` from raw source bytes
- [ ] Assert `inputSnapshotHash` is computed from exact raw bytes
- [ ] Make `runConfig` required in stored run records
- [ ] Persist `runs/<revision>-run.json` for planned runs
- [ ] Finalize run records for dry-runs
- [ ] Finalize run records for failed runs
- [ ] Finalize run records for successful runs
- [ ] Persist timestamps and summary fields consistently

### Viewer

- [ ] Replace `/blueprints/manifest` with a build-state endpoint
- [ ] Rename `getBuildManifest` and `BuildManifestResponse`
- [ ] Rename `useBuildManifest`
- [ ] Rename `hasManifest` to a non-legacy field
- [ ] Keep artifact listing event-backed
- [ ] Keep blob streaming event-backed
- [ ] Keep timeline lookup event-backed
- [ ] Keep read-only input fallback on latest YAML snapshot
- [ ] Keep model-selection fallback on authored YAML parsing
- [ ] Remove manifest terminology from viewer state, props, and tests

### CLI And Export

- [ ] Replace `loadCurrentManifest(...)` with a build-state loader
- [ ] Replace manifest-based artifact materialization
- [ ] Replace manifest-based export lookup
- [ ] Replace manifest-based DaVinci export lookup
- [ ] Remove manifest-specific export errors and wording
- [ ] Remove `manifestPath` / `manifestRevision` style result fields
- [ ] Remove manifest terminology from CLI output and command help where applicable

### Docs And Tests

- [ ] Rewrite manifest-era core tests
- [ ] Rewrite manifest-era viewer tests
- [ ] Rewrite manifest-era CLI integration/e2e tests
- [ ] Remove `current.json` / `manifests/` references from docs
- [ ] Remove `current.json` / `manifests/` references from readmes
- [ ] Ensure tracked bundle outputs are synchronized with new source

### Verification

- [ ] Test YAML snapshots are byte-for-byte identical to the source file used for planning
- [ ] Test `inputSnapshotHash` matches the exact snapshot bytes
- [ ] Test `runConfig` survives planned-only, dry-run, failed, and successful cases
- [ ] Test deleting manifest files does not change planner results
- [ ] Test deleting manifest files does not break execution
- [ ] Test deleting manifest files does not break viewer build inspection
- [ ] Test deleting manifest files does not break export
- [ ] Test deleting manifest files does not break DaVinci export
- [ ] Test read-only builds still show inputs/models using revision snapshots
- [ ] Test non-canonical runtime IDs still fail fast everywhere
- [ ] Run `pnpm test` from the repository root as final verification
