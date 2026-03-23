# Unified Resolution Plan (Revised)

This replaces the previous plan and incorporates:

- your `plans/system-inputs.md` proposal (single canonical system property `Resolution` with a `Resolution` type),
- SegmentDuration compatibility concerns,
- schema-ingestion hardening for models where constraints are in descriptions (not enums).

---

## Key changes from prior plan

1. We are **not** promoting `AspectRatio` and `Resolution` as two system inputs anymore.
2. We will use **one canonical system input**: `Input:Resolution`. It is of type `resolution`
3. `resolution` is a **typed value** (`{ width, height }`), and custom inputs can also use type `resolution`.
4. `AspectRatio` and `Size` are removed. When the providers need these properties for some models, conversion transforms happen before calling the API. The transforms can generate multiple model required properties from a single property of type `resolution`. 
5. Segment-duration compatibility gets explicit handling in the same normalization layer used for duration.

---

## SegmentDuration: current behavior and required fix

## What is true today

- `SegmentDuration` is derived in core from `Duration / NumOfSegments` when absent (`core/src/execution/system-inputs.ts`, `core/src/orchestration/planning-service.ts`).
- Blueprints often wire `SegmentDuration` into producer `Duration` ports (for example `catalog/blueprints/flow-video/continuous-video.yaml`).
- Payload enum normalization in provider runtime is field-based (`providers/src/sdk/runtime.ts`): when mapped field has JSON Schema `enum`, runtime can normalize/snap numeric-like values.

## Gap

- There is no explicit guarantee/test that **SegmentDuration path** (as source input to a duration field) always gets the same compatibility normalization behavior.
- Current normalization only uses explicit schema enums on the target field; it does not infer constraints from description text.

## Plan update

1. Add explicit tests for `Input:SegmentDuration -> duration` enum snap behavior in provider runtime tests.
2. Route SegmentDuration through the same compatibility resolver as Duration (shared duration normalization path).
3. Extend compatibility metadata so description-only duration constraints (e.g. `5 or 10`) can still be normalized in dry-run and live mode.

---

## Proposal-aligned target model

## Canonical system property

- `Input:Resolution`

Value shape:

```yaml
inputs:
  Resolution:
    width: 1280
    height: 720
```

## Type system

- Introduce blueprint input type `resolution`.
- Any input can be declared `type: resolution` (for example `ReferenceImageResolution`) and should get the same UI + validation + transformation behavior.

## Derived representations (not canonical)

- API contracts sometimes require different forms that width & height. We do conversion at the edge (providers) before calling the APIs 
  - aspect ratio derived from width/height (for example `16:9`).
  - resolution preset can be derived from dimensions (for example `720p`, `1080p`).
  - size token/object projection as needed per model (`1K`, `2K`, `{width,height}`, `video_size`, etc.).
- We should not represent AspectRatio and Size as inputs anymore within Renku

---

## Schema audit finding: description-only constraints are real

I audited catalog model schemas and found a meaningful set where duration/aspect/resolution/size constraints are not encoded as enum/range, but only in free-text descriptions.

High-level result:

- **26 schema files** with description-only constraints in relevant fields.
- **25 under `replicate`**, **1 under `wavespeed-ai`**.
- Fal schemas in current catalog mostly provide explicit enums for these fields.

Detailed inventory is in `plans/system-inputs-schema-audit.md`.

---

## Ingestion strategy (scripts) without API contract break

We should not narrow provider API contracts accidentally.

## Principle

- Keep raw provider schema semantics intact for payload validation.
- Add Renku-specific compatibility metadata alongside schema information.
- Use metadata for UI options/warnings and compatibility snapping, not to claim provider contract certainty when uncertain.

## Script changes

Targets:

- `scripts/fetch-replicate-schema.mjs`
- `scripts/fetch-fal-schema.mjs`
- and batch updaters:
  - `scripts/update-replicate-catalog.mjs`
  - `scripts/update-fal-catalog.mjs`

### New enrichment pass

When ingesting schema JSON, compute `x-renku-constraints` metadata for fields such as:

- `aspect_ratio`
- `resolution`
- `size`
- `target_resolution`
- `duration` / `seconds`

Constraint sources in priority order:

1. explicit JSON schema enum/const/range (authoritative),
2. deterministic description parsing (for example `5 or 10`, `only 1080p`, listed ratios),
3. curated overrides file for ambiguous providers/models.

Each extracted rule should carry provenance:

- `source: explicit | inferred | override`
- `confidence: high | medium`

### Important safety rule

- Provider payload validation still uses schema contract as-is.
- Compatibility snapping can use `x-renku-constraints`, but when inferred constraints are low confidence, emit warning and avoid destructive coercion.

---

## Mapping and transform plan for `Resolution` type

Current mapping DSL supports `field`, `transform`, `combine`, `conditional`, `expand`. We will extend this to support typed resolution projections cleanly.

## Add resolution-aware transform - applyResolutionTransform

This allows one canonical input value to drive multiple model-specific fields without reintroducing parallel canonical inputs.

## Compatibility order

1. exact support,
2. deterministic snap (with warning),
3. fail fast when no valid target.

---

## Viewer UX plan (from your proposal)

Resolution editor for all `type: Resolution` inputs:

- left control: aspect/preset intent (`Custom`, `Default`, `Square`, `Portrait(3:4)`, `Portrait(9:16)`, `Landscape(4:3)`, `Landscape(16:9)`, `Widescreen(21:9)`),
- right controls: `width` + `height`, including common height presets (240, 360, 480, 720, 1080, 1440, 2160),
- when loading persisted values, infer nearest ratio preset else `Custom`.

Compatibility UX:

- on model switch, recompute compatibility using model constraints metadata,
- if snappable -> show warning + chosen value,
- if unsupported -> allow switch still, but display an error next to the Resolution value, so users can change it from new available resolutions for that model.
  - Note that Input:Resolution cascades through the blueprint via connections to downstream producers with different models. So we need ability to check the upstream and downstream breakage of a selected model. E.g. selecting in image model that does not support 9:16 in mid-stream can break the pipeline if the pipeline was using a resolution with 9:16
  - Some resolution type properties may only be used for a specific producer/model and not cascade downstream. E.g. an image producer producing square images which will be used as reference images in a downstream video producer. This should not break the downstream producer.

## Compatibility Validations
**IMPORTANT** We need a validator for Resolution (and properties of type resolution), which should run and validate. This should be well unit tested with edge cases. This validator validates not the validity of blueprint connections but the values selected for incompatibility. This should also be run in --dry-run for CLI cases. 

---

## Core/package implementation phases

### Phase 1 - Core type and system input foundations

1. Add `RESOLUTION: 'Resolution'` to `SYSTEM_INPUTS` (`core/src/types.ts`).
2. Extend system-input value kinds to include resolution object type in `core/src/execution/system-inputs.ts`.
3. Keep `SegmentDuration` derived behavior, and add explicit tests around coexistence with `Resolution` system input.

### Phase 2 - Resolution type plumbing

1. Allow `Resolution` input type as first-class in blueprint parsing/validation and UI typing.
2. Define canonical runtime representation `{ width: number; height: number }`.
3. Validate positivity/integer constraints at parse/load boundaries.

### Phase 3 - Transform engine extensions

1. Add resolution projection helpers in provider transform layer (`providers/src/sdk/transforms.ts`).
2. Update producer mappings to reference projections instead of raw `AspectRatio`/`Size` where appropriate.
3. Ensure canonical IDs remain strict and explicit.

### Phase 4 - Schema ingestion enrichment

1. Implement `x-renku-constraints` extraction in fetch scripts.
2. Add deterministic parsers for known description patterns.
3. Add curated overrides for unresolved ambiguous models.
4. Add audit command that fails when targeted fields remain unconstrained without explicit allowlist.

### Phase 5 - Compatibility engine (Duration + SegmentDuration + Resolution)

1. Build compatibility evaluator that consumes explicit schema + renku constraints metadata.
2. Apply same evaluator in dry-run and live invocation paths.
3. Add SegmentDuration-specific tests to prove enum snapping and description-derived handling.

### Phase 6 - Viewer integration

1. Resolution editor component in inputs panel.
2. Model-aware compatibility warnings.
3. Persist width/height shape in inputs YAML.

### Phase 7 - Clean up tests and fixtures

1. Reduce the number of fixtures used in tests without reducing test quality. 
2. Migrate blueprints/producers from canonical `AspectRatio`/`Size` assumptions to canonical `Resolution` input plus projections.


### Phase 8 - Catalog migration (**LATER DO NOT BUILD THIS YET**)

1. Migrate blueprints/producers from canonical `AspectRatio`/`Size` assumptions to canonical `Resolution` input plus projections.
2. Keep producer-local custom `Resolution` type inputs for selective overrides (for example reference-image generation).
3. Remove stale mappings after migration to avoid parallel semantics.

---

## Non-negotiable behavior rules

1. Canonical IDs remain strict (`Input:*`, `Artifact:*`, `Producer:*`), no alias guessing.
2. No silent fallback defaults for missing canonical inputs.
3. Any auto-normalization/snap must be visible (warning metadata/UI).
4. If compatibility cannot be resolved safely, fail before provider call.

---

## Immediate next execution slice

1. Add SegmentDuration compatibility tests first (to lock behavior).
2. Implement schema-audit utility + `x-renku-constraints` extraction in ingestion scripts.
3. Introduce `Resolution` typed system input in core and wire parser/validator support.
4. Then update viewer input editor and producer transforms.
