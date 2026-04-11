What Problem We Are Actually Fixing

The main issue is not that storyboard has its own graph builder.

The real issue is this:

- buildBlueprintGraph(...) already contains the shared graph logic.
- But that graph logic only works correctly when the blueprint tree has already been prepared for resolution.
- Today, that preparation step is easy to forget because it lives outside the graph builder.

So the bug is really:

- “some callers remember to prepare the tree before graph resolution”
- “some callers forget”
- “the type system does not make that requirement obvious”

That is why this feels leaky.

A concrete example helps.

Imagine a producer outputs a JSON artifact called Storyboard.

The raw YAML may only say something like:

artifacts:
  - name: Storyboard
    type: json

But the output schema says that Storyboard contains:

- Scenes[scene].VideoPrompt
- Scenes[scene].SceneImagePrompt
- Scenes[scene].NarrationScript

Those derived fields are not literally present in the YAML. They only become visible to graph resolution after the tree is enriched with the producer’s output schema.

So if a consumer builds the graph from the raw tree, it cannot “see” those derived fields.

That is the architectural gap.

———

Why The Current Design Feels Confusing

There are really two different layers mixed together today:

1. Raw blueprint loading
    - Read YAML files
    - Build a BlueprintTreeNode
    - This is what core/src/parsing/blueprint-loader/yaml-parser.ts does
2. Resolution preparation
    - Load output schema files or read schemas from provider options
    - Attach schema to JSON artifacts
    - Add the derived producer-to-field edges
    - This is what core/src/orchestration/output-schema-hydration.ts:33 does
3. Graph resolution
    - Build graph
    - Normalize inputs
    - Expand loops / canonical instances
    - This is what core/src/resolution/canonical-graph.ts:106 and core/src/resolution/canonical-expander.ts:58 do

The problem is that layer 2 and layer 3 are not cleanly bundled together.

So callers currently have to “just know” that graph resolution really means:

- maybe load tree
- maybe hydrate schemas
- then build graph
- maybe expand graph

That hidden “maybe” is the leak.

———

Where This Shows Up In The Repo

Today the prep step is handled in multiple places:

- Planning applies schemas from provider options in core/src/orchestration/planning-service.ts:150
- SDK preview hydrates from producer metadata in viewer/server/blueprints/sdk-preview-handler.ts:95
- Storyboard hydrates from producer metadata in viewer/server/blueprints/storyboard-handler.ts:22
- Config schemas hydrates from producer metadata in viewer/server/blueprints/config-schemas-handler.ts:502

And then several core helpers assume the tree is already prepared:

- core/src/resolution/producer-binding-summary.ts:47
- core/src/resolution/storyboard-projection.ts:155

So the hidden contract today is:

- “if you call these helpers on a raw tree, they may be wrong”
- “if you call them on a prepared tree, they work”

That is exactly the kind of architecture that becomes hard to reason about later.

———

What I Am Not Proposing

I am not proposing that we shove schema loading directly into buildBlueprintGraph(...).

I would avoid that for three reasons:

- buildBlueprintGraph(...) is currently a nice low-level synchronous transform
- schema hydration is async because it may read files from disk
- planning also has a second schema source, providerOptions, which the graph builder should not know about

So I think your instinct is right:

- keep buildBlueprintGraph(...) low-level
- centralize the step above it

———

The Architecture I Recommend

I would split this into a very explicit three-stage pipeline.

### 1. Raw Tree

This remains exactly what it sounds like:

- load YAML
- no runtime enrichment
- safe for parsing views and static validation

API:

- loadYamlBlueprintTree(...)

This is the “what was authored” representation.

### 2. Prepared Tree

This is the blueprint after resolution preparation:

- output schemas applied
- JSON artifacts enriched with schema
- decomposed derived fields made visible to graph construction
- synthetic producer-to-derived-field edges added

API:

- prepareBlueprintTreeForResolution(rawTree, options)

This is the “resolution-ready” representation.

### 3. Resolution Context

This is the shared graph bundle built from the prepared tree:

- prepared tree
- graph
- input source map
- an expand(inputs) helper

API:

- createBlueprintResolutionContext(preparedTree)

This becomes the shared object that all resolution consumers use.

———

Why I Think A Context Object Is Better Than Just One More Helper

If we only add a helper like hydrateThenBuildGraph(...), we improve things a bit, but we still leave graph work spread out.

A context object is cleaner because it gives us one shared unit:

const prepared = await prepareBlueprintTreeForResolution(rawTree, source);
const resolution = createBlueprintResolutionContext(prepared);

Then consumers can use what they need:

- storyboard uses resolution.expand(inputs)
- binding summary uses resolution.graph
- planning uses resolution.graph and resolution.expand(inputs)

That means “different consumers can call different pieces” without rebuilding the same setup every time.

It also makes the architecture much easier to explain:

- raw tree
- prepared tree
- resolution context

———

The Most Important Design Choice: Prepared Copy vs In-Place Mutation

For a refactor of this size, I recommend a prepared copy, not mutating the raw loaded tree in place.

Why I recommend that:

- it makes the boundary explicit
- it avoids hidden side effects
- it avoids order-dependent behavior
- it makes tests easier to reason about

Right now planning mutates args.blueprintTree in place in core/src/orchestration/planning-service.ts:150. That means the same object can silently change meaning from
“raw authored blueprint” to “runtime-prepared blueprint”.

That is exactly the kind of thing that makes a codebase feel spooky later.

With a prepared copy, the rule becomes simple:

- raw tree is raw
- prepared tree is prepared
- resolution code only consumes prepared tree / resolution context

That is much easier for humans.

———

A Concrete Example Of Why This Helps

Take rerun preview.

Today in viewer/server/builds/preview/rerun-preview.ts:488, applyRerunInputOverrides(...) builds and expands the graph before planning runs.

That means it can try to resolve override targets against a graph that has not yet been prepared.

So if an override needs to target something like:

- Storyboard.Scenes[scene].NarrationScript

that target may not exist yet unless schema preparation already happened somewhere else.

That is exactly the bug class this refactor removes.

With the new architecture, rerun preview would do this:

1. load raw tree
2. load inputs and provider metadata
3. prepare tree for resolution using provider-option schemas
4. create resolution context
5. resolve input overrides against that context
6. plan using the same prepared blueprint

So both rerun preview and planning are guaranteed to see the same graph universe.

———

What Stays Out Of Scope

This refactor should not change:

- static parse/visual graph views that only want the authored YAML shape
- blueprints:validate as a raw static wiring validator
- the schema decomposition algorithm itself
- mapping resolution rules
- any fallback behavior

So the goal is not “make everything use hydrated blueprints.”
The goal is:

- make every resolution consumer use the same prepared blueprint contract

That is a much narrower, cleaner target.

• Proposed Plan


# Shared Resolution-Ready Blueprint Architecture

## Summary

- Introduce a new explicit boundary between:
    - raw loaded blueprints
    - resolution-prepared blueprints
    - graph-resolution context
- Fix the real leak: resolution consumers currently depend on a prepared tree, but that requirement is hidden and duplicated across callers.
- Keep buildBlueprintGraph(...) and expandBlueprintGraph(...) as low-level primitives. Do not move file I/O or provider-option logic into them.

## Architecture

- Add prepareBlueprintTreeForResolution(rawTree, options) in core.
    - Input: raw BlueprintTreeNode
    - Options:
        - schemaSource: 'producer-metadata'
        - schemaSource: 'provider-options' plus provider options map
    - Output: a new prepared tree copy, not an in-place mutation
    - Responsibilities:
        - load or parse output schemas
        - attach artifact.schema
        - add derived producer-to-decomposed-field edges
        - fail fast on missing schema, duplicate producer alias registration, or conflicting preparation
- Add createBlueprintResolutionContext(preparedTree) in core.
    - Output:
        - preparedRoot
        - graph
        - inputSources
        - expand(inputs)
    - Responsibilities:
        - centralize buildBlueprintGraph(...)
        - centralize input normalization setup
        - centralize expandBlueprintGraph(...)
- Add loadResolutionReadyBlueprint(...) as a convenience helper for async callers that only need the producer-metadata path.
    - This is loadYamlBlueprintTree(...) + prepareBlueprintTreeForResolution(...) + createBlueprintResolutionContext(...)
- Keep raw loading separate because planning cannot choose its schema source until after inputs/provider metadata are available.

## Consumer Changes

- Refactor metadata-based viewer handlers to use the convenience loader:
    - viewer/server/blueprints/sdk-preview-handler.ts
    - viewer/server/blueprints/storyboard-handler.ts
    - viewer/server/blueprints/config-schemas-handler.ts
- Refactor planning to use the explicit preparation step with provider-option schemas:
    - core/src/orchestration/planning-service.ts
    - preparation happens before graph build, but on a prepared copy rather than mutating the caller’s tree
- Refactor rerun preview to prepare the blueprint before override targeting:
    - viewer/server/builds/preview/rerun-preview.ts
    - use the same prepared resolution context for input-override targeting and later planning
- Refactor core resolution helpers to consume shared context instead of rebuilding setup ad hoc:
    - core/src/resolution/producer-binding-summary.ts
    - core/src/resolution/storyboard-projection.ts
- Leave raw/static tooling alone:
    - cli/src/commands/blueprints-validate.ts stays on the raw-tree path
    - parse-only blueprint graph endpoints stay on the raw-tree path

## API Shape

- New core APIs:
    - prepareBlueprintTreeForResolution(...)
    - createBlueprintResolutionContext(...)
    - loadResolutionReadyBlueprint(...)
- Existing low-level APIs remain:
    - loadYamlBlueprintTree(...)
    - buildBlueprintGraph(...)
    - expandBlueprintGraph(...)
- Existing low-level hydration exports may remain temporarily for compatibility, but app code should stop calling them directly once migration is complete.

## Tests

- Add core tests proving that metadata-based preparation and provider-option-based preparation yield the same decomposed graph shape for the same schema.
- Add tests proving prepared-copy behavior:
    - raw tree remains unchanged
    - prepared tree contains schema-enriched artifacts and synthetic derived edges
- Update regression tests for:
    - producer binding summary
    - storyboard projection
    - SDK preview
    - config schemas
    - storyboard handler
- Add rerun-preview regression coverage for decomposed JSON-derived override targets.
- Keep the existing CLI validation test asserting blueprints:validate remains a raw static validator.

## Assumptions

- Recommended design: prepared copy, not in-place mutation.
- Resolution consumers should use prepared tree/context only.
- Raw-tree consumers remain valid and intentionally separate.
- No fallback behavior is added anywhere; missing schemas or unresolved preparation requirements continue to fail fast.


If you want, the next turn I can turn this into an even more concrete “before vs after call flow” walkthrough for each consumer, with tiny code sketches showing exactly
how storyboard, sdk preview, planning, and rerun preview would look after the refactor.
