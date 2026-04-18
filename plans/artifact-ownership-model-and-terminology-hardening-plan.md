# Artifact Ownership Model And Terminology Hardening Plan

## Summary

This plan fixes the real codebase defect for new builds: artifact ownership is currently modeled with overlapping, ambiguously named fields, and several write paths persist incomplete or misleading ownership data.

The root problem is not simply that we have both `producedBy` and `producerId`.
The real problem is that the system is currently mixing **three different concepts**:

1. the exact producer job instance that an artifact belongs to
2. the stable canonical producer node/family that the UI and graph reason about
3. whether the current blob came from a producer run or a user edit

Those are three different things and they should not be encoded into one overloaded field.

This plan does four things:

1. defines the terminology clearly
2. renames the ambiguous lineage field to make intent obvious
3. makes ownership mandatory for all new persisted artifact events
4. adds thorough unit, integration, and end-to-end coverage so this does not regress again

Old local builds with missing ownership stay out of scope for the runtime refactor. They should be repaired separately with the one-time local script.

---

## Terminology

This section is the vocabulary we should use consistently in code, tests, docs, and review comments.

### `artifactId`

The canonical persisted artifact identity.

Examples:

- `Artifact:ScriptProducer.NarrationScript[0]`
- `Artifact:ImageProducer.GeneratedImage[1][0]`

Meaning:

- This answers: "Which artifact is this?"
- This is the stable key used in event logs, build state, reruns, and artifact selection.
- This is not the producer identity.

### `producerJobId`

This is the proposed new name for the field currently called `producedBy`.

Examples:

- `Producer:ScriptProducer[0]`
- `Producer:ImageProducer[1][0]`

Meaning:

- This answers: "Which exact scheduled producer job instance owns this artifact lineage?"
- It is job-level identity, not producer-family identity.
- It is the right field for exact reruns, targeted regeneration, and any logic that must point to one concrete scheduled job.

Why the rename is needed:

- `producedBy` sounds like authorship in plain English.
- In reality, the field is used as exact execution lineage.
- That ambiguity is what keeps making user edits, overrides, and restore flows confusing.

### `producerId`

The canonical producer node or producer family identity.

Examples:

- `Producer:ScriptProducer`
- `Producer:CelebrityVideoProducer.MeetingVideoProducer`

Meaning:

- This answers: "Which stable producer node does this artifact belong to?"
- This is the right field for grouping in the Outputs panel, matching graph nodes, model/config panels, producer-level status, folder grouping, and display logic.
- This must never leak instance indices like `[0]`, `[1]`.

Why it is different from `producerJobId`:

- one producer node may have many scheduled job instances
- the UI wants the stable producer node
- rerun/regeneration logic often wants the exact job instance

### `lastRevisionBy`

This is the proposed new name for the field currently called `editedBy`.

Meaning:

- This answers: "Who authored the latest persisted artifact revision?"
- It does **not** answer which producer owns the artifact lineage.
- It is revision authorship, not producer identity.
- In the target model it is mandatory, not optional.

Allowed values:

- `'producer'`
- `'user'`

Examples:

- a normal generated artifact event writes `lastRevisionBy: 'producer'`
- a viewer edit writes `lastRevisionBy: 'user'`
- a restore-to-original event writes `lastRevisionBy: 'producer'`

Why `lastRevisionBy` is better:

- `editedBy = 'producer'` reads awkwardly
- `lastRevisionBy = 'producer'` is immediately understandable
- it makes the field about revision authorship instead of implying every change is an edit

Why `lastRevisionBy` exists separately:

- because user authorship and producer lineage are different dimensions
- an artifact can still belong to `Producer:ScriptProducer` and exact job `Producer:ScriptProducer[0]` even when the current blob was uploaded by the user
- that is exactly why revision authorship should exist as its own field instead of being encoded into `producerJobId`

### `preEditArtifactHash`

This is the proposed new name for the field currently called `originalHash`.

Meaning:

- This answers: "What artifact blob hash should we restore to after a chain of user edits?"
- More concretely: it is the artifact blob hash from immediately before user editing began.
- It is restore metadata, not ownership metadata.

### Ownership

When this plan says "artifact ownership", it means the pair:

- `producerJobId`
- `producerId`

That pair is the authoritative producer identity for an artifact lineage.

This is distinct from:

- `lastRevisionBy`
- `preEditArtifactHash`
- `diagnostics`

### Authorship vs lineage

This distinction is the single most important concept in the refactor.

Lineage:

- which producer job / producer node the artifact belongs to
- stable across user edits, restores, recovery, and preview overrides unless the artifact is actually rebound to a different producer in the graph

Authorship:

- whether the latest blob was emitted by a producer run or supplied by the user

Correct model:

- lineage is `producerJobId` + `producerId`
- revision authorship is `lastRevisionBy`

Incorrect model:

- writing fake lineage like `producedBy: 'user-override'`
- dropping `producerId` on user-edited or recovered events
- inferring the producer family later by parsing the job ID at read time

---

## Current Problems In The Codebase

### 1. The name `producedBy` is ambiguous

Today `producedBy` is used as if it means:

- "exact producer job instance" in regeneration and runner logic
- "artifact owner" in build state
- "maybe the author of the current blob" in edit/override flows

Those are not the same thing.

### 2. Some writers persist only partial ownership

New-build breakage can still happen because some artifact event writers append rows without canonical `producerId`.

Already confirmed problem paths:

- `viewer/server/builds/artifact-edit-handler.ts`
- `core/src/recovery/preplan.ts`
- thrown-error path in `core/src/runner.ts`
- planning draft / override flows in `core/src/orchestration/planning-service.ts`, `core/src/orchestration/plan-helpers.ts`, `cli/src/lib/artifacts-view.ts`, and `viewer/server/builds/preview/rerun-preview.ts`

Impact:

- build state is reconstructed from the latest artifact events
- viewer grouping uses canonical producer ownership only
- one later malformed event can wipe out producer grouping and producer-level status for that artifact

### 3. Some flows encode authorship into lineage

Example:

- generic artifact overrides currently generate pending drafts with `producedBy: 'user-override'`

Why this is wrong:

- that token is not an exact scheduled producer job
- it is not a canonical producer node either
- it is a user action encoded into the wrong field

### 4. Some flows still recover producer information by parsing IDs

Example:

- rerun preview strips indices from producer job IDs to recover a producer alias

Why this is wrong:

- canonical IDs are meant to be consumed through declared structure and authoritative mappings
- it mixes up string format with ownership semantics
- it encourages the same fallback thinking that caused the current regression

---

## Target Ownership Model

### New canonical artifact ownership contract

Every persisted artifact event for current and future builds must carry:

- `artifactId`
- `producerJobId`
- `producerId`
- `lastRevisionBy`
- `status`
- `output`
- `inputsHash`
- `createdAt`

And may additionally carry:

- `preEditArtifactHash`
- `diagnostics`

### Meaning of each field in the target state

- `artifactId`: which artifact
- `producerJobId`: exact producer job instance that owns the artifact lineage
- `producerId`: stable producer node/family that owns the artifact lineage
- `lastRevisionBy`: who authored the latest persisted artifact revision
- `preEditArtifactHash`: the artifact blob hash to restore back to after user edits

### Invariants

These must hold for all new persisted artifact events:

1. `producerJobId` must always refer to a real producer job for that artifact lineage
2. `producerId` must always be the canonical producer node/family for that same lineage
3. `lastRevisionBy` must always be present and must be either `'producer'` or `'user'`
4. user edits must not rewrite lineage
5. recovery must not rewrite lineage
6. restore must not rewrite lineage
7. no event may use placeholder lineage values such as `user-override`, `manual-edit`, or `user`
8. read paths must not reconstruct missing ownership via parsing or fallbacks

### Naming changes

The codebase should rename `producedBy` to `producerJobId` in:

- `ArtifactEvent`
- `BuildStateArtifactEntry`
- viewer artifact response types
- helper/result types that currently expose `producedBy`

Internal compatibility notes:

- for the runtime refactor, we should update code and tests together instead of creating another long-lived dual-field model
- separate one-time local migration can rewrite old event logs later
- runtime code should remain strict and not add fallback reads from legacy fields

---

## Implementation Plan

## 1. Core type hardening

Update core types so the ownership contract is explicit and difficult to misuse.

Changes:

- rename `ArtifactEvent.producedBy` -> `producerJobId`
- rename `BuildStateArtifactEntry.producedBy` -> `producerJobId`
- extend `PendingArtifactDraft` to carry both:
  - `producerJobId`
  - `producerId`
- make `ProducerJobContext.producerId` required instead of optional
- add a small shared ownership type, for example:

```ts
interface ArtifactOwnership {
  producerJobId: string;
  producerId: string;
}
```

Reason:

- today some writers can build artifact events without having enough ownership data
- if ownership is represented as an explicit shared type, code that tries to persist an artifact without both fields becomes obviously incomplete

## 2. Centralize ownership resolution

Add a single core helper for resolving artifact ownership from authoritative sources.

Two authoritative sources are allowed:

1. current producer graph / scheduled job context
2. an existing artifact event or build-state entry for the same `artifactId`

Not allowed:

- parsing job IDs to infer family IDs
- parsing artifact IDs to guess producer families
- placeholder ownership tokens

Suggested helper responsibilities:

- build an `artifactId -> ArtifactOwnership` index from a `ProducerGraph`
- resolve ownership for draft artifact overrides from the graph
- preserve ownership for edits/restores/recovery from the latest artifact event or build-state entry
- fail fast if ownership cannot be resolved explicitly

## 3. Runner hardening

`core/src/runner.ts` already has the correct shape on the success path.
That good path should become the model for all artifact event writes.

Required changes:

- success path: keep writing both `producerJobId` and `producerId`
- thrown-error failure path: also write both fields
- if `job.context.producerId` is unexpectedly absent, throw instead of writing a partial event

Reason:

- thrown producer errors currently create broken latest artifact events

## 4. Recovery hardening

`core/src/recovery/preplan.ts` must preserve ownership from the recoverable event being replaced.

Required changes:

- recovered success events copy both `producerJobId` and `producerId`
- if the source recoverable event lacks either ownership field, fail recovery for that artifact rather than writing malformed state

Reason:

- recovery is not producing a new lineage
- it is completing the existing lineage

## 5. Viewer edit / restore hardening

`viewer/server/builds/artifact-edit-handler.ts` currently manages revision authorship and restore metadata, but it also needs to preserve producer ownership.

Required changes:

- local `ArtifactEvent` interface in that file must include the renamed ownership fields
- edit events preserve `producerJobId` and `producerId` from the latest artifact event
- restore events preserve the same ownership
- restore switches `lastRevisionBy` back to `'producer'` and clears `preEditArtifactHash`, because restore returns the artifact to producer-origin state
- if latest ownership is missing, fail and surface that the historical artifact must be repaired first

Important semantic clarification:

- `lastRevisionBy: 'user'` means the current blob was user-supplied
- it does not mean the artifact stopped belonging to the original producer lineage

## 6. Planning draft hardening

Draft artifacts are where the ownership model currently gets muddled.

This section must follow the current execution-only revision model introduced by `b40d4ec70bf8a1b8a77bc4a40990ee9cd06d9d9b`.

That means:

- planning does **not** create a persisted revision
- planning computes transient draft input/artifact events in planning storage
- those transient draft events currently use `DRAFT_REVISION_ID`
- only `commitExecutionDraft(...)` allocates a real revision and persists the draft plan, input events, and artifact events

So the goal of this section is **not** to reintroduce persisted planning revisions.
The goal is to make sure the transient draft ownership model is already correct, because those same draft artifact events are later committed into the real persisted revision if execution starts.

Required changes:

- `PendingArtifactDraft` must stop using authorship placeholders as lineage
- `PendingArtifactDraft` must carry full ownership and required revision authorship even in transient planning mode:
  - `producerJobId`
  - `producerId`
  - `lastRevisionBy`
- `makeArtifactEvent(...)` in planning service must require full ownership and build a transient draft artifact event from it
- transient planning events must remain structurally identical to the later committed artifact events except for revision stamping
- `convertArtifactOverridesToDrafts(...)` must resolve ownership from the current producer graph, not emit `user-override`
- `prepareArtifactsPreflight(...)` in CLI must preserve ownership from current build-state entries
- rerun prompt override drafts must preserve ownership from the source prompt artifact event
- `commitExecutionDraft(...)` must preserve the draft ownership fields exactly when converting transient draft events into persisted revision-bound events

Important modeling rule:

- an override replaces the blob for an existing artifact
- it does not create a brand-new producer lineage
- therefore ownership stays the same and authorship changes

Important execution-boundary clarification:

- during planning, these draft artifact events exist to drive transient dirty tracking, execution-state hashing, cost/explain previews, and eventual execution commit
- during execution commit, the system should stamp the real revision onto those already-correct draft events rather than "fixing up" ownership later
- therefore ownership correctness must be enforced at draft-creation time, not deferred until persistence

## 7. Viewer build-state and artifact response alignment

Viewer-facing types should mirror the clarified ownership model.

Required changes:

- `ArtifactInfo` should expose:
  - `producerJobId`
  - `producerNodeId` or `producerId`
  - `lastRevisionBy`
- outputs grouping, execution status, and prompt/model resolution continue to rely on canonical producer node identity
- exact rerun and source-job lookups should use `producerJobId`

Reason:

- the viewer should not need to know that `producedBy` historically meant "exact producer job instance"
- the response shape should be self-explanatory

## 8. Rerun preview cleanup

`viewer/server/builds/preview/rerun-preview.ts` must stop recovering producer information by parsing indexed job IDs.

Required changes:

- use canonical producer ownership already present on the artifact event
- when an authored producer reference is needed, resolve it through authoritative producer-reference helpers in core
- do not strip index selectors from IDs by regex

Reason:

- this is exactly the kind of implicit parsing the repo rules are trying to avoid

## 9. Materialization and folder semantics

Artifact folder grouping should be family/node based, not exact-job based.

Required changes:

- artifact materialization helpers should use canonical producer node identity for folder grouping
- exact job instance identity should remain available separately for rerun/regeneration logic

Reason:

- folders are a producer-level organization concern
- `[0]`, `[1]` job-instance details should not leak into folder names or producer lists

---

## Test Plan

This change needs thorough coverage because it touches persistence contracts and several cross-package flows.

The test strategy should be split into four layers:

1. core type + event-log/build-state tests
2. writer-path unit tests
3. viewer integration-style tests
4. CLI end-to-end tests using existing fixture patterns

### A. Core unit tests

Target files:

- `core/src/build-state.test.ts`
- `core/src/event-log-state.ts` tests if added
- `core/src/orchestration/planning-service.test.ts`
- `core/src/recovery/preplan` tests
- `core/src/runner.test.ts`

Coverage to add:

1. build state mirrors both ownership fields from latest succeeded artifact events
2. latest failed/skipped events preserve ownership in history projections
3. thrown runner failures append artifact events with both `producerJobId` and `producerId`
4. recovery writes recovered success events with preserved ownership
5. transient draft artifact events cannot be constructed without full ownership and required `lastRevisionBy`
6. override drafts preserve lineage and only change authorship semantics
7. `commitExecutionDraft(...)` preserves ownership and `lastRevisionBy` when stamping a real revision onto transient draft events
8. restore-style events keep ownership and clear user-edit restore metadata only

### B. Viewer/server tests

Target files:

- `viewer/server/builds/artifact-edit-handler.test.ts`
- `viewer/server/builds/build-state-handler.test.ts`
- `viewer/src/contexts/execution-context.test.tsx`
- `viewer/src/components/blueprint/outputs-panel.test.tsx`

Coverage to add:

1. artifact edit events preserve `producerJobId` and `producerId`
2. restore events preserve ownership while switching `lastRevisionBy` back to `'producer'` and clearing `preEditArtifactHash`
3. build-state handler surfaces `producerJobId` and canonical producer node identity correctly
4. outputs panel groups by canonical producer node and never leaks indexed exact-job IDs into producer lists
5. execution context derives producer-level status from canonical producer node identity and does not rely on exact-job formatting
6. artifact responses with missing ownership fail fast where appropriate instead of silently degrading

### C. CLI integration tests

Target files:

- `cli/src/lib/artifacts-view.test.ts`
- `cli/src/lib/planner-recovery.test.ts`
- `cli/src/lib/planner.ts` related tests

Coverage to add:

1. preflight artifact edits preserve ownership from build state
2. materialized artifact folder resolution uses canonical producer identity, not placeholder lineage
3. downstream regeneration still uses exact `producerJobId`
4. recovery logic preserves exact source job lineage when resolving artifacts to jobs
5. planner persist/commit path copies transient draft ownership into the real persisted revision without mutation

### D. CLI end-to-end tests

We should add or extend E2E coverage in `cli/tests/end-to-end/`.

Use existing fixture conventions:

- use `cli/tests/test-catalog-paths.ts`
- prefer dedicated fixture blueprints under `cli/tests/fixtures/blueprints`
- prefer dedicated inputs fixtures under `cli/tests/fixtures/inputs`
- avoid introducing new test cases that depend on the mutable repo catalog unless the scenario truly requires catalog behavior
- when possible, keep blueprints local to the fixture tree and use the shared fixture helpers already used by the E2E suite

Scenarios to cover:

1. artifact override via inputs YAML
   - overridden artifact retains original ownership
   - downstream rerun selects the correct exact producer job
   - no persisted event uses placeholder lineage like `user-override`

2. viewer-style artifact edit parity from build-state/preflight path
   - edited artifact remains groupable under the same producer
   - rerun still targets the correct exact source job

3. thrown producer failure
   - failure event contains full ownership
   - later build-state and CLI planning still resolve the correct source job

4. recovery completion
   - recovered artifact keeps original ownership
   - downstream planning treats it as the same lineage and avoids unnecessary reruns

5. composite producer case
   - canonical nested producer IDs like `Producer:CelebrityVideoProducer.MeetingVideoProducer`
   - UI grouping uses the canonical producer node
   - exact rerun still resolves the correct indexed source job

6. transient-plan to real-run transition
   - dry-run planning creates only transient draft events
   - starting a real run commits those draft events under a real revision
   - ownership fields and `lastRevisionBy` remain identical across that transition except for revision stamping

### E. Core/shared fixture tests

If a focused ownership-resolution helper is added in core, add dedicated tests around:

1. resolving ownership from a `ProducerGraph`
2. preserving ownership from existing artifact events
3. nested/composite producer IDs
4. failure when ownership cannot be resolved exactly

These tests should use `core/tests/catalog-paths.ts` or local core fixtures rather than importing paths from CLI.

---

## Acceptance Criteria

The refactor is complete when all of the following are true:

1. new artifact events no longer use the ambiguous `producedBy` field in runtime code
2. new artifact events always persist both `producerJobId` and `producerId`
3. user edits, restores, overrides, and recovery preserve producer lineage
4. `lastRevisionBy` is required and is used only for revision authorship of the current blob, not ownership
5. no code path writes placeholder lineage values such as `user-override`
6. no read path reconstructs ownership by parsing canonical IDs
7. viewer producer grouping and producer-level status are stable after edits, restores, recovery, and failures
8. exact rerun / surgical regeneration still resolve the correct scheduled producer job instance
9. tests cover the happy path and the mutation paths that previously dropped ownership

---

## Non-Goals

These are intentionally not part of this runtime hardening change:

1. repairing old local builds that already persisted incomplete ownership
2. adding compatibility fallbacks for legacy artifact history
3. keeping dual runtime support for both `producedBy` and `producerJobId` indefinitely

Those should be handled separately, with the local one-time repair script for old builds.

---

## Recommended Implementation Order

1. update core types and shared ownership helpers
2. update runner and recovery writer paths
3. update planning draft / override flows
4. update viewer edit/restore and build-state response types
5. update rerun preview to stop parsing IDs
6. update CLI/materialization call sites
7. update unit tests
8. add or extend end-to-end tests

This order keeps the ownership model stable from the core outward and avoids patching UI behavior before the persisted data contract is fixed.
