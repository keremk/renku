# Outputs Connectors And Runtime Artifacts Hard-Cut Plan

## Why This Plan Exists

The current codebase still mixes together three different concepts:

1. authored blueprint outputs
2. executable producer outputs
3. runtime artifacts materialized into the build folder

That mix-up is the root cause of the ongoing confusion and regressions.

This plan defines the correct terminology, the target architecture, and the exact refactor needed to get there without shortcuts, heuristics, or compatibility shims.

This is a hard cut.

- YAML should declare `outputs:`, not `artifacts:`
- YAML should declare `imports:`, not `producers:` for authored child blueprint references
- output connectors are connectors everywhere, including producer blueprints
- runtime artifacts exist only after execution
- runtime artifacts have canonical `Artifact:...` IDs
- `artifact` is the only correct spelling everywhere in code, docs, tests, types, and comments
- `cli/catalog` is a generated copy of `catalog` and must not be edited by hand

---

## Core Terminology

These terms must be used consistently in code, tests, docs, and review discussion.

### 1. Output connector

An output connector is a declared blueprint interface node.

- It is authored in YAML under `outputs:`
- It is identified canonically as `Output:...`
- It exposes a value to a parent blueprint or to the outside world
- It is not materialized into the build folder
- It is not a runtime artifact

Examples:

- `Output:Movie`
- `Output:SegmentUnit.Video`
- `Output:SegmentUnit.MainVideo.GeneratedVideo`

Important rule:

- all blueprint YAML files declare outputs
- this includes producer blueprints (`meta.kind: producer`)
- an authored output is always a connector, never a persisted runtime artifact

### 2. Runtime artifact

A runtime artifact is a produced thing that actually exists in storage after a job runs.

- It is written to the event log / manifest / blobs / build output
- It is identified canonically as `Artifact:...`
- It exists only for executed producer jobs

Examples:

- `Artifact:SegmentUnit.MainVideo.GeneratedVideo`
- `Artifact:TimelineComposer.Timeline`

Important rule:

- only runtime execution creates `Artifact:...`
- authored YAML never declares runtime artifacts directly

### 3. Leaf producer blueprint

A leaf producer blueprint is a blueprint with `meta.kind: producer`.

- it is still a blueprint
- it still declares `inputs:` and `outputs:`
- it is executable
- execution materializes runtime artifacts corresponding to its declared outputs

Important rule:

- leafness is defined by explicit blueprint kind, not by topology
- no heuristic based on missing children, missing imports, or graph shape is allowed

### 3a. Blueprint import

A blueprint import is an authored child reference declared in a blueprint's `imports:` section.

- it imports another blueprint file
- the imported blueprint may itself be:
  - a nested composite blueprint
  - or a leaf producer blueprint with `meta.kind: producer`

Important rule:

- imported children are blueprint imports
- some imported blueprints are producer blueprints
- not every blueprint import is a producer import

### 4. Export binding

An export binding maps one connector to one exact upstream source.

- destination: `Output:...`
- source: `Input:...` or `Artifact:...`
- it is blueprint interface metadata
- it is not production
- it is not materialization

Examples:

- `Output:Movie -> Artifact:SegmentUnit.MainVideo.GeneratedVideo`
- `Output:MovieDuration -> Input:Duration`

### 5. Runtime graph

The runtime graph is the graph used by planning and execution.

It must contain:

- `Producer:...`
- `Input:...`
- `Artifact:...`

It must not treat `Output:...` as a runtime-produced identity.

### 5a. Authored graph vs execution graph

The authored blueprint graph and the execution graph are not the same thing.

The authored graph contains:

- `Input`
- `Output`
- blueprint imports / producer references

The execution graph is derived from the authored graph and additionally contains:

- executable producer jobs
- runtime `Artifact:` identities for those jobs

Important rule:

- authored blueprint structure should not pretend that runtime artifacts are authored nodes
- runtime artifact nodes belong to the derived execution graph, not to the authored blueprint schema

### 6. Blueprint interface layer

The blueprint interface layer is the mapping between declared outputs and their exact upstream sources.

It is used by:

- root output publishing
- viewer output display
- storyboard/display projections

It is not used to pretend that `Output:...` is materialized.

---

## Architecture Rules

These rules are the non-negotiable target state.

### Rule 1. YAML declares connectors, not runtime artifacts

Every blueprint YAML file declares:

- `inputs:`
- `outputs:`
- `imports:`
- `connections:`

No YAML file should declare `artifacts:`.
No YAML file should declare authored child blueprint references under `producers:`.

### Rule 2. All declared outputs are `Output:...`

Every declared output, in every blueprint kind, becomes an `Output:` connector.

There are no exceptions for:

- root blueprints
- composite blueprints
- producer blueprints

### Rule 3. Only executed producer jobs create `Artifact:...`

Runtime artifacts are not authored.

They are synthesized by the runtime model for executable producer jobs only.

For a producer blueprint output named `GeneratedVideo`, the model is:

```text
Producer:SegmentUnit.MainVideo
  -> Artifact:SegmentUnit.MainVideo.GeneratedVideo
  -> Output:SegmentUnit.MainVideo.GeneratedVideo
```

That means:

- the artifact is the real produced thing
- the output is the connector exposing that thing

### Rule 4. Planner and runner operate on runtime IDs only

Planning, execution, event logging, manifests, and providers work only with:

- `Input:...`
- `Artifact:...`
- `Producer:...`

They must never rely on `Output:...` as if it were materialized.

### Rule 5. Root output publishing uses explicit bindings only

Root outputs must be surfaced by exact root output bindings:

- `Output:Movie -> Artifact:SegmentUnit.MainVideo.GeneratedVideo`

No name matching, suffix matching, or heuristic “final output” logic is allowed.

### Rule 6. No topology-based producer detection

This must be deleted everywhere:

- “no imported children means producer”
- “has local producers and no children means artifact node”
- any similar shortcut

The only source of truth for an executable producer blueprint is:

- `meta.kind: producer`

### Rule 7. No backwards compatibility

The parser should reject `artifacts:` in YAML with a direct error telling the author to use `outputs:`.

There should be no:

- alias section support
- fallback parser behavior
- dual-schema migration mode

---

## Current Problems To Fix

### 1. Wrong authoring schema in parser and types

Current state:

- `BlueprintArtifactDefinition`
- `BlueprintDocument.artifacts`
- many runtime/event/manifest types also still use `artifact`
- parser accepts `artifacts:`
- parser infers producer-blueprint status partly from missing imports

Why this is wrong:

- it makes authored connectors look like runtime artifacts
- it keeps the wrong mental model alive everywhere else

Required fix:

- rename authored output types and fields to `Output`
- rename all remaining `artifact` / `Artifact` spellings in codebase to `artifact` / `Artifact`
- change parser to require `outputs:`
- change parser to require `imports:` for authored child blueprint references
- remove topology-based producer inference

### 2. Wrong graph classification in canonical graph builder

Current state:

- declared YAML outputs are sometimes turned into `Artifact` nodes and sometimes into `Output` nodes
- this still depends on heuristics in `core/src/resolution/canonical-graph.ts`

Why this is wrong:

- node kind is being guessed from structure
- producer blueprints and composite blueprints are being modeled inconsistently

Required fix:

- every authored output becomes `Output`
- producer runtime artifacts are synthesized structurally, not by reclassifying authored outputs

### 3. Wrong execution boundary for producer blueprints

Current state:

- producer blueprints author outputs under the old `artifacts:` section
- parser synthesizes producer edges directly from those authored nodes

Why this is wrong:

- the authored node and the produced thing are being conflated

Required fix:

- producer blueprints still author `outputs:`
- runtime layer synthesizes a matching `Artifact:` node per output for runnable producers
- execution uses those synthesized `Artifact:` nodes only

### 4. Output publication still depends on old assumptions

Current state:

- root output publication now uses `rootOutputBindings`, which is good
- but some upstream code still determines connectedness and ownership using assumptions inherited from the old artifact model

Required fix:

- root outputs remain interface metadata only
- runtime ownership comes only from direct producer-to-artifact edges

### 5. Viewer and CLI authoring tooling have a parallel wrong schema

Current state:

- CLI producer interactive tooling still has `ProducerArtifactDefinition`
- scaffolds still emit `artifacts:`
- viewer blueprint projection still reads `document.artifacts`

Required fix:

- move every authored blueprint-facing surface to `outputs`

### 6. Input conditions are still partially broken

Current state:

- nested `Input:` condition paths are parsed incorrectly in `core/src/condition-evaluator.ts`

Why this matters here:

- conditional output publication depends on condition evaluation
- if we are fixing output architecture, we must fix condition resolution too

Required fix:

- parse canonical input ID first
- then traverse nested object and bracketed path segments
- reuse one shared input-condition path parser everywhere relevant

---

## Target Model By Layer

### Layer 1. Authored blueprint document

`BlueprintDocument` should model authored intent only.

It should contain:

- `inputs`
- `outputs`
- blueprint imports
- `edges`
- `loops`
- `conditions`
- `mappings`

It should not contain any field named `artifacts`.

Important terminology rule:

- authored child blueprint references live under `imports:`
- do not use `producerImports` as target architecture terminology
- some of those imported blueprints are producer blueprints

For internal representation:

- use `blueprintImports`, `imports`, or another blueprint-oriented name
- if execution metadata is needed for a producer blueprint, name it separately from authored imports

### Layer 2. Blueprint graph

The authored blueprint graph should model authored structure faithfully.

It should contain:

- `InputSource`
- `Output`
- `Producer`

Important distinction:

- composite/root declared outputs come directly from authored `outputs`
- the authored blueprint graph should not model runtime artifacts as if they were authored outputs

### Layer 2a. Execution graph

The execution graph is derived from the authored blueprint graph.

It may contain runtime `Artifact:` nodes, but only as derived runtime identities for executable producer outputs.

Important distinction:

- execution-graph artifact nodes are derived runtime nodes
- they are not authored YAML outputs
- they are not second names for outputs

### Layer 3. Canonical expanded graph

The canonical expanded graph should:

- expand dimensions
- collapse output chains
- retain explicit output-source mappings

It should expose:

- `outputSources`
- `outputSourceBindings`

Those mappings should be the only interface-layer truth for output publication.

### Layer 4. Producer graph

The producer graph should contain runtime semantics only.

Each job should expose:

- `inputs` as canonical runtime dependencies
- `produces` as canonical `Artifact:...` only

There must be no `Output:...` in job `produces`.

### Layer 5. Planning and execution

Planning, execution, manifests, event logs, and providers should only consume runtime identities.

That means:

- `Input:...`
- `Artifact:...`
- `Producer:...`

Output connectors stay outside the runtime contract.

### Layer 6. Projection and UI

Projection/UI surfaces may display:

- friendly output labels
- root outputs
- storyboard visibility

But they must do it by consulting output bindings, not by pretending output connectors are runtime artifacts.

---

## Detailed Refactor Plan

## Phase 1. Rename authored schema and remove compatibility

### 1.1 Core authored types

In `core/src/types.ts`:

- rename `BlueprintArtifactDefinition` to `BlueprintOutputDefinition`
- rename `BlueprintDocument.artifacts` to `BlueprintDocument.outputs`
- rename any authored helper type/field that still says artifact but actually means declared output
- rename all codebase `artifact` spellings to `artifact`, including runtime/event/manifest types

Comments must clearly distinguish:

- authored outputs
- runtime artifacts

### 1.2 Parser hard cut

In `core/src/parsing/blueprint-loader/yaml-parser.ts`:

- allow `outputs`
- reject `artifacts`
- update missing-section errors to say output
- update parsing helpers from `parseArtifact` to `parseOutput`
- keep all supported metadata on outputs:
  - `type`
  - `itemType`
  - `required`
  - `description`
  - `countInput`
  - `countInputOffset`
  - `arrays`

### 1.3 Explicit producer-role detection

Also in the parser:

- remove `isProducerBlueprint = rawProducerImports.length === 0`
- stop inferring producer role from import shape
- use only `meta.kind === 'producer'`

If a blueprint is a producer blueprint, that must be explicit in YAML.

### 1.4 CLI producer loader hard cut

In `cli/src/interactive/utils/producer-loader.ts` and related types:

- change producer YAML parsing from `artifacts` to `outputs`
- rename `ProducerArtifactDefinition` to `ProducerOutputDefinition`

This must match the core parser model exactly.

### 1.5 Import schema hard cut

In core parser/types and all authored YAML surfaces:

- change authored child blueprint references from `producers:` to `imports:`
- rename internal authored-import fields away from `producerImports`
- keep explicit blueprint-kind handling so imported blueprints may be either:
  - nested composite blueprints
  - or leaf producer blueprints

## Phase 2. Rebuild graph semantics around connector outputs

### 2.1 Declared outputs always become `Output` nodes

In `core/src/resolution/canonical-graph.ts`:

- remove heuristic output classification
- authored outputs always create graph nodes of type `Output`

Delete logic like:

- “if childless and has producers then Artifact”

### 2.2 Synthesize runtime artifacts for runnable producers

For nodes with `meta.kind: producer`:

- each declared output should map to a derived runtime `Artifact:` node in the execution graph
- the runtime artifact ID should be canonical and producer-scoped

For each producer output:

```text
Producer:<alias>
  -> Artifact:<alias>.<outputName>
  -> Output:<alias>.<outputName>
```

This derivation should be structural and explicit in the graph builder.

It must not rely on authored `connections:` for producer output creation.

### 2.3 Leaf producer output inference

Producer blueprints currently often omit explicit `connections:` because outputs are structurally connected to the producer.

Keep that behavior, but define it correctly:

- producer blueprint authored outputs do not become runtime artifacts directly
- instead, graph construction derives the producer-to-artifact and artifact-to-output relationship

That gives one truthful model instead of one overloaded node.

### 2.4 Output metadata preservation

Any metadata currently attached to declared outputs must survive the rename and graph generation:

- media type
- array cardinality
- schema decomposition metadata

This metadata belongs to the connector/output declaration.

When runtime artifact nodes are synthesized for producer outputs, they should inherit the necessary output metadata for runtime use.

## Phase 3. Preserve output bindings as interface metadata only

### 3.1 Canonical expander contract

In `core/src/resolution/canonical-expander.ts`:

- keep `Output:` collapse behavior
- ensure output binding result shape remains explicit:
  - `outputId`
  - `sourceId`
  - `conditions`
  - `indices`

### 3.2 Allowed output sources

An output connector may resolve from:

- `Artifact:...`
- `Input:...`
- another `Output:...`

Final collapsed output bindings must end in:

- `Artifact:...` or `Input:...`

Never in another `Output:...`.

### 3.3 Root output collection

In planning/orchestration:

- collect root-level `Output:` bindings
- attach them to the execution plan
- continue using them for published root outputs

This is the correct bridge from interface layer to runtime materialization.

## Phase 4. Make runtime ownership strict

### 4.1 Producer graph ownership

In `core/src/resolution/producer-graph.ts`:

- `produces` must contain only direct runtime `Artifact:...`
- connectedness checks may consult output bindings to keep source artifacts alive
- but ownership must stay direct

Important rule:

- a producer owns an artifact only if there is a direct `Producer -> Artifact` relationship

### 4.2 Remove root-level artifact special casing

If any artifact connectedness logic still assumes:

- “root-level artifact means final output”

that should be replaced by:

- “artifact is published because a root `Output:` resolves to it”

### 4.3 Runtime-only contracts

Verify and preserve this rule in:

- planner
- runner
- manifest
- event log
- provider registry
- provider request/response contracts

They should continue to use `Artifact:...` only for produced outputs.

## Phase 5. Fix validators to match the real model

### 5.1 Output validation terminology

In `core/src/validation/blueprint-validator.ts` and related validators:

- rename declared-artifact validation to declared-output validation
- validate endpoint references against declared outputs, not declared artifacts

### 5.2 Output metadata validation

Keep validation for:

- `countInput`
- JSON array metadata
- item type
- output types

But those rules must now talk about outputs, not artifacts.

### 5.3 Producer contract validation

Media producer rules should be tied to producer outputs and actual producer blueprint kind, not to an accidental artifact interpretation.

### 5.4 Export binding validation

Add or tighten validation so that output/export bindings:

- resolve to exactly one upstream source
- reject cycles
- reject `groupBy`
- reject `orderBy`
- preserve conditions

## Phase 6. Fix input-condition parsing properly

In `core/src/condition-evaluator.ts`:

- replace current nested-input lookup logic
- parse canonical input ID first
- separate the input ID from the nested field path
- support dotted segments and bracketed segments

Examples that must work:

- `Input:Resolution.width`
- `Input:Settings.flags[scene].enabled`
- `Input:Settings.flags[0].enabled`

This parser should be shared or extracted if similar logic exists elsewhere.

## Phase 7. Update projection, tooling, and docs

### 7.1 Viewer parse projection

In `core/src/resolution/viewer-parse-projection.ts`:

- project authored `outputs`, not `artifacts`
- keep viewer-facing output summaries grounded in the output connector model

### 7.2 Scaffolds and generators

In `cli/src/commands/new-blueprint.ts` and any template generators:

- emit `outputs:`
- emit `imports:`
- use updated terminology in comments and scaffold text

### 7.3 Producer tooling

In CLI producer interactive flows and input-template tooling:

- refer to declared outputs, not artifacts
- keep model selection behavior unchanged except for schema names/terminology

### 7.4 Plan docs

Update plan documents that currently reinforce the wrong model.

At minimum:

- `plans/canonical-runtime-artifacts-no-alias-plan.md`

It must stop saying:

- outputs are declared in `artifacts:`
- the code does not have `Output:` nodes

because both statements are no longer acceptable for the target architecture.

## Phase 8. Rewrite source YAML and tests

### 8.1 Source of truth

Edit only source YAML and tests under:

- `catalog/`
- `core/tests/fixtures/`
- `cli/tests/fixtures/`
- `viewer/server/fixtures/`
- inline test YAML strings

Do not manually edit:

- `cli/catalog`

That copy should be refreshed by the normal bundle/copy workflow after the source catalog changes.

### 8.2 Authoring migration

Every blueprint YAML should move from:

```yaml
artifacts:
```

to:

```yaml
outputs:
```

And every authored child blueprint import should move from:

```yaml
producers:
```

to:

```yaml
imports:
```

This includes:

- composite blueprints
- root blueprints
- producer blueprints

### 8.3 Parser and fixture tests

Rewrite tests so they:

- author `outputs:`
- author `imports:`
- expect hard failure on `artifacts:`
- expect hard failure on authored `producers:`
- expect explicit `meta.kind: producer` for producer blueprints

---

## Files And Subsystems That Must Change

This section is the actionable cut list.

### Core parser and types

- `core/src/types.ts`
- `core/src/parsing/blueprint-loader/yaml-parser.ts`
- `core/src/parsing/node-inventory.ts`
- `core/src/parsing/input-loader.ts`
- `core/src/parsing/prompt-input-loader.ts`

### Core graph and resolution

- `core/src/resolution/canonical-graph.ts`
- `core/src/resolution/canonical-expander.ts`
- `core/src/resolution/producer-graph.ts`
- `core/src/resolution/viewer-parse-projection.ts`
- `core/src/resolution/producer-binding-summary.ts`
- `core/src/resolution/storyboard-projection.ts`

### Core orchestration and planning

- `core/src/orchestration/planning-service.ts`
- `core/src/orchestration/output-schema-hydration.ts`
- `core/src/planning/planner.ts`
- `core/src/runner.ts`
- `core/src/condition-evaluator.ts`

### Validation

- `core/src/validation/blueprint-validator.ts`
- any other validator referring to declared blueprint artifacts when it really means outputs

### CLI and viewer authoring surfaces

- `cli/src/commands/new-blueprint.ts`
- `cli/src/interactive/utils/producer-loader.ts`
- `cli/src/interactive/types/producer-mode.ts`
- any CLI test helpers or direct producer blueprint readers

### YAML and tests

- source `catalog/`
- `core` fixtures/tests
- `cli` fixtures/tests
- `viewer` server fixtures/tests
- inline YAML strings in unit/integration/e2e tests

---

## Acceptance Criteria

The refactor is only complete when all of these are true.

### Schema and parsing

- all authored YAML uses `outputs:`
- all authored child blueprint references use `imports:`
- `artifacts:` in YAML is rejected
- authored `producers:` in YAML is rejected
- producer blueprint role is derived only from `meta.kind: producer`

### Graph semantics

- every authored output becomes `Output:...`
- producer runtime outputs become synthesized `Artifact:...`
- no authored output is retyped into a runtime artifact

### Planning and execution

- jobs produce only canonical `Artifact:...`
- root outputs are published only from explicit `rootOutputBindings`
- no runtime code depends on `Output:...` for materialization

### Conditions

- nested `Input:` conditions work correctly
- conditional output publication works for object-field input conditions

### Tooling

- scaffolded blueprints use `outputs:`
- scaffolded blueprints use `imports:`
- producer CLI flows parse `outputs:`
- viewer parse projection reports outputs using the new authored model

### Repository consistency

- source catalog and fixtures are migrated
- `cli/catalog` is refreshed by the normal copy/bundle flow, not hand-edited

---

## Test Plan

### 1. Parser hard-cut tests

- accepts `outputs:`
- rejects `artifacts:`
- rejects producer blueprints missing `meta.kind: producer`
- does not infer producer blueprint role from missing imports

### 2. Canonical graph tests

Given a producer blueprint:

```yaml
meta:
  kind: producer
outputs:
  - name: GeneratedVideo
```

expect graph shape equivalent to:

```text
Producer:VideoProducer
  -> Artifact:VideoProducer.GeneratedVideo
  -> Output:VideoProducer.GeneratedVideo
```

### 3. Nested export tests

Given:

```text
MainVideo.GeneratedVideo -> SegmentUnit.Video -> Movie
```

expect:

- one runtime artifact identity
- `Output:SegmentUnit.Video -> Artifact:SegmentUnit.MainVideo.GeneratedVideo`
- `Output:Movie -> Artifact:SegmentUnit.MainVideo.GeneratedVideo`

### 4. Root output regression tests

For one-file runnable blueprints:

- root outputs are still published
- `rootOutputs` / `finalStageOutputs` are not empty when the blueprint exposes outputs backed by produced artifacts

### 5. Producer graph tests

- `produces` contains only direct runtime artifacts
- no output connector appears in job `produces`
- root publishing does not change job ownership

### 6. Condition tests

- `Input:Resolution.width`
- `Input:Settings.flags[scene].enabled`
- `Input:Settings.flags[0].enabled`

All must resolve correctly and control publication as expected.

### 7. Viewer/projection tests

- viewer parse projection reports authored outputs correctly
- storyboard/output projections do not show connector aliases as fake materialized artifacts

### 8. End-to-end YAML migration tests

- CLI validation passes with migrated `outputs:`
- generate flow works with migrated producer and composite blueprints

---

## Execution Order

This order is important to avoid thrashing the codebase.

1. Rename authored output types and parser schema in core.
2. Rename authored import schema from `producers:` to `imports:`.
3. Remove topology-based producer inference.
4. Rebuild canonical graph semantics so all authored outputs are `Output`.
5. Add explicit synthesized runtime artifacts for producer outputs.
6. Repair canonical expansion and output-source binding flow.
7. Tighten producer graph ownership/runtime contracts.
8. Update validators.
9. Fix nested `Input:` condition parsing.
10. Update CLI/viewer authoring/tooling surfaces.
11. Rewrite source YAML and tests.
12. Refresh generated `cli/catalog` through the normal bundle/copy workflow.
13. Run full verification.

---

## Completion Checklist

This refactor is not complete until every item below is true.

### Authoring schema

- [ ] No source blueprint YAML in `catalog/`, source fixtures, or inline test YAML uses `artifacts:`
- [ ] No source blueprint YAML in `catalog/`, source fixtures, or inline test YAML uses `producers:` for authored child blueprint references
- [ ] All authored blueprint YAML uses `outputs:`
- [ ] All authored child blueprint references use `imports:`
- [ ] The parser rejects `artifacts:` with a clear migration error
- [ ] The parser rejects authored `producers:` sections with a clear migration error directing authors to `imports:`
- [ ] Producer blueprints are identified only by `meta.kind: producer`
- [ ] No code path infers producer blueprint role from missing imports, missing children, or graph shape

### Core terminology and types

- [ ] Authored output types/fields have been renamed away from `Artifact` / `artifacts` where they really mean declared outputs
- [ ] No codebase type, field, comment, or doc uses `artifact` / `Artifact`; all spelling is `artifact` / `Artifact`
- [ ] Runtime-only types still use `Artifact:...` terminology where they refer to materialized products
- [ ] Comments and type docs clearly distinguish `Output:` connectors from runtime `Artifact:` IDs
- [ ] Internal naming no longer uses `producerImports` for authored imported blueprints

### Graph semantics

- [ ] Every authored output becomes an `Output:` node
- [ ] No authored output is retyped into an `Artifact:` node by heuristic
- [ ] Producer blueprints synthesize runtime `Artifact:` nodes for their executable outputs
- [ ] Composite and root blueprints do not synthesize fake runtime artifacts from authored outputs
- [ ] Output connector collapse produces exact `outputSourceBindings`

### Runtime contract

- [ ] Producer job `produces` lists contain only canonical `Artifact:...` IDs
- [ ] Planner/runtime code does not depend on `Output:...` as if it were materialized
- [ ] Root output publishing works from explicit root output bindings only
- [ ] No fallback or name-matching logic is used to discover final outputs

### Validation and conditions

- [ ] Validators refer to declared outputs when they mean authored blueprint interface nodes
- [ ] Export/output binding validation rejects invalid multi-source or grouped export bindings
- [ ] Nested `Input:` condition paths resolve correctly for dotted and bracketed object fields
- [ ] Conditional output publication and storyboard visibility work for nested input conditions

### Tooling and projections

- [ ] CLI scaffolds generate `outputs:`
- [ ] CLI scaffolds generate `imports:`
- [ ] CLI producer interactive tooling parses `outputs:`
- [ ] Viewer blueprint projection reads authored outputs, not authored artifacts
- [ ] `cli/catalog` was not hand-edited and was refreshed only via the normal bundle/copy workflow

### Tests and verification

- [ ] Parser tests cover the hard cut from `artifacts:` to `outputs:`
- [ ] Parser tests cover the hard cut from authored `producers:` to `imports:`
- [ ] Canonical graph tests cover synthesized producer runtime artifacts plus declared `Output:` connectors
- [ ] Root output regression tests pass for one-file runnable blueprints
- [ ] Producer graph tests prove `produces` contains only runtime artifacts
- [ ] Condition tests cover nested `Input:` object-path conditions
- [ ] End-to-end tests run against migrated `outputs:` YAML
- [ ] Final verification includes `pnpm test` from the repository root

If any checkbox remains false, the refactor is still halfway done and should not be considered complete.

---

## Verification

Focused package tests are useful during development, but final verification must include:

```bash
pnpm test
```

from the repository root.

Recommended focused checks during implementation:

```bash
cd core && pnpm vitest run --pool=threads --poolOptions.threads.singleThread
cd cli && pnpm vitest run --pool=threads --poolOptions.threads.singleThread
cd providers && pnpm vitest run --config vitest.config.ts --pool=threads
```

---

## Final Note

This refactor should be judged by one simple question:

When looking at any identifier in the system, can we tell immediately whether it is:

- a connector declared in YAML
- a runtime-produced artifact
- or a runnable producer job

If the answer is ever “it depends on context” or “it depends on heuristics,” then the refactor is not done.
