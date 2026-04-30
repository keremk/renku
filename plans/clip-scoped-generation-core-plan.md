# Clip-Scoped Generation Core Plan

## Goal

Add first-class core support for planning and executing only the work needed for one or more **clips**, while still including the required upstream dependencies that make those clips valid.

This is meant to replace the current user-facing “segment” concept with the movie-industry term **clip**:

- `segment` becomes `clip`
- `NumOfSegments` becomes `NumOfClips`
- `SegmentDuration` becomes `ClipDuration`
- user-facing “segment generation” becomes **clip-scoped generation**

The core behavior we want is:

> Generate clip 7, or plan through clip 7, without generating unrelated later clips, while still running any upstream producers needed to know what clip 7 should generate.

This must be implemented through structured graph metadata and explicit planning controls. Do **not** parse canonical IDs to infer clip numbers. Canonical IDs remain opaque identifiers.

## Current State

The current core has several useful pieces already:

- Expanded producer jobs carry structured loop indices in `ProducerJobContext.indices`.
- Conditions are resolved and evaluated through structured condition metadata.
- The planner already supports:
  - dirty detection
  - conditionally inactive jobs
  - pinning
  - surgical artifact regeneration
  - producer family caps
  - `upToLayer`
- Producer graph edges already represent artifact dependencies between jobs.

Important files:

- `core/src/orchestration/planning-service.ts`
- `core/src/planning/planner.ts`
- `core/src/orchestration/planning-controls.ts`
- `core/src/orchestration/producer-overrides.ts`
- `core/src/resolution/producer-graph.ts`
- `core/src/resolution/canonical-blueprint.ts`
- `core/src/types.ts`

The current limitation is that user controls are mostly layer-shaped or producer-family-shaped:

- `upToLayer` answers “how far through the execution DAG?”
- producer directives answer “how many first-dimension jobs for this producer family?”
- surgical regeneration answers “regenerate this artifact and downstream dependents”

None of those directly answer:

> Generate only clip 7 and the upstream work required to make clip 7 meaningful.

## Terminology Migration

### Required Naming Changes

Use **clip** consistently for the generation unit.

Core/catalog/viewer terminology should migrate as follows:

| Old | New |
| --- | --- |
| segment | clip |
| Segment | Clip |
| segments | clips |
| Segments | Clips |
| NumOfSegments | NumOfClips |
| SegmentDuration | ClipDuration |
| SegmentNarrationAudio | ClipNarrationAudio |
| SegmentStillImages | ClipStillImages |
| SegmentReferenceStillImages | ClipReferenceStillImages |
| SegmentMapImages | ClipMapImages |
| SegmentMotionVideos | ClipMotionVideos |
| SegmentExpertTalkingHeadAudio | ClipExpertTalkingHeadAudio |
| SegmentExpertTalkingHeadVideos | ClipExpertTalkingHeadVideos |

This should be a deliberate migration, not a compatibility fallback.

If we need temporary compatibility for existing checked-in fixtures during the migration, it should be isolated to migration tests or explicit fixture conversion helpers, not runtime fallback behavior.

### Validation Expectations

After migration:

- New blueprints should declare a `clip` loop for clip-based workflows.
- New blueprints should use `NumOfClips`.
- If a blueprint uses `ClipDuration`, it must declare required `Duration` and `NumOfClips` inputs.
- `SegmentDuration` should be removed from production blueprint validation paths.
- Any remaining `segment` naming should be either:
  - a legacy test fixture explicitly marked as legacy, or
  - unrelated prose/history in old plan files.

## New Core Concept: Clip Scope

Add a new scope control under `PlanningUserControls`.

Proposed type:

```ts
export type ClipScopeMode = 'through' | 'only';

export interface PlanningClipScopeControls {
  /**
   * Loop dimension used as the clip axis.
   * Defaults should not be guessed. The initial implementation should require
   * this to be explicitly provided by the caller or resolved from blueprint UI
   * metadata in a later viewer layer.
   */
  dimension: string; // usually "clip"

  /**
   * Zero-based clip indices selected by the user.
   *
   * mode: "only" means exactly these clips.
   * mode: "through" means every clip with index <= max(indices).
   */
  indices: number[];

  /**
   * "only": plan selected clips only.
   * "through": plan clips from 0 through max(indices).
   */
  mode: ClipScopeMode;

  /**
   * Include upstream jobs required to satisfy selected clip jobs.
   * For the first core implementation this should be required true.
   */
  includeUpstream: true;

  /**
   * Optional future extension. Do not implement filtering by asset kind in the
   * first core pass unless the producer/artifact classification is explicit.
   */
  assetKinds?: string[];
}

export interface PlanningScopeControls {
  upToLayer?: number;
  producerDirectives?: ProducerDirective[];
  clip?: PlanningClipScopeControls;
}
```

Rules:

- `clip.dimension` is a structured loop dimension name, not a canonical ID fragment.
- Clip indices are zero-based internally.
- The UI can display one-based labels: “Clip 1”, “Clip 2”, etc.
- For the first implementation, reject `assetKinds` unless there is an explicit, schema-backed classification. Do not infer from producer names.
- If both `clip` and `upToLayer` are supplied, both filters apply. The plan must fail clearly if the combined scope excludes required upstream condition artifacts.

## Planning Semantics

### Mode: `through`

This mode answers:

> Plan up to clip N.

For `dimension = "clip"` and `indices = [6]`, include clip indices `0..6`.

This is useful for progressive long-form generation:

- plan the grand scenario
- generate clips 1-3
- inspect
- then extend through clip 4
- continue incrementally

Expected behavior:

- jobs with no clip index are eligible as upstream/global jobs
- jobs with `context.indices.clip <= 6` are eligible
- jobs with `context.indices.clip > 6` are out of scope
- out-of-scope jobs must not be generated just because their cardinality exists

### Mode: `only`

This mode answers:

> Generate clip N only.

For `dimension = "clip"` and `indices = [6]`, include clip index `6` only, plus required upstream jobs.

Expected behavior:

- clip-local jobs for clip 6 are eligible
- global upstream jobs are included only when needed by selected clip jobs
- unrelated clip jobs are out of scope
- downstream final assembly jobs should not be included unless they are explicitly selected and scoped correctly

## Scope Algorithm

Add a clip-scope resolver that operates on `ProducerGraph` and `ProducerGraphNode.context.indices`.

Suggested file:

- `core/src/orchestration/clip-scope.ts`

Suggested exported functions:

```ts
export interface ClipScopeResolution {
  selectedJobIds: Set<string>;
  upstreamJobIds: Set<string>;
  scopedJobIds: Set<string>;
  blockedJobIds: Set<string>;
  warnings: PlanningWarning[];
}

export function resolveClipScope(args: {
  producerGraph: ProducerGraph;
  scope: PlanningClipScopeControls;
}): ClipScopeResolution;
```

### Step 1: Validate Scope

Fail fast if:

- `dimension` is empty
- `indices` is empty
- any index is not a non-negative integer
- `mode` is not `only` or `through`
- `includeUpstream` is not `true`

Do not silently default to `clip`.

### Step 2: Classify Jobs

For each producer graph node:

- if `node.context?.indices` contains the scope dimension:
  - read the structured index value
  - mark the job as clip-indexed
- otherwise:
  - mark the job as global/non-clip-indexed

Never inspect `jobId` strings to discover indices.

### Step 3: Select Target Clip Jobs

For `mode = "through"`:

- selected clip indices are `0..max(scope.indices)`

For `mode = "only"`:

- selected clip indices are exactly `scope.indices`

Select jobs whose structured index is in that set.

### Step 4: Add Required Upstream Closure

Build a reverse adjacency map from `producerGraph.edges`.

For every selected clip job:

- walk upstream dependency edges
- add upstream jobs to `upstreamJobIds`
- continue until graph roots

This handles planner/story/casting producers that do not have a clip index but are required to generate clip-local jobs.

Important nuance:

- upstream closure must include jobs required to produce condition artifacts
- condition artifact validation in `planner.ts` should remain the final safety check
- if a required condition artifact producer is not in scope, fail fast with the existing numbered Renku error path rather than guessing

### Step 5: Build `scopedJobIds`

`scopedJobIds = selectedJobIds ∪ upstreamJobIds`

Then:

`blockedJobIds = all producer graph jobs - scopedJobIds`

These blocked jobs should be passed into the planner in the same general category as producer-directive-blocked jobs, but the implementation should preserve provenance so warnings and plan explanation can say:

- blocked by clip scope
- blocked by producer directive
- blocked by layer scope

## Integration With Existing Planning Controls

Update `resolvePlanningControls` in `core/src/orchestration/planning-controls.ts`.

Current output includes:

- `effectiveUpToLayer`
- `blockedProducerJobIds`
- `cappedProducerJobIds`
- `forcedJobIds`
- `pinnedArtifactIds`
- `producerSummaries`
- `warnings`
- `normalizedOverrides`
- `artifactRegenerations`

Add:

```ts
clipScope?: {
  dimension: string;
  mode: ClipScopeMode;
  selectedIndices: number[];
  selectedJobIds: string[];
  upstreamJobIds: string[];
  blockedJobIds: string[];
}
```

And merge blocking:

```ts
blockedProducerJobIds =
  producerDirectiveBlockedJobIds ∪ clipScopeBlockedJobIds
```

The planner should continue receiving a single `blockedProducerJobIds` list initially, but the explanation should eventually expose why each job was blocked.

### Interaction With Producer Directives

Producer directives and clip scope should compose.

Examples:

- clip scope says clip 7 is in scope
- producer directive disables video producer
- result: clip 7 video jobs are blocked

If a producer directive blocks a required upstream dependency for selected clip jobs, existing dependency validation should fail clearly.

Do not re-add producer-disabled jobs just because clip scope selected them.

### Interaction With Pins

Pins should still work.

If a selected clip job only produces pinned reusable artifacts, it can be removed from the final plan.

The plan explanation should still make it clear that the clip was in scope, but the job was skipped because reusable pinned output already exists.

### Interaction With Surgical Regeneration

Keep surgical regeneration and clip scope compatible, but do not overcomplicate the first pass.

Initial rule:

- If `surgical.regenerateIds` is present and clip scope is present, the regenerated target must be inside the clip scope or required upstream closure.
- If not, fail with a clear planning conflict.

Later extension:

- Allow surgical regeneration to seed selected jobs, then intersect with clip scope.

## Planner Changes

Update `core/src/planning/planner.ts`.

The current flow is:

1. determine dirty jobs
2. propagate dirty jobs
3. add force target jobs
4. apply producer override jobs
5. remove conditionally inactive jobs
6. prune unrunnable jobs if producer overrides exist
7. remove pinned jobs
8. build layers
9. validate condition artifacts

With clip scope, the intended behavior is:

1. determine dirty jobs
2. propagate dirty jobs
3. add force target jobs
4. apply blocked jobs from producer directives and clip scope
5. remove conditionally inactive jobs
6. prune unrunnable jobs when any blocking controls exist
7. remove pinned jobs
8. build layers
9. validate condition artifacts

Important change:

`pruneUnrunnableJobsWithMissingArtifactInputs` currently only runs when `blockedProducerJobIds` length is greater than zero. That remains fine if clip scope contributes to `blockedProducerJobIds`.

But tests must prove that:

- unrelated later clip jobs are removed
- downstream jobs that require removed later clip outputs are also pruned
- selected clip jobs remain if their required upstream artifacts are included or reusable

## Plan Explanation Changes

Update `core/src/planning/explanation.ts` and related tests.

Add reason types:

```ts
type JobDirtyReason =
  | ...
  | { reason: 'includedByClipScope'; clipDimension: string; clipIndex: number }
  | { reason: 'includedAsClipUpstream'; clipDimension: string; targetClipIndices: number[] };
```

Also add blocked/skipped explanation metadata for out-of-scope jobs if the explanation model supports it. If not, keep it in `ResolvedPlanningControls` first and expose it through plan-display later.

## CLI/API Control Shape

### Core Type

The source of truth is `PlanningUserControls.scope.clip`.

### CLI Flags

Add CLI flags after core is implemented:

```bash
renku generate --clip=7
renku generate --through-clip=7
renku generate --clip=7,9,12
```

Rules:

- CLI display is one-based for humans.
- Convert to zero-based before sending to core.
- `--clip=7` maps to `mode: "only", indices: [6]`.
- `--through-clip=7` maps to `mode: "through", indices: [6]`.
- Do not allow `--clip` and `--through-clip` together.

Use `--clip-dimension` only if we need to support non-`clip` dimensions before blueprint UI metadata exists:

```bash
renku generate --clip-dimension=clip --clip=7
```

If no dimension can be resolved explicitly, fail and ask for it.

### Viewer API

Extend the viewer plan request body:

```ts
planningControls: {
  scope: {
    clip: {
      dimension: 'clip',
      mode: 'only',
      indices: [6],
      includeUpstream: true
    }
  }
}
```

The viewer should initially use this only for plan preview, then execution once tests are stable.

## Clip Terminology Migration Details

### Core Derived Inputs

Find and update derived input logic currently based on `Duration` + `NumOfSegments`.

Expected new behavior:

- `Duration / NumOfClips` produces `Input:ClipDuration`
- `ClipDuration` is system-derived
- validation requires `Duration` and `NumOfClips` when `ClipDuration` is referenced

Remove `SegmentDuration` from production paths.

### Blueprint Validation

Update validation tests and rules:

- old: blueprints using `SegmentDuration` must declare required `NumOfSegments`
- new: blueprints using `ClipDuration` must declare required `NumOfClips`

Add a validation error for mixed terminology:

- a blueprint should not use both `NumOfSegments` and `NumOfClips`
- a blueprint should not use both `SegmentDuration` and `ClipDuration`

This should be a numbered Renku error if the validation layer supports one.

### Catalog Migration

Update catalog blueprints:

- `historical-documentary-assets-seedance`
- `documentary-talkinghead`
- `ken-burns-documentary`
- `ken-burns-documentary-v2`
- `animated-edu-characters`
- `grid-based-storyboard`
- `boilerplate`

Expected edits:

- loop names: `segment` -> `clip`
- count inputs: `NumOfSegments` -> `NumOfClips`
- generated outputs and connection references: `Segments[...]` -> `Clips[...]` where those schemas are authored by us
- root outputs: `Segment*` -> `Clip*`
- prompt text: replace user-facing segment wording with clip wording
- input templates: rename keys and model config references

Be careful:

- Do not parse or transform canonical IDs at runtime.
- This is a source migration. Update authored YAML/JSON/TOML explicitly.
- Prompt wording may still mention “scene” where creative meaning is scene-specific. The generation unit should be “clip”.

### Viewer Terminology

After core/catalog migration:

- `StoryboardPanel` can remain as a component name temporarily, but user-facing labels should say clip where appropriate.
- Replace user-facing “Segment” with “Clip”.
- Replace `NumOfSegments` display names with `NumOfClips`.
- Future UI should expose “Clip Planner” or “Production Planner”.

## Testing Plan

### Unit Tests: Clip Scope Resolver

Create `core/src/orchestration/clip-scope.test.ts`.

Test cases:

1. `through` mode includes jobs with clip index up to N.
2. `only` mode includes exactly selected clip-local jobs.
3. upstream closure includes global planner jobs.
4. no canonical ID parsing: job IDs with misleading strings do not affect selection.
5. missing/invalid scope values throw clear errors.
6. nested dimensions work:
   - job indices `{ clip: 2, image: 1 }` belongs to clip 2.
7. non-clip jobs are not included unless upstream of selected clip jobs.

### Planner Integration Tests

Add tests near `core/src/orchestration/planning-controls.test.ts` and `core/src/planning/planner.test.ts`.

Test cases:

1. fresh build, `clip only 1`:
   - schedules upstream plan producer
   - schedules clip 1 jobs
   - does not schedule clip 0 or clip 2 jobs unless required upstream

2. fresh build, `through clip 1`:
   - schedules clips 0 and 1
   - excludes clip 2+

3. condition artifact required:
   - selected clip job depends on planner output condition
   - planner output producer is included as upstream
   - condition evaluates correctly

4. missing required upstream due to producer directive:
   - clip scope selects clip job
   - producer directive disables required upstream producer
   - planning fails or prunes with explicit missing artifact diagnostics

5. pins:
   - selected clip output already exists and is pinned
   - job is removed from final plan
   - no unrelated clips scheduled

6. surgical conflict:
   - regenerate artifact from clip 3 while scope is clip 1
   - fail with explicit conflict

### Terminology Tests

Update existing tests that assert:

- `NumOfSegments`
- `SegmentDuration`
- `Segments`
- user-facing “segment” labels

Add tests that assert:

- `NumOfClips`
- `ClipDuration`
- `Clips`
- user-facing “clip” labels

### Catalog Validation

Run blueprint validation across migrated catalog entries.

Important final verification after implementation:

```bash
pnpm build
pnpm test
```

Package-level focused tests are useful during development, but the final verification should use the repository root commands.

## Implementation Phases

### Phase 1: Core Scope Types

- Add `PlanningClipScopeControls`.
- Add `ClipScopeMode`.
- Extend `PlanningScopeControls`.
- Add serialization/display support where plan requests cross CLI/viewer boundaries.

No behavior change yet.

### Phase 2: Clip Scope Resolver

- Add `core/src/orchestration/clip-scope.ts`.
- Implement validation, job classification, selected job resolution, and upstream closure.
- Add focused unit tests.

### Phase 3: Planning Control Integration

- Call `resolveClipScope` from `resolvePlanningControls`.
- Merge clip-blocked jobs into `blockedProducerJobIds`.
- Preserve clip-scope metadata in `ResolvedPlanningControls`.
- Add tests for interaction with producer directives and pins.

### Phase 4: Planner Explanation and Diagnostics

- Extend plan explanations for clip-scoped inclusion.
- Add clear warnings/errors for out-of-scope controls.
- Ensure missing condition artifacts still fail fast and explain what was excluded.

### Phase 5: CLI and Viewer Plan Preview

- Add CLI flags:
  - `--clip`
  - `--through-clip`
  - optionally `--clip-dimension`
- Add viewer plan request support.
- Do not build the full new UI yet; first expose this as an executable planning primitive.

### Phase 6: Terminology Migration

- Migrate core derived input naming:
  - `NumOfSegments` -> `NumOfClips`
  - `SegmentDuration` -> `ClipDuration`
- Migrate validation.
- Migrate catalog blueprints.
- Migrate tests.
- Migrate user-facing viewer/CLI text.

This phase will touch many files. Keep it mechanical and avoid behavior changes beyond the terminology rename.

### Phase 7: End-to-End Clip Workflow Tests

Add at least one representative migrated blueprint fixture that proves:

- `--through-clip=2` generates only clips 1-2 plus upstream dependencies.
- `--clip=4` generates only clip 4 plus upstream dependencies.
- later clip cardinalities are ignored.
- conditions still determine whether map/motion/talking-head-style optional branches are active.

## Open Design Questions

1. Should `clip.dimension` always be exactly `clip`, or should core allow any dimension while the product standardizes on `clip`?

   Recommendation: core should allow any explicit dimension, but first-party blueprints should use `clip`.

2. Should `through` mode include non-clip final assembly jobs?

   Recommendation: no by default. Final assembly should require either an explicit assembly stage/scope or a full run, because assembling a partial movie can be useful but should be intentional.

3. Should clip scope be applied before or after dirty propagation?

   Recommendation: compute dirty as today, then apply clip blocking before pruning. This preserves existing dirty logic while allowing scope to remove unrelated work.

4. Should clip-local downstream jobs outside the selected asset category be supported now?

   Recommendation: not in the first pass. Add clip scope first; asset/stage filtering should come later with explicit producer/artifact classification metadata.

## Non-Goals For This Plan

- Full Production Planner UI.
- Blueprint-specific decision surfaces.
- Generic stage/asset-kind filtering.
- Automatic detection of clip axes from names.
- Runtime compatibility fallbacks for `segment` terminology.

Those are valuable follow-ups, but the first core milestone should be:

> Can the planner safely preview and execute clip-only or through-clip generation while including necessary upstream dependencies and excluding unrelated later clip cardinalities?

