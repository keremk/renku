# General-Purpose Composite Producers Plan

Updated: 2026-04-12

## Summary

Add **composite producers** as a first-class, broadly reusable blueprint authoring pattern.

The goal is to let authors define a producer-like unit in YAML that internally orchestrates multiple producers, but exposes a clean input/output contract to the parent blueprint. This must work for:

- local blueprint modules imported by relative `path`
- catalog-hosted composite modules imported by a qualified catalog reference
- single-output composites
- multi-output composites
- composites whose internal artifacts are only intermediate implementation details

This feature should be implemented as a **general blueprint composition capability**, not as a one-off solution for `celebrity-then-now`, and not as a provider-code-only orchestration feature.

## Why We Need This

Several real scenarios want the same abstraction:

- `celebrity-then-now`: one segment may internally require multiple generation steps, but the parent blueprint should see one clean segment artifact.
- Kling `audio -> VoiceID -> video`: authors should be able to express prerequisite multi-step flows in YAML instead of requiring a dedicated hard-coded provider implementation for each case.
- Future multi-step generation flows: preprocessing, extraction, prompt generation, stitching, conditioning, or validation steps should be composable without expanding graph syntax or adding one-off engine logic.

The current system is close, but incomplete:

- local child blueprints already exist and are flattened into the graph
- catalog imports currently distinguish only:
  - `path`: local relative import
  - `producer`: catalog leaf producer under `catalog/producers`
- there is no first-class catalog import path for a blueprint module under `catalog/blueprints`
- imported blueprints are not treated as an explicit public/private boundary yet

## Goals

1. Make composite producers a normal YAML authoring pattern.
2. Keep `NumOfSegments` as the canonical public segment count for segment-based blueprints.
3. Preserve strict canonical IDs internally end-to-end.
4. Preserve fail-fast behavior: no silent defaults, no alias/runtime fallbacks, no heuristic lookups.
5. Use the existing numbered Renku error system only.
6. Keep the user-facing syntax simple and readable.

## Non-Goals

- Do not add graph-expression syntax like parity, `floor(segment / 2)`, or inline mapping expressions.
- Do not introduce fallback behavior that guesses missing imports, missing bindings, or missing canonical IDs.
- Do not special-case `celebrity-then-now` in core graph semantics.
- Do not make provider code the primary orchestration mechanism for authorable multi-step flows.

## User-Facing Design

### 1. Composite producers remain plain blueprints

Do **not** add `kind: composite`.

A composite producer is simply a blueprint that is imported through the parent blueprint’s `producers:` section and has its own internal `inputs`, `artifacts`, `producers`, and `connections`.

This keeps the model simple:

- leaf producer module: imported producer with no internal `producers:`
- composite producer module: imported blueprint with internal `producers:`

Both are authored in YAML and both are consumed from the parent through the same `producers:` section.

### 2. Extend producer imports to support catalog blueprints

Keep `path` and `producer`, and add a third mutually exclusive import source:

```yaml
producers:
  - name: SegmentUnit
    path: ./segment-unit/segment-unit.yaml

  - name: ImageGenerator
    producer: image/text-to-image

  - name: KlingVoiceVideo
    blueprint: video/kling-voice-conditioned
```

Rules:

- exactly one of `path`, `producer`, or `blueprint` must be provided
- `path` resolves relative to the importing blueprint file
- `producer` resolves under `catalog/producers`
- `blueprint` resolves under `catalog/blueprints`

This is the cleanest way to make catalog composites first-class without overloading the existing `producer` meaning.

### 3. Parent blueprints consume only the composite’s public contract

The parent blueprint may connect only to the imported blueprint’s top-level:

- declared `inputs`
- declared `artifacts`
- declared condition outputs that are already exposed via top-level artifacts

The parent must **not** be allowed to wire directly into the composite’s internal child producers or internal private artifacts.

This gives the feature real encapsulation:

- internal graph structure can evolve safely
- composite modules have a stable external contract
- authors reason about the composite as one reusable unit

### 4. Internal producer overrides remain supported

Existing producer-scoped model/config inputs should continue to work for nested producers when explicitly targeted by the user, because this is already part of the config surface.

However:

- that override path is a configuration capability, not a graph-wiring capability
- internal producers remain private from `connections:`
- any such producer-scoped IDs must still be canonicalized immediately after ingress

## YAML Shape

### Parent blueprint

```yaml
inputs:
  - name: NumOfSegments
    type: int
    required: true

artifacts:
  - name: SegmentVideos
    type: array
    itemType: video
    countInput: NumOfSegments

loops:
  - name: segment
    countInput: NumOfSegments

producers:
  - name: SegmentUnit
    blueprint: video/segment-unit
    loop: segment

connections:
  - from: SomePromptPlan.Segments[segment].Prompt
    to: SegmentUnit[segment].Prompt
  - from: SegmentUnit[segment].FinalVideo
    to: SegmentVideos[segment]
```

### Composite blueprint module

```yaml
meta:
  id: SegmentUnit
  kind: blueprint

inputs:
  - name: Prompt
    type: string
  - name: SourceImage
    type: image

artifacts:
  - name: FinalVideo
    type: video

producers:
  - name: PrepImage
    producer: image/image-edit
  - name: MainVideo
    producer: video/image-to-video

connections:
  - from: SourceImage
    to: PrepImage.SourceImage
  - from: PrepImage.EditedImage
    to: MainVideo.StartImage
  - from: Prompt
    to: MainVideo.Prompt
  - from: MainVideo.GeneratedVideo
    to: FinalVideo
```

This is the core authoring experience to optimize for.

## Engine Changes

### 1. Import parsing and resolution

Update `ProducerImportDefinition` and parser/loading logic so a producer import can resolve one of:

- `path`
- `producer`
- `blueprint`

Required behavior:

- reject entries that specify more than one import source
- reject entries that specify none
- fail fast when `blueprint:` is used without a catalog root
- fail fast when the referenced catalog blueprint does not exist

Implementation note:

- keep existing `producer` resolution behavior unchanged
- add a new blueprint resolver rooted at `catalog/blueprints`
- do not add fallback search order between producers and blueprints

### 2. Public/private boundary for imported blueprints

Add validation/resolution rules so parent references into an imported blueprint may resolve only to that imported blueprint’s declared public nodes:

- top-level input nodes
- top-level artifact nodes

Reject parent references that target:

- internal nested producer nodes
- internal nested imported children
- internal private intermediary artifacts

This should be enforced during graph/reference validation, not left to accidental runtime behavior.

### 3. Composite graph flattening remains internal

Internally, the engine may continue flattening imported blueprints into the canonical graph for planning/execution, but that flattening is an implementation detail.

Externally:

- parent graph authoring sees the composite as a reusable module boundary
- internal canonical IDs still include the import alias path
- canonical IDs must remain exact and deterministic

### 4. No new graph language

Do not add:

- selector arithmetic beyond current support
- parity conditions
- mapping expressions
- branching DSL

Composite blueprints should solve orchestration complexity through composition, not by turning edge syntax into a programming language.

## Canonical ID and Fail-Fast Requirements

This feature must follow the repo’s canonical-ID rules strictly.

### Canonical IDs

- User-authored ingress may use human-authored names:
  - blueprint `connections:`
  - blueprint import aliases
  - `inputs.yaml`
  - producer-scoped user config
- Immediately after ingress parsing, all internal references must be canonicalized.
- Runtime, planning, provider execution, fan-in, `inputBindings`, `resolvedInputs`, and nested-composite execution must consume canonical IDs only.
- No runtime alias fallback, no self-fallback, no unqualified-key fallback, no “best guess” lookup.

### Composite-specific canonical rules

- Imported composite aliases must expand into canonical namespace paths deterministically.
- Internal child producers inside composites must receive canonical producer IDs.
- Parent-to-composite bindings must resolve to canonical input IDs at the composite boundary.
- Composite output artifacts must resolve to canonical artifact IDs at the boundary and downstream consumers must read those exact IDs.
- If a canonical boundary binding is missing, execution must fail immediately with a typed error.

### Fail fast

The implementation must never:

- silently substitute a missing internal artifact
- guess whether a catalog reference meant `producer` or `blueprint`
- allow parent references to private internals “because it happens to resolve”
- fall back from canonical to alias lookup during runtime

## Error Handling

Use the existing numbered Renku error system only:

- parser layer: `createParserError(...)` + `ParserErrorCode`
- runtime layer: `createRuntimeError(...)` + `RuntimeErrorCode`
- provider layer: `createProviderError(...)` + `SdkErrorCode`

Do not add a parallel custom error mechanism.

### Prefer existing codes where they already fit

Examples:

- invalid/malformed import entry: existing parser import-entry errors where appropriate
- missing catalog root: existing `P032`
- unknown catalog producer: existing `P033`
- invalid graph/private-boundary reference: existing runtime/validation graph/reference errors where appropriate

### Add new codes only where the existing vocabulary is not precise enough

Likely additions:

- parser code for unknown catalog blueprint reference
- parser code for `producer`/`blueprint`/`path` import source conflicts if existing import conflict codes are no longer precise enough
- runtime or validation code for parent access to private composite internals if existing graph-reference errors are too vague

Messages must be concrete and actionable, for example:

- which import alias failed
- which catalog reference was missing
- which internal node was referenced illegally
- which canonical ID was expected but missing

## `NumOfSegments` Standardization

Keep `NumOfSegments` as the standard public segment count for segment-based blueprints.

Guidance:

- blueprints may still use internal loop names if needed, but `countInput` should use `NumOfSegments`
- “segment” should remain the preferred terminology for user-facing and storyboard-facing flows
- composites may internally create multiple intermediate artifacts for a single public segment
- a composite is not restricted to producing one artifact, but `celebrity-then-now` should use one final exported video per segment because that is the cleanest public shape

## `celebrity-then-now` as One Example, Not the Feature Definition

After the general-purpose composite feature exists, `celebrity-then-now` should adopt it like this:

- parent blueprint loops on `segment` with `countInput: NumOfSegments`
- parent imports a composite segment module
- composite owns the internal meeting/transition logic
- composite exports one final segment video to the parent
- timeline composition stays simple at the parent level

Important:

- this blueprint is only one consumer of the feature
- the feature definition must not be tailored only around this blueprint

## Testing Strategy

### 1. Use scenario-specific fixtures, not real catalog blueprints

Do not write tests directly against existing catalog blueprints like `celebrity-then-now`.

Instead, create focused scenario fixtures that isolate one behavior at a time.

Follow the existing fixture pattern and naming style, for example:

- `core/tests/fixtures/composite-blueprint--single-output-segment`
- `core/tests/fixtures/composite-blueprint--multi-output-artifacts`
- `core/tests/fixtures/composite-blueprint--private-internal-reference-rejected`
- `core/tests/fixtures/catalog-blueprint-import--qualified-module`
- `core/tests/fixtures/composite-blueprint--canonical-boundary-bindings`

### 2. Core parser/loading tests

Add fixture-based tests for:

- parsing `blueprint:` imports
- rejecting `path` + `producer`
- rejecting `path` + `blueprint`
- rejecting `producer` + `blueprint`
- rejecting missing import source
- rejecting unknown catalog blueprint reference
- loading nested composites through alias paths

### 3. Resolution and canonical graph tests

Add fixture-based tests for:

- imported composite public inputs/artifacts resolve correctly
- parent cannot reference composite internals
- composite internal loops and child producers flatten correctly internally
- canonical IDs remain stable across parent/composite boundaries
- fan-in and array outputs across composite boundaries preserve exact canonical IDs

### 4. Input-loading and producer-option tests

Add focused tests for:

- producer-scoped config targeting nested internal producers still canonicalizes correctly
- alias-based authored input keys are converted immediately to canonical IDs
- runtime maps reject non-canonical keys after ingress

### 5. CLI/integration fixtures

Add dedicated integration fixtures under the CLI fixture tree for:

- local composite import by `path`
- catalog composite import by `blueprint`
- one-segment-one-final-video composite flow
- multi-output composite flow

These fixtures should be named by scenario, not by product blueprint.

## Implementation Phases

### Phase 1: Import Contract

- add `blueprint:` to producer import definitions
- update parser validation for mutually exclusive import sources
- update loader resolution to find catalog blueprints
- add parser fixture coverage

### Phase 2: Boundary Enforcement

- define composite public contract as top-level inputs/artifacts only
- reject parent references into private composite internals
- add graph/reference validation coverage

### Phase 3: Canonical Integrity

- audit parent/composite boundary resolution
- ensure canonical IDs are emitted and consumed consistently through:
  - planning
  - runner job contexts
  - input bindings
  - fan-in descriptors
  - resolved inputs
- add targeted fail-fast tests for missing canonical bindings

### Phase 4: Consumer Adoption Fixture

- add a dedicated scenario fixture proving a parent segment loop can consume a composite that internally performs multiple producer steps and exports one final segment artifact
- use this scenario as the model for migrating `celebrity-then-now`

## Risks and Mitigations

### Risk: accidental leakage of composite internals

If parent graphs can still reference internal child nodes, the feature becomes fragile and non-modular.

Mitigation:

- enforce boundary validation explicitly
- add negative tests for illegal internal references

### Risk: canonical ID regressions across nested graphs

Nested imports already carry alias-path complexity. Composite boundaries increase the importance of strict canonicalization.

Mitigation:

- add boundary-specific canonical tests
- reject non-canonical runtime maps immediately
- do not add fallback lookup logic

### Risk: ambiguous catalog import behavior

If `producer:` starts heuristically resolving both producers and blueprints, authoring becomes unpredictable.

Mitigation:

- keep `producer:` and `blueprint:` separate
- fail fast on invalid or missing import sources

## Acceptance Criteria

- Authors can build reusable multi-step producer modules entirely in YAML.
- Both local and catalog composite modules can be imported cleanly.
- Parent blueprints can wire only to a composite’s public interface.
- Internal execution uses canonical IDs only.
- Missing bindings or invalid references fail fast with numbered typed errors.
- Tests use dedicated scenario fixtures, not live catalog blueprints as the primary coverage surface.
- `celebrity-then-now` can be migrated later as one clean consumer of this feature rather than as the feature’s definition.
