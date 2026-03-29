# Schema-Driven Models Panel + `x-renku-viewer` Plan

## Status

- Owner: Viewer/Schema architecture workstream
- Scope: `input_schema` only
- Start mode: forward-fix (no destructive rollback in code changes)

## Problem Statement

The models panel currently mixes approximation logic, mapping previews, and ad-hoc field rendering. This causes regressions and makes behavior hard to reason about when schemas evolve across providers.

We need a **single, maintainable, schema-driven architecture** where:

- field rendering is explicit and deterministic,
- mapped-from-input fields are editable (with override precedence),
- mapped-from-artifact fields are hidden,
- complex fields are represented by explicit viewer components,
- `TranscriptionProducer` nested STT behavior remains behaviorally correct,
- schema refresh flow for Replicate/FAL remains robust as models change.

## Non-Negotiable Requirements

1. `x-renku-viewer` annotation is source of truth for UI component initialization.
2. No code that infers component semantics from brittle heuristics or provider descriptions.
3. All fields in `input_schema` must be annotated.
4. `x-renku-viewer.order` is explicit and present at every object node.
5. Mapped-from-artifact SDK fields are hidden in models panel.
6. Schema-invalid edits are hard errors (save blocked).
7. `inputs.yaml` stores only explicit overrides, never a materialized full payload.
8. `TranscriptionProducer` nested STT behavior must remain behaviorally equivalent to known-good behavior.
9. `x-renku-constraints` is deprecated and phased out.

## High-Level Architecture

### 1) Schema Contract Layer (`catalog/models/**/*.json`)

- Keep provider schema shape as-is (`input_schema`, `output_schema`, refs).
- Add `x-renku-viewer` as Renku-owned UI contract for `input_schema`.
- Canonical annotation location: `x-renku-viewer.input` recursive tree with JSON Pointer metadata on each field.

### 2) Field Surface Resolver (server)

- Build one resolver that combines:
  - JSON Schema (+ ref resolution),
  - `x-renku-viewer`,
  - producer mappings,
  - graph binding sources.
- Output: canonical field descriptors consumed by viewer UI.

### 3) Viewer Renderer

- Render directly from canonical field descriptors.
- Initialize editor component exactly from `x-renku-viewer.component`.
- Apply source-state behavior:
  - `mapped-input` => visible + editable,
  - `mapped-artifact` => hidden,
  - `unmapped` => visible + editable.

### 4) Persistence/Runtime

- Save explicit overrides only into `models[].config`.
- Runtime payload precedence: mapped/transformed values first, explicit overrides last.

## `x-renku-viewer` Contract (V1)

### Component IDs (base set)

- `string`
- `file-uri`
- `string-enum`
- `number`
- `integer`
- `boolean`
- `nullable`
- `union`
- `object`
- `array-scalar`
- `array-file-uri`
- `array-object-cards`
- `placeholder-to-be-annotated`

### Rules

- Every field path under `input_schema` has explicit `component`.
- Every property node has explicit human-friendly `label`.
- Every object node defines `order` for immediate child keys.
- Optional field-level marker `visibility: "hidden"` can be set manually to skip rendering in models pane.
- `placeholder-to-be-annotated` is allowed in V1 to avoid silent omissions.
- Placeholder must render explicit searchable text: `To be annotated`.

### Label rule (V1)

- Tool-generated default label from property key:
  - replace `_` and `-` with spaces,
  - split camelCase boundaries,
  - title-case each word.
- Examples:
  - `voice_setting` => `Voice Setting`
  - `fontSize` => `Font Size`

### Suggested shape (V1)

```json
{
  "x-renku-viewer": {
    "version": 1,
    "input": {
      "pointer": "/input_schema",
      "component": "object",
      "label": "Input",
      "order": ["image_size", "colors"],
      "fields": {
        "image_size": {
          "pointer": "/input_schema/properties/image_size",
          "component": "union",
          "label": "Image Size",
          "variants": [
            {
              "id": "variant-1",
              "component": "string-enum",
              "label": "Preset"
            },
            { "id": "variant-2", "component": "object", "label": "Custom Size" }
          ]
        },
        "colors": {
          "pointer": "/input_schema/properties/colors",
          "component": "array-object-cards",
          "label": "Colors",
          "item": {
            "component": "placeholder-to-be-annotated",
            "label": "Item"
          }
        }
      }
    }
  }
}
```

## Phase Plan

## Phase 0 - Plan + Alignment (this document)

Deliverables:

- locked architecture and phased implementation strategy.

Exit criteria:

- explicit user approval for phases and defaults.

---

## Phase 1 - Annotation Tooling Foundation (first implementation phase)

### Goals

1. Annotate every `input_schema` field with explicit `x-renku-viewer.component`.
2. Annotate every object node with explicit `x-renku-viewer.order`.
3. Provide strict validation and fail-on-missing behavior.
4. Introduce placeholder strategy for unresolved complex components.

### Work items

1. Add script: `scripts/schema-viewer-annotations.mjs`
   - exports deterministic utilities:
     - enumerate schema nodes by JSON Pointer,
     - classify base component by schema structure (not semantics),
     - compute object-node order from existing properties order,
     - merge/update `x-renku-viewer` maps.
2. Add script: `scripts/annotate-viewer-schemas.mjs`
   - scans all `catalog/models/**/*.json`,
   - annotates `input_schema` only,
   - supports:
     - `--model=<provider/model>` filter,
     - `--rewrite` for full regeneration,
     - default preserve+fill behavior.
3. Add script: `scripts/validate-viewer-schemas.mjs`
   - fails if:
     - any `input_schema` field lacks annotation,
     - any object node missing `order`,
     - annotation references unknown component,
     - pointer references non-existent node,
     - duplicate/malformed `order` entries.
   - prints machine-readable summary of placeholders and coverage.
4. Add package scripts:
   - `catalog:annotate-viewer`
   - `catalog:validate-viewer`

### Base component mapping for auto-annotation

- structural-only mapping, deterministic:
  - `type=string` + enum => `string-enum`
  - `type=string` => `string`
  - `type=number` => `number`
  - `type=integer` => `integer`
  - `type=boolean` => `boolean`
  - `anyOf/oneOf/allOf` => `union`
  - `type=object` => `object`
  - `type=array` + scalar items => `array-scalar`
  - `type=array` + object/union items => `array-object-cards`
  - unknown/unsupported shape => `placeholder-to-be-annotated`

### Placeholder policy

- If annotator cannot confidently map structure to supported base component, assign:
  - `component: "placeholder-to-be-annotated"`
- Placeholder rendering text in UI: `To be annotated`.
- Validator should pass placeholders, but report count and exact pointers.

### Exit criteria

- Annotator runs repo-wide and writes explicit annotations.
- Validator passes with 0 missing annotations.
- Placeholder report is available for manual second pass.

---

## Phase 2 - Fetch/Update Pipeline Integration

### Goals

- Ensure new/updated schemas are always annotation-complete when written.

### Work items

1. Update `scripts/fetch-replicate-schema.mjs`
   - remove `x-renku-constraints` enrichment,
   - run viewer annotation merge before write.
2. Update `scripts/fetch-fal-schema.mjs`
   - same as replicate.
3. Update `scripts/update-replicate-catalog.mjs`
   - fetched schema -> annotate -> validate -> write.
4. Update `scripts/update-fal-catalog.mjs`
   - add `--check-diff` and `--update-diff` parity,
   - same annotate/validate gating as replicate.
5. Add strict failure behavior:
   - update/fetch exits non-zero if validation fails.

### Exit criteria

- Any fetched/updated schema lands with valid `x-renku-viewer` metadata.
- No path writes `x-renku-constraints`.

---

## Phase 3 - Skills Flow Update (`.claude/skills`)

### Goals

- Ensure model-add flows enforce schema annotation lifecycle.

### Work items

1. Update `add-fal-model` skill:
   - after fetch: annotate + validate mandatory,
   - if placeholders remain in complex fields, ask user explicitly which component should be used,
   - re-run validate.
2. Update `add-replicate-model` skill:
   - same flow.

### Exit criteria

- Skills prescribe deterministic annotation flow,
- user prompt for unresolved complex components is explicit and required.

---

## Phase 4 - Server Config Surface Refactor

### Goals

- Replace split preview/config approximation with canonical field descriptors.

### Work items

1. Introduce canonical descriptor type in server layer.
2. Resolver merges schema annotation + mapping source state.
3. Enforce source visibility:
   - mapped from artifact => hidden.
4. Preserve nested model semantics (`x-renku-nested-models`) without duplicate fields.

### Exit criteria

- descriptor payload is single source for viewer rendering,
- `TranscriptionProducer` nested behavior remains correct.

---

## Phase 5 - Viewer Renderer Refactor

### Goals

- Render all fields from descriptor and explicit component IDs.

### Work items

1. Build component registry keyed by annotation component id.
2. Add placeholder renderer with searchable text `To be annotated`.
3. Keep schema description slot clean (only schema description).
4. Implement mapped-input editable + reset-to-mapped UX.
5. Hide mapped-artifact rows.

### Exit criteria

- models pane behavior follows descriptor rules only,
- no ad-hoc editor guessing in render path.

---

## Phase 6 - Runtime/Persistence Finalization

### Goals

- Ensure explicit-overrides-only persistence and precedence correctness.

### Work items

1. Keep path-aware config writes.
2. Save only explicit overrides.
3. Runtime deep-merge explicit overrides last.
4. Block save for schema-invalid values.

### Exit criteria

- `inputs.yaml` clean and explicit,
- runtime uses override precedence correctly.

---

## Phase 7 - `x-renku-constraints` Retirement

### Goals

- remove legacy constraint annotation generation/consumption.

### Work items

1. Stop generating `x-renku-constraints` in scripts.
2. Remove viewer dependency.
3. Remove provider/runtime usage and tests in dedicated cleanup PR.

### Exit criteria

- no code path relies on `x-renku-constraints`.

## Testing & Verification Strategy

### Tooling tests

- unit tests for annotation pointer traversal and component mapping.
- unit tests for validator failure cases.

### Integration checks

- run annotator + validator against full catalog.
- run provider schema contract checks after fetch/update changes.

### Behavioral checks

- focused viewer tests:
  - mapped-input editable,
  - mapped-artifact hidden,
  - placeholder rendering,
  - transcription nested-model behavior unchanged.

## Risks & Mitigations

- **Risk:** Annotation drift after provider schema refresh.
  - **Mitigation:** fetch/update pipeline enforces annotate+validate before write.
- **Risk:** Placeholder volume initially high.
  - **Mitigation:** report with exact pointers; planned second annotation pass.
- **Risk:** Nested-model regressions (Transcription).
  - **Mitigation:** lock behavioral tests before refactor stages.

## Commands (target)

- `pnpm catalog:annotate-viewer`
- `pnpm catalog:validate-viewer`
- `pnpm catalog:update-replicate`
- `pnpm catalog:update-fal`

## Current Phase Start

Begin with **Phase 1**:

1. implement annotator core + CLI,
2. implement validator CLI,
3. wire package scripts,
4. run on catalog and produce initial placeholder report.
