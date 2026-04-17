# Execution-Only Revisions And Transient Plans Plan

## Summary

This plan changes the meaning of a revision in Renku:

1. a revision represents a real execution attempt
2. planning by itself does not create a revision
3. a persisted plan is not an authority and should not exist unless a real execution is about to start
4. dry-runs, preview dialogs, explain flows, and "what would happen?" planning stay transient by default

This is a semantic cleanup, not just a bug fix.

It addresses two recurring sources of confusion:

1. edit flows accidentally selecting inputs from the newest planned or cancelled attempt instead of the current built revision
2. build history and revision numbers being polluted by plans that never became real runs

We are explicitly choosing a clean architecture:

1. no permanent backwards-compatibility paths in production code
2. one-time migration support for the existing `~/videos` workspace if needed
3. shared core logic for "current build" and "editable snapshot source" so this does not reappear in viewer-only variations

## Explicit Decision

We are adopting these semantics:

1. `plan` is transient
2. `revision` is execution-backed
3. execution is the moment a revision becomes real
4. persisted build history must describe what actually ran, not what was merely previewed

That means:

1. opening a run dialog must not allocate a revision
2. dry-run must not allocate a revision by default
3. explaining a plan must not allocate a revision
4. a cancelled-before-start plan must not leave a persisted revision behind
5. only a real run start should allocate and persist a revision

## Why The Current Model Is Wrong

Today the planning path already allocates a revision in core:

1. [core/src/orchestration/planning-service.ts](/Users/keremk/Projects/aitinkerbox/renku/core/src/orchestration/planning-service.ts:157)

Then some call sites persist that planned revision before any real execution:

1. CLI persist path in [cli/src/lib/planner.ts](/Users/keremk/Projects/aitinkerbox/renku/cli/src/lib/planner.ts:372)
2. Viewer persist path in [viewer/server/generation/plan-handler.ts](/Users/keremk/Projects/aitinkerbox/renku/viewer/server/generation/plan-handler.ts:590)

This has several bad side effects:

1. dry-runs consume revision numbers
2. a cancelled or abandoned preview can become "the latest run"
3. edit flows are tempted to use `loadLatest(movieId)` and accidentally select abandoned inputs
4. persisted plan files look authoritative even though the user never executed them
5. build history mixes "real runs" with "uncommitted planning drafts"

In plain language: the system currently treats "I thought about doing this" too much like "I actually ran this".

## Target Semantics

After this refactor, the lifecycle should be:

1. user asks for a plan
2. planner computes a transient execution draft
3. UI/CLI displays costs, layers, explanation, warnings, and predicted work
4. if the user does not execute, nothing is persisted as a revision
5. if the user executes, the system allocates the next revision at execution start
6. the plan, input snapshot, run lifecycle event, and any pre-run persisted state are stamped with that real revision
7. build history now describes only actual execution attempts

## Core Invariants

These invariants should be true everywhere after the change:

1. every persisted revision has a corresponding real execution start
2. there is no persisted revision that only ever existed as a preview
3. "latest revision" means latest real execution attempt, not latest planned draft
4. "current build revision" is derived from event-backed runtime state, not from whichever plan was computed most recently
5. editable snapshot resolution must anchor to the current build revision when one exists
6. no handler should use `loadLatest(movieId)` to answer "what inputs should this build edit from?"

## Architectural Direction

## 1. Planning Returns A Draft, Not A Revision

The core planning service should stop committing to a revision number during planning.

Instead of returning something like:

1. `targetRevision`
2. `planPath` for a persisted run file
3. pre-baked revision-bound input events

it should return a transient planning draft that contains:

1. the computed execution plan structure
2. the resolved inputs used for computation
3. the build-state baseline it planned against
4. any warnings, explanation, producer scheduling, and surgical info
5. enough data to mint revision-bound events later when a real execution starts

The important distinction is:

1. "what should run?" belongs to planning
2. "under which revision did this run?" belongs to execution

## 2. Revision Allocation Moves To Execution Start

At the moment execution begins, the runtime should:

1. load the current persisted build state
2. compute the next revision
3. stamp the transient draft with that revision
4. materialize revision-bound inputs, snapshots, and plan file only then
5. append the first persisted run lifecycle event for that revision

This should happen in the execution entrypoints, not in the planning service.

## 3. Persisted Plans Become Execution Artifacts, Not Planning Artifacts

Persisted plan files can still exist if they are useful for debugging or post-run explainability, but their meaning changes:

1. they are a record of the plan that was actually executed
2. they are not a persisted preview cache
3. they should only be written once execution commits to a revision

If we decide later that executed plans are not worth keeping, that can be a follow-up cleanup. The important change now is that non-executed plans stop being persisted.

## 4. Run Lifecycle Should Reflect Real Execution

The run lifecycle should model real execution attempts only.

That implies:

1. `run-started` remains meaningful
2. `run-completed` remains meaningful
3. `run-cancelled` remains meaningful for a run that had become real
4. `run-planned` either disappears entirely or is reduced to an execution-commit event that happens immediately before `run-started`

Chosen direction:

Remove "planned" as a long-lived persisted state for previews and remove `run-planned` event.

That keeps persisted run state about real runs only.

## 5. Snapshot Selection Moves Into Core

The repeated edit bug is a symptom of split policy.

Today some viewer handlers already try to distinguish:

1. current displayed build revision
2. latest run revision
3. snapshot source run at or before a revision

but the logic is duplicated and inconsistent.

We should centralize two decisions in `core`:

1. what revision counts as the current displayed build for a movie?
2. what persisted input snapshot should back editing or display for that build?

The desired rule is:

1. if there is an event-backed current build revision, use the latest snapshot at or before that revision
2. only if there is no event-backed build at all may we fall back to the newest snapshot-only run
3. if neither editable `inputs.yaml` nor a valid snapshot exists, fail fast

## Scope Of The Refactor

## In Scope

1. revision semantics
2. planning vs execution boundary
3. run lifecycle semantics
4. persisted plan timing
5. editable snapshot selection
6. moving duplicated viewer policy into `core`
7. one-time migration planning for `~/videos`

## Out Of Scope

1. redesigning artifact event schemas
2. changing canonical ID rules
3. keeping legacy runtime fallback readers
4. changing provider execution logic beyond revision allocation boundaries
5. changing user-facing dry-run semantics beyond "do not persist revisions by default"

## Detailed Implementation Plan

## Phase 1: Document And Encode The New Semantics In Core Types

### Goals

Make the new model visible in the type system before moving the behavior.

### Work

1. Update `core` lifecycle and planning types in [core/src/types.ts](/Users/keremk/Projects/aitinkerbox/renku/core/src/types.ts:1).
2. Remove any wording that implies planning automatically makes a revision real.
3. Rename fields if needed so "target revision" is only used for actual execution-bound plans.
4. Introduce a transient plan draft type if the current execution plan type is too revision-bound.

### Key Decision

Prefer explicit types such as:

1. `TransientPlanDraft`
2. `CommittedExecutionPlan`
3. `ExecutionCommit`

over reusing one ambiguous structure for both preview and execution.

### Completion Signal

Someone reading the types alone should be able to see that:

1. planning can happen without a revision
2. revision allocation belongs to execution

## Phase 2: Move Revision Allocation Out Of Core Planning

### Goals

Stop `core` planning from minting revisions or writing revision-bound events.

### Current Problem Area

[core/src/orchestration/planning-service.ts](/Users/keremk/Projects/aitinkerbox/renku/core/src/orchestration/planning-service.ts:140)

This service currently:

1. computes `targetRevision`
2. appends input events using that revision
3. writes artifact drafts using that revision
4. writes a plan file immediately

### Work

1. Refactor the planning service so it computes against a baseline without committing to a new revision.
2. Stop persisting revision-bound input events during planning.
3. Stop writing the plan file during planning.
4. Return enough transient information so execution can create revision-bound persisted artifacts later.

### Important Constraint

Do not solve this by inventing fake preview revisions such as `draft-*` or `preview-*`.

That would only rename the same conceptual bug.

### Completion Signal

After this phase, asking for a plan alone does not mutate persisted revision history.

## Phase 3: Create A Core Execution-Commit Step

### Goals

Create one shared core path that turns a transient draft into a real execution-backed revision.

### Work

Add a core service/helper responsible for:

1. loading current persisted state
2. allocating the next revision
3. materializing revision-bound input events
4. writing the persisted input snapshot
5. writing the persisted plan file if we keep executed plans
6. appending the first run lifecycle event for that real revision
7. returning the committed execution plan and revision-bound execution state

### Candidate Home

Likely near:

1. [core/src/orchestration/planning-service.ts](/Users/keremk/Projects/aitinkerbox/renku/core/src/orchestration/planning-service.ts:1)
2. [core/src/run-lifecycle.ts](/Users/keremk/Projects/aitinkerbox/renku/core/src/run-lifecycle.ts:1)
3. a new orchestration helper in `core/src/orchestration/`

### Why This Matters

This step becomes the only place in the codebase allowed to say:

1. "a revision now exists"

### Completion Signal

Both CLI and viewer can call the same commit helper before real execution starts.

## Phase 4: Simplify Run Lifecycle Semantics

### Goals

Align lifecycle events with the new execution-only revision model.

### Work

1. Review [core/src/run-lifecycle.ts](/Users/keremk/Projects/aitinkerbox/renku/core/src/run-lifecycle.ts:1) and current tests.
2. Decide whether `run-planned` should:
   1. be removed entirely
   2. or remain only as an immediate execution-commit event
3. Remove any persisted "planned but never executed" state from normal runtime behavior.
4. Ensure `loadLatest`, `load`, and projection APIs now reason only over real execution revisions.

### Recommended Choice

Preferred model:

1. `run-started`
2. `run-completed`
3. `run-cancelled`


### Completion Signal

Run lifecycle history describes only real execution attempts.

## Phase 5: Refactor CLI To Use Transient Plans

### Goals

Make CLI preview flows stop persisting revisions.

### Primary Files

1. [cli/src/lib/planner.ts](/Users/keremk/Projects/aitinkerbox/renku/cli/src/lib/planner.ts:1)
2. [cli/src/commands/execute.ts](/Users/keremk/Projects/aitinkerbox/renku/cli/src/commands/execute.ts:1)
3. [cli/src/commands/generate.ts](/Users/keremk/Projects/aitinkerbox/renku/cli/src/commands/generate.ts:1)
4. [cli/src/lib/build.ts](/Users/keremk/Projects/aitinkerbox/renku/cli/src/lib/build.ts:1)

### Work

1. Change CLI planning to hold a transient draft until the user confirms execution.
2. Ensure `--explain` never persists a revision.
3. Ensure dry-run does not persist a revision by default.
4. Ensure cancellation before execution leaves no committed revision behind.
5. On real execution, use the shared core execution-commit helper to allocate the revision.

### Important UX Decision

The CLI may still show an eventual revision preview in the UI if useful, but that should be explicitly labeled as provisional and should not be persisted or used in reads.

### Completion Signal

Running CLI planning-only flows no longer creates new files under `runs/` or new lifecycle entries.

## Phase 6: Refactor Viewer To Use Transient Plans

### Goals

Make viewer plan previews stay in memory until the user actually starts a real execution.

### Primary Files

1. [viewer/server/generation/plan-handler.ts](/Users/keremk/Projects/aitinkerbox/renku/viewer/server/generation/plan-handler.ts:1)
2. [viewer/server/generation/execute-handler.ts](/Users/keremk/Projects/aitinkerbox/renku/viewer/server/generation/execute-handler.ts:1)
3. [viewer/server/generation/job-manager.ts](/Users/keremk/Projects/aitinkerbox/renku/viewer/server/generation/job-manager.ts:1)

### Work

1. Keep plan previews cached in memory only.
2. Ensure the cached plan does not represent a committed revision.
3. When the user clicks execute, call the shared core execution-commit step first.
4. Only after commit should the viewer:
   1. persist the plan if we keep executed plans
   2. write the input snapshot
   3. append run lifecycle state
   4. start execution

### Completion Signal

Opening the viewer run dialog repeatedly does not create persisted revisions or run history noise.

## Phase 7: Consolidate Displayed Revision And Snapshot Resolution In Core

### Goals

Stop the repeated "wrong snapshot" bug from reappearing in viewer-local code.

### Current Duplication

Relevant files include:

1. [viewer/server/builds/displayed-revision.ts](/Users/keremk/Projects/aitinkerbox/renku/viewer/server/builds/displayed-revision.ts:1)
2. [viewer/server/builds/build-state-handler.ts](/Users/keremk/Projects/aitinkerbox/renku/viewer/server/builds/build-state-handler.ts:175)
3. [viewer/server/builds/list-handler.ts](/Users/keremk/Projects/aitinkerbox/renku/viewer/server/builds/list-handler.ts:17)
4. [viewer/server/builds/enable-editing-handler.ts](/Users/keremk/Projects/aitinkerbox/renku/viewer/server/builds/enable-editing-handler.ts:16)
5. [viewer/server/generation/plan-handler.ts](/Users/keremk/Projects/aitinkerbox/renku/viewer/server/generation/plan-handler.ts:89)

### Work

Add shared core helpers for:

1. resolving the current displayed build revision from event-backed state
2. resolving the authoritative snapshot source for editing/display

Then migrate all viewer call sites to those helpers.

### Suggested API Shape

Prefer small focused helpers such as:

1. `resolveDisplayedBuildRevision(...)`
2. `resolveEditableSnapshotRun(...)`

instead of one giant helper that returns everything.

### Completion Signal

No viewer handler should contain its own ad-hoc "latest run vs current build" policy.

## Phase 8: Remove Persisted-Preview Assumptions From Reads And UI

### Goals

Make sure UI and reporting code no longer assume that every plan has a persisted revision.

### Work

1. Audit any "planPath", "targetRevision", or "latest run" displays in CLI and viewer.
2. Update messages to avoid implying that preview created a real revision.
3. Ensure build lists and detail panels only show real execution-backed revisions.
4. Ensure explain/debug flows can still work from transient plan data when invoked pre-execution.

### Completion Signal

User-facing wording matches the new model:

1. plans are previews
2. runs are revisions

## Migration Plan For Existing `~/videos`

## Migration Philosophy

We do not want backwards-compatibility readers in production code.

We do want a one-time idempotent migration or cleanup script for the existing `~/videos` workspace if the old persisted semantics leave behind misleading revisions.

The migration should be written after the new runtime semantics are in place, because the script should target the final model rather than today’s intermediate state.

## Migration Goals

Normalize existing persisted state so it matches the new semantics:

1. only real execution attempts remain as persisted revisions
2. abandoned preview-only revisions are removed or folded away
3. snapshot resolution is anchored to real execution-backed revisions
4. rerunning the migration causes no additional changes once a build is normalized

## Migration Inputs To Inspect

For each movie build under `~/videos`:

1. `events/inputs.log`
2. `events/artifacts.log`
3. `events/runs.log` if present
4. `runs/<revision>-plan.json`
5. `runs/<revision>-inputs.yaml`
6. any remaining old run-record artifacts if they still exist before the new refactor lands

## Migration Heuristics

The migration should classify each persisted revision as one of:

1. real execution-backed revision
2. preview-only persisted revision
3. malformed or ambiguous revision needing explicit failure

### A revision counts as real if:

1. it has a real execution lifecycle entry under the new model
2. or its event-log state clearly shows actual runtime execution for that revision

### A revision counts as preview-only if:

1. it has a persisted plan or snapshot
2. but no real execution lifecycle evidence
3. and no event-backed artifact/input state that should survive as a committed run

### Ambiguous builds should fail fast if:

1. the script cannot safely distinguish preview-only from real execution
2. required files are malformed
3. revision ordering is inconsistent

No silent guesses.

## Migration Actions

For preview-only persisted revisions, the script should remove or rewrite only the artifacts that make them appear real, such as:

1. run lifecycle entries that no longer fit the new semantics
2. plan files for unexecuted previews if we do not want them kept
3. orphaned input snapshot files tied only to preview revisions if they are no longer referenced

For real execution-backed revisions, the script should preserve:

1. execution-backed lifecycle state
2. executed plan file if still part of the final design
3. authoritative input snapshot file if it remains referenced by a real run

## Idempotency Requirements

The migration script must be idempotent.

That means:

1. running it twice yields the same filesystem and event-log state as running it once
2. it must detect already-normalized builds and skip them cleanly
3. it should emit a summary of:
   1. builds scanned
   2. builds changed
   3. revisions removed
   4. revisions preserved
   5. failures

## Script Shape

Create a new script in `scripts/`, likely separate from the current migration helper so the old and new semantics do not get mixed together.

Suggested behavior:

1. default root: `~/videos`
2. `--write` to apply changes
3. no flag means dry-run
4. deterministic output summary
5. fail-fast on ambiguous data

## Testing Plan

## Core Tests

Add tests for the semantic boundary:

1. planning does not allocate a revision
2. planning does not append persisted lifecycle state
3. planning does not write persisted plan files
4. execution allocates the revision at start
5. dry-run does not allocate a revision by default
6. cancellation before execution leaves no revision
7. execution failure after start still leaves a real failed revision

## Snapshot Resolution Tests

Add tests for:

1. successful `rev-0003`, then preview-only draft for what would have become `rev-0004` -> edit still resolves from `rev-0003`
2. successful `rev-0003`, then cancelled real execution `rev-0004` -> snapshot resolution follows the correct current build semantics
3. snapshot-only build with no event-backed revision -> fallback works only when that is the actual intended state
4. editable `inputs.yaml` beats snapshot fallback
5. missing snapshot fails fast

## CLI Tests

Add or update tests for:

1. `generate --explain` does not create run files or revisions
2. dry-run does not create run files or revisions
3. interactive cancel before execution does not create run files or revisions
4. confirmed real execution does create the revision and persisted execution artifacts

## Viewer Tests

Add or update tests for:

1. opening the plan dialog does not create persisted revision artifacts
2. cached plan execution commits the revision only when execute starts
3. build list and build detail screens ignore transient previews
4. edit fallback uses shared core snapshot selection

## Migration Tests

Add deterministic fixtures covering:

1. already-normalized build
2. build with preview-only persisted revision
3. build with multiple real revisions and one abandoned preview
4. malformed build that must fail
5. rerunning migration after a prior write does nothing

## Risks And Things To Watch

1. Some current code assumes revision-bound input events already exist before execution. That assumption must be removed cleanly.
2. Explain flows may currently rely on persisted plan files. They should be able to work from in-memory plan drafts when pre-execution.
3. Some tests currently assert on `targetRevision` or persisted `planPath` after planning. Those assertions will need to be rewritten to reflect the new semantics.
4. The migration script must be careful not to delete the only snapshot a real execution-backed build still needs.
5. Dry-run semantics need one explicit product decision: if you ever want recorded dry-runs later, that should be opt-in and clearly separate from normal execution revisions.

## Recommended Order Of Work

1. Change core types and planning/execution boundaries first
2. Update run lifecycle semantics second
3. Update CLI and viewer execution flows to use the new commit step
4. Move displayed revision and snapshot resolution into core
5. Update UI/messages/tests to match
6. Implement the one-time `~/videos` migration script last, against the final runtime semantics

## Final Completion Checklist

- [ ] Planning in `core` no longer allocates a real revision
- [ ] Planning in `core` no longer writes revision-bound persisted state
- [ ] A shared core execution-commit step exists and is the only place that allocates revisions
- [ ] CLI explain flow does not create persisted revisions or plan files
- [ ] CLI dry-run does not create persisted revisions or plan files by default
- [ ] CLI cancellation before execution does not create persisted revisions or plan files
- [ ] Viewer plan preview stays transient and in-memory until real execution begins
- [ ] Viewer execution commits the revision only at execution start
- [ ] Run lifecycle semantics describe real execution attempts only
- [ ] Persisted plan files, if kept, are written only for committed executions
- [ ] Shared core helpers exist for displayed build revision and editable snapshot resolution
- [ ] Viewer handlers use shared core snapshot/revision helpers instead of local policy
- [ ] No production runtime code keeps legacy fallback readers just for old semantics
- [ ] Existing tests are updated to match the new semantics
- [ ] New tests cover transient planning, execution-only revisions, and snapshot selection
- [ ] A one-time idempotent migration script for `~/videos` exists in `scripts/`
- [ ] The migration script has dry-run and `--write` modes
- [ ] The migration script skips already-normalized builds without changing them
- [ ] The migration script fails fast on ambiguous data instead of guessing
- [ ] `pnpm build` passes from the repo root
- [ ] `pnpm test` passes from the repo root
