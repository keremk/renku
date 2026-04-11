The Model

The cleanest way to think about this refactor is:

- a raw blueprint tree is just “what the YAML says”
- a resolution-ready blueprint is “the raw tree plus schema-driven enrichment”
- an expanded resolution is “the resolution-ready blueprint after inputs are applied”

Right now those three stages are blurred together. That is why the code feels slippery.

A very concrete example:

- raw YAML might only declare one JSON artifact: Storyboard
- the producer’s meta.outputSchema tells us Storyboard contains:
    - Scenes[scene].VideoPrompt
    - Scenes[scene].SceneImagePrompt
    - Scenes[scene].NarrationScript

Those derived fields do not exist in the raw tree by themselves. They only exist after preparation.

So if a caller builds the graph too early, it is building the graph from an incomplete view of the blueprint.

What The Repo Does Today

Here is the current “before” picture in plain English.

1. Planning path, used by CLI and viewer

- CLI/viewer loads a raw tree, loads inputs, builds provider metadata, then core/src/orchestration/planning-service.ts:150 mutates the tree with
  applyOutputSchemasFromProviderOptionsToBlueprintTree(...), then builds and expands the graph.
- This works, but the preparation step is hidden inside planning rather than being a named shared pipeline.

2. SDK preview

- viewer/server/blueprints/sdk-preview-handler.ts:95 loads a raw tree, hydrates metadata schemas, then later calls binding helpers.
- Those helpers in core/src/resolution/producer-binding-summary.ts:47 rebuild graph state from the tree again.

3. Storyboard

- viewer/server/blueprints/storyboard-handler.ts:22 loads a raw tree, hydrates metadata schemas, then calls core/src/resolution/storyboard-projection.ts:155, which
  builds and expands the shared graph.
- So storyboard is not special in graph logic. It was special only because it initially forgot the preparation step.

4. Config schemas

- viewer/server/blueprints/config-schemas-handler.ts:502 also does raw load, metadata hydration, then static binding work.

5. Rerun preview

- viewer/server/builds/preview/rerun-preview.ts:488 builds and expands a graph for input-override targeting before planning runs.
- That is the most concerning path, because it is doing resolution work before the planning-side preparation step.

6. Raw-only consumers

- cli/src/commands/blueprints-validate.ts:27 is intentionally a raw/static validator.
- That path should stay raw. It should not suddenly get synthetic derived edges.

What Is Wrong With The Current Shape

The problem is not “duplicate graph builders.” The problem is “resolution prerequisites are not represented honestly.”

That creates five concrete issues:

- A caller can hold a BlueprintTreeNode and have no clue whether it is raw or prepared.
- Preparation happens in multiple places, so future features can easily forget it.
- Planning uses provider-option schemas, while preview paths use metadata-on-disk schemas, but there is no shared abstraction that says “this is the schema source for
  this resolution run.”
- Some core helpers accept a plain BlueprintTreeNode even though they only work correctly for prepared trees.
- SDK preview and config schemas also rebuild graph state repeatedly per producer, which is not the main bug, but it is a sign that the setup is not centralized.

The Architecture I Recommend

I would make the stages explicit and give each one a distinct object.

1. Raw Blueprint Tree

- Produced by loadYamlBlueprintTree(...)
- No enrichment
- Safe for parse views and static validation

2. BlueprintResolutionContext

- Built from a raw tree plus a declared schema source
- Contains:
    - root: a prepared copy of the tree
    - graph: the shared graph
    - inputSources: the normalized input-source map
- This is the shared “resolution-ready blueprint”

3. ExpandedBlueprintResolution

- Built from a BlueprintResolutionContext plus input values
- Contains:
    - context
    - normalizedInputs
    - canonical expanded graph

This is the key design choice: resolution consumers should take either BlueprintResolutionContext or ExpandedBlueprintResolution, not a raw BlueprintTreeNode.

That is what actually closes the leak.

Why I Prefer This Over Smaller Tweaks

I considered three directions:

- Put schema hydration into buildBlueprintGraph(...)
- Keep today’s design and just add a helper plus comments
- Introduce an explicit resolution context layer

I recommend the third one.

I would reject putting hydration inside buildBlueprintGraph(...) because:

- graph build is nicely low-level and sync today
- schema prep is async
- planning’s schema source comes from provider options, not just files on disk

I would reject “just add a helper” because:

- the hidden contract would still exist
- the public API would still make raw and prepared trees look identical

The API Shape I Would Build

I think the most readable version is this:

type ResolutionSchemaSource =
  | { kind: 'producer-metadata' }
  | { kind: 'provider-options'; providerOptions: Map<string, OutputSchemaProviderOption> };

interface BlueprintResolutionContext {
  root: BlueprintTreeNode;      // prepared copy
  graph: BlueprintGraph;
  inputSources: ReturnType<typeof buildInputSourceMapFromCanonical>;
}

interface ExpandedBlueprintResolution {
  context: BlueprintResolutionContext;
  normalizedInputs: Record<string, unknown>;
  canonical: ReturnType<typeof expandBlueprintGraph>;
}

And the constructor functions:

async function prepareBlueprintResolutionContext(args: {
  root: BlueprintTreeNode;
  schemaSource: ResolutionSchemaSource;
}): Promise<BlueprintResolutionContext>

async function loadBlueprintResolutionContext(args: {
  blueprintPath: string;
  catalogRoot?: string;
  schemaSource: ResolutionSchemaSource;
}): Promise<BlueprintResolutionContext>

function expandBlueprintResolutionContext(
  context: BlueprintResolutionContext,
  inputValues: Record<string, unknown>
): ExpandedBlueprintResolution

The important part is that the schema source becomes explicit every time.

Before vs After

Storyboard today:

const { root } = await loadYamlBlueprintTree(path, { catalogRoot });
await hydrateOutputSchemasFromProducerMetadata(root);
return buildStoryboardProjection({ root, effectiveInputs });

Storyboard after:

const context = await loadBlueprintResolutionContext({
  blueprintPath: path,
  catalogRoot,
  schemaSource: { kind: 'producer-metadata' },
});

const expanded = expandBlueprintResolutionContext(context, effectiveInputs);
return buildStoryboardProjection({ expanded, artifactStates, resolvedArtifactValues });

SDK preview today:

- load raw tree
- hydrate metadata
- for each producer, binding helpers rebuild graph / expand logic from the tree

SDK preview after:

- build one BlueprintResolutionContext
- expand once for the current inputs
- reuse that same expanded resolution for every producer preview in the request

Planning today:

- callers pass raw tree into planning
- planning mutates that tree with provider-option schemas
- planning builds graph and expands it

Planning after:

- planning still receives raw tree from its callers
- inside planning, it first creates a BlueprintResolutionContext using schemaSource: { kind: 'provider-options', providerOptions }
- planning then expands that context after blob conversion and derived-input injection
- planning no longer owns ad hoc schema mutation logic

Rerun preview after:

- load raw tree
- load inputs and provider metadata
- create one provider-option-based BlueprintResolutionContext
- use that same context for input-override targeting
- use that same context again for planning
- no graph work is ever done on the raw tree

One Important Recommendation: Prepared Copy, Not In-Place Mutation

For a major refactor, I strongly recommend that preparation returns a new prepared tree copy.

I would not keep mutating the raw BlueprintTreeNode in place.

Why:

- it makes “raw” versus “prepared” visible in code
- it avoids accidental reuse bugs
- it makes tests much easier to reason about
- it prevents hidden order dependencies

Yes, this means we need a tree clone helper. I still think it is worth it.

What Should Stay Raw

These should stay on the raw-tree path:

- static validation
- parse/visualization of authored YAML shape
- any tooling whose job is “show me what the author wrote,” not “show me runtime resolution”

That is why cli/src/commands/blueprints-validate.ts:27 should not be moved onto the resolution-ready path.

• Proposed Plan


# Resolution-Ready Blueprint Refactor

## Summary

- Introduce a new shared BlueprintResolutionContext layer that owns blueprint preparation, graph build, and input-source setup.
- Keep raw blueprint loading separate and keep low-level graph primitives unchanged.
- Make resolution consumers use BlueprintResolutionContext or ExpandedBlueprintResolution instead of a raw BlueprintTreeNode.

## Core Design

- Add a new core module for resolution context creation.
- Add explicit schema-source options:
    - producer-metadata
    - provider-options
- Build a prepared tree copy, not an in-place mutation.
- Add expandBlueprintResolutionContext(...) to centralize normalized-input and canonical expansion work.

## Consumer Migration

- Migrate storyboard, SDK preview, and config schemas to loadBlueprintResolutionContext(...).
- Migrate rerun preview to create a provider-option-based resolution context before override targeting.
- Refactor planning service to create and use a provider-option-based resolution context internally instead of directly hydrating the raw tree.
- Refactor resolution helpers such as producer binding summary and storyboard projection to consume context / expanded resolution objects rather than raw trees.
- Leave raw/static consumers like blueprints:validate and parse-only endpoints unchanged.

## Tests

- Add unit tests for:
    - metadata-based preparation
    - provider-option-based preparation
    - prepared-copy behavior
    - conflicting re-preparation failure
- Add regression coverage for:
    - storyboard projection
    - SDK preview
    - config schemas
    - producer binding summary
    - rerun preview input overrides on schema-derived JSON fields
- Keep existing raw validation tests unchanged.

## Defaults Chosen

- Recommended public abstraction: BlueprintResolutionContext
- Recommended runtime abstraction: ExpandedBlueprintResolution
- Recommended preparation behavior: clone raw tree, prepare the clone, fail fast on missing/conflicting schema state
- Recommended non-goal: do not route raw/static validation through resolution preparation


If this matches what you had in mind, the next best step is implementation in two slices: first build the new context module and migrate storyboard + SDK preview, then
migrate planning + rerun preview once the shared API feels right.

