# Models Pane Contract Hardening Plan (No Fallbacks, No Heuristics)

## Status

- Owner: Viewer/API/Core mapping contract workstream
- Mode: plan only (no implementation in this step)
- Scope: models pane field visibility, mapping initialization, error handling, and validation pipeline

## Why This Plan Exists

Recent regressions showed three unacceptable failure modes:

1. Artifact-connected fields (for example `prompt`, `audio_url`, `image_url`) leaked into the pane.
2. Mapped/default initialization behavior became inconsistent.
3. Error handling was not contract-driven and not fully test-locked for the real failing scenario.

This plan enforces a strict architecture so the same class of bugs cannot return.

## Non-Negotiable Requirements

1. **No fallbacks** for contract/invariant failures.
2. **No heuristics** (no name guessing, alias guessing, semantic guessing).
3. **Schema descriptors are source of truth** for field inventory.
4. **SDK preview only contributes runtime values/status** for descriptor keys.
5. **Union editors must be schema-driven and structured**:
   - enum values are selected from explicit dropdown options,
   - custom branch uses typed controls (for example width/height numeric inputs),
   - no free-text enum token entry UI.
6. **Layer boundaries must remain clean**:
   - Core: canonical graph/binding semantics
   - Providers: mapping preview/evaluation
   - Viewer server: contract composition + transport
   - Viewer UI: contract rendering only
7. **Blueprint/producers/schemas malformed states must be caught in development/CI**, not silently surfaced as normal UI behavior.
8. **Whole pane must not blank** because of one producer failure.
9. **Use existing Renku error mechanism** (`createRuntimeError`, `RuntimeErrorCode`, `isRenkuError`, `{ error, code }` response envelope), not a new parallel system.

## Explicit Goal Criteria (all three required)

1. **Works functionally**: artifact-connected fields do not appear, mapped/default initialization behaves correctly.
2. **Works cleanly**: no hacks, no duplicate cross-layer logic, no fallback branches.
3. **Works robustly**: broad deterministic tests and validation tooling catch regressions before runtime.

If any one of these three is not met, the work is considered a failure.

---

## Target Architecture

## A. Single Contract for Models Pane

The models pane consumes a single per-producer contract:

- `fields`: schema-driven descriptor tree (only visible fields)
- `runtimeByField`: runtime value/status for keys already present in `fields`
- `errorsByProducer` (optional): explicit producer-level contract/runtime errors

Rules:

- UI may render only keys from `fields`.
- `runtimeByField` keys must be a strict subset of descriptor keys.
- Any violation is a typed runtime error (no silent drop, no fallback row).

## B. Layer Responsibilities

- **Core**
  - Owns canonical graph expansion and producer binding semantics.
  - Exposes a binding metadata API so downstream layers do not parse references manually.
- **Providers**
  - Owns mapping preview evaluation and runtime mapping status/value computation.
- **Viewer server**
  - Joins schema descriptors + core binding metadata + providers preview.
  - Filters artifact-connected fields.
  - Enforces subset contract (`runtimeByField ⊆ descriptorFields`).
- **Viewer UI**
  - Pure render from server contract.
  - No inventory augmentation.
  - No standalone preview-only rows.

## C. Union/Variant Editor Contract (No Dumb Preset/Custom UX)

For union fields (for example `image_size` style fields that can be either preset enum or custom object), UI behavior must be explicit and schema-driven:

1. Descriptor includes `component: union` with explicit variants from `x-renku-viewer`.
2. If one variant is enum and another is custom object:
   - render one primary selector containing **all enum values + `Custom`**,
   - selecting enum writes that exact enum value,
   - selecting `Custom` activates object editor controls.
3. Custom branch controls are typed from schema/annotation:
   - for image size: numeric `width` and `height` controls (integer/number per schema),
   - enforce schema constraints (`minimum`, `maximum`) where present.
4. No text input for enum presets.
5. No inferred "preset labels" by guessing; labels/options come from schema + annotation.

### Union value initialization rules

- If effective value is enum string and exists in enum set: select that preset.
- If effective value is object matching custom variant shape: select `Custom` and prefill controls.
- If effective value does not match any declared union variant: treat as contract error (existing error-code mechanism), not silent coercion.

---

## Error Mechanism (Existing System Only)

Use existing core error system and viewer API envelope:

- Create/throw typed errors using `createRuntimeError(...)` + `RuntimeErrorCode` from `@gorenku/core`.
- Detect with `isRenkuError(...)`.
- Respond with existing envelope via `sendError(res, status, message, code)` resulting in `{ error, code }`.

### RuntimeErrorCode strategy

- Reuse existing codes where appropriate.
- If new codes are needed for contract violations, add them to existing `RuntimeErrorCode` enum in core (same mechanism, no custom side channel).
- Candidate additions (names TBD, numbers allocated in unused `R11x` slot):
  - descriptor missing for selected model
  - preview field outside descriptor contract
  - missing binding metadata for mapped alias
  - missing required `x-renku-viewer` annotation

### API behavior

- **Top-level request failure** (invalid blueprint path, parse failure, etc.): regular error response with `{ error, code }`.
- **Producer-level contract failure**:
  - Do not blank whole pane.
  - Return successful response containing unaffected producers + explicit `errorsByProducer` entries for failing producers (each entry includes message + code using existing error structure semantics).
  - No fallback data for failed producer.

### UI behavior for errors

- Producer with error shows explicit blocking panel `[CODE] message`.
- Model selector remains visible for recovery/change.
- Config rows for that producer are not rendered.
- Other producers remain usable.

---

## Development-Time Validation Strategy

Malformed blueprints/producers/schemas should be detected before runtime:

1. **Schema annotation validation** (existing + strengthened)
   - `catalog:validate-viewer` remains required.
   - Extend checks for descriptor completeness and pointer correctness.

2. **Mapping contract validation tooling**
   - Add validation that provider mapping outputs are representable by descriptor keys.
   - Catch mismatches during tests/CI, not via UI leakage.

3. **Union descriptor validation tooling**
   - Validate `union` descriptors are structurally complete.
   - Validate enum branch has explicit option set.
   - Validate custom object branch has explicit typed child descriptors.
   - Fail validation if union editor would require free-text guessing.

4. **Fixture-based integration tests**
   - Deterministic blueprint fixtures (copied into test fixtures, not loaded from mutable catalog blueprints).
   - Validate end-to-end contract from blueprint parsing through viewer API payload.

5. **CI gates**
   - Viewer tests + typecheck + build.
   - Contract validation scripts included in check pipeline for this workstream.

---

## Test Architecture (No Catalog Blueprint Dependency)

## Fixture layout

Introduce viewer-local test fixtures and path helpers:

- `viewer/server/test-catalog-paths.ts`
- `viewer/server/fixtures/blueprints/models-pane/artifact-mapped-fields-hidden--lipsync-video-producer/`
- `viewer/server/fixtures/blueprints/models-pane/union-enum-or-custom-object--image-size-editor/`

Naming convention for scenarios:

- `<domain>/<scenario>--<expected-behavior>/`
- Example: `models-pane/artifact-mapped-fields-hidden--lipsync-video-producer`

Fixture must include any nested module files needed for deterministic loading.

## Required test sets

1. **Core-level tests** (binding semantics)
   - Canonical binding metadata contains exact alias/source classification.
   - Loop/indexed producers covered.

2. **Viewer server integration tests**
   - `config-schemas-handler` on fixture:
     - `prompt`, `audio_url`, `image_url` absent for lipsync model.
     - union descriptor payload for `image_size` includes enum variant + custom object variant.
   - `sdk-preview-handler` on fixture:
     - preview fields are subset of descriptor field keys.
   - contract violation tests:
     - verify `{ error, code }` payload on top-level failure,
     - verify producer-level errors are returned and isolated.

3. **Viewer UI tests**
   - annotation mode renders descriptor keys only.
   - preview containing non-descriptor keys never renders extra rows.
   - producer error state is explicit, non-silent, and non-destructive to other producers.
   - transcription nested selector still suppresses duplicate `provider/model` rows.
   - union editor for enum/object fields:
     - selector shows all enum values + `Custom`,
     - selecting enum writes enum value,
     - selecting `Custom` shows typed controls (for example width/height numeric inputs),
     - no free-text enum entry control appears.

4. **Regression tests for value precedence**
   - `explicit override > mapped runtime value > schema default > empty`.

---

## Implementation Phases

## Phase 0 - Fixture + Test Scaffold (must go red first)

Deliverables:

- Viewer fixture path helpers.
- Copied deterministic blueprint fixture with clear scenario naming.
- Initial failing integration tests for current leak.

Exit criteria:

- Tests fail for the current bug before any functional changes.

## Phase 1 - Core Binding Metadata API (remove viewer parsing logic)

Deliverables:

- Core-exported API for producer binding metadata (alias + source kind + canonical source id).
- Unit tests for looped/indexed and producer->producer artifact paths.

Exit criteria:

- Viewer server no longer performs ad-hoc target/source parsing for this purpose.

## Phase 2 - Viewer Server Contract Composer

Deliverables:

- One shared contract composer module used by both config and preview handlers.
- Strict subset enforcement for preview keys against descriptor keys.
- Artifact-mapped field suppression at contract layer.
- Union descriptor normalization for enum/object unions (explicit variant contract, no UI guesswork).

Exit criteria:

- Both endpoints derive from same contract source; no duplicated inference paths.

## Phase 3 - Error Integration (existing mechanism)

Deliverables:

- Contract failures raised via `createRuntimeError` and existing `RuntimeErrorCode`.
- Handlers emit `{ error, code }` for top-level failures.
- Producer-level failures isolated in response data (`errorsByProducer`) without blanking unaffected producers.

Exit criteria:

- Error-path tests pass for server and UI.

## Phase 4 - UI Strict Rendering (no fallback branches)

Deliverables:

- Remove standalone preview-row rendering in annotation mode.
- Remove legacy fallback branches that synthesize extra inventory.
- Producer-level error panel UX in models pane.
- Implement strict union editor behavior:
  - enum/object union selector with all enum values + `Custom`,
  - typed custom controls,
  - no free-text enum path.

Exit criteria:

- UI renders only descriptor keys; failing producer does not blank entire pane.

## Phase 5 - Validation Tooling + CI Hardening

Deliverables:

- Extended contract validation checks integrated into development flow.
- Documented commands and expected checks.

Exit criteria:

- Malformed schema/mapping contract fails in validation/test stage.

---

## Verification Gates

Required before sign-off:

1. Fixture integration tests for lipsync artifact-hidden scenario pass.
2. Error-path tests (with `code`) pass.
3. Precedence and transcription regressions pass.
4. `pnpm test:typecheck:viewer` passes.
5. `pnpm --filter viewer build` passes.
6. `pnpm build` passes.

---

## Definition of Done

The work is complete only when all are true:

1. Artifact-connected fields from the failing scenario are never shown.
2. Contract uses clean layer boundaries with no duplicate heuristic logic.
3. Runtime/API errors use existing Renku code mechanism and are explicit.
4. One producer failure does not blank the entire pane.
5. Validation + tests catch malformed blueprint/producer/schema contracts during development.
6. Union fields (for example `image_size`) use explicit enum+custom UX with typed controls and no free-text preset entry.

## Out of Scope

- Any broad visual redesign of models pane.
- Any non-contract-related producer feature additions.
