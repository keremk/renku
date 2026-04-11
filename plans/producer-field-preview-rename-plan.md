# Producer Field Preview Rename Plan

## Goal

Rename the current "SDK preview" feature to "producer field preview" everywhere in source code, API routes, UI hooks, and tests so the code reflects what the feature actually does.

The feature is not previewing an SDK. It resolves and returns the current effective values, warnings, and connection state for producer config fields in the Models panel.

This phase is intentionally rename-only. It should not change graph logic, schema hydration behavior, or the underlying field-resolution algorithm.

## Why This Rename Is Worth Doing First

- The current name is misleading.
- The refactor in phase 2 will touch the same area heavily.
- Doing the rename first gives the graph refactor a cleaner vocabulary.
- It reduces the chance that we bake more "sdk preview" naming into new abstractions.

Example of the confusion today:

- Route: `/blueprints/producer-sdk-preview`
- Hook: `useProducerSdkPreview(...)`
- Types: `ProducerSdkPreviewResponse`, `SdkPreviewField`

But what the feature actually returns is:

- resolved field values
- warnings and errors per field
- whether a field is connected
- per-instance values for looped producers

That is much closer to "producer field preview" than "SDK preview."

## Current Behavior To Preserve

This phase must preserve the existing feature behavior exactly:

- The viewer Models panel still fetches live field-resolution data when model selections or inputs change.
- The server still loads the blueprint, hydrates output schemas, resolves mappings, builds binding summaries, and returns field preview data.
- The JSON payload shape stays semantically the same. Keys like `producers`, `errorsByProducer`, `fields`, `value`, `warnings`, and `errors` should not be redesigned in this phase.
- No compatibility alias route should be added. The old name should be removed and all internal callers updated together in one pass.
- The viewer server remains a thin wrapper around core services. This phase should not move feature logic from core into the viewer server.
- Internal identifiers must continue to use canonical IDs only. This rename must not introduce any new alias-based identity handling.
- No duplicated graph traversal or dependency-resolution logic should be introduced during the rename.
- No silent fallback behavior should be added while renaming error paths, route handling, or UI state.

## Non-Negotiable Rules For This Phase

- Viewer server remains a thin wrapper around core services.
- Internal identifiers must use canonical IDs only.
- No duplicated graph traversal or dependency-resolution logic outside core.
- No silent fallback behavior that hides missing metadata or ambiguous blueprint structure.

## Scope

Rename all source-facing references from "sdk preview" to "producer field preview" in these areas:

- Server handler module and exports
- HTTP route name
- Client fetch helper
- React hook
- Response/request/type names
- Prop names flowing through the Models panel
- Tests, comments, and error messages

Do not include broader refactoring in this phase:

- no new graph context abstraction
- no resolution-ready pipeline changes
- no schema hydration behavior changes
- no functional cleanup beyond the rename
- do not rename `sdkMapping`, `resolveMappingsForModel(...)`, or any other "SDK mapping" terminology that refers to provider/model mapping configuration rather than this viewer preview feature
- do not move any storyboard, visibility, provenance, graph, or identity logic between packages

## Recommended Naming

Use "producer field preview" consistently.

Recommended names:

- File: `viewer/server/blueprints/producer-field-preview-handler.ts`
- Server function: `getProducerFieldPreview(...)`
- Request type: `ProducerFieldPreviewRequest`
- Response type: `ProducerFieldPreviewResponse`
- Entry type: `ProducerFieldPreviewEntry`
- Field type: `ProducerFieldPreviewField`
- Field instance type: `ProducerFieldPreviewFieldInstance`
- Route: `POST /blueprints/producer-field-preview`
- Client fetcher: `fetchProducerFieldPreview(...)`
- Hook: `useProducerFieldPreview(...)`
- Hook result key: `fieldPreviewByProducer`
- UI prop names: `fieldPreviewByProducer`, `fieldPreviewErrorsByProducer`, `fieldPreview`

Use the longer "ProducerFieldPreview..." type names instead of short `FieldPreview...` names so the meaning stays obvious when imported out of context.

## Files Likely To Change

Primary server files:

- `viewer/server/blueprints/sdk-preview-handler.ts`
- `viewer/server/blueprints/blueprint-handler.ts`
- `viewer/server/blueprints/index.ts`
- `viewer/server/blueprints/sdk-preview-handler.test.ts`

Primary viewer client files:

- `viewer/src/data/blueprint-client.ts`
- `viewer/src/hooks/use-producer-sdk-preview.ts`
- `viewer/src/hooks/index.ts`
- `viewer/src/types/blueprint-graph.ts`
- `viewer/src/components/blueprint/workspace-layout.tsx`
- `viewer/src/components/blueprint/detail-panel.tsx`
- `viewer/src/components/blueprint/models-panel.tsx`
- `viewer/src/components/blueprint/models/producer-section.tsx`
- `viewer/src/components/blueprint/models/config-properties-editor.tsx`
- any related tests using `sdkPreview` names

Generated/bundled files:

- `cli/viewer-bundle/server-dist/...`

Do not hand-edit generated bundle output. Update source files only, then regenerate the bundle through the existing build path if this repo expects the bundled output to be committed.

## Implementation Steps

### 1. Rename the server module and exports

- Rename `sdk-preview-handler.ts` to `producer-field-preview-handler.ts`.
- Rename the exported function from `getProducerSdkPreview` to `getProducerFieldPreview`.
- Rename the request and response interfaces in that module.
- Rename all internal interfaces from `ProducerSdkPreview...` and `SdkPreview...` to `ProducerFieldPreview...`.

### 2. Rename the HTTP route

- Change the route from `/blueprints/producer-sdk-preview` to `/blueprints/producer-field-preview` in `viewer/server/blueprints/blueprint-handler.ts`.
- Update route comments and error messages so they stop saying "sdk preview".
- Update imports and re-exports in `viewer/server/blueprints/index.ts`.

### 3. Rename the client API surface

- Rename `fetchProducerSdkPreview(...)` to `fetchProducerFieldPreview(...)`.
- Update the URL it posts to.
- Rename request/response imports on the client side.
- Update error messages to say "producer field preview".

### 4. Rename the React hook and state

- Rename `useProducerSdkPreview(...)` to `useProducerFieldPreview(...)`.
- Rename its result keys:
  - `sdkPreviewByProducer` -> `fieldPreviewByProducer`
  - related error state -> `fieldPreviewErrorsByProducer`
- Update `viewer/src/hooks/index.ts`.

### 5. Rename UI prop flow through the Models panel

- Replace `sdkPreviewByProducer` prop names with `fieldPreviewByProducer`.
- Replace `sdkPreviewErrorsByProducer` with `fieldPreviewErrorsByProducer`.
- Replace per-producer `sdkPreview` props with `fieldPreview`.
- Update variable names in `workspace-layout.tsx`, `detail-panel.tsx`, `models-panel.tsx`, `producer-section.tsx`, and `config-properties-editor.tsx`.

### 6. Rename shared field types

- In `viewer/src/types/blueprint-graph.ts`, rename:
  - `SdkPreviewStatus` -> `ProducerFieldPreviewStatus`
  - `SdkPreviewField` -> `ProducerFieldPreviewField`
  - `SdkPreviewFieldInstance` -> `ProducerFieldPreviewFieldInstance`
  - `ProducerSdkPreviewEntry` -> `ProducerFieldPreviewEntry`
  - `ProducerSdkPreviewResponse` -> `ProducerFieldPreviewResponse`
- Update all imports accordingly.

### 7. Update tests and assertions

- Rename the server test file to match the new handler name.
- Update test names and expectations so they talk about "producer field preview".
- Update component tests that reference `sdkPreview` props or types.

### 8. Regenerate committed bundle output if required

- If `cli/viewer-bundle/server-dist` is a committed artifact in this repo workflow, regenerate it using the proper build command after source changes are complete.
- Do not manually patch generated files.

## Acceptance Criteria

The rename phase is complete when all of the following are true:

- There are no remaining source references to `sdk-preview-handler`, `getProducerSdkPreview`, `ProducerSdkPreview`, or `useProducerSdkPreview` outside historical docs or obsolete plan files.
- There are no remaining active source references to `SdkPreviewField`, `SdkPreviewFieldInstance`, or `SdkPreviewStatus`.
- The active route is `/blueprints/producer-field-preview`.
- The Models panel still shows the same resolved field values and warnings as before.
- Server and viewer tests referring to the renamed feature pass.
- No behavior changed other than naming.

## Verification

Code search checks:

- Search for `sdk-preview-handler`
- Search for `getProducerSdkPreview`
- Search for `ProducerSdkPreview`
- Search for `useProducerSdkPreview`
- Search for `sdkPreviewByProducer`
- Search for `sdkPreview`

Expected result:

- no matches in active source files after the rename, except for obsolete plan docs or generated output prior to regeneration

Explicit exception:

- `sdkMapping` and related mapping terminology are expected to remain because they refer to a different concept

Behavior checks:

- Open the viewer Models panel
- Change model selections
- Change inputs that affect mapped fields
- Confirm resolved field preview values, warnings, and per-instance data still appear

## Risks

- This rename touches a wide cross-section of viewer code, so incomplete renames are the main risk.
- The route rename can break the UI immediately if the client and server are not updated together.
- Generated bundled output may lag behind source if the repo expects committed build artifacts.

## Recommended Commit Boundary

Keep this as a single dedicated rename refactor commit.

Good commit shape:

- source rename
- tests updated
- generated bundle refreshed if required

Do not mix in graph refactoring changes in the same commit.
