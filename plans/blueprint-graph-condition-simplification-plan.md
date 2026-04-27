# Blueprint Graph And Condition Simplification Plan

## Why This Plan Exists

The current blueprint system is trying to be a dependency graph, a conditional router, a loop expander, a binding resolver, an output publisher, and a runtime input selector all at once.

That is why authoring a new blueprint feels brittle. A blueprint author is not just describing a graph anymore. They are also manually encoding enough condition information for:

- graph construction
- canonical expansion
- producer graph creation
- planner pruning
- runner input filtering
- dry-run validation
- viewer parse projection
- output publication

The symptom is visible in the catalog:

- `catalog/producers/video/seedance-video-generator/seedance-video-generator.yaml` has 60 repeated `if:` entries.
- `catalog/blueprints/historical-documentary-assets-seedance/historical-documentary-assets-seedance.yaml` has 28 repeated `if:` entries.

The deeper problem is not repetition by itself. The deeper problem is that repeated edge conditions are the only way the current system can infer when a producer is active, which inputs are supposed to exist, which outputs are meaningful, and which dependencies should be scheduled.

That inference model is too fragile for production.

## What We Should Not Do

We should not replace this with a big new workflow DSL.

That would likely create another large abstraction with its own edge cases. It would also force a broad rewrite across the viewer, CLI, planner, runner, validation, and tests before we have proved the simpler semantics.

We should also not remove the graph.

The graph is the right core model for Renku because it gives us:

- dependency tracking
- producer scheduling
- concurrency by layer
- fan-in/fan-out
- reusable imported blueprints
- top-level output publication
- viewer graph display
- dry-run and planning diagnostics

The part to simplify is not "graph vs no graph". The part to simplify is where conditionality lives.

## The Core Diagnosis

Today, condition semantics are edge-centered.

That means a producer does not clearly have one activation rule. Instead, it becomes "active" because one or more incoming input edges are active, and those edges may not all share the same condition.

That creates several failure modes:

- A producer can run when only some required inputs survived condition filtering.
- A producer can produce outputs in a branch where nothing consumes them.
- A condition attached to an output route can accidentally become a condition on a producer input.
- The validator has to reconstruct producer activation from many separate edges.
- The planner and runner both need to evaluate input-level conditions.
- Canonical expansion has to preserve, merge, materialize, and propagate edge conditions through collapsed input and output connectors.

This is the "big ball of mud": the same semantic question, "should this producer instance exist in this branch?", is answered indirectly in several different places.

## Current Complexity Points

### 1. Seedance Video Generator Repeats The Same Branch Condition Everywhere

`catalog/producers/video/seedance-video-generator/seedance-video-generator.yaml` has four conceptual branches:

- Text
- Reference
- StartEnd
- MultiShot

The blueprint already declares those branches as conditions:

- `useText`
- `useReference`
- `useStartEnd`
- `useMultiShot`

But the branch condition is repeated on:

- each imported branch producer
- every input connection into the prompt compiler
- every input connection into the clip producer
- every prompt-to-clip connection
- every branch output route into `GeneratedVideo`

For example, the Text branch has to repeat `if: useText` on all of these concepts:

- `TextPromptCompiler` import
- `TextClipProducer` import
- `Workflow -> TextPromptCompiler.Workflow`
- `SceneIntent -> TextPromptCompiler.SceneIntent`
- `CameraIntent -> TextPromptCompiler.CameraIntent`
- `AudioIntent -> TextPromptCompiler.AudioIntent`
- `EnvironmentAndStyle -> TextPromptCompiler.EnvironmentAndStyle`
- `UseNativeAudio -> TextPromptCompiler.UseNativeAudio`
- `TextPromptCompiler.Prompt -> TextClipProducer.Prompt`
- `Duration -> TextClipProducer.Duration`
- `Resolution -> TextClipProducer.Resolution`
- `UseNativeAudio -> TextClipProducer.GenerateAudio`
- `TextClipProducer.GeneratedVideo -> GeneratedVideo`

That is not really "conditional data flow". It is one branch activation rule duplicated across normal data bindings.

### 2. Historical Documentary Blueprint Mixes Branch Routing With Data Binding

`catalog/blueprints/historical-documentary-assets-seedance/historical-documentary-assets-seedance.yaml` has real branch complexity:

- plain image generation
- historical character image references
- map generation
- motion text workflow
- motion reference workflow
- motion start/end workflow
- motion multi-shot workflow
- native audio option
- expert talking head option

Those are legitimate capabilities. The graph needs to express them.

The problem is that the conditions are placed mostly on individual connections. That makes the blueprint author responsible for keeping all required inputs of a branch coherent by hand.

The risky pattern is:

- one connection into a producer has `if: motionIsStartEnd`
- another connection into the same producer has `if: motionReferencesHistoricalCharacter`
- another connection is unconditional
- the engine later has to infer whether the producer should run and whether its required inputs are valid

That is exactly the kind of arrangement where adding one new workflow or one new optional asset exposes a planner or runner bug.

### 3. Canonical Expansion Does Too Many Jobs

`core/src/resolution/canonical-expander.ts` is currently 2160 lines.

Its public name suggests one responsibility: expand a graph into canonical instances.

In practice it does much more:

- resolve dimension sizes from count inputs and loops
- derive dimensions through inbound edges
- instantiate nodes
- instantiate edges
- align source and target dimensions
- special-case alignment when condition paths select dimensions
- infer fan-in grouping and ordering
- collapse input connector nodes
- resolve input aliases
- propagate conditions through collapsed inputs
- create `inputBindings`
- create `conditionalInputBindings`
- handle element-level array bindings such as `ReferenceImages[0]`
- propagate dynamic collection bindings
- collapse output connector nodes
- route multi-source outputs by condition
- normalize output-sourced conditions
- dedupe canonical edges

That is too much semantic work in one phase.

The most concerning part is that expansion is not only expanding structure. It is also preserving branch behavior for later runtime filtering.

The existence of `conditionalInputBindings` is the clearest sign of this. It means canonical expansion could not produce one simple binding for a producer input, so it carries a runtime list of possible sources and conditions into the producer graph and runner.

### 4. Producer Graph Creation Reconstructs Runtime Semantics

`core/src/resolution/producer-graph.ts` takes the expanded canonical graph and then rebuilds producer runtime context.

It derives:

- producer inputs
- produced artifacts
- dependency edges
- input bindings
- conditional input bindings
- fan-in descriptors
- input conditions
- artifact source metadata
- output definitions

The dependency graph should ideally be a straightforward projection of the canonical graph. Instead, it has to understand conditional input candidates and input-level conditions.

That is another sign that condition semantics are leaking across layers.

### 5. Planner And Runner Both Evaluate Input Conditions

The planner uses `inputConditions` for dirty propagation, inactive jobs, and dependency decisions.

The runner also evaluates `inputConditions` and `conditionalInputBindings` to filter a job's inputs right before execution.

That means branch decisions are split across scheduling time and execution time.

This is hard to reason about because a job can exist in the execution plan and then have some of its inputs filtered away later. For required inputs, that is exactly the wrong shape. If a producer is active, its required inputs should already be known and available.

### 6. Validation Has To Infer Intent After The Fact

`core/src/validation/blueprint-validator.ts` reconstructs activation-like behavior from edge conditions.

It converts edge conditions into a simple disjunctive normal form and asks questions like:

- does producer activation imply downstream consumption?
- do required inputs have coherent conditions?
- can a producer run in a branch where its output is unused?

Those are good validations, but the implementation is compensating for a missing first-class concept.

If producer activation were explicit, the validator would not need to infer it from scattered edge conditions.

### 7. Viewer And CLI Are Coupled To These Shapes

The viewer parse projection currently consumes the same graph and condition concepts to display nodes, edges, bindings, loop groups, and conditions.

The CLI planning flow uses the same resolution pipeline to produce executable plans.

So any simplification must keep the graph pipeline intact while changing the semantics gradually. A sudden replacement would break too many surfaces at once.

## The Target Model

The target model is still a graph.

The simplification is:

> A producer instance has one activation condition. If that producer instance is active, every required input binding for that producer must be available.

In plain language:

- Conditions decide whether a producer branch exists.
- Connections bind data inside an active branch.
- Required inputs are not conditionally optional.
- Optional inputs can be absent only if the producer contract says they are optional.
- Output routing can remain conditional, because selecting which branch publishes to a shared output is a real routing problem.
- Fan-in members can remain conditional, but only when the target input is explicitly a collection/fan-in input.

This keeps the capability but removes the worst ambiguity.

## New Semantic Rules

### Rule 1: Import Conditions Are Activation Conditions

An imported producer or imported composite blueprint can have an activation condition.

Example:

```yaml
imports:
  - name: TextBranch
    path: ./seedance-text-branch.yaml
    if: useText
```

Everything inside `TextBranch` inherits that activation condition.

The connections inside that branch should not need to repeat `if: useText` on every edge.

### Rule 2: Required Producer Inputs Must Be Unconditional Within The Active Producer

If a producer is active, required inputs must be bound.

Allowed:

```yaml
imports:
  - name: TextClipProducer
    path: ./seedance-text-clip/producer.yaml
    if: useText

connections:
  - from: Duration
    to: TextClipProducer.Duration
  - from: Resolution
    to: TextClipProducer.Resolution
  - from: PromptCompiler.Prompt
    to: TextClipProducer.Prompt
```

The `TextClipProducer` import carries `useText`. The bindings are just bindings.

Not allowed for a required scalar input:

```yaml
connections:
  - from: Duration
    to: TextClipProducer.Duration
    if: useText
  - from: PromptCompiler.Prompt
    to: TextClipProducer.Prompt
    if: someOtherCondition
```

That shape forces the engine to guess whether `TextClipProducer` is active under `useText`, `someOtherCondition`, or the union of both.

### Rule 3: Edge Conditions Are Narrow Exceptions

Edge-level conditions should be allowed only for cases where the edge itself is genuinely conditional:

- route-selected top-level outputs
- optional producer inputs where the producer contract allows absence
- fan-in collection members

They should not be the normal way to activate a producer branch.

### Rule 4: Branch-Specific Producers Beat Broad Conditional Producers

When conditions differ, split the producer/import.

This is already the safer blueprint-authoring rule in the condition audit skill. It should become a system invariant, not just advice.

For Seedance, the engine should prefer this graph shape:

- `SeedanceTextBranch`, active when `Workflow == Text`
- `SeedanceReferenceBranch`, active when `Workflow == Reference`
- `SeedanceStartEndBranch`, active when `Workflow == StartEnd && StartEndAnchorsArePlain == true`
- `SeedanceMultiShotBranch`, active when `Workflow == MultiShot`

Each branch is internally normal.

The parent only conditionally publishes one branch output to `GeneratedVideo`.

### Rule 5: Canonical IDs Stay Opaque

This simplification must not add any new logic that infers meaning from canonical ID strings.

Canonical IDs must keep flowing end to end, but if a phase needs producer name, namespace, indices, binding alias, or endpoint kind, that information should be carried as structured metadata.

Do not parse a canonical ID to recover data that should have been present in a data structure.

## Proposed Architecture

### Keep The Existing High-Level Pipeline

The broad pipeline should stay recognizable:

1. Load blueprint YAML.
2. Prepare blueprint tree for resolution.
3. Build graph.
4. Expand graph into canonical instances.
5. Create producer graph.
6. Plan execution layers.
7. Run jobs.
8. Publish outputs.

This keeps the viewer, CLI, and providers on familiar ground.

The work is to simplify what each stage is responsible for.

### Add First-Class Activation Metadata

Introduce explicit activation metadata on graph nodes and later on producer jobs.

Conceptually:

```ts
interface ProducerActivation {
  condition?: EdgeConditionDefinition;
  inheritedFromImports: string[];
}
```

This does not need to be the exact final type. The important part is that activation is attached to the producer/import node, not reconstructed from input edges.

Expected impact:

- validators can inspect producer activation directly
- planner can skip inactive producer instances directly
- runner should not need to filter required inputs later
- viewer can display branch activation once per producer/import

### Split Canonical Expansion Into Smaller Phases

`expandBlueprintGraph(...)` should become a coordinator over smaller, named transforms.

The target phases should be:

1. `resolveDimensionPlan`
   - read count inputs and loop definitions
   - derive dimension sizes
   - fail fast on missing or conflicting dimensions

2. `instantiateCanonicalNodes`
   - create canonical node instances
   - carry structured metadata needed later

3. `instantiateCanonicalEdges`
   - create canonical edge instances
   - align dimensions
   - do not collapse aliases

4. `resolveBindings`
   - collapse input connectors into explicit producer input bindings
   - produce one binding per required scalar input
   - reject ambiguous conditional alternatives for required scalar inputs

5. `resolveFanIn`
   - handle collection inputs and fan-in ordering
   - allow conditional members only for explicit fan-in inputs

6. `resolveOutputRoutes`
   - collapse output connectors
   - support conditional route-selected outputs
   - keep output routing separate from producer activation

7. `buildCanonicalBlueprint`
   - return the final canonical structure consumed by producer graph creation

This is not a rewrite of behavior in one jump. It is an extraction plan. The first pass can preserve behavior while moving code into clearer units. Then later passes can delete the conditional input machinery.

### Replace Runtime Conditional Inputs With Producer Activation

The target producer job context should move from this:

```ts
{
  inputBindings?: Record<string, string>;
  conditionalInputBindings?: Record<string, ConditionalInputBindingCandidate[]>;
  inputConditions?: Record<string, InputConditionInfo>;
}
```

Toward this:

```ts
{
  activationCondition?: EdgeConditionDefinition;
  inputBindings?: Record<string, string>;
  fanIn?: Record<string, FanInDescriptor>;
}
```

This is the main simplification.

The planner should decide whether a producer job exists for the current input values. Once a job exists, its required inputs should be normal canonical bindings.

The runner should execute jobs with resolved inputs. It should not need to decide which scalar source won a conditional binding contest.

## Catalog Migration Strategy

### Seedance First

Seedance is the best first target because it is branch-heavy but conceptually clean.

Current shape:

- one wrapper blueprint
- four branch conditions
- branch imports have `if`
- every internal connection repeats the same `if`
- shared `GeneratedVideo` output is route-selected

Target shape:

- keep `SeedanceVideoGenerator` as the public wrapper
- create four branch composite blueprints:
  - `seedance-text-branch.yaml`
  - `seedance-reference-branch.yaml`
  - `seedance-start-end-branch.yaml`
  - `seedance-multishot-branch.yaml`
- each branch imports its prompt compiler and clip producer
- each branch uses normal internal connections with no repeated branch `if`
- parent wrapper imports each branch with one activation condition
- parent wrapper routes each branch output into `GeneratedVideo` with one conditional output edge per branch

Expected result:

- branch conditions move from dozens of input edges to four branch imports plus four output routes
- each branch becomes independently testable
- required `Duration` and `Resolution` bindings become obvious and unconditional inside active branches
- future Seedance branch changes touch one branch file, not a giant conditional wrapper

### Historical Documentary Second

After Seedance is simplified, migrate `historical-documentary-assets-seedance`.

The goal is not to hide complexity. The goal is to make each optional workflow a named branch:

- plain image branch
- historical-character image branch
- map branch
- motion text branch
- motion reference branch
- motion start/end branch
- motion multi-shot branch
- expert talking-head branch

Each branch should have:

- one activation condition
- normal required input bindings
- explicit optional inputs only where the producer contract allows absence
- clear published outputs

The historical blueprint can then compose those branches instead of manually repeating edge conditions.

## Example: New Seedance Wrapper Shape

This is not meant to be final copy-paste YAML. It shows the intended shape.

```yaml
meta:
  name: Seedance Video Generator
  id: SeedanceVideoGenerator
  kind: blueprint
  version: 0.2.0

inputs:
  - name: Workflow
    type: string
    required: true
  - name: SceneIntent
    type: string
    required: true
  - name: CameraIntent
    type: string
    required: true
  - name: AudioIntent
    type: string
    required: true
  - name: EnvironmentAndStyle
    type: string
    required: true
  - name: EndFrameDescription
    type: string
    required: false
  - name: ShotBreakdown
    type: string
    required: false
  - name: ReferenceMediaInstructions
    type: string
    required: false
  - name: StartEndAnchorsArePlain
    type: boolean
    required: false
  - name: UseNativeAudio
    type: boolean
    required: true
  - name: ReferenceImage1
    type: image
    required: false
  - name: ReferenceImage2
    type: image
    required: false
  - name: StartImage
    type: image
    required: false
  - name: EndImage
    type: image
    required: false
  - name: Duration
    type: integer
    required: true
  - name: Resolution
    type: resolution
    required: true

outputs:
  - name: GeneratedVideo
    type: video

conditions:
  useText:
    when: Workflow
    is: Text
  useReference:
    when: Workflow
    is: Reference
  useStartEnd:
    all:
      - when: Workflow
        is: StartEnd
      - when: StartEndAnchorsArePlain
        is: true
  useMultiShot:
    when: Workflow
    is: MultiShot

imports:
  - name: TextBranch
    path: ./seedance-text-branch.yaml
    if: useText
  - name: ReferenceBranch
    path: ./seedance-reference-branch.yaml
    if: useReference
  - name: StartEndBranch
    path: ./seedance-start-end-branch.yaml
    if: useStartEnd
  - name: MultiShotBranch
    path: ./seedance-multishot-branch.yaml
    if: useMultiShot

connections:
  # Normal data bindings into branch inputs. The branch import carries activation.
  - from: SceneIntent
    to: TextBranch.SceneIntent
  - from: CameraIntent
    to: TextBranch.CameraIntent
  - from: AudioIntent
    to: TextBranch.AudioIntent
  - from: EnvironmentAndStyle
    to: TextBranch.EnvironmentAndStyle
  - from: UseNativeAudio
    to: TextBranch.UseNativeAudio
  - from: Duration
    to: TextBranch.Duration
  - from: Resolution
    to: TextBranch.Resolution

  - from: SceneIntent
    to: ReferenceBranch.SceneIntent
  - from: CameraIntent
    to: ReferenceBranch.CameraIntent
  - from: AudioIntent
    to: ReferenceBranch.AudioIntent
  - from: EnvironmentAndStyle
    to: ReferenceBranch.EnvironmentAndStyle
  - from: ReferenceMediaInstructions
    to: ReferenceBranch.ReferenceMediaInstructions
  - from: ReferenceImage1
    to: ReferenceBranch.ReferenceImage1
  - from: ReferenceImage2
    to: ReferenceBranch.ReferenceImage2
  - from: UseNativeAudio
    to: ReferenceBranch.UseNativeAudio
  - from: Duration
    to: ReferenceBranch.Duration
  - from: Resolution
    to: ReferenceBranch.Resolution

  - from: SceneIntent
    to: StartEndBranch.SceneIntent
  - from: CameraIntent
    to: StartEndBranch.CameraIntent
  - from: AudioIntent
    to: StartEndBranch.AudioIntent
  - from: EnvironmentAndStyle
    to: StartEndBranch.EnvironmentAndStyle
  - from: EndFrameDescription
    to: StartEndBranch.EndFrameDescription
  - from: StartImage
    to: StartEndBranch.StartImage
  - from: EndImage
    to: StartEndBranch.EndImage
  - from: UseNativeAudio
    to: StartEndBranch.UseNativeAudio
  - from: Duration
    to: StartEndBranch.Duration
  - from: Resolution
    to: StartEndBranch.Resolution

  - from: SceneIntent
    to: MultiShotBranch.SceneIntent
  - from: CameraIntent
    to: MultiShotBranch.CameraIntent
  - from: AudioIntent
    to: MultiShotBranch.AudioIntent
  - from: EnvironmentAndStyle
    to: MultiShotBranch.EnvironmentAndStyle
  - from: ShotBreakdown
    to: MultiShotBranch.ShotBreakdown
  - from: UseNativeAudio
    to: MultiShotBranch.UseNativeAudio
  - from: Duration
    to: MultiShotBranch.Duration
  - from: Resolution
    to: MultiShotBranch.Resolution

  # Output routing remains conditional because this is a real route selection.
  - from: TextBranch.GeneratedVideo
    to: GeneratedVideo
    if: useText
  - from: ReferenceBranch.GeneratedVideo
    to: GeneratedVideo
    if: useReference
  - from: StartEndBranch.GeneratedVideo
    to: GeneratedVideo
    if: useStartEnd
  - from: MultiShotBranch.GeneratedVideo
    to: GeneratedVideo
    if: useMultiShot
```

The important difference is not just fewer `if:` lines. The important difference is that the branch boundary is explicit.

## Impact On Viewer, CLI, Providers, And Tests

### Viewer

The viewer should keep working during the early phases because the graph remains the core representation.

Expected viewer changes:

- parse projection should display activation conditions on imported branches/producers
- condition display becomes simpler because repeated input-edge conditions disappear
- graph layout and layer visualization can continue to use producer dependency edges
- branch activation can be shown once per branch instead of repeated on every connection

Risk:

- viewer tests that assert exact condition payloads or exact edge condition counts will need updates

### CLI

The CLI should keep using the existing planning pipeline:

- prepare resolution context
- expand canonical graph
- create producer graph
- build execution plan

Expected CLI changes:

- validation errors become clearer when a required input is conditionally bound
- dry-run output should show inactive producers by activation condition rather than filtered input conditions
- no CLI flag model needs to change

Risk:

- tests that expect conditional input filtering behavior will need to be rewritten around activation pruning

### Providers

Providers should be the least affected.

Provider runtime should still receive:

- canonical input bindings
- resolved inputs by canonical ID
- fan-in descriptors where needed
- SDK mappings

Expected provider change:

- providers should see fewer ambiguous or missing-input scenarios because required inputs are validated before execution

Risk:

- any provider test that relied on runtime `conditionalInputBindings` should be updated to use normal resolved bindings or fan-in

### Planner And Runner

Planner changes are central:

- planner should evaluate producer activation before scheduling
- inactive jobs should be pruned before dependency layering
- required inputs for active jobs should be validated before the job enters a runnable layer

Runner changes should happen later:

- initially keep `inputConditions` support while migrating catalog/tests
- once migrated, remove runtime scalar conditional binding selection
- runner should not need to filter required scalar inputs

### Tests

This will require significant test changes, but not a one-shot rewrite.

Test migration should follow the implementation phases:

- add focused tests for activation metadata
- add validation tests for invalid conditional required inputs
- update Seedance tests after Seedance migration
- update historical blueprint tests after historical migration
- update planner/runner tests only after conditional runtime filtering is replaced

Final verification for implementation work must still be:

```bash
pnpm build
pnpm test
```

from the repository root.

## Iteration Plan

### Phase 1: Document And Lock The Semantics

Deliverables:

- this plan
- a short architecture note near the resolution code explaining:
  - graph remains the core model
  - activation belongs to producer/import nodes
  - required scalar input edges must not be branch selectors
  - edge conditions are limited exceptions

No runtime behavior changes yet.

### Phase 2: Add Activation Metadata Without Removing Old Behavior

Deliverables:

- add structured activation metadata during graph construction
- propagate import-level `if` / `conditions` as node activation metadata
- preserve existing edge condition behavior
- expose activation metadata in canonical/projection structures where needed
- add tests proving imported branch activation is visible without inspecting input edges

This phase should be behavior-preserving.

### Phase 3: Add Strict Validation Around Required Inputs

Deliverables:

- validation error when a required scalar input has an edge condition that differs from producer activation
- validation error when a required scalar input has multiple conditional alternatives
- validation error when a producer's activation cannot guarantee all required inputs
- allow edge conditions for optional inputs and fan-in members only when the target contract supports it

This phase turns the desired model into enforceable rules while old catalog files can still be migrated intentionally.

### Phase 4: Extract Canonical Expansion Subsystems

Deliverables:

- split `canonical-expander.ts` into focused modules
- keep public behavior stable
- avoid new canonical ID parsing or heuristic binding recovery
- introduce structured metadata where later phases currently need to recover endpoint facts

Suggested modules:

- `dimension-plan.ts`
- `node-instantiation.ts`
- `edge-instantiation.ts`
- `binding-resolution.ts`
- `fan-in-resolution.ts`
- `output-route-resolution.ts`
- `canonical-blueprint.ts`

This phase is about making the current engine understandable before deleting behavior.

### Phase 5: Migrate Seedance Catalog

Deliverables:

- split Seedance wrapper into branch composites
- remove repeated input-edge branch conditions
- keep only branch import activation and output route conditions
- validate every branch binds `Duration` and `Resolution`
- add focused tests for Text, Reference, StartEnd, and MultiShot workflows

This is the proving ground.

### Phase 6: Migrate Historical Documentary Catalog

Deliverables:

- split branch-specific image, motion, map, and talking-head paths into clearer composites or branch imports
- remove edge conditions used as producer activation
- keep conditional output routes and legitimate optional/fan-in conditions
- add dry-run coverage for representative branches

### Phase 7: Move Planner To Activation-First Scheduling

Deliverables:

- planner evaluates job activation conditions directly
- inactive producers are pruned before layer construction
- concurrency/layering continues to use producer dependency edges
- input conditions remain as compatibility only for unmigrated fixtures during this phase

Expected outcome:

- dependencies stay graph-based
- branches become graph-pruned, not runtime-filtered
- layers become easier to reason about because active jobs have complete required inputs

### Phase 8: Remove Scalar Conditional Input Runtime Selection

Deliverables:

- remove or sharply limit `conditionalInputBindings`
- remove runner selection of scalar conditional input candidates
- keep fan-in conditional member handling only where explicitly supported
- update planner, runner, dry-run, and provider tests

This is the phase where the system gets materially simpler.

## Success Criteria

This effort is successful when:

- a branch condition is authored once at the import/producer boundary
- required producer inputs are normal bindings inside an active branch
- Seedance no longer repeats the same `if` on every internal connection
- canonical expansion is split into readable phases
- planner decides active jobs before execution
- runner no longer chooses between scalar conditional input candidates
- viewer and CLI still operate on the same graph pipeline
- adding a new blueprint branch requires creating a branch/import and wiring normal bindings, not debugging planner edge cases

## Main Risks

### Risk: Output Routing Still Needs Conditions

Output routing is a real conditional problem. A shared output such as `GeneratedVideo` may have multiple possible branch sources.

Mitigation:

- keep conditional output routes as a first-class exception
- do not treat route selection as producer activation

### Risk: Fan-In Still Needs Sparse Membership

Some workflows legitimately collect whichever branch members exist.

Mitigation:

- keep conditional members for explicit fan-in inputs
- reject conditional scalar alternatives for required scalar inputs

### Risk: Tests Are Coupled To Current Internals

Many tests currently assert `inputConditions`, `conditionalInputBindings`, and edge-level condition behavior.

Mitigation:

- do not rewrite all tests at once
- migrate tests phase by phase
- keep compatibility fields temporarily while introducing activation metadata

### Risk: Canonical Expansion Refactor Becomes Too Large

`canonical-expander.ts` is dense and central. A broad behavioral rewrite there would be dangerous.

Mitigation:

- first extract modules without changing semantics
- add tests around each extracted phase
- only remove conditional input behavior after Seedance and historical migrations prove the simpler model

## Bottom Line

The system can be salvaged, but not by adding more syntax.

The graph should stay. The graph is the good part.

The fix is to stop making edge conditions carry producer activation semantics. Activation should be explicit at the producer/import boundary. Canonical expansion should expand and bind the graph, not preserve a pile of runtime scalar binding alternatives. Planner should prune inactive producer instances before execution. Runner should run active jobs with complete required inputs.

That is the path to keeping Renku's current capabilities while making new blueprints possible to author without tripping over engine edge cases every time.
