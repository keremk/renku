# Storyboard Hardening Plan

Date: 2026-04-10

## Summary

This plan hardens the new storyboard feature so it matches the intended architecture and product contract:

- storyboard is a narrow, scene/segment-oriented projection
- it shows generated media plus the specific storyboard input declared by producer metadata
- it is not a source of truth for generation
- `core` owns all dependency/provenance logic
- viewer stays a thin renderer / transport layer
- internal handling stays canonical-ID-first end to end

The current implementation is directionally correct as a product prototype, but it still contains four architectural problems:

1. visibility is driven by prompt/config naming heuristics
2. the old `Shared` concept still exists in the data model
3. the viewer re-derives prompt provenance by traversing graph/binding data itself
4. canonical ID handling is leaky in storyboard internals, especially around input updates

This plan fixes those issues by moving the feature to a metadata-driven contract based on producer input declarations such as:

- `storyboard: main`
- `storyboard: secondary`

and by making unsupported blueprint shapes fail explicitly instead of rendering best-effort projections.

---

## Product Contract After This Change

Storyboard should only render:

- scene/segment columns
- generated media cards that belong to the scene/segment story lane
- the producer-declared storyboard text input for those media cards

Storyboard should not render:

- config-ish values
- control inputs
- resolution / aspect / duration / model settings
- arbitrary prompt-like text discovered by name matching
- a `Shared` rail or any shared-only system concept

Storyboard provenance should come from core, not from viewer heuristics.

If a blueprint cannot produce the intended storyboard shape, it should fail fast with a descriptive core error instead of rendering a degraded approximation.

---

## Confirmed Inputs To This Plan

The catalog now carries storyboard metadata on producer inputs.

Examples already present:

- [catalog/producers/image/text-to-image.yaml](/Users/keremk/Projects/aitinkerbox/renku/catalog/producers/image/text-to-image.yaml)
- [catalog/producers/audio/text-to-speech.yaml](/Users/keremk/Projects/aitinkerbox/renku/catalog/producers/audio/text-to-speech.yaml)
- [catalog/producers/video/kling-multishot.yaml](/Users/keremk/Projects/aitinkerbox/renku/catalog/producers/video/kling-multishot.yaml)

Special case already identified:

- [catalog/producers/video/motion-transfer.yaml](/Users/keremk/Projects/aitinkerbox/renku/catalog/producers/video/motion-transfer.yaml)

For `motion-transfer`, no input is marked for storyboard. That means storyboard should show the generated media card with no prompt-equivalent companion card.

For `kling-multishot`:

- `Prompt` is `main`
- `MultiPrompt` is `secondary`

Meaning:

- if the `main` storyboard input is bound for a producer instance, use it
- if the `main` input is not bound, use the `secondary` one
- anything else should not be shown as storyboard prompt context

---

## Non-Negotiable Engineering Rules

- `core` owns storyboard derivation, visibility rules, and provenance rules.
- viewer server remains a thin wrapper around core services.
- viewer UI renders the returned projection and reuses existing card interactions.
- Internal identifiers must use canonical IDs only.
- The only place authored / non-canonical names are allowed is at ingress:
  - user-facing YAML
  - authored blueprint connection syntax
  - external request payloads before normalization
- After ingress normalization, no feature code should guess, strip, or reconstruct identities from aliases.
- No duplicated graph traversal / dependency resolution logic outside core.
- No silent fallback behavior that hides missing metadata or ambiguous blueprint structure.

---

## Problem Breakdown

### 1. Heuristic visibility rules

Current storyboard visibility is based on keyword matching such as `prompt`, `script`, `description`, and config exclusions such as `duration`, `resolution`, `model`.

Why this is a problem:

- it is spelling-based, not schema-based
- it will drift as producer contracts evolve
- it hides or shows fields based on naming accidents
- it is not aligned with the new `storyboard` producer metadata

### 2. Leftover `Shared` system concept

The current response type still exposes:

- `sharedSection`
- `dependencyClass: 'shared'`
- `connector.kind: 'shared'`

even though the product dropped the shared rail concept.

Why this is a problem:

- the API advertises a concept the product no longer has
- the implementation still classifies nodes as shared and then discards them
- tests currently lock in that obsolete shape

### 3. Viewer-side provenance reconstruction

The viewer currently resolves prompt artifacts for media by inspecting graph bindings and materializing upstream artifact IDs in:

- [viewer/src/lib/artifact-prompt-resolver.ts](/Users/keremk/Projects/aitinkerbox/renku/viewer/src/lib/artifact-prompt-resolver.ts)

Why this is a problem:

- it duplicates dependency/provenance logic outside core
- it creates a second graph traversal algorithm
- it violates the thin-viewer rule
- it makes storyboard behavior depend on viewer-specific reconstruction instead of the returned projection

### 4. Canonical ID leakage

The current storyboard path still accepts or reconstructs non-canonical keys internally.

Examples:

- core projection accepts canonical IDs, scoped names, and bare names when reading effective inputs
- viewer input patch logic parses canonical IDs and collapses them back to authored names

Why this is a problem:

- it weakens the canonical-ID boundary
- it risks collisions when different canonical IDs share the same terminal input name
- it reintroduces the alias ambiguity this codebase has been trying to eliminate

---

## Proposed Design

## 1. Replace heuristic prompt/config discovery with producer-declared storyboard inputs

Storyboard input selection must be based on producer input metadata, not name matching.

### New rule

For each rendered media artifact or input-media card, core should determine its storyboard text companion by following the producing node's canonical input bindings and selecting only inputs whose producer schema declares:

- `storyboard: main`
- `storyboard: secondary`

Selection order:

1. choose bound `main` input if present
2. otherwise choose bound `secondary` input if present
3. otherwise show no storyboard text companion

Implications:

- no more `STORY_TEXT_KEYWORDS`
- no more config-ish exclusion heuristics
- no more top-level text input heuristics pretending to know which fields are story-relevant

The feature becomes deterministic and schema-driven.

## 2. Remove `Shared` from the storyboard contract

The storyboard data model should no longer expose a `sharedSection` or `shared` dependency class unless the product explicitly reintroduces that concept.

Instead:

- items without the primary storyboard axis are simply out of scope for this projection
- there is no hidden "shared but not rendered" classification in the public contract

This should simplify:

- response types
- connector kinds
- dependency classes
- tests
- UI rendering

## 3. Move storyboard provenance fully into core

Core should emit enough data for the viewer to render:

- media items
- companion storyboard text items, if any
- connector relationships between the companion text and media card, if the UI still needs them

Viewer should not:

- inspect producer bindings to find prompt artifacts
- normalize artifact IDs to recover source text
- materialize selector indices
- re-run provenance resolution

The existing viewer helper should be deleted after core owns this.

## 4. Enforce canonical-ID-only internals

Storyboard internals should normalize authored input keys at the boundary, then operate canonically afterward.

Required rule change:

- ingress may accept authored keys
- internal feature code must consume and emit canonical IDs only

That means:

- projection builders should read canonicalized input maps only
- storyboard UI update paths should preserve canonical identity all the way until the YAML serialization boundary
- any conversion back to authored names should happen in one canonical serialization layer, not inside React components

---

## Implementation Plan

## Phase 1. Extend schema/types for producer storyboard metadata

Goal:

- make `storyboard` a first-class typed part of producer input definitions

Work:

- find the producer definition types and parsing pipeline that load `catalog/producers/*.yaml`
- add a typed field for producer input storyboard metadata
- constrain it to:
  - `main`
  - `secondary`
- validate that no producer defines multiple `main` inputs
- validate that no producer defines multiple `secondary` inputs
- validate that `storyboard` only appears on producer inputs, not arbitrary blueprint inputs

Deliverable:

- producer metadata is accessible from canonical graph / expanded graph structures without ad-hoc YAML access

Notes:

- if there is already a producer schema validation layer, use it rather than adding ad-hoc checks in storyboard code

## Phase 2. Replace heuristic storyboard visibility with metadata-driven selection

Goal:

- make storyboard input visibility deterministic and producer-driven

Work:

- remove the current keyword-based text selection logic from [core/src/resolution/storyboard-projection.ts](/Users/keremk/Projects/aitinkerbox/renku/core/src/resolution/storyboard-projection.ts)
- introduce a new core helper that, for each producer instance feeding a visible media item, resolves the selected storyboard companion input/artifact using producer metadata
- only include text items that are selected through this metadata path
- do not surface unrelated text inputs or artifacts just because their names look prompt-like

Important behavior:

- if a producer has no storyboard-marked input bound for the rendered media, show no companion text card
- if `main` exists in the producer schema but is not bound in this blueprint path, fall back to a bound `secondary`
- if both are bound, `main` wins
- if neither is bound, show nothing

## Phase 3. Remove `Shared` from the data model and projection

Goal:

- align the response model with the product

Work:

- remove `sharedSection` from storyboard types
- remove `shared` from item dependency classes
- remove `shared` from connector kinds
- rename or remove helpers like `shouldRenderInSharedSection`
- replace that logic with explicit "in scope for storyboard axis" checks
- update viewer rendering code to stop expecting `sharedSection`

Expected simplification:

- the storyboard response becomes just:
  - `meta`
  - `columns`
  - `connectors`

## Phase 4. Fail fast for unsupported blueprint shapes

Goal:

- storyboard should only support the intended scene/segment narrative shape

Work:

- tighten axis derivation in core
- refuse unsupported primary axes with a descriptive core runtime error
- include a message that explains why the blueprint cannot render in storyboard yet

- support only the loop variable mapped to NumOfSegments. NumOfSegments is an internal system property that is guaranteed to be present in all blueprints. `scene`, `clip` and `segment` are examples of loop variables defined by countInput: NumOfSegments in current blueprints. 

Rationale:

- this matches the stated product intent
- it prevents misleading output for blueprints like `celebrity-then-now` until the blueprint/model is redesigned

Based on this:
- unsupported storyboards should:
  - cause the tab to be hidden in the 

This plan assumes fail-fast at the projection layer unless product wants a softer UI treatment.

## Phase 5. Move storyboard provenance fully into core and delete viewer fallback logic

Goal:

- remove the second graph traversal algorithm from viewer

Work:

- make core projection emit the exact companion text/media relationships the viewer needs
- remove use of [viewer/src/lib/artifact-prompt-resolver.ts](/Users/keremk/Projects/aitinkerbox/renku/viewer/src/lib/artifact-prompt-resolver.ts) from storyboard
- delete `buildFallbackPromptArtifactByMediaId(...)` and related fallback logic from [viewer/src/components/blueprint/storyboard-panel.tsx](/Users/keremk/Projects/aitinkerbox/renku/viewer/src/components/blueprint/storyboard-panel.tsx)
- if the helper remains useful for Outputs, keep it there only if that panel still genuinely needs it

Design preference:

- the viewer should receive either:
  - prompt items plus prompt->media connectors
  - or an explicit `promptItemIds` / `companionItemIds` relationship already resolved by core

The exact shape can be chosen during implementation, but the provenance resolution must not stay in React code.

## Phase 6. Harden canonical-ID handling

Goal:

- canonicalize once at ingress, stay canonical internally

Work:

- audit storyboard input resolution paths in core and stop re-checking scoped/unscoped authored keys after normalization
- ensure `resolveNodeInputValue(...)` only reads canonicalized input maps
- remove React-side logic that collapses canonical IDs to authored names for saving storyboard input edits
- route storyboard input edits through the same canonical input save path used elsewhere, with authored-key conversion happening only in the serializer / input persistence layer

Important specific fix:

- remove the terminal-name collapse in `parseStoryboardInputAddress(...)`
- do not derive update targets via `.split('.').pop()`
- preserve the full canonical input identity until the YAML serialization boundary

## Phase 7. Keep interaction parity with Outputs using shared APIs

Goal:

- storyboard remains a projection, not a forked execution system

Work:

- verify artifact edit / restore / regenerate / pin / selection actions remain identical to Outputs
- deduplicate any storyboard-only copies of behavior where practical
- ensure storyboard cards never introduce alternate artifact identity or alternate mutation paths

Note:

- the current implementation is already reasonably aligned here, so this phase is mostly verification and small cleanup rather than redesign

---

## Test Plan

## Core tests

Add focused tests in `core` for:

- producer metadata parsing for `storyboard: main|secondary`
- invalid producer metadata combinations
- `main` selection when bound
- `secondary` fallback when `main` is unbound
- no companion text when neither `main` nor `secondary` is present
- no text shown for producers like `motion-transfer`
- no heuristic leakage from names like `Description`, `Resolution`, `Narration`, etc.
- unsupported axis failure for non-scene/non-segment blueprints
- storyboard projection shape without `sharedSection`
- canonical-only input lookup after normalization

Prefer small fixture blueprints local to `core`, not catalog blueprints.

## Viewer server tests

Add or update tests in `viewer/server` for:

- thin wrapper behavior around the new core projection shape
- no server-side re-derivation of storyboard prompt logic
- unsupported axis surfaced correctly from core errors

## Viewer UI tests

Add or update tests in `viewer` for:

- no `Shared` UI concept anywhere
- rendering of media plus core-provided companion text only
- rendering of media with no companion text for producers with no storyboard-marked input
- no React fallback provenance logic
- storyboard edit/upload/regenerate/pin actions still use the same APIs as Outputs

## Regression tests

Add a few named regression tests for exactly the architectural failures identified here:

- "does not infer storyboard text from prompt-like naming"
- "does not expose shared section"
- "does not reconstruct prompt provenance in viewer"
- "does not collapse canonical input ids to terminal authored names"

---

## Suggested File Areas

Expected core touch points:

- producer schema / parsing / validation types
- canonical producer metadata access path
- [core/src/resolution/storyboard-projection.ts](/Users/keremk/Projects/aitinkerbox/renku/core/src/resolution/storyboard-projection.ts)
- related storyboard tests

Expected viewer touch points:

- [viewer/server/blueprints/storyboard-handler.ts](/Users/keremk/Projects/aitinkerbox/renku/viewer/server/blueprints/storyboard-handler.ts)
- [viewer/src/components/blueprint/storyboard-panel.tsx](/Users/keremk/Projects/aitinkerbox/renku/viewer/src/components/blueprint/storyboard-panel.tsx)
- possibly delete or narrow [viewer/src/lib/artifact-prompt-resolver.ts](/Users/keremk/Projects/aitinkerbox/renku/viewer/src/lib/artifact-prompt-resolver.ts) usage for storyboard

---

## Recommended Order Of Work

1. land producer metadata typing + validation
2. refactor core storyboard projection to metadata-driven companion selection
3. remove `Shared` from the public contract
4. tighten axis support and fail-fast behavior
5. remove viewer fallback provenance logic
6. harden canonical-ID save/read paths
7. update tests across core/server/viewer

This order keeps the dangerous logic changes inside core first, then simplifies the viewer after core becomes authoritative.

---

## Questions Requiring Confirmation

Here are confirmed answers:

1. Unsupported blueprint behavior:
   The tab should be hidden

2. Companion text cardinality:
   The contract stay strictly "at most one selected storyboard input per producing media step" for now

3. Metadata scope:
   `storyboard: main|secondary` intended to apply only to text-like producer inputs. They are already marked in producers accordingly.

