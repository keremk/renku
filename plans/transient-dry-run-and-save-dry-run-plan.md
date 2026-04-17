# Transient Dry-Run And Save-Dry-Run Plan

## Summary

This plan changes dry-run semantics so they match the product intent:

1. a dry-run is transient by default
2. a dry-run does not create a real build
3. a dry-run does not appear in CLI or viewer build lists
4. a dry-run does not require later cleanup from the workspace
5. an explicit `--save-dry-run` flag can persist the dry-run output into a temp folder for inspection

This is not just a bug fix for `rev-draft`.

It is a cleanup of the boundary between:

1. validation and preview
2. real execution
3. optional debug inspection

The central idea is simple:

1. `--dry-run` means "simulate and report"
2. `--dry-run --save-dry-run` means "simulate and also save the simulated output in temp storage"
3. neither mode should write into the project workspace under `builds/`

## Product Decision

We are explicitly choosing these semantics:

1. dry-runs are not builds
2. dry-runs do not allocate or persist a workspace revision
3. dry-runs do not update workspace event logs
4. dry-runs do not create viewer-visible build folders
5. saving a dry-run is an explicit debugging action, not a normal part of execution

That means:

1. `renku generate --dry-run` stays fully transient
2. `renku generate --dry-run --save-dry-run` writes to an isolated temp directory only
3. the temp save is for inspection and debugging, not for normal build history
4. the viewer and CLI build lists show only real workspace builds

## Why The Current Model Is Wrong

The current behavior mixes two different concepts:

1. "what would happen if I ran this?"
2. "what actually exists as a build in this workspace?"

Today the CLI dry-run path in
[cli/src/commands/execute.ts](/Users/keremk/Projects/aitinkerbox/renku/cli/src/commands/execute.ts:422)
does real local materialization after running validation in memory.

That causes three problems:

1. dry-runs leak into persistent workspace state
2. dry-runs can create inconsistent revision/build-state combinations such as `rev-draft`
3. the user sees dry-run leftovers in `list`, viewer build lists, and cleanup flows even when they never wanted to keep them

In plain language:

1. a temporary simulation currently behaves too much like a real build
2. a debugging convenience became normal product behavior
3. the product now needs cleanup for things the user did not think they saved

## Target Semantics

After this change, the lifecycle should be:

1. plan is computed
2. dry-run executes in memory or transient storage only
3. summary, warnings, and validation results are returned to the caller
4. if the user did not ask to save the dry-run, no workspace state is written
5. if the user asked to save the dry-run, an inspectable copy is written under a temp directory
6. the temp copy is clearly reported as a debug artifact, not a project build
7. real workspace build history continues to describe only actual executions

## Core Invariants

These invariants should be true everywhere after the change:

1. no workspace `builds/<movieId>` folder is created by plain `--dry-run`
2. no workspace `events/runs.log`, `events/artifacts.log`, or `events/inputs.log` is updated by plain `--dry-run`
3. no workspace build list entry appears because of plain `--dry-run`
4. `--save-dry-run` writes outside the project workspace
5. saved dry-run output is clearly discoverable by the CLI response
6. saved dry-run output does not affect `resolveCurrentBuildContext(...)` for the project workspace
7. viewer execute error handling never masks the original persist failure with a secondary lifecycle error

## Scope

## In Scope

1. CLI dry-run execution semantics
2. optional temp persistence for inspection
3. CLI output contract for reporting saved temp dry-runs
4. CLI list and clean semantics
5. viewer build-list filtering for non-real builds
6. viewer execute error-path hardening
7. one-time cleanup guidance for leftover legacy preview-only workspace builds

## Out Of Scope

1. redesigning real execution revisions
2. changing canonical input or artifact ID rules
3. changing provider simulation semantics
4. changing the structure of real persisted build folders
5. introducing a long-lived user-managed cache for dry-runs

## Explicit CLI Contract

## `--dry-run`

Behavior:

1. generate the plan
2. execute simulated providers
3. perform condition validation and dry-run coverage logic
4. return summary and validation output
5. optionally write a transient temp plan file for immediate inspection if still useful for UX

Must not:

1. initialize movie storage in the project workspace
2. persist run lifecycle in the project workspace
3. copy blobs into the project workspace
4. create a listable build folder in the project workspace

## `--dry-run --save-dry-run`

Behavior:

1. do the same simulated dry-run execution
2. persist an inspectable copy into a temp directory created with `mkdtemp(...)`
3. print the saved temp path clearly
4. keep the temp layout close enough to a normal local build layout to make debugging easy

Must not:

1. write anything under the project workspace `builds/`
2. write anything under the project workspace `artifacts/`
3. change viewer or CLI build listings

## Temp Save Shape

The saved temp directory should be easy to inspect manually.

Prefer a layout like:

1. `<tmp>/renku-dry-run-<id>/metadata.json`
2. `<tmp>/renku-dry-run-<id>/events/`
3. `<tmp>/renku-dry-run-<id>/runs/`
4. `<tmp>/renku-dry-run-<id>/blobs/`
5. `<tmp>/renku-dry-run-<id>/inputs.yaml`
6. `<tmp>/renku-dry-run-<id>/summary.json`

The saved temp artifact should be treated as a debug snapshot, not a build.

That means the CLI should report something like:

1. this was a dry-run
2. nothing was written to the workspace
3. debug copy saved at `<tmp path>`

## Revision Semantics For Saved Dry-Runs

Saved dry-runs should not use the draft revision in persisted files.

Even though the temp snapshot is outside the real workspace, it is still better
to persist it in a normal execution-shaped layout because:

1. existing readers and debugging tools already understand that shape
2. the saved data is easier to inspect without one-off draft-only logic
3. it avoids spreading `rev-draft` persistence deeper into the system

So the rule is:

1. workspace dry-runs persist nothing
2. temp-saved dry-runs may use a normal persisted revision shape inside their isolated temp root

This temp revision is local to the temp save and must not affect the project workspace.

## Detailed Implementation Plan

## Phase 1: Make Plain Dry-Runs Fully Transient In CLI

### Goal

Remove workspace writes from the default dry-run path.

### Work

1. Update [cli/src/commands/execute.ts](/Users/keremk/Projects/aitinkerbox/renku/cli/src/commands/execute.ts:422) so `executeDryRunWithValidation(...)` no longer does the final local workspace materialization.
2. Keep validation passes in memory only.
3. Return the dry-run summary from the in-memory execution result.
4. Keep or simplify the transient plan file behavior depending on whether tests and UX still need it.
5. Ensure the returned result shape makes it obvious this is not a committed build.

### Exit Criteria

1. running `renku generate --dry-run` leaves no new project build folder behind
2. no workspace run lifecycle events are written
3. no workspace artifact events are written

## Phase 2: Add Explicit `--save-dry-run` Support

### Goal

Preserve the inspection/debugging use case without touching the workspace.

### Work

1. Add a new CLI flag `--save-dry-run`.
2. Require it to be used only with `--dry-run`.
3. Create a temp root with `mkdtemp(...)`.
4. Persist a debug snapshot there using a local storage context rooted at the temp folder.
5. Include summary metadata that tells the user what was saved and where.
6. Print the temp path clearly in the CLI response.

### Design Note

The temp save should happen after the transient dry-run result exists, so the normal `--dry-run` flow remains the default architecture and `--save-dry-run` is only an optional extra write step.

### Exit Criteria

1. `--dry-run --save-dry-run` writes a full inspectable snapshot outside the workspace
2. the CLI output tells the user where it was saved
3. the workspace still remains untouched

## Phase 3: Remove Dry-Run Build Semantics From CLI List/Clean

### Goal

Stop teaching the CLI that no-artifact build folders are normal dry-runs.

### Work

1. Update [cli/src/commands/list.ts](/Users/keremk/Projects/aitinkerbox/renku/cli/src/commands/list.ts:1) to list real builds only.
2. Remove wording like `(dry-run, no artifacts)` from the normal list output.
3. Update [cli/src/commands/clean.ts](/Users/keremk/Projects/aitinkerbox/renku/cli/src/commands/clean.ts:1) so it no longer markets itself as dry-run cleanup.
4. Reframe `clean` around actual cleanup policies that still make sense after dry-runs become transient.
5. Update CLI help text in [cli/src/cli.tsx](/Users/keremk/Projects/aitinkerbox/renku/cli/src/cli.tsx:74) so it no longer describes persisted dry-run cleanup as a normal workflow.

### Exit Criteria

1. the CLI no longer encourages users to clean persisted dry-runs
2. normal list output no longer exposes dry-runs as builds

## Phase 4: Tighten Viewer Build Listing To Show Real Builds Only

### Goal

Make the viewer consistent with the new product semantics and hide preview-only leftovers.

### Work

1. Update [viewer/server/builds/list-handler.ts](/Users/keremk/Projects/aitinkerbox/renku/viewer/server/builds/list-handler.ts:1).
2. Replace the current permissive rule:
   - show the folder if it has any displayable artifacts or any saved inputs
3. With a stricter rule:
   - show the folder only if it has real execution-backed state
4. Treat snapshot-only or inputs-only folders without execution-backed lifecycle/build-state as non-builds.
5. Confirm that the viewer still displays real in-progress or real completed builds correctly.

### Important Note

This is not a backwards-compatibility fallback.

It is a product-level filtering decision:

1. preview-only leftovers are not real builds
2. they should not be listed as if they were

### Exit Criteria

1. viewer build lists stop showing preview-only leftovers
2. real builds remain visible

## Phase 5: Harden Viewer Execute Error Handling

### Goal

Fix the independent bug where persist failures can be masked by later lifecycle writes.

### Work

1. Update [viewer/server/generation/execute-handler.ts](/Users/keremk/Projects/aitinkerbox/renku/viewer/server/generation/execute-handler.ts:229).
2. Track whether the execution was successfully committed before attempting failure completion bookkeeping.
3. In the catch path, append `run-completed` only if a real committed revision exists.
4. Preserve the original persist/storage error as the primary failure.

### Exit Criteria

1. commit/persist failures surface the real error
2. no catch-path lifecycle write attempts to complete a draft revision

## Phase 6: Cleanup Existing Preview-Only Leftovers

### Goal

Normalize the existing local workspace so the product behavior matches the new rules.

### Current Known Preview-Only Leftovers

From `~/videos`, these paths currently look like legacy planned-only preview folders:

1. `~/videos/storyboard-video/builds/movie-a3b38a57`
2. `~/videos/storyboard-video/builds/movie-577f004d`
3. `~/videos/historical-story/builds/movie-5698c41f`

They have:

1. legacy `runs/<revision>-run.json`
2. `status: "planned"`
3. empty `events/runs.log`
4. no artifact event history

### Work

1. Decide whether to delete these preview-only leftovers with a targeted cleanup script or ignore them after the list filter hides them.
2. If we clean them, use explicit criteria and fail fast on ambiguous cases.
3. Keep this cleanup separate from the production runtime change.

### Exit Criteria

1. preview-only leftovers are either removed or at least fully hidden from normal product surfaces

## Testing Plan

## CLI Tests

Add or update tests to prove:

1. `--dry-run` creates no workspace build directory
2. `--dry-run` writes no workspace `events/runs.log`
3. `--dry-run` writes no workspace `events/artifacts.log`
4. `--dry-run --save-dry-run` writes to a temp directory
5. `--dry-run --save-dry-run` does not write to the workspace
6. `--save-dry-run` without `--dry-run` fails with a clear error
7. CLI output includes the saved temp path when the flag is used
8. list output no longer labels no-artifact folders as dry-runs

## Viewer Tests

Add or update tests to prove:

1. build list handler excludes preview-only or snapshot-only leftovers
2. real builds still appear in the list
3. execute-handler persist failures preserve the original error
4. execute-handler does not append failure completion for a non-committed draft revision

## Workspace Verification

At the end, verify:

1. a new dry-run does not create a new workspace folder under the current blueprint
2. a saved dry-run appears only in temp storage
3. viewer build lists are stable before and after dry-runs
4. CLI `list` is stable before and after dry-runs

## Risks And Tradeoffs

## Risk 1: Some tests may currently assume dry-runs create build folders

That is expected.

Those tests should be rewritten because the product semantics are changing on purpose.

## Risk 2: Some viewer flows may currently refresh build-state after dry-run execution

That refresh should remain harmless if the workspace is unchanged.

The viewer should treat dry-run execution as a transient execution session, not as a guaranteed source of new persisted build-state.

## Risk 3: Temp persistence may accidentally become another semi-permanent storage mode

Avoid this by keeping the rules explicit:

1. temp save is debug-only
2. temp save is outside the workspace
3. temp save is reported as a file path, not a build

## Completion Checklist

- [ ] Plain `--dry-run` no longer writes any workspace build state
- [ ] Plain `--dry-run` no longer creates listable build folders
- [ ] `--save-dry-run` exists and is accepted only together with `--dry-run`
- [ ] `--save-dry-run` writes an inspectable temp snapshot outside the workspace
- [ ] CLI output clearly reports the temp save path
- [ ] CLI `list` no longer treats no-artifact folders as dry-run builds
- [ ] CLI `clean` no longer documents dry-run cleanup as a standard workflow
- [ ] Viewer build list hides preview-only leftovers
- [ ] Viewer execute failure path no longer masks persist errors
- [ ] Regression tests cover plain dry-run, saved dry-run, list filtering, and execute failure behavior
- [ ] `pnpm build` passes from the repository root
- [ ] `pnpm test` passes from the repository root

## Suggested Implementation Order

1. Make plain CLI dry-run fully transient.
2. Add `--save-dry-run`.
3. Update CLI output/help text.
4. Update CLI list and clean behavior.
5. Tighten viewer build-list filtering.
6. Fix viewer execute error handling.
7. Add regression tests.
8. Run full repository verification.

