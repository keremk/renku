# Resolution-Ready Blueprint Graph Refactor Plan

## Goal

Introduce one shared, explicit, reusable blueprint-resolution pipeline so every resolution consumer works from the same prepared blueprint state before graph building and graph expansion.

This phase starts after the "producer field preview" rename is complete. All references in this plan use the new name.

## Non-Negotiable Engineering Rules

- `core` owns storyboard derivation, visibility rules, and provenance rules.
- Viewer server remains a thin wrapper around core services.
- Viewer UI renders the returned projection and reuses existing card interactions.
- Internal identifiers must use canonical IDs only.
- The only place authored / non-canonical names are allowed is at ingress:
  - user-facing YAML
  - authored blueprint connection syntax
  - external request payloads before normalization
- After ingress normalization, no feature code should guess, strip, or reconstruct identities from aliases.
- No duplicated graph traversal or dependency-resolution logic outside core.
- No silent fallback behavior that hides missing metadata or ambiguous blueprint structure.

## Problem Statement

The repo already shares the low-level graph primitives:

- `buildBlueprintGraph(...)`
- `expandBlueprintGraph(...)`

That part is not the problem.

The real problem is the preparation step that has to happen before graph work begins.

Some blueprints rely on producer `meta.outputSchema` to decompose a JSON artifact into derived graph-visible fields.

Example:

- raw artifact: `Storyboard`
- derived fields after schema enrichment:
  - `Storyboard.Scenes[scene].VideoPrompt`
  - `Storyboard.Scenes[scene].SceneImagePrompt`
  - `Storyboard.Scenes[scene].NarrationScript`

Those fields do not exist in the raw tree by default. They only become available after schema-driven preparation.

Today, that preparation is duplicated or hidden in multiple places. That means resolution code depends on a prepared tree, but the code does not make that requirement explicit.

## Current Issues To Fix

### 1. Raw and prepared trees look identical in code

Today a variable of type `BlueprintTreeNode` may mean either:

- the raw loaded YAML tree
- the prepared tree after schema enrichment

That makes the callsites hard to reason about.

### 2. Preparation is scattered

Preparation currently happens in more than one place:

- planning prepares via provider options
- storyboard prepares via producer metadata
- config schemas prepares via producer metadata
- producer field preview prepares via producer metadata

That means future callers can easily forget the step.

### 3. Schema source is implicit

There are two valid schema sources today:

- producer metadata on disk
- provider options built for planning

The code does not currently expose this as a first-class decision.

### 4. Some helpers accept a raw tree even though they really require a prepared tree

Examples include:

- producer binding summary
- storyboard projection
- any logic that expects schema-derived artifact fields to exist in the graph

### 5. Rerun preview is especially fragile

`viewer/server/builds/preview/rerun-preview.ts` builds and expands graph state for input-override targeting before planning runs.

That means it can do resolution work before the planning-side preparation logic has had a chance to run.

## Architecture Proposal

Make the stages explicit and give each stage a distinct object.

### Stage 1: Raw Blueprint Tree

This is the authored blueprint as loaded from YAML.

Properties:

- returned by `loadYamlBlueprintTree(...)`
- no enrichment
- safe for parse visualization and static validation
- it is the last place where authored/non-canonical naming can still exist as authored blueprint syntax before later normalization paths take over

### Stage 2: Blueprint Resolution Context

This is the shared "resolution-ready blueprint" object.

It should contain:

- `root`: the prepared blueprint tree
- `graph`: the result of `buildBlueprintGraph(root)`
- `inputSources`: the result of `buildInputSourceMapFromCanonical(graph)`

This becomes the one shared object that all resolution consumers can depend on.

This stage is also where identity rules become strict:

- all downstream graph-facing and resolution-facing work must operate on canonical IDs
- no caller should reconstruct identity by parsing display labels, alias fragments, or authored path strings after this point

### Stage 3: Expanded Blueprint Resolution

This is the per-input expansion result built from a resolution context.

It should contain:

- `context`
- `normalizedInputs`
- `canonical`

This becomes the shared object for any feature that needs expanded graph instances.

This stage should also be the single home for any dependency-aware expansion result that downstream features need. No viewer-layer code should reimplement graph traversal or dependency resolution once this object exists.

## Key Design Decision

Use a prepared copy of the tree, not in-place mutation.

That means the preparation step should take a raw tree and return a new prepared tree.

Why this is the better choice:

- it makes the boundary visible
- it prevents hidden mutation of caller-owned state
- it avoids order-dependent behavior
- it makes tests easier to reason about

This phase should add a tree-cloning helper rather than continuing the current in-place mutation style.

## Proposed Core API

### Schema source model

Use an explicit union so every callsite states where its schemas come from.

```ts
type ResolutionSchemaSource =
  | { kind: 'producer-metadata' }
  | { kind: 'provider-options'; providerOptions: Map<string, OutputSchemaProviderOption> };
```

### Resolution context builder

```ts
async function prepareBlueprintResolutionContext(args: {
  root: BlueprintTreeNode;
  schemaSource: ResolutionSchemaSource;
}): Promise<BlueprintResolutionContext>;
```

Responsibilities:

- clone the raw tree
- load or parse output schemas
- attach `artifact.schema`
- add schema-derived producer-to-field edges
- build the shared graph
- build input sources
- normalize the abstraction boundary so viewer/server code stays thin and depends on core rather than open-coding graph preparation

### Load-and-prepare convenience helper

```ts
async function loadBlueprintResolutionContext(args: {
  blueprintPath: string;
  catalogRoot?: string;
  schemaSource: ResolutionSchemaSource;
}): Promise<BlueprintResolutionContext>;
```

Responsibilities:

- load raw tree from disk
- delegate to `prepareBlueprintResolutionContext(...)`

### Expansion helper

```ts
function normalizeBlueprintResolutionInputs(
  context: BlueprintResolutionContext,
  inputValues: Record<string, unknown>
): Record<string, unknown>;

function expandBlueprintResolutionContext(
  context: BlueprintResolutionContext,
  canonicalInputs: Record<string, unknown>
): ExpandedBlueprintResolution;
```

Responsibilities:

- `normalizeBlueprintResolutionInputs(...)`
  - convert caller input maps into canonical input IDs using `context.inputSources`
- `expandBlueprintResolutionContext(...)`
  - accept the final canonical input map
  - call `expandBlueprintGraph(...)`
  - return the expanded graph plus normalized inputs

This split is important for planning because planning still needs an explicit phase between normalization and expansion to:

- convert `BlobInput` values into stored `BlobRef`s
- inject derived system inputs
- append input events based on the final canonical input map

## Module Layout

Add a new core module dedicated to this abstraction.

Recommended new file:

- `core/src/resolution/blueprint-resolution-context.ts`

This module should own:

- schema-source types
- tree cloning for preparation
- prepared tree creation
- normalized-input helper
- context creation
- expansion helper
- any shared dependency-resolution setup needed by storyboard, producer field preview, config schemas, planning, and rerun preview

Keep these existing low-level modules intact:

- `canonical-graph.ts`
- `canonical-expander.ts`
- `output-schema-hydration.ts`

`output-schema-hydration.ts` can remain as the lower-level implementation detail used by the new context builder. Application code should stop calling it directly.

Important ownership rule:

- storyboard derivation, visibility rules, and provenance rules must remain in `core`
- the viewer server may call into those core services, but it should not grow its own parallel resolution policy

## Consumer Migration Plan

### 1. Producer field preview

Current shape:

- load raw tree
- hydrate metadata schemas
- for each selected producer, rebuild graph/binding state from the tree

Target shape:

- build one `BlueprintResolutionContext` using `producer-metadata`
- expand it once for the current inputs
- reuse that context or expanded resolution while evaluating each selected producer

Benefits:

- one preparation path
- one graph build
- clearer dependency on prepared state
- keeps producer field preview as a thin viewer-server wrapper over core-owned resolution state rather than a place where graph logic grows

### 2. Storyboard

Current shape:

- load raw tree
- hydrate metadata schemas
- call `buildStoryboardProjection(...)`, which rebuilds graph and expansion internally

Target shape:

- load one `BlueprintResolutionContext` using `producer-metadata`
- expand it for effective inputs
- pass `ExpandedBlueprintResolution` into storyboard projection logic

Required API shift:

- `buildStoryboardProjection(...)` should accept expanded resolution, not a raw tree
- storyboard projection behavior, visibility rules, and provenance rules remain core-owned; this migration should move more authority into core, not into the viewer server

### 3. Config schemas

Current shape:

- load raw tree
- hydrate metadata schemas
- perform static producer binding work

Target shape:

- load one `BlueprintResolutionContext` using `producer-metadata`
- use its prepared root and graph-derived binding state

Rule reminder:

- config schema derivation may consume prepared core state, but it should not add its own duplicate graph traversal logic in the viewer server

### 4. Planning

Current shape:

- receives raw tree
- mutates it inside planning with provider-option schemas
- builds graph and expands graph

Target shape:

- still receives the raw tree from callers
- immediately builds `BlueprintResolutionContext` with `provider-options`
- performs all graph and expansion work from that context
- stops mutating the caller-owned tree

Important detail:

- planning must continue to use provider-option schemas, not producer-metadata schemas, because the planning path is model-selection-aware and already has provider metadata available
- planning must continue to operate on canonical IDs only after ingress normalization

### 5. Rerun preview

Current shape:

- loads raw tree
- builds provider metadata
- resolves input overrides by building/expanding graph state before planning

Target shape:

- load raw tree
- build provider metadata
- create one `BlueprintResolutionContext` using provider-option schemas
- use that same context for input-override targeting
- use that same context again for planning

This is the most important callsite to harden because it currently does pre-planning graph work.

Rule reminder:

- rerun preview must not guess identities from aliases or reconstruct node references from display names after normalization

### 6. Raw-only tooling that should not migrate

These should stay on the raw-tree path:

- static validation
- parse visualization of authored graph shape
- any feature whose job is to show authored YAML structure rather than runtime resolution

That means:

- `cli/src/commands/blueprints-validate.ts` stays raw
- parse-oriented viewer endpoints stay raw

## Concrete "Before vs After" Call Flows

### Storyboard before

```ts
const { root } = await loadYamlBlueprintTree(path, { catalogRoot });
await hydrateOutputSchemasFromProducerMetadata(root);
return buildStoryboardProjection({ root, effectiveInputs, artifactStates });
```

### Storyboard after

```ts
const context = await loadBlueprintResolutionContext({
  blueprintPath: path,
  catalogRoot,
  schemaSource: { kind: 'producer-metadata' },
});

const canonicalInputs = normalizeBlueprintResolutionInputs(context, effectiveInputs);
const expanded = expandBlueprintResolutionContext(context, canonicalInputs);

return buildStoryboardProjection({
  expanded,
  artifactStates,
  resolvedArtifactValues,
});
```

### Producer field preview before

```ts
const { root } = await loadYamlBlueprintTree(path, { catalogRoot });
await hydrateOutputSchemasFromProducerMetadata(root);

for (const selection of request.models) {
  buildProducerBindingSummary({ root, ... });
  buildProducerRuntimeBindingSnapshot({ root, ... });
}
```

### Producer field preview after

```ts
const context = await loadBlueprintResolutionContext({
  blueprintPath: path,
  catalogRoot,
  schemaSource: { kind: 'producer-metadata' },
});

const canonicalInputs = normalizeBlueprintResolutionInputs(context, request.inputs);
const expanded = expandBlueprintResolutionContext(context, canonicalInputs);

for (const selection of request.models) {
  evaluateProducerFieldPreview({ context, expanded, selection });
}
```

### Planning before

```ts
applyOutputSchemasFromProviderOptionsToBlueprintTree(rawTree, providerOptions);
const graph = buildBlueprintGraph(rawTree);
const inputSources = buildInputSourceMapFromCanonical(graph);
const canonical = expandBlueprintGraph(graph, normalizedInputs, inputSources);
```

### Planning after

```ts
const context = await prepareBlueprintResolutionContext({
  root: rawTree,
  schemaSource: { kind: 'provider-options', providerOptions },
});

const canonicalInputs = normalizeBlueprintResolutionInputs(context, inputValues);
const inputsWithBlobRefs = await transformInputBlobsToRefs(canonicalInputs, ...);
const inputsWithDerived = injectDerivedInputs(inputsWithBlobRefs);
const expanded = expandBlueprintResolutionContext(context, inputsWithDerived);
```

## Implementation Steps

### Step 1. Add the new resolution context module

- Create `core/src/resolution/blueprint-resolution-context.ts`.
- Define the schema-source types.
- Add a tree clone helper for `BlueprintTreeNode`.
- Ensure the clone preserves:
  - `sourcePath`
  - `namespacePath`
  - `children` map structure
  - document arrays and nested objects without sharing mutable references with the raw tree
- Add context creation and expansion helpers.
- Ensure the new helpers expose canonical graph-facing identities, not ad hoc alias-derived ones.

### Step 2. Extract preparation behind the new API

- Reuse the current schema-loading and schema-application logic from `output-schema-hydration.ts`.
- Keep those helpers low-level.
- Stop letting application callsites perform ad hoc hydration directly.
- Keep fail-fast behavior. If schema data is missing, invalid, duplicated, or conflicting, the new context builder must throw instead of falling back.

### Step 3. Update exports

- Export the new context API from `core/src/resolution/index.ts`.
- Re-export from `core/src/index.ts` if the viewer imports through `@gorenku/core`.

### Step 4. Migrate producer field preview

- Rename-aware target file: `viewer/server/blueprints/producer-field-preview-handler.ts`
- Build one context and one expansion per request.
- Rework binding-summary helpers as needed to accept the new context or expanded resolution.
- Keep the viewer server wrapper thin. Any reusable resolution logic uncovered during this migration should move into core rather than staying in the handler.

### Step 5. Migrate storyboard

- Update handler code to load context instead of manually hydrating the tree.
- Update projection code to accept the new expanded object.
- Keep all storyboard derivation, visibility, and provenance logic in core.

### Step 6. Migrate config schemas

- Load shared context through the new helper.
- Use prepared root / graph-derived state rather than manual metadata hydration.
- Do not add new viewer-server graph walks for convenience.

### Step 7. Migrate planning

- Replace the in-place schema application in `planning-service.ts`.
- Build a provider-option-backed context internally.
- Make planning operate entirely from the prepared copy.
- Preserve canonical-ID-only behavior after input normalization.

### Step 8. Migrate rerun preview

- Build provider metadata first.
- Create the shared context before input-override targeting.
- Reuse the same context across override resolution and planning.
- Ensure override targeting consumes canonical identities from the prepared graph instead of reconstructing names from aliases.

### Step 9. Remove direct app-level hydration calls

- After all migrations, application code should stop calling:
  - `hydrateOutputSchemasFromProducerMetadata(...)`
  - `applyOutputSchemasFromProviderOptionsToBlueprintTree(...)`
- These may remain as lower-level internals or compatibility exports, but they should no longer be the main application entrypoint.
- After all migrations, no viewer/server feature should own a parallel graph-preparation or dependency-resolution path.

## Testing Plan

### Core tests

Add new tests for the context module:

- metadata-based preparation produces expected schema-derived fields
- provider-option-based preparation produces the same derived graph shape for equivalent schema
- raw tree remains unchanged after preparation
- prepared tree contains schema attachments and derived edges
- conflicting preparation or duplicate registrations fail loudly
- canonical IDs flow through the context and expansion APIs without alias reconstruction

### Regression tests to update

Update or extend tests for:

- producer field preview handler
- storyboard handler
- storyboard projection
- config schemas handler
- producer binding summary
- planning service
- rerun preview input override path
- verify viewer-server layers remain wrappers over core rather than growing new graph logic

### Specific rerun preview regression

Add a regression test for a schema-derived JSON field target so rerun preview proves it can resolve override targets that only exist after schema preparation.

### Raw-path regression

Keep the current static validation behavior intact:

- `blueprints:validate` should remain a raw-tree/static wiring validator

## Acceptance Criteria

The refactor is complete when all of the following are true:

- Resolution consumers no longer own their own schema-preparation step.
- The schema source is explicit at every resolution entrypoint.
- No caller needs to "remember" to hydrate output schemas before graph work.
- Planning no longer mutates the raw caller-owned blueprint tree.
- Rerun preview resolves input overrides from the same prepared graph universe that planning uses.
- Raw/static tooling still works from the raw authored tree.
- The new context API preserves the repo's no-fallback rule: missing or conflicting schema state fails loudly rather than guessing.
- Storyboard derivation, visibility rules, and provenance rules remain core-owned.
- Viewer server remains a thin wrapper over core services.
- No duplicate graph traversal or dependency-resolution logic remains outside core for migrated consumers.
- After ingress normalization, migrated code paths operate on canonical IDs only.

## Risks

- This refactor changes several core call boundaries at once.
- The biggest behavioral risk is accidentally mixing raw-tree and prepared-tree consumers during migration.
- The second biggest risk is partial migration where one path still does hidden preparation and another path uses the new context.

## Recommended Delivery Strategy

Implement this phase in small commits after the rename phase is merged:

- commit 1: add context module and exports
- commit 2: migrate producer field preview
- commit 3: migrate storyboard and config schemas
- commit 4: migrate planning
- commit 5: migrate rerun preview and remove direct application-level hydration calls

This keeps each step reviewable and makes regressions easier to isolate.
