# Viewer Storyboard Tab Plan

Date: 2026-04-09

## Summary

This plan adds a new `Storyboard` tab to the viewer detail panel, positioned immediately to the left of `Outputs`.

The tab is a horizontally scrolling, narrative-first board that shows the story-building state of a blueprint as it progresses. It is not a second graph editor and it is not a React Flow canvas in v1. It is a structured board with:

- an initial `Shared` section on the left for reusable story prerequisites
- one column per instance of the blueprint's primary top-level narrative loop
- light connectors showing story dependencies
- existing input/output card interactions preserved where they already exist
- only story-relevant prompts, images, audio, and videos

The key architectural rule is non-negotiable:

- `core` owns the storyboard projection logic
- viewer server remains a thin transport wrapper
- viewer UI renders the returned projection and reuses existing card components

No viewer-side graph heuristics, no duplicated dependency walking, and no fallback guessing are allowed.

---

## Why This Plan Exists

The current viewer has the right raw ingredients, but not the right view model:

- the `Inputs` tab shows editable user/build inputs
- the `Outputs` tab shows generated artifacts grouped by producer
- the `Blueprint` bottom panel shows execution structure as a graph

What is missing is a user-facing answer to:

- "For this scene / story step, what do I have so far?"

The storyboard tab is that answer.

It rearranges the same underlying blueprint/build information into a story-oriented board instead of a producer-oriented panel.

---

## Non-Negotiable Engineering Constraints

  - Layered architecture, core contains the main logic, viewer and CLI are thin wrappers on services provided by that.
  - Always respect CanonicalID. All ids must be canonical internally and converted to canonical ids as soon as they are parsed from sources of input.
      - Never introduce aliases, fallbacks, guesses for canonical ids.
  - Error architecture:
      - Use numbered core error codes for all invalid combinations and invalid producer/count/dependency cases.
      - Fail fast; no silent fallback, no implicit substitution, no guessing. Errors can also be in the form of warnings if instructed explicitly in the plan.
  - Testability:
      - Core logic must be fully unit testable with a comprehensive coverage and test matrix of edge cases.
  - Fixture discipline:
      - Integration/E2E tests use package-owned fixtures only.
      - No cross-package fixture dependency.
      - No tests referencing catalog blueprints; use targeted, explicitly named local fixture blueprints.

## Confirmed Product Decisions

These decisions are already locked from discussion and should not be reopened during implementation.

### 1. Tab placement and naming

- Add a new `Storyboard` tab in the top detail panel.
- Final tab order:
  - `Inputs`
  - `Models`
  - `Storyboard`
  - `Outputs`
  - `Preview`
- Keep the label fixed as `Storyboard` for all supported blueprints in v1, even when the content is more narrative-board than literal storyboard.

### 2. Interaction model

- v1 uses a structured horizontal board, not a true infinite pan/zoom canvas.
- Do not use React Flow for the storyboard tab in v1.
- Do not support freeform dragging or persisted manual layout in v1.
- Use normal DOM layout plus a connector overlay.

### 3. Visible content rules

- Show only story-relevant:
  - text prompt/script items
  - images
  - audio
  - video
- Do not show config-only or control-only inputs such as:
  - duration
  - resolution
  - aspect ratio
  - booleans / enums / non-story scalars
  - model selections
  - schema/config-only properties
- Preserve existing interactions where they already exist:
  - input editing
  - upload
  - expand
  - artifact editing / restore / regenerate where already supported

### 4. State visibility

- If nothing has run yet, show only the story-relevant inputs and shared prerequisites.
- Do not render empty output placeholders before any story-related execution exists.
- Once story-related execution exists, keep expected story outputs visible with stateful placeholders:
  - pending
  - failed
  - skipped

### 5. Dependency depth

- Storyboard columns must include recursive story-relevant upstream dependencies, not only immediate parents.
- This includes upstream media dependencies when they are part of the story chain.

### 6. Shared vs non-shared dependencies

- Reusable prerequisites should be shown once in the initial `Shared` section.
- Cross-segment continuity should not be duplicated into later columns.
- If a segment depends on a previous segment's output, show that as a cross-column dependency.

### 7. Scope

- The storyboard tab should work for all supported primary-loop narrative blueprints, not only "storyboard image" blueprints.
- Global terminal outputs such as `Timeline` and `FinalVideo` are hidden in v1.

---

## Real Blueprint Survey and What It Means

The concept was checked against real blueprints under `/Users/keremk/videos`. The result is positive, but it widened the model beyond the original cartoon example.

### Strong direct fits

These blueprints fit the original concept very naturally:

- `/Users/keremk/videos/style-cartoon-alt/style-cartoon-alt.yaml`
- `/Users/keremk/videos/cool-ads/cool-ads.yaml`
- `/Users/keremk/videos/animated-edu-characters/animated-edu-characters.yaml`
- `/Users/keremk/videos/documentary-expert/documentary-expert.yaml`

Why they fit:

- clear reusable prerequisites
- clear per-column story assets
- prompt/media relationships are meaningful and readable in a board

### Fits that require extra support

These blueprints still fit, but require the storyboard projection to support more than `Shared + segment column`.

#### A. Previous-column carry-over

- `/Users/keremk/videos/continuous-video/continuous-video.yaml`
- `/Users/keremk/videos/historical-story/historical-story.yaml`

Requirement:

- segment 0 starts from an initial/shared image
- later segments start from the previous segment's `LastFrame`
- the storyboard must support cross-column dependency edges

#### B. Offset dependencies

- `/Users/keremk/videos/storyboard-video/storyboard-video.yaml`

Requirement:

- clip `i` depends on `panel[i]` and `panel[i+1]`
- projection must support offset-based media dependencies cleanly

#### C. Nested content inside a column

- `/Users/keremk/videos/simple-documentary/simple-documentary.yaml`

Requirement:

- one segment can own multiple images plus narration/audio
- the column renderer must support grouped nested cards, not only one flat stack

#### D. Conditional branches

- `/Users/keremk/videos/documentary/documentary-talking-head.yaml`
- `/Users/keremk/videos/documentary-expert/documentary-expert.yaml`

Requirement:

- different segments can follow different branches
- the storyboard must support conditional card families and conditional placeholders

#### E. Primary axis is not always literally "segment"

- `/Users/keremk/videos/celebrity-then-now/celebrity-then-now.yaml`

Requirement:

- the board axis is effectively `character`
- the tab must derive the primary top-level narrative loop from blueprint structure, not from the literal name `NumOfSegments`

### Resulting model adjustment

The storyboard data model must support four dependency classes:

- `shared`
- `local-upstream` within the same column
- `carry-over` from the previous column
- `nested-local` within grouped content inside a column

This is still the same product feature. It just makes the internal model match the actual blueprints.

---

## Non-Negotiable Engineering Constraints

- Layered architecture:
  - storyboard graph/projection logic lives in `core`
  - viewer server only parses request context and delegates
  - viewer UI only renders the returned projection
- Canonical IDs only:
  - all nodes/items/dependencies must be based on canonical `Input:...`, `Artifact:...`, and `Producer:...` identities
  - no alias-based lookup or UI heuristics
- Error architecture:
  - unsupported / ambiguous blueprint shapes must fail fast with descriptive core errors
  - no silent fallback to guessed story axes or guessed prompt/media relationships
- No duplicated dependency logic:
  - current viewer-local prompt/media pairing and panel grouping logic must not be re-copied into the storyboard tab
- Existing card behaviors must be reused where possible rather than rebuilt
- Global terminal artifacts remain out of scope for v1 storyboard rendering

---

## Existing Repo Facts This Plan Builds On

These are important implementation anchors already present in the repo.

- Viewer parse projection already moved into `core`:
  - `core/src/resolution/viewer-parse-projection.ts`
  - viewer parse handler already delegates to core
- Canonical graph expansion already exists in `core`:
  - `core/src/resolution/canonical-graph.ts`
  - `core/src/resolution/canonical-expander.ts`
- Producer runtime binding snapshots already exist:
  - `core/src/resolution/producer-binding-summary.ts`
- Condition evaluation already exists:
  - `core/src/condition-evaluator.ts`
- Viewer server already reads build inputs and manifests via thin wrappers:
  - `viewer/server/builds/inputs-handler.ts`
  - `viewer/server/builds/manifest-handler.ts`
- Shared viewer cards already exist and should be reused:
  - `viewer/src/components/blueprint/shared/text-card.tsx`
  - `viewer/src/components/blueprint/shared/image-card.tsx`
  - `viewer/src/components/blueprint/shared/audio-card.tsx`
  - `viewer/src/components/blueprint/shared/video-card.tsx`

These are the strongest signals that the correct solution is a new core storyboard projection, not a new viewer-local parser.

---

## Target User Experience

### Board layout

The tab renders as:

- one horizontally scrolling board
- leftmost initial section labeled `Shared`
- one column per primary story-loop instance after that

Examples:

- `Segment 1`, `Segment 2`, `Segment 3`
- `Character 1`, `Character 2`, `Character 3`
- `Clip 1`, `Clip 2`, `Clip 3`

### Column content

Each column answers:

- what story-relevant inputs feed this column
- what story-relevant media has been produced for it
- what is still pending / failed / skipped

### Connectors

Use light connectors only:

- shared item -> column item
- local upstream item -> downstream item in same column
- previous column item -> current column item for continuity

Do not render full graph-edge density.

### Visual style

- follow `viewer/docs/design-guidelines.md`
- keep the parchment / warm card language
- do not introduce a graph-tool visual language for this tab
- prioritize scanability over graph density

---

## Core Storyboard Projection Contract

Add a new core projection service and export it from `@gorenku/core`.

Suggested public API:

```ts
interface BuildStoryboardProjectionArgs {
  root: BlueprintTreeNode;
  effectiveInputs: Record<string, unknown>;
  manifestArtifacts?: Record<string, ManifestArtifactEntry>;
  latestArtifactEvents?: Map<string, StoryboardArtifactEvent>;
  resolvedArtifactValues?: Record<string, unknown>;
}

function buildStoryboardProjection(
  args: BuildStoryboardProjectionArgs
): StoryboardProjection;
```

The projection must be pure, deterministic, and fully testable without viewer code.

### Suggested result shape

```ts
interface StoryboardProjection {
  meta: {
    blueprintId: string;
    blueprintName: string;
    axisLabel: string;         // "Segment", "Character", "Clip"
    axisDimension: string;     // canonical top-level loop symbol
    axisCount: number;
    hasProducedStoryState: boolean;
  };
  sharedSection: StoryboardSection;
  columns: StoryboardColumn[];
  connectors: StoryboardConnector[];
}

interface StoryboardSection {
  id: string;                  // "shared"
  title: string;               // "Shared"
  items: StoryboardItem[];
}

interface StoryboardColumn {
  id: string;                  // e.g. "segment:0"
  title: string;               // e.g. "Segment 1"
  dimension: {
    symbol: string;
    index: number;
  };
  groups: StoryboardItemGroup[];
}

interface StoryboardItemGroup {
  id: string;
  label?: string;
  items: StoryboardItem[];
}

interface StoryboardItem {
  id: string;
  kind:
    | 'input-text'
    | 'artifact-text'
    | 'input-image'
    | 'artifact-image'
    | 'input-audio'
    | 'artifact-audio'
    | 'input-video'
    | 'artifact-video'
    | 'placeholder';
  identity: {
    canonicalInputId?: string;
    canonicalArtifactId?: string;
    canonicalProducerId?: string;
  };
  label: string;
  description?: string;
  state:
    | 'input'
    | 'succeeded'
    | 'pending'
    | 'failed'
    | 'skipped';
  dependencyClass:
    | 'shared'
    | 'local-upstream'
    | 'carry-over'
    | 'local-output';
  media?: {
    mimeType: string;
    hash?: string;
  };
  text?: {
    value: string;
    language?: 'markdown' | 'json';
  };
  actions: StoryboardActionHints;
}

interface StoryboardConnector {
  id: string;
  fromItemId: string;
  toItemId: string;
  kind: 'shared' | 'local' | 'carry-over';
}
```

`actions` is not UI behavior itself. It is a hint layer telling the viewer which existing behaviors to wire up.

---

## Effective Input and Build State Rules

The storyboard projection must not rely on the viewer's current local merge logic.

Instead, the server should resolve an explicit effective story context before calling core.

### Effective input source policy

For storyboard rendering:

1. If a build with `inputs.yaml` exists, use parsed build inputs.
2. Else if a selected build manifest has parsed input values, use those.
3. Else use the blueprint input template file.

This matches current viewer behavior semantically, but the merge policy should live in the new storyboard route/service flow rather than inside the tab component.

### Effective artifact source policy

- Use manifest artifacts plus latest artifact event state, exactly like current manifest display behavior.
- Include:
  - succeeded artifacts
  - failed artifacts
  - skipped artifacts
- Use latest event state when it supersedes manifest blob metadata.

### Effective artifact-value policy for conditions

To support conditional branches:

- resolve JSON/text artifact values for story-driving upstream artifacts when available
- use existing core condition evaluation to determine whether a conditional dependency is active
- if a condition depends on artifact values that do not yet exist:
  - before any story execution exists, do not render downstream placeholders
  - after story execution has begun, render a conditional placeholder group indicating the branch is unresolved/pending upstream story data

This avoids speculative branch guessing while still preserving state once a run is underway.

---

## Story-Relevant Item Selection Rules

This is the most important part of the plan.

Storyboard content must be selected from graph structure, not from hard-coded blueprint names.

### Include

Include an item if it satisfies both:

1. it is story-facing content:
  - image
  - video
  - audio
  - text/string content
2. it participates in the recursive upstream/downstream chain of visible story media for a board column

### Exclude

Always exclude:

- system/control inputs
- resolution / size / aspect ratio
- duration / segment duration / panel count / loop counters
- model selections and config schemas
- prompt-file templates from `Models`-style producer prompt TOML editing
- timeline/final export terminal artifacts
- non-story JSON/config structures unless decomposed fields become direct text dependencies of visible story media

### Important nuance: prompt files are not storyboard cards

The storyboard should show runtime story text that feeds media:

- input prompt arrays
- prompt/script artifacts from director-style producers
- narration/talking-head/video prompt text artifacts

It should not show producer meta prompt templates from `promptFile` TOML configs. Those remain the concern of the `Models` tab.

---

## Story Axis Derivation Rules

The board axis must be derived, not guessed from names like `NumOfSegments`.

### Deterministic rule

1. Build the canonical expanded graph from effective inputs.
2. Build the story-visible dependency subgraph.
3. Identify visible media artifact families that are farthest downstream in the story-visible graph while still being column-level artifacts, not terminal global outputs.
4. Collect their outermost top-level loop dimensions.
5. If exactly one top-level dimension remains, use it as the board axis.
6. If zero remain, the blueprint is unsupported for storyboard mode.
7. If more than one remain, throw an explicit ambiguity error in core.

This rule intentionally avoids literal name matching.

### Result

Examples:

- `style-cartoon-alt` -> `scene`
- `continuous-video` -> `segment`
- `storyboard-video` -> `clip`
- `celebrity-then-now` -> `character`

---

## Shared / Local / Carry-Over Classification Rules

Once the axis is known, classify visible items as follows.

### Shared

Place an item in `Shared` when:

- it has no axis dimension but is a story-relevant upstream dependency reused by axis columns
- or it belongs to a different top-level dimension and is reused across multiple columns without being carry-over

Examples:

- character images reused across all scenes
- product image reused across all ad clips
- single expert/talking-head character image reused across many segments
- initial image that seeds only the first segment and is global

### Local-upstream / local-output

Place an item inside the owning column when:

- it is indexed by the axis dimension
- or it is nested under the axis dimension and logically belongs to that column

Examples:

- storyboard prompt for scene 2
- narration audio for segment 3
- image 2 inside segment 1's grouped image set

### Carry-over

Mark as `carry-over` when:

- a visible item in column `i` directly depends on a visible output from column `i-1`
- the source should remain rendered only in column `i-1`
- the connection should be represented as a cross-column connector

Examples:

- `VideoProducer[segment-1].LastFrame -> VideoProducer[segment].StartImage`
- previous character output feeding the next transition sequence

Do not duplicate carry-over items into the next column.

---

## Conditional Rendering Rules

Conditional edges are common in the documentary blueprints and must be first-class.

### When condition-driving artifact values are available

- evaluate the condition using existing core condition evaluation
- if true:
  - include the conditional dependency/item normally
- if false:
  - hide the dependency/item entirely from the storyboard column

### When condition-driving artifact values are not yet available

- if no story execution has happened yet:
  - do not materialize speculative conditional output placeholders
- if story execution has already started:
  - show a compact conditional placeholder group such as:
    - `Talking head branch pending upstream script`
    - `Video narration branch pending upstream script`

This avoids showing every possible conditional branch in empty state while still making mid-run state understandable.

---

## Placeholder Rules

### Before any story execution exists

- show only story-relevant inputs and shared prerequisites
- do not show empty storyboard image / video / audio placeholders yet

### After story execution exists

For expected story outputs:

- `succeeded` -> render normal card
- `failed` -> render failed placeholder card
- `skipped` -> render skipped placeholder card
- missing but logically expected -> render pending placeholder card

Placeholder cards should use the same card family sizing so the board remains stable.

---

## Viewer Server Plan

Add a new thin route:

- `GET /viewer-api/blueprints/storyboard`

Suggested query parameters:

- `path` - blueprint path
- `folder` - blueprint folder
- `movieId` - optional selected build id
- `inputsPath` - optional template/no-build input path
- `catalog` - optional catalog root

### Server responsibilities

- resolve effective input source
- load blueprint tree
- load manifest/event-log state if `movieId` is present
- resolve condition-driving artifact values where available
- call new core storyboard projection service
- return the projection JSON unchanged except for HTTP transport concerns

### Server must not do

- no viewer-local graph walking
- no prompt/media matching regex heuristics
- no producer-oriented regrouping for storyboard
- no UI-only fallback decision-making

---

## Viewer Client and UI Plan

### Data loading

- add `fetchStoryboardProjection(...)` to `viewer/src/data/blueprint-client.ts`
- add a dedicated hook such as `useStoryboardProjection(...)`
- do not derive the projection in React from manifest + inputs + parse graph

### Detail panel integration

- extend `DetailPanel` tab union to include `storyboard`
- insert the tab between `models` and `outputs`
- keep current `Preview` synchronization behavior unchanged

### Rendering architecture

Do not create a brand new card ecosystem for the storyboard.

Instead:

1. create a panel-neutral storyboard renderer layer
2. adapt existing shared cards to render from storyboard item data
3. wire existing actions based on `actions` hints from the projection

### Suggested UI composition

- `StoryboardPanel`
- `StoryboardBoard`
- `StoryboardSharedSection`
- `StoryboardColumn`
- `StoryboardGroup`
- `StoryboardConnectorLayer`
- `StoryboardPlaceholderCard`

### Layout rules

- outer container scrolls horizontally
- columns are fixed-width or bounded-width cards/panels
- `Shared` section is first
- connectors rendered in an SVG overlay aligned to card anchor refs
- no zoom controls
- no React Flow provider

---

## Reuse Strategy for Existing Card Components

The following components should be reused directly or via thin adapters:

- `TextCard`
- `ImageCard`
- `AudioCard`
- `VideoCard`

### Adapter requirement

Create a small adapter layer that maps a `StoryboardItem` to the correct shared card plus footer/actions. This prevents `StoryboardPanel` from becoming a copy of `InputsPanel` and `OutputsPanel`.

### Input-side interactions to preserve

- text editing for editable input-backed text cards
- file upload / file replacement for editable media inputs

### Output-side interactions to preserve

- artifact expand
- artifact edit/restore/regenerate where currently supported
- prompt expand where current output cards already support it

---

## Implementation Phases

## Phase 0 - Test fixtures and contract scaffold

Deliverables:

- new core tests for storyboard projection contract
- viewer server contract tests for the new route
- viewer UI smoke tests for tab presence and horizontal board rendering

Fixture set must include representative local blueprints covering:

- shared prerequisites
- recursive prompt/media chains
- previous-column carry-over
- nested grouped items
- conditional branches
- non-`segment` primary axis

Suggested fixture coverage should mirror these real blueprints:

- `style-cartoon-alt`
- `cool-ads`
- `continuous-video`
- `simple-documentary`
- `documentary-talking-head`
- `celebrity-then-now`

## Phase 1 - Core storyboard projection service

Deliverables:

- new core module in `core/src/resolution` or a neighboring viewer-projection module
- exported storyboard projection types
- deterministic axis derivation
- visible-item selection
- shared/local/carry-over classification
- placeholder generation
- connector generation
- condition evaluation integration

Exit criteria:

- all storyboard semantics live in core and are test-covered

## Phase 2 - Viewer server thin wrapper

Deliverables:

- new storyboard handler route
- effective input resolution moved into route-level service
- build artifact state wiring
- projection JSON response

Exit criteria:

- route is a pure adapter with no duplicated graph logic

## Phase 3 - Viewer tab and renderer

Deliverables:

- `Storyboard` tab in `DetailPanel`
- horizontal board renderer
- shared card adapters
- SVG connector layer
- preserved interactions for input/output backed cards

Exit criteria:

- tab works for empty state, partial state, and produced state

## Phase 4 - Cleanup and integration hardening

Deliverables:

- remove any storyboard-specific viewer-local dependency logic introduced during development
- ensure current viewer-local utilities remain only where still needed by `Outputs`
- document unsupported blueprint shapes and explicit errors

Exit criteria:

- architecture remains layered and maintainable

---

## Test Plan

### Core unit tests

- axis derivation for:
  - style-cartoon-alt -> `scene`
  - continuous-video -> `segment`
  - celebrity-then-now -> `character`
- fail-fast ambiguity error when more than one unrelated candidate axis remains
- shared classification for reusable prerequisites
- carry-over classification for previous-segment dependencies
- recursive prompt/media chain resolution
- nested grouped column items for multi-image segment blueprints
- offset dependency handling (`panel[i]`, `panel[i+1]`)
- condition evaluation:
  - resolved true branch
  - resolved false branch
  - unresolved condition before any story run
  - unresolved condition after story run has started
- placeholder rules:
  - no placeholders in pre-run state
  - pending/failed/skipped after run has started
- exclusion rules for:
  - duration
  - resolution
  - aspect ratio
  - timeline/final video
  - promptFile TOML templates

### Viewer server tests

- route delegates to core
- route uses build inputs when `inputs.yaml` exists
- route falls back to manifest inputs when build inputs do not exist
- route falls back to template input file for no-build state
- route merges manifest and latest event state correctly
- route returns fail-fast errors for unsupported/ambiguous blueprint shapes

### Viewer UI tests

- tab order includes `Storyboard` before `Outputs`
- board scrolls horizontally
- `Shared` section renders once
- columns render correct titles for axis instances
- grouped nested items render within a column
- carry-over connector renders across columns
- existing card interactions still open/edit where supported
- pre-run state shows only inputs/shared prerequisites
- partial run state shows produced cards plus placeholders

### Manual acceptance checklist

Run manual validation on:

- `/Users/keremk/videos/style-cartoon-alt/style-cartoon-alt.yaml`
- `/Users/keremk/videos/cool-ads/cool-ads.yaml`
- `/Users/keremk/videos/continuous-video/continuous-video.yaml`
- `/Users/keremk/videos/simple-documentary/simple-documentary.yaml`
- `/Users/keremk/videos/documentary/documentary-talking-head.yaml`
- `/Users/keremk/videos/celebrity-then-now/celebrity-then-now.yaml`

For each:

- no selected build
- selected build with no produced story artifacts
- partial run
- completed run

---

## Explicit Non-Goals for v1

- no React Flow storyboard canvas
- no pan/zoom viewport
- no freeform drag/drop card layout
- no timeline/final export visualization in storyboard
- no prompt-file template editing inside storyboard
- no blueprint opt-in marker required for supported primary-loop blueprints

---

## Assumptions and Defaults

- The tab label remains `Storyboard` for all supported blueprints.
- Board axis is the unique derived primary top-level narrative loop.
- Shared prerequisites appear in a single initial `Shared` section.
- Previous-column continuity is shown via connectors, not duplicated cards.
- Global terminal outputs stay hidden in v1.
- Unsupported blueprint shapes fail explicitly in core rather than degrading to guessed behavior.
- The implementation should favor reusing existing viewer card interactions over inventing storyboard-only action systems.

