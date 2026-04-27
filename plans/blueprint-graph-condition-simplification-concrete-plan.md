# Concrete Blueprint Graph Condition Simplification Plan

This document turns the rough design in
[`plans/blueprint-graph-condition-simplification-plan.md`](./blueprint-graph-condition-simplification-plan.md)
into an implementation plan.

The original document has the right diagnosis: condition behavior is currently
encoded on too many individual edges, which makes producer activation hard to
reason about. This plan keeps that direction, but makes the migration more
concrete and corrects one important assumption:

> Some activation conditions depend on artifacts produced earlier in the same
> run. The planner can pre-prune only when condition values are already known.
> The runner still needs a job-level activation gate for conditions that become
> known during execution. The thing we want to remove is required scalar input
> filtering, not all runtime condition evaluation.

## Current State Findings

### Import Conditions Already Exist

The YAML model already supports `if` / `conditions` on imports:

- `BlueprintImportDefinition.if`
- `BlueprintImportDefinition.conditions`
- `BlueprintTreeNode.importConditions`
- `loadYamlBlueprintTree(...)` resolves an import `if` into `importConditions`

So the first task is not "add import conditions". The first task is to stop
flattening those import conditions into every edge as the only durable runtime
representation.

Today `core/src/resolution/canonical-graph.ts` carries import conditions forward
by combining them into edge conditions inside `collectGraphEdges(...)`.

That compatibility behavior is useful during migration, but it is also the
source of the current ambiguity: downstream code can no longer tell whether a
condition came from:

- a producer/import activation rule,
- an authored connection condition,
- an output route condition,
- a propagated input connector condition.

The concrete plan starts by preserving condition provenance.

### Canonical Nodes Do Not Carry Activation

`CanonicalNodeInstance` currently contains structural data such as:

- canonical id,
- node type,
- namespace path,
- producer alias,
- indices,
- input/output/producer definitions.

It does not carry activation metadata. As a result, `createProducerGraph(...)`
reconstructs runtime behavior from edge conditions and produces:

- `inputConditions`
- `conditionalInputBindings`
- fan-in descriptors

Those fields then drive both planner decisions and runner input filtering.

### Validation Is Compensating For Missing Activation

`core/src/validation/blueprint-validator.ts` already has useful condition
checks, especially around required input coherence and unused conditional
producer outputs. However, those checks infer activation from incoming edges.

That is the right validation intent, but the wrong source of truth.

After this migration, validation should inspect explicit producer activation
metadata and then validate authored edge conditions as narrow exceptions.

### Catalog Source Of Truth

The source of truth is `catalog`.

Ignore `cli/catalog` while doing this work. It is a generated copy produced by
`pnpm bundle:catalog`, and it can be stale when the bundle step has not been
run.

## Simplification Goal

The goal is not to add a cleaner metadata layer on top of the current behavior.
The goal is to delete duplicated decision-making.

Right now the engine answers the same questions in several places:

| Question | Current duplicate owners | Target owner | Logic to remove |
| --- | --- | --- | --- |
| Should this producer run? | import condition propagation, edge conditions, validation inference, producer graph `inputConditions`, planner inactive-job scan, runner "all conditional inputs unsatisfied" branch | activation resolver, then planner/runner consume `job.context.activation` | activation inferred from incoming required input edges; job skipping based on conditional scalar inputs |
| Which source binds this required scalar input? | `collapseInputNodes`, `conditionalInputBindings`, `createProducerGraph`, runner candidate selection | binding resolver | `conditionalInputBindings`; runner choosing one scalar candidate at execution time |
| Which sparse fan-in members are present? | fan-in builder plus generic `inputConditions` maps plus planner/runner filtering | fan-in resolver | fan-in member filtering through generic input conditions |
| Which branch publishes a shared output? | output collapse, root output binding collection, planner condition-artifact collection | output route resolver | output route handling mixed into scalar input binding logic |
| How does validation know intent? | validator reconstructs activation from authored edge conditions | prepared graph validation over activation, bindings, fan-in, and routes | DNF reconstruction as the main source of producer activation truth |

This is the simplification: each semantic question gets one owner. Other layers
consume the owner’s output and stop rediscovering the same answer.

## Target Ownership Boundaries

The final pipeline should have these responsibilities:

1. **Parser**
   - Reads YAML.
   - Resolves named `if:` references into condition definitions.
   - Does not decide activation, bindings, fan-in, or output routing.

2. **Graph Builder**
   - Builds raw graph nodes and authored edges.
   - Preserves condition provenance:
     - import activation,
     - authored edge condition,
     - output route condition.
   - Does not flatten activation into every edge as the primary model.

3. **Activation Resolver**
   - Computes one activation condition per producer/import instance.
   - Combines nested import activation structurally.
   - Produces explicit activation metadata for canonical producer nodes.

4. **Binding Resolver**
   - Resolves scalar producer input bindings.
   - Enforces exactly one source for every required scalar input of an active
     producer.
   - Allows conditional scalar bindings only for optional inputs.
   - Does not know about job skipping or output publication.

5. **Fan-In Resolver**
   - Owns collection membership, grouping, ordering, and member-level conditions.
   - Does not encode fan-in member conditions in generic scalar `inputConditions`.

6. **Output Route Resolver**
   - Owns multi-source public output routes.
   - Requires explicit route conditions when more than one source can publish to
     the same output connector.
   - Does not create producer activation or scalar input bindings.

7. **Producer Graph Projection**
   - Becomes a projection step, not a semantic reconstruction step.
   - Copies activation, bindings, fan-in, routes, schemas, and provider options
     into job context.
   - Does not infer activation from input edges.

8. **Planner**
   - Uses activation metadata for known pre-pruning.
   - Keeps unknown generated-artifact conditions as job-level gates.
   - Builds dependency layers from resolved artifact dependencies.
   - Does not decide scalar input candidates.

9. **Runner**
   - Evaluates whole-job activation when the job is about to run.
   - Evaluates optional input and fan-in member conditions.
   - Never removes required scalar inputs from an active job.
   - Never chooses between multiple required scalar sources.

10. **Validation**
    - Validates the prepared graph after activation/binding/fan-in/route
      resolution.
    - Checks invariants against explicit structures.
    - Uses condition implication only to validate authored compatibility, not to
      reconstruct the graph’s meaning.

This ownership split is the main architectural simplification. The phases below
exist to reach it without breaking every catalog blueprint at once.

## Deletion Targets

The work is not complete until these pieces are gone or reduced to narrow
compatibility tests:

- `ProducerJobContext.conditionalInputBindings`
- runner scalar conditional candidate selection in `applyConditionalInputFiltering`
- planner inactive-job logic that treats "no conditional inputs satisfied" as
  producer activation
- generic `inputConditions` usage for required scalar inputs
- validation paths that infer producer activation primarily from incoming edge
  conditions
- canonical expansion paths that propagate import activation by copying it onto
  every ordinary internal edge

Some condition evaluation stays:

- job activation gates,
- optional scalar input gates,
- fan-in member gates,
- output route gates.

The simplification is that those four concepts are separate structures instead
of one overloaded edge/input-condition mechanism.

## Temporary Complexity Budget

Some phases intentionally run old and new structures side by side. That is only
acceptable as migration scaffolding.

Every compatibility field introduced or preserved in this plan must have a
named removal phase:

- legacy combined edge `conditions` as the primary semantic source: removed from
  new callers by Phase 10,
- `conditionalInputBindings`: removed by Phase 9,
- required scalar `inputConditions`: removed or narrowed by Phase 9,
- activation inference from incoming edges: removed by Phase 10.

If a PR adds a new compatibility path without a deletion target, it is making
the system worse, not simpler.

## Target Semantics

The target is still a graph. The change is where conditional meaning lives.

### Producer Activation

Every producer instance may have one activation condition:

```ts
interface ProducerActivation {
  condition?: EdgeConditionDefinition;
  indices: Record<string, number>;
  inheritedFrom: Array<{
    namespacePath: string[];
    importName: string;
  }>;
}
```

This is illustrative, not final API. The important properties are:

- activation is structured metadata,
- it is attached to graph/canonical/producer job nodes,
- it does not require parsing canonical ids,
- it records provenance for diagnostics.

If a producer is active, every required scalar input must be bound and available.

### Edge Conditions

Edge-level conditions remain valid only for real edge-level behavior:

- route-selected top-level outputs,
- optional scalar inputs where the producer contract allows absence,
- fan-in collection members,
- temporary compatibility while catalog files are being migrated.

They should not be the normal way to activate a producer.

### Runtime Conditions

Runtime condition evaluation does not disappear. It changes shape.

The runner may still evaluate:

- job activation conditions,
- optional input conditions,
- fan-in member conditions,
- output publication conditions.

The runner should no longer choose between multiple scalar sources for a
required producer input. That choice must be resolved by the graph before the job
is runnable.

## Work Plan

## Phase 0 - Baseline Inventory

Goal: make the current condition surface measurable before changing behavior.

Deliverables:

- Add a small inventory helper or focused test utility that reports, per
  blueprint:
  - import conditions,
  - authored connection conditions,
  - propagated edge conditions,
  - `conditionalInputBindings`,
  - `inputConditions`,
  - fan-in members with conditions,
  - route-selected output bindings.
- Run the inventory against:
  - root Seedance wrapper,
  - root historical documentary Seedance blueprint,
  - conditional routing test fixtures.

Acceptance criteria:

- We can point to exactly which files still depend on scalar edge conditions.
- The inventory separates activation-like conditions, optional-input conditions,
  fan-in conditions, and output-route conditions.
- No runtime behavior changes yet.

Recommended test command during this phase:

```bash
cd core && pnpm vitest run --pool=threads --poolOptions.threads.singleThread
```

Final verification for an implementation PR remains root-level:

```bash
pnpm build
pnpm test
```

## Phase 1 - Preserve Condition Provenance And Stop New Flattening

Goal: split "why this condition exists" before changing semantics.

Current code mostly has one combined `conditions` field. Replace that internally
with provenance-aware fields while still producing the legacy combined field.

Suggested graph edge shape:

```ts
interface BlueprintGraphEdge {
  from: BlueprintGraphEdgeEndpoint;
  to: BlueprintGraphEdgeEndpoint;
  activationConditions?: EdgeConditionDefinition;
  endpointConditions?: EdgeConditionDefinition;
  authoredEdgeConditions?: EdgeConditionDefinition;
  conditions?: EdgeConditionDefinition; // compatibility: combined legacy view
}
```

Suggested node shape:

```ts
interface BlueprintGraphNode {
  // existing fields...
  activation?: ProducerActivation;
}
```

Implementation targets:

- `core/src/types.ts`
- `core/src/resolution/canonical-graph.ts`
- `core/src/resolution/canonical-expander.ts`
- `core/src/resolution/viewer-parse-projection.ts`
- tests in `core/src/resolution/*.test.ts`

Important detail:

- Keep `conditions` as the combined legacy field during this phase.
- Add tests proving import activation is visible on producer nodes even when
  ordinary child input edges are unguarded.
- New code should read the provenance fields first. The legacy combined
  `conditions` field exists only for old callers.
- Do not infer anything from canonical id strings. If producer/import ancestry is
  needed, carry `namespacePath`, `importName`, or other structured metadata.

Acceptance criteria:

- Existing tests still pass.
- Import activation can be inspected directly on graph/canonical producer nodes.
- Edge conditions can be classified by provenance in tests.
- There is a visible TODO/deprecation boundary around the legacy combined
  `conditions` field.

## Phase 2 - Build The Four Resolved Semantic Structures

Goal: create the structures that replace the overloaded input-condition model.

This is the first real simplification phase. It introduces the four structures
that later phases will make authoritative:

```ts
interface ResolvedProducerActivation {
  condition?: EdgeConditionDefinition;
  indices: Record<string, number>;
}

interface ResolvedScalarBinding {
  inputId: string;
  sourceId: string;
  optionalCondition?: {
    condition: EdgeConditionDefinition;
    indices: Record<string, number>;
  };
}

interface ResolvedFanInDescriptor {
  groupBy: string;
  orderBy?: string;
  members: Array<{
    id: Id;
    group: number;
    order?: number;
    condition?: {
      condition: EdgeConditionDefinition;
      indices: Record<string, number>;
    };
  }>;
}

interface ResolvedOutputRoute {
  outputId: Id;
  sourceId: Id;
  condition?: EdgeConditionDefinition;
  indices?: Record<string, number>;
}
```

Implementation targets:

- split or stage code in `core/src/resolution/canonical-expander.ts`
- `core/src/resolution/producer-graph.ts`
- `core/src/types.ts`
- tests in `core/src/resolution/*.test.ts`

Behavior in this phase:

- Keep producing legacy fields for existing callers.
- Start producing the new structures in parallel.
- Do not add fallback paths from one structure to another.

Acceptance criteria:

- A canonical blueprint can be inspected as:
  - producer activations,
  - scalar bindings,
  - fan-in descriptors,
  - output routes.
- Producer graph creation can copy these structures without reconstructing them
  from generic edge conditions.
- Tests prove the same condition is not required to be rediscovered by
  `producer-graph.ts`.

## Phase 3 - Add Producer Job Activation Metadata

Goal: carry activation into the producer graph and execution plan without using
it to prune yet.

Add activation metadata to `ProducerJobContext`:

```ts
interface ProducerJobContext {
  // existing fields...
  activation?: {
    condition?: EdgeConditionDefinition;
    indices: Record<string, number>;
    inheritedFrom: ProducerActivation['inheritedFrom'];
  };
}
```

Implementation targets:

- `core/src/types.ts`
- `core/src/resolution/producer-graph.ts`
- `core/src/orchestration/planning-service.ts`
- `core/src/planning/planner.ts`
- `core/src/validation/blueprint-dry-run-validator.ts`
- viewer parse projection types if the UI should display activation.

Behavior in this phase:

- No pruning changes.
- No runner filtering changes.
- `inputConditions` and `conditionalInputBindings` remain intact.
- Activation is emitted as diagnostic metadata only.

Acceptance criteria:

- Producer graph nodes include activation metadata for import-gated producers.
- Existing plan output remains compatible.
- Tests cover activation metadata for:
  - root input conditions,
  - generated artifact conditions,
  - loop-indexed conditions.
- `createProducerGraph(...)` reads resolved activation metadata instead of
  deriving activation-like behavior from `inputConditions`.

## Phase 4 - Make Validation Use The Resolved Structures

Goal: make validation validate explicit structures, not infer intent from edge
conditions.

Add validation checks that use activation metadata instead of reconstructing
activation from incoming edges.

Validation rules:

- A required scalar input must have exactly one resolved source inside the
  active producer branch.
- A required scalar input must not depend on an authored edge condition, unless
  compatibility mode explicitly allows a redundant condition equal to the
  producer activation.
- Multiple conditional scalar alternatives for the same required input are
  invalid.
- Edge conditions on optional scalar inputs are allowed only when the target
  producer input is declared `required: false`.
- Edge conditions on fan-in members are allowed only when the target input is
  declared `fanIn: true`.
- Multi-source public outputs must keep explicit route conditions.

Suggested new error codes:

- `REQUIRED_INPUT_CONDITION_UNSUPPORTED`
- `REQUIRED_INPUT_MULTIPLE_CONDITIONAL_SOURCES`
- `EDGE_CONDITION_TARGET_NOT_OPTIONAL_OR_FANIN`
- `MISSING_PRODUCER_ACTIVATION_FOR_CONDITIONAL_INPUTS`

Compatibility mode:

- Initially report these as warnings or opt-in strict errors, because current
  catalog files still contain known legacy patterns.
- Add a strict option to prepared validation so migrated blueprints can prove
  they obey the new model.
- Once Seedance and historical documentary are migrated, make strict behavior the
  default for catalog validation.

Implementation targets:

- `core/src/validation/blueprint-validator.ts`
- `core/src/validation/prepared-blueprint-validator.ts`
- `core/src/validation/*.test.ts`
- CLI `blueprints validate` output if strict mode is exposed there.

Acceptance criteria:

- Legacy catalog can still be validated in compatibility mode.
- Migrated fixtures can opt into strict mode and fail on required scalar edge
  conditions.
- Error messages name the producer input, the authored connection, and the
  expected fix.
- Required-input validation reads resolved scalar bindings.
- Unused-producer validation reads resolved activation and resolved output
  routes.
- The old edge-DNF activation inference remains only as compatibility support
  until the catalog is migrated.

## Phase 5 - Job-Level Activation Evaluation

Goal: evaluate whole-job activation without filtering required scalar inputs.

This phase is the corrected version of "planner decides active jobs before
execution."

Planner behavior:

- If activation condition values are already known at planning time, the planner
  can pre-prune inactive jobs.
- If activation condition values are unknown because they come from artifacts
  that will be produced earlier in the same run, the planner keeps the job in the
  plan as activation-gated.
- Layering still includes activation-gated jobs so dependency order remains
  stable.

Runner behavior:

- Before executing a job, evaluate `job.context.activation`.
- If the condition is false, skip the whole job with a clear diagnostic:
  `activation_condition_not_met`.
- If the condition is unknown at the point the job is about to run, fail fast
  with a numbered Renku error instead of guessing.
- Do not filter required scalar inputs based on activation. An active job should
  already have complete required inputs.

Important stage-by-stage rule:

- `--up` and `--up-to-layer` must not fail because a later activation-gated job
  has unresolved condition inputs. Only jobs in the scheduled scope should be
  activation-checked.

Implementation targets:

- `core/src/planning/planner.ts`
- `core/src/runner.ts`
- `core/src/condition-evaluator.ts`
- `core/src/validation/blueprint-dry-run-validator.ts`
- `core/src/orchestration/planning-service.ts`

Acceptance criteria:

- A job whose activation is false is skipped as a whole job.
- Required scalar inputs are not removed from a job during activation handling.
- Activation conditions that depend on upstream generated artifacts work after
  those artifacts are available.
- Existing `--up` / `--up-to-layer` behavior is preserved.
- The runner skip path no longer uses "all conditional inputs unsatisfied" as a
  proxy for producer activation when `job.context.activation` exists.

## Phase 6 - Extract Canonical Expansion Into Named Modules

Goal: make the central graph transform understandable before deleting legacy
conditional-input behavior.

This should be a behavior-preserving extraction. Do not combine it with catalog
migration or semantic changes.

Suggested module split:

- `core/src/resolution/dimension-plan.ts`
  - dimension size resolution,
  - loop count handling,
  - dimension lineage.
- `core/src/resolution/node-instantiation.ts`
  - canonical node instance creation,
  - activation metadata materialization.
- `core/src/resolution/edge-instantiation.ts`
  - edge instance expansion,
  - dimension alignment,
  - condition index materialization.
- `core/src/resolution/input-binding-resolution.ts`
  - input connector collapse,
  - scalar binding resolution,
  - legacy conditional scalar candidate compatibility.
- `core/src/resolution/fan-in-resolution.ts`
  - fan-in member construction,
  - group/order inference.
- `core/src/resolution/output-route-resolution.ts`
  - output connector collapse,
  - conditional output route binding.
- `core/src/resolution/canonical-blueprint.ts`
  - final assembly and normalization.

Acceptance criteria:

- Public `expandBlueprintGraph(...)` still exists.
- Existing tests pass after each extraction slice.
- No new canonical id parsing is introduced.
- Each extracted module has focused tests for the behavior it owns.
- The extracted modules align with the target ownership boundaries above.
- `producer-graph.ts`, planner, and runner do not need to know how input
  connector collapse works.

## Phase 7 - Migrate Seedance First

Goal: prove the new model on the smallest high-value branch-heavy catalog item.

Use root `catalog/producers/video/seedance-video-generator/seedance-video-generator.yaml`
as the first target.

Migration shape:

- Keep the public `SeedanceVideoGenerator` wrapper.
- Keep the existing branch imports:
  - `TextPromptCompiler`
  - `TextClipProducer`
  - `ReferencePromptCompiler`
  - `ReferenceClipProducer`
  - `StartEndPromptCompiler`
  - `StartEndClipProducer`
  - `MultiShotPromptCompiler`
  - `MultiShotClipProducer`
- Keep `if:` on those imports as producer activation.
- Remove redundant `if:` from ordinary data-binding connections.
- Keep explicit `if:` on the four `GeneratedVideo` output routes.
- Ensure every video/audio producer still declares and receives required
  `Duration`.
- Ensure every branch binds `Resolution` explicitly.

Do not create four new branch composite files unless the existing prompt+clip
pair imports are still too noisy after redundant edge conditions are removed.
The minimum useful migration is smaller and easier to validate.

Tests to add or update:

- Text workflow produces only text branch jobs.
- Reference workflow produces only reference branch jobs.
- StartEnd workflow activates only when `StartEndAnchorsArePlain` is true.
- MultiShot workflow produces only multishot branch jobs.
- Public `GeneratedVideo` route remains explicitly conditional.
- Strict validation rejects reintroducing required scalar edge conditions.

Acceptance criteria:

- Seedance branch conditions are authored once per branch import plus once per
  output route.
- No required scalar Seedance input relies on authored edge conditions.
- Strict activation validation passes for Seedance.
- Seedance plans do not require `conditionalInputBindings` for required scalar
  inputs.

## Phase 8 - Migrate Historical Documentary Seedance

Goal: move the real complex blueprint to named activation branches.

Target file:

- `catalog/blueprints/historical-documentary-assets-seedance/historical-documentary-assets-seedance.yaml`

First audit questions:

- `motionEnabled` exists as a condition but is not currently the main activation
  guard for `SeedanceVideoGenerator`. Decide whether motion generation should be
  skipped entirely when `MotionPlan.Enabled` is false.
- Start/end branches must use the stricter plain-anchor condition, not just
  `Workflow == StartEnd`, wherever the branch requires plain generated anchors.
- Reference motion should use reference-specific prompt and input wiring, not a
  broad generic motion branch.

Migration shape:

- Add import activation conditions to optional producers:
  - `SegmentPlainImageProducer`: `imageUsesPlainGenerationOrStartEndAnchor`
  - `HistoricalReferenceStillPromptProducer`: `imageReferencesHistoricalCharacter`
  - `SegmentReferenceImageProducer`: `imageReferencesHistoricalCharacter`
  - `MapImageProducer`: `hasMap`
  - `ExpertTalkingHeadAudioProducer`: `hasExpertTalkingHead`
  - `ExpertTalkingHeadVideoProducer`: `hasExpertTalkingHead`
  - `SeedanceVideoGenerator`: the explicit motion activation rule chosen by the
    audit above.
- Remove redundant `if:` from required scalar data bindings inside those active
  branches.
- Keep conditional output publication routes where outputs are sparse.
- Keep condition-bearing fan-in members only on declared fan-in inputs.

Potential follow-up extraction:

- If the historical blueprint remains hard to read after import activation, split
  branches into local composite files:
  - plain still branch,
  - historical reference still branch,
  - map branch,
  - Seedance motion branch,
  - expert talking-head branch.

Tests to add or update:

- Dry-run branch coverage for:
  - plain stills,
  - historical reference stills,
  - maps,
  - Seedance text/reference/start-end/multishot motion,
  - expert talking head.
- Stage-by-stage execution with activation-gated later jobs.
- No missing required inputs for active branches.
- No active producer whose outputs are unused, unless explicitly published.

Acceptance criteria:

- Strict activation validation passes for the historical Seedance blueprint.
- Dry-run condition coverage proves the fixed-index StartEnd anchor paths are
  exercised.
- Runtime skips inactive jobs as whole jobs, not by stripping required inputs.
- Historical documentary plans do not require `conditionalInputBindings` for
  required scalar inputs.

## Phase 9 - Delete Scalar Conditional Binding Machinery

Goal: remove the old runtime shape after the catalog no longer needs it.

Current fields to retire or sharply limit:

- `conditionalInputBindings`
- required-input uses of `inputConditions`

New target shapes:

```ts
interface OptionalInputCondition {
  inputId: string;
  condition: EdgeConditionDefinition;
  indices: Record<string, number>;
}

interface FanInMember {
  id: Id;
  group: number;
  order?: number;
  condition?: {
    condition: EdgeConditionDefinition;
    indices: Record<string, number>;
  };
}
```

Rules:

- Required scalar inputs must be in `inputBindings`.
- Optional scalar inputs can have an optional-input condition.
- Fan-in members carry their own member condition.
- No producer job should contain multiple conditional scalar source candidates
  for the same required input.

Implementation targets:

- `core/src/resolution/input-binding-resolution.ts`
- `core/src/resolution/fan-in-resolution.ts`
- `core/src/resolution/producer-graph.ts`
- `core/src/planning/planner.ts`
- `core/src/runner.ts`
- provider SDK runtime tests that read resolved inputs.

Acceptance criteria:

- `conditionalInputBindings` is removed from normal producer job context.
- Runner no longer selects among scalar candidates.
- Optional input filtering and fan-in member filtering still work.
- Required missing inputs fail before provider SDK calls.
- `evaluateInputConditions(...)` is no longer used for required scalar input
  availability.
- `inputConditions` is either removed or narrowed to optional scalar inputs only.

## Phase 10 - Delete Legacy Edge-Condition Activation Inference

Goal: remove the second major source of duplicated logic: validation and planning
that rediscover activation from incoming edges.

Implementation targets:

- `core/src/validation/blueprint-validator.ts`
- `core/src/planning/planner.ts`
- `core/src/orchestration/planning-service.ts`
- `core/src/validation/blueprint-dry-run-validator.ts`

Acceptance criteria:

- Producer activation is read from resolved activation metadata.
- Required input availability is read from resolved scalar bindings.
- Fan-in availability is read from resolved fan-in descriptors.
- Output publication is read from resolved output routes.
- DNF condition implication helpers remain only for comparing explicit
  conditions, not for building the graph meaning.

## Phase 11 - Make Strict Semantics The Default

Goal: turn the migration model into the normal model.

Deliverables:

- Prepared validation uses strict activation semantics by default.
- CLI validation reports strict activation errors as normal errors.
- Catalog conformance tests run strict mode.
- Compatibility-only tests are explicitly named and isolated.
- Developer docs explain:
  - activation belongs on imports/producers,
  - required inputs are unconditional inside active branches,
  - edge conditions are only for output routes, optional inputs, and fan-in
    members.

Acceptance criteria:

- Root catalog passes strict validation.
- No production path relies on required scalar conditional input selection.
- Running `pnpm bundle:catalog` after the root catalog migration produces the
  CLI copy.

## Test Strategy

Use package-level tests while developing, but the final verification for an
implementation PR must be:

```bash
pnpm build
pnpm test
```

from the repository root.

Focused test areas:

- `core/src/resolution/canonical-expander.test.ts`
  - activation propagation,
  - condition provenance,
  - strict scalar binding rejection,
  - fan-in conditional members.
- `core/src/resolution/producer-graph.test.ts`
  - producer job activation metadata,
  - no required scalar conditional candidates in strict mode.
- `core/src/validation/blueprint-validator.test.ts`
  - required input coherence,
  - optional input exceptions,
  - fan-in exceptions,
  - route-selected output exceptions.
- `core/src/planning/planner.test.ts`
  - known activation pruning,
  - unknown activation kept as gated,
  - dependency layering remains stable.
- `core/src/runner.test.ts`
  - whole-job activation skip,
  - unknown activation fail-fast,
  - optional/fan-in filtering still works,
  - required inputs are not silently dropped.
- CLI end-to-end conditional fixtures
  - branch execution,
  - sparse fan-in,
  - dry-run coverage,
  - stage-by-stage execution.

## Non-Goals

This effort should not:

- replace the graph with a new workflow DSL,
- infer meaning from canonical id strings,
- add default values to keep missing bindings alive,
- guess condition equivalence from names or aliases,
- silently fall back from strict activation to legacy edge behavior,
- rewrite providers unless their tests expose a real resolved-input contract
  change.

## Suggested PR Breakdown

1. Inventory root `catalog` condition usage and classify each condition by
   activation, optional input, fan-in member, or output route.
2. Add condition provenance and mark the legacy combined `conditions` field as
   compatibility-only for new code.
3. Produce the four resolved structures: activation, scalar bindings, fan-in,
   and output routes.
4. Make producer graph creation copy resolved structures instead of
   reconstructing condition behavior.
5. Make validation read resolved structures and add strict mode.
6. Add job-level activation evaluation in planner/runner.
7. Extract canonical expansion into ownership-aligned modules.
8. Migrate Seedance in root `catalog`.
9. Migrate historical documentary Seedance in root `catalog`.
10. Delete scalar `conditionalInputBindings` and required scalar
    `inputConditions`.
11. Delete legacy activation inference from incoming edges.
12. Make strict semantics the default and run `pnpm bundle:catalog`.

This order keeps risky runtime changes behind explicit structures and
validation, but the end state is intentionally smaller: producer activation,
required scalar binding, fan-in membership, and output routing each have one
owner, and the runner no longer patches up ambiguous graph meaning at execution
time.

## Completion Checklist

Use this checklist at the end of the implementation to verify that the work
actually simplified the system rather than only moving complexity around.

### Inventory And Scope

- [ ] Root `catalog` condition usage has been inventoried.
- [ ] Every inventoried condition is classified as one of:
  - producer/import activation,
  - optional scalar input gate,
  - fan-in member gate,
  - output route gate,
  - legacy pattern that must be removed.
- [ ] `cli/catalog` has not been hand-edited during the migration.
- [ ] Any needed `cli/catalog` update is generated only by `pnpm bundle:catalog`.

### Ownership Boundaries

- [ ] Parser only parses YAML and resolves named conditions.
- [ ] Graph builder preserves condition provenance instead of flattening every
  condition into one generic edge condition.
- [ ] Activation resolver is the single owner of producer/job activation.
- [ ] Binding resolver is the single owner of scalar input source selection.
- [ ] Fan-in resolver is the single owner of sparse collection membership,
  grouping, ordering, and member gates.
- [ ] Output route resolver is the single owner of shared output publication
  routes.
- [ ] Producer graph creation is a projection of resolved structures, not a
  place that reconstructs semantics.
- [ ] Planner consumes activation and dependency metadata without choosing
  scalar input candidates.
- [ ] Runner evaluates whole-job activation and never removes required scalar
  inputs from an active job.
- [ ] Validation checks explicit resolved structures instead of reconstructing
  producer activation from incoming edges.

### Data Structures

- [ ] Canonical graph exposes resolved producer activations.
- [ ] Canonical graph exposes resolved scalar bindings.
- [ ] Canonical graph exposes resolved fan-in descriptors with member-level
  conditions where needed.
- [ ] Canonical graph exposes resolved output routes.
- [ ] `ProducerJobContext` carries job activation metadata.
- [ ] Optional scalar input conditions are represented separately from required
  scalar bindings.
- [ ] Fan-in member conditions are represented on fan-in members, not through a
  generic required-input condition map.
- [ ] Output route conditions remain explicit route metadata.

### Deleted Or Narrowed Legacy Logic

- [ ] `conditionalInputBindings` is removed from normal producer job context.
- [ ] Runner no longer selects one required scalar source from conditional
  candidates.
- [ ] Runner no longer uses "all conditional inputs unsatisfied" as the primary
  producer activation test.
- [ ] Planner no longer infers producer activation from required scalar
  `inputConditions`.
- [ ] Required scalar inputs no longer use generic `inputConditions`.
- [ ] Validation no longer uses incoming edge conditions as the primary source of
  producer activation truth.
- [ ] Canonical expansion no longer propagates import activation by copying it
  onto every ordinary internal edge as the main semantic model.
- [ ] Compatibility-only helpers are isolated, named as legacy, and covered by
  removal-oriented tests or comments.

### Catalog Migration

- [ ] Seedance root catalog wrapper uses import activation for each branch.
- [ ] Seedance ordinary required data bindings do not repeat branch `if:`
  conditions.
- [ ] Seedance shared `GeneratedVideo` output routes remain explicitly
  conditional.
- [ ] Seedance plans do not need `conditionalInputBindings` for required scalar
  inputs.
- [ ] Historical documentary Seedance optional producers use import activation
  or branch composites where appropriate.
- [ ] Historical documentary required branch inputs do not rely on authored edge
  conditions.
- [ ] Historical documentary sparse outputs and fan-in members keep only the
  condition gates that are semantically necessary.
- [ ] `pnpm bundle:catalog` has been run after root catalog migration, if a CLI
  catalog update is part of the final PR.

### Validation And Runtime Behavior

- [ ] Missing required scalar bindings fail before provider SDK calls.
- [ ] Multiple conditional sources for one required scalar input fail validation.
- [ ] Edge conditions on required scalar inputs fail strict validation.
- [ ] Edge conditions on optional scalar inputs pass only when the target input
  is declared optional.
- [ ] Edge conditions on fan-in members pass only when the target input declares
  `fanIn: true`.
- [ ] Multi-source public outputs require explicit route conditions.
- [ ] Known-false activation conditions can be pruned or skipped as whole jobs.
- [ ] Unknown activation conditions remain job-level gates until their condition
  values are available.
- [ ] Unknown activation at execution time fails fast with a numbered Renku
  error.
- [ ] Stage-limited runs (`--up`, `--up-to-layer`) do not fail because later
  unscheduled activation-gated jobs have unresolved condition inputs.

### Verification

- [ ] Focused core resolution tests cover activation, bindings, fan-in, and
  output routes.
- [ ] Producer graph tests prove projection reads resolved structures.
- [ ] Validation tests cover strict activation/input coherence.
- [ ] Planner tests cover known activation pruning and unknown activation gates.
- [ ] Runner tests cover whole-job activation skip and required-input
  preservation.
- [ ] CLI end-to-end tests cover branch execution, sparse fan-in, dry-run
  coverage, and stage-by-stage execution.
- [ ] Final verification has run from the repository root:

```bash
pnpm build
pnpm test
```
