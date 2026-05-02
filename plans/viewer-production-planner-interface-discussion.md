# Viewer Production Planner Interface Discussion

Date: 2026-04-29

## Purpose

This document captures the current product/interface discussion around improving the Renku viewer for larger video-generation blueprints.

This is **not yet a full implementation plan**. It is a discussion snapshot so the work can be picked up in a later thread without losing the reasoning, product constraints, mockup direction, or open questions.

Related documents:

- `plans/viewer-storyboard-tab-plan.md`
- `plans/storyboard-hardening-metadata-driven-plan.md`
- `plans/clip-scoped-generation-core-plan.md`

Mockup generated during the discussion:

- `/Users/keremk/.codex/generated_images/019dd9c7-a05c-7db2-be72-02dd54a3e633/ig_0200f12452a094a70169f22449d4f48191bb177a58234d8bb5.png`

## Starting Problem

The current viewer works reasonably for small blueprints, but breaks down for large asset-generation workflows such as:

- `catalog/blueprints/historical-documentary-assets-seedance/historical-documentary-assets-seedance.yaml`

The current UI exposes the system mostly through:

- execution layers
- producer graph
- producer-oriented outputs
- build list sidebar
- a horizontally scrolling storyboard tab

That is useful for debugging the execution model, but it is not the mental model of a person producing a video.

The user mental model is closer to:

1. Decide the story/hook/progression/characters.
2. Review the narration script.
3. Use the script and timing to identify required b-roll/assets.
4. Choose where to spend money:
   - stills are cheaper
   - video clips are expensive
   - reference video can be especially expensive
5. Add music/atmosphere as needed.
6. Assemble everything in a tool such as HyperFrames.
7. Add subtitles, upsample, and do final finishing.

The viewer currently does not help users:

- see the production plan clearly
- understand what will be generated per clip
- see conditional decisions such as map/video/reference/talking-head choices
- generate progressively
- avoid expensive accidental full-blueprint runs
- inspect and approve work clip by clip
- understand the whole progression across many clips

## Terminology Update

During the discussion, we decided to move away from “segment” as the product term.

The new generation unit is:

> **clip**

Terminology migration is covered more concretely in:

- `plans/clip-scoped-generation-core-plan.md`

Important mappings:

| Old | New |
| --- | --- |
| segment | clip |
| Segment | Clip |
| NumOfSegments | NumOfClips |
| SegmentDuration | ClipDuration |
| segment generation | clip-scoped generation |

The interface discussion below uses **clip** except when describing existing code or existing files that still use segment terminology today.

## Core Product Insight

Layers are an execution model.

Producers are an implementation model.

Neither is the right primary interface for a user making a movie.

The primary interface should answer:

- What is the story?
- What are the clips?
- What does each clip need?
- Which decisions has the planner made?
- What will be cheap vs expensive?
- What has been generated?
- What has been approved?
- What should I generate next?

The graph should remain available, but as a technical/debug view, not the main production cockpit.

## Conditionals Are Hidden Production Decisions

A major issue is that conditionals are almost invisible to the user.

In the historical documentary Seedance blueprint, planner outputs drive conditionals such as:

- whether a clip has a map
- whether a still uses historical reference
- whether motion is enabled
- whether motion uses text, reference, start/end, or multi-shot workflow
- whether native audio is used
- whether a historical character reference is used
- whether an expert talking-head clip is used

These conditionals are currently buried inside:

- producer outputs
- skipped/running producer state
- graph edges
- low-level condition metadata

But they are not technical trivia. They are the actual production plan.

Examples of what the user needs to see:

- Clip 7 uses reference video.
- Clip 7 is expensive because reference video is selected.
- Clip 3 uses stills only.
- Clip 4 needs a map.
- Clip 9 has Expert 1 talking head enabled.
- Clip 11 is using a cheaper Ken Burns path.

The UI should not present this primarily as:

> Producer X skipped because condition Y evaluated false.

It should present it as:

> Motion: Reference Video  
> Cost: High  
> Map: Off  
> Expert: Expert 1 enabled

## Why The Current Storyboard Tab Is Not Enough

The current storyboard tab was directionally useful, but the discussion identified several limitations.

### 1. It does not expose conditional decisions clearly

It can show generated media and placeholders, but does not make the planner's decisions visible enough.

For example:

- Is this clip planned as Ken Burns?
- Is it going to use expensive reference video?
- Why is a producer skipped?
- Which optional branches are active?

Those questions are not answered directly.

### 2. It does not scale to long-form work

A horizontal board with one column per clip is not viable for large documentaries.

For a 20-minute documentary, we may have 100+ clips. A giant horizontal scroll becomes impossible to navigate.

The user needs to:

- see the progression across clips
- jump to a clip quickly
- inspect details for one clip at a time
- compare status/cost across many clips

This suggests a virtualized list or timeline/editor layout, not a wide board.

### 3. Users should not generate all clips at once

For expensive blueprints, full generation can waste a lot of money.

Desired workflow:

1. Generate the grand scenario/story/script.
2. Inspect the plan.
3. Generate clip 1 or clips 1-3.
4. Review.
5. Adjust.
6. Continue progressively.

The UI must support progressive clip-scoped generation.

### 4. It should not be blueprint-specific

The first mockup used documentary-specific controls such as:

- map
- reference video
- expert talking head

That is appropriate for the example, but the product cannot hardcode those fields.

For a cartoon episode, the equivalent decisions might be:

- scene type
- character voices
- background style
- animation mode
- camera motion
- sound effects

The interface must be generic while still allowing each blueprint to expose highly relevant production decisions.

## Proposed Interface Direction

The working product concept is:

> **Production Planner**

or, for first-party clip-based movie workflows:

> **Clip Planner**

This should become the primary surface for large movie-generation blueprints.

It should be a master/detail production workspace:

1. A compact production workflow rail.
2. A scalable clip overview/progression surface.
3. A vertical clip list.
4. A selected clip detail panel.
5. Scoped generation controls.
6. A de-emphasized technical graph/debug surface.

## Proposed Layout

### App Header

Keep the existing viewer shell feel:

- dark neutral background
- amber primary accent
- compact 11px uppercase section labels
- soft borders
- dense operational layout

Header should show:

- Renku/app identity
- blueprint name
- selected build/version
- primary generation action
- settings/theme controls

### Left Rail: Production Workflow, Not Builds First

The current Builds sidebar is not the right primary left panel for this workflow.

Builds matter, but they are not the user’s main task.

Proposed left rail:

- `PRODUCTION`
  - Story
  - Script
  - Clip Plan
  - Cheap Visuals
  - Motion
  - Assembly
  - Finish
- status/progress counts per stage
- small status dots
- selected version/build compactly below

Build selection could become:

- a dropdown in the header
- a compact `VERSION` card in the rail
- a modal/dialog for create/rename/delete

The user should feel they are managing a production workflow, not mostly switching build folders.

### Top Overview: Clip Progression Strip

For long-form work, a compact progression strip is useful.

It should show many clips as small markers:

- gray: not generated
- blue: generated/in progress
- green: approved
- amber: needs review
- red: failed
- amber outline or cost marker: expensive path selected

The selected clip is highlighted.

This provides “visual progression across clips” without making every clip a giant horizontal card.

### Main Clip List

The center-left area should be a vertical, virtualized list.

Each row should show:

- clip number
- title/beat/summary
- duration
- decision chips
- cost indicator
- generation status
- review/approval state

Example chips for the documentary blueprint:

- Narration
- 2 Stills
- Map
- No Motion
- Ken Burns
- Reference Video
- Expert 1
- High Cost
- Needs Review

For a cartoon blueprint, the same component could render:

- Voices
- Background
- Character Animation
- Camera Move
- SFX
- High Cost

The row model should not know these fields by name. They should come from metadata/projection.

### Selected Clip Detail Panel

The detail panel should show one clip at a time.

Suggested generic sections:

1. **Clip Header**
   - clip number
   - title
   - duration
   - estimated cost
   - status
   - approval state

2. **Plan**
   - story beat / summary
   - narration/script excerpt
   - structured plan fields

3. **Decisions**
   - condition-backed decision fields
   - rendered as toggles, badges, segmented controls, or compact cards
   - examples:
     - Motion: Reference Video
     - Map: Off
     - Expert: Expert 1
     - Visual Style: 2D Cartoon

4. **Assets**
   - generated/missing/failed media for this clip
   - audio
   - images
   - video
   - text/script artifacts
   - edit/regenerate/pin controls where already supported

5. **Run Scope**
   - what will happen if the user clicks generate
   - number of jobs
   - estimated cost
   - upstream dependencies included
   - out-of-scope work excluded

### Bottom Technical Panel

The graph should remain, but be de-emphasized.

Possible bottom tabs:

- Execution
- Timeline
- Technical Graph

Renaming `Blueprint` to `Technical Graph` or `Execution Graph` would make it clear this is not the main creative model.

## Mockup Direction

A mockup image was generated for this idea.

Path:

- `/Users/keremk/.codex/generated_images/019dd9c7-a05c-7db2-be72-02dd54a3e633/ig_0200f12452a094a70169f22449d4f48191bb177a58234d8bb5.png`

The mockup showed:

- dark-theme Renku Viewer styling
- a `PRODUCTION` workflow rail
- a `SEGMENT PLANNER` main view, which should now be renamed to `CLIP PLANNER` or `PRODUCTION PLANNER`
- compact progression strip
- vertical clip list
- selected clip detail
- visible plan decisions
- cost-aware generation controls
- de-emphasized technical graph

The user liked the general direction but raised two important corrections:

1. Clip-scoped generation must be grounded in how blueprint generation actually works.
2. The detail view must become generic, not hardcoded to one documentary blueprint.

## Core Dependency: Clip-Scoped Generation

The interface depends on a core planning capability:

> Plan and execute only the required jobs for selected clips, including upstream dependencies, while excluding unrelated clip cardinalities.

This is covered in detail in:

- `plans/clip-scoped-generation-core-plan.md`

Key requirements:

- `--clip=7` means only clip 7 plus required upstream dependencies.
- `--through-clip=7` means clips 1-7 plus required upstream dependencies.
- Later clip cardinalities should not be generated just because the blueprint expanded them.
- Required planner/condition artifacts must be included or planning must fail clearly.
- Selection must use structured `ProducerJobContext.indices`, not canonical ID parsing.

This is a prerequisite for the production interface to become more than a visualization.

## Generic Model: Production Axis

The interface should not be hardcoded to documentaries.

The generic concept is:

> A blueprint can expose a primary production axis.

For video workflows this will usually be:

- clip

But the core/viewer model should allow other explicit axes if needed:

- scene
- shot
- variant
- character
- chapter

First-party movie blueprints should standardize on `clip`.

The interface can then render:

- Clip Planner for `clip`
- Scene Planner for `scene`
- Variant Planner for `variant`

But the generic internal concept is:

- production axis item

## Generic Model: Decision Surface

The viewer should not infer decision fields from names like `HasMap` or `MotionPlan`.

Instead, blueprints should eventually declare which planner output fields are production decisions.

Possible future metadata shape:

```yaml
ui:
  production:
    primaryAxis:
      dimension: clip
      label: Clip
      titleSource:
        artifact: PlanDirector.AssetPlan
        path: Clips[clip].Title
      summarySource:
        artifact: PlanDirector.AssetPlan
        path: Clips[clip].Summary

    decisions:
      - id: motionMode
        label: Motion
        dimension: clip
        source:
          artifact: PlanDirector.AssetPlan
          path: Clips[clip].MotionPlan.Workflow
        affects:
          - producer: SeedanceVideoGenerator
        costTier:
          Reference: high
          Text: medium
          StartEnd: high
          Off: none

      - id: map
        label: Map
        dimension: clip
        source:
          artifact: PlanDirector.AssetPlan
          path: Clips[clip].HasMap
        affects:
          - producer: MapImageProducer
```

For a cartoon episode, the same model could be:

```yaml
ui:
  production:
    primaryAxis:
      dimension: clip
      label: Clip
      titleSource:
        artifact: EpisodeDirector.EpisodePlan
        path: Clips[clip].Title

    decisions:
      - id: animationMode
        label: Animation
        dimension: clip
        source:
          artifact: EpisodeDirector.EpisodePlan
          path: Clips[clip].AnimationMode
        affects:
          - producer: ClipAnimator

      - id: voiceCast
        label: Voices
        dimension: clip
        source:
          artifact: EpisodeDirector.EpisodePlan
          path: Clips[clip].VoicePerformances
        affects:
          - producer: VoiceProducer
```

This keeps the UI generic while letting each blueprint provide domain-relevant language.

## Generic Model: Production Projection

A future core projection could return a read-only production view.

This is distinct from the current storyboard projection.

Possible response shape:

```ts
interface ProductionProjection {
  meta: {
    blueprintId: string;
    blueprintName: string;
    axis: {
      dimension: string;
      label: string;
      count: number;
    };
  };

  items: ProductionAxisItem[];
}

interface ProductionAxisItem {
  index: number;
  label: string;
  title?: string;
  summary?: string;
  duration?: number;
  decisions: ProductionDecision[];
  assets: ProductionAsset[];
  jobs: ProductionJobSummary[];
  cost?: ProductionCostSummary;
  state: ProductionItemState;
}

interface ProductionDecision {
  id: string;
  label: string;
  value: unknown;
  displayValue: string;
  state?: 'active' | 'inactive' | 'warning';
  costTier?: 'none' | 'low' | 'medium' | 'high';
  affectedProducerIds: string[];
}
```

Important rules:

- Core owns the projection.
- Viewer renders the projection.
- Viewer should not duplicate dependency/condition traversal.
- No naming heuristics.
- If production metadata is missing, either:
  - render a generic technical projection, or
  - show a clear “production metadata missing” state.

## Relationship To Current Viewer Components

### `StoryboardPanel`

The current `StoryboardPanel` may remain useful for media-oriented review, but it should not be the primary long-form production planner.

Possible future:

- Production Planner becomes the primary tab.
- Storyboard becomes either:
  - a mode inside selected clip detail, or
  - a media-lane view for generated assets.

### `OutputsPanel`

The current Outputs tab groups by producer.

For production workflows, the user usually needs asset grouping by:

- clip
- asset kind
- decision/stage
- review state

Producer grouping is still useful for debugging and folder access, but should not be the main view.

### `PlanDialog`

The plan dialog currently summarizes by producer/layer.

It should eventually summarize by:

- selected clip scope
- required upstream dependencies
- jobs by stage/asset kind
- estimated cost
- expensive decisions
- out-of-scope work excluded

Example:

> Scope: Clip 7  
> Included: PlanDirector, Clip 7 narration, Clip 7 stills, Clip 7 reference video  
> Excluded: Clips 8-100  
> Estimated cost: $3.12

### `BuildsListSidebar`

The Builds sidebar should likely be demoted.

Possible replacements:

- compact version selector
- production workflow rail
- stage checklist

The user should not feel the primary left rail is just a build folder manager.

### `BlueprintViewer`

The blueprint graph should become a technical/debug surface.

Possible labels:

- Technical Graph
- Execution Graph
- Blueprint Graph

The graph remains valuable for:

- debugging dependencies
- understanding why something did/did not run
- inspecting producer topology

But it should not be the default mental model for production.

## Interface Principles Captured So Far

1. The main UI should be production-oriented, not graph-oriented.
2. Clip decisions must be visible before generation.
3. Expensive paths must be obvious before execution.
4. Clip-scoped generation should be previewed before execution.
5. Large workflows require vertical/virtualized navigation, not giant horizontal boards.
6. The UI must be generic across blueprint scenarios.
7. Blueprint-specific relevance should come from explicit metadata, not name guessing.
8. Core should own projections and dependency/condition reasoning.
9. Viewer should render returned structures and reuse existing media/edit controls.
10. Technical graph and producer outputs should remain available, but not primary.

## Design System Notes

The mockup and future UI should follow `viewer/docs/design-guidelines.md`.

Relevant design constraints:

- dark theme uses neutral gray surfaces
- amber/golden primary accent
- dense operational layout
- compact uppercase section headers:
  - `text-[11px] uppercase tracking-[0.12em] font-semibold`
- major panels use 14px radius
- borders are soft, commonly `border-border/40`
- cards are elevated through lighter gray surfaces and subtle shadows
- no decorative gradient/orb backgrounds
- status badges use low-opacity emerald/blue/amber/red/slate
- avoid oversized marketing/landing-page composition

The interface should feel like a serious production workstation.

## Open Questions

### 1. What is the exact first UI surface?

Options:

- Add a new `Production` or `Clips` tab.
- Replace `Storyboard` with `Clips`.
- Make `Production Planner` the default top panel after a build is selected.

Current leaning:

- add `Clips` or `Production` as the main tab
- keep graph/debug surfaces available but secondary

### 2. Should the first production view require new blueprint metadata?

Options:

- require explicit `ui.production` metadata
- provide a generic fallback based on loop dimensions and media artifacts
- support only first-party migrated clip blueprints initially

Current leaning:

- first pass can support first-party migrated clip blueprints
- avoid heuristics
- fail clearly when metadata is missing or insufficient

### 3. What should decision overrides edit?

If the user changes “Reference Video” to “Ken Burns,” where does that live?

Options:

- edit the planner output artifact
- store explicit user override metadata
- regenerate the plan with additional constraints

Current leaning:

- do not silently mutate downstream artifacts
- overrides should be durable and explicit
- plan preview should show the effect before execution

This is not solved yet.

### 4. How should approval state work?

The current system has generated artifacts, pins, edits, and regeneration selection.

A production UI likely needs explicit states such as:

- planned
- generated
- needs review
- approved
- rejected

Question:

- should approval be artifact-level, clip-level, or both?

### 5. How should partial assembly work?

If the user has generated clips 1-7, should the assembly/timeline producer run for a partial film?

Current leaning:

- no by default
- partial assembly should be explicit
- final assembly should not accidentally run when clip-scoping early work

### 6. How does cost estimation map to decisions?

Producer/model costs already exist, but decision-level cost attribution needs careful design.

Questions:

- Can a decision declare affected producers?
- Should the plan projection compute cost per clip?
- How should placeholder/range estimates display?

### 7. What happens with global reusable assets?

Some assets are shared across clips:

- character references
- expert portraits
- style frames
- music themes

The Production Planner needs to show them without duplicating them into every clip.

Possible solution:

- global/shared production stage in the left rail
- reusable asset section in selected clip detail when relevant
- dependency badges showing “requires character reference set”

## Candidate Implementation Sequence

This is preliminary and should be revisited after clip-scoped generation lands.

### Phase A: Core Clip-Scoped Generation

Implement:

- `--clip`
- `--through-clip`
- core clip scope
- upstream dependency closure
- plan preview support

Covered by:

- `plans/clip-scoped-generation-core-plan.md`

### Phase B: Read-Only Production Projection

Add a core projection that groups:

- jobs
- artifacts
- condition/activation states
- costs

by production axis item.

Do not add overrides yet.

### Phase C: Basic Clip Planner UI

Add a read-only clip planner:

- progression strip
- vertical clip list
- selected clip detail
- visible decisions
- generated/missing assets
- scoped plan preview button

### Phase D: Scoped Generate From UI

Wire selected clip generation to the new core scope.

First actions:

- Generate this clip
- Generate through this clip

Avoid asset-kind filtering initially unless core classification exists.

### Phase E: Blueprint Metadata For Decision Surface

Add `ui.production` metadata:

- primary axis
- title/summary/script sources
- decisions
- affected producers
- cost tier hints

### Phase F: Overrides and Approval

Design and implement:

- user decision overrides
- clip approval state
- artifact/clip review workflow

This requires a separate plan.

## Important Warnings

Do not implement the production UI by:

- parsing canonical IDs
- guessing from producer names
- matching fields like `HasMap` by name
- hardcoding documentary-specific controls
- duplicating core graph traversal in viewer
- silently falling back when metadata is missing
- adding defaults just to make the UI “work”

Those would recreate the same brittleness the system is trying to avoid.

## Summary

The direction is:

> Move the viewer from an execution/producers mental model to a production/clips mental model.

The production UI should make hidden planner decisions visible, especially conditional and cost-driving decisions. It should scale to long-form work by using a clip progression strip, virtualized vertical clip list, and selected clip detail panel rather than a huge horizontal storyboard.

The UI must be generic. Documentary-specific relevance should come from explicit blueprint metadata and core projections, not hardcoded field names.

The immediate prerequisite is core clip-scoped generation, so the interface can safely preview and execute “this clip” or “through this clip” without generating unrelated later clip cardinalities.

