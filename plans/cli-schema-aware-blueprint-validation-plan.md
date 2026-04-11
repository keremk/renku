# CLI Schema-Aware Blueprint Validation Plan

## Goal

Make CLI validation and pre-planning validation understand schema-backed graph structure, so blueprints that rely on producer `meta.outputSchema` are validated against the same authored graph contract that planning and dry-run generation already use.

This plan does not replace the existing resolution-context refactor. It finishes the remaining validation gap around output-schema-backed graph structure and makes the raw-vs-prepared distinction explicit in tooling.

## Problem Statement

Today the repo has two different ideas of "blueprint validity":

- planning/runtime validity
- CLI validation validity

Planning/runtime already treats `meta.outputSchema` as part of the real graph-building contract:

- producer metadata or provider options load the schema
- JSON artifacts are enriched with `artifact.schema`
- schema-derived field nodes and edges become graph-visible

But CLI validation still runs on the raw tree:

- `cli/src/commands/blueprints-validate.ts`
- `cli/src/lib/planner.ts`
- `viewer/server/generation/plan-handler.ts`

That creates a mismatch:

- a blueprint can pass `validateBlueprintTree(...)`
- yet fail later when schema loading/preparation runs
- or pass validation while still referencing invalid schema-derived field paths

If `meta.outputSchema` is part of the authored graph contract, this is incomplete validation, not just a harmless raw/static view.

## Why This Matters

Many prompt-producer-driven blueprints start from a JSON artifact whose real downstream wiring depends on schema decomposition.

Example:

- authored top-level artifact: `VideoScript`
- authored producer metadata: `meta.outputSchema: ./video-script-output.json`
- authored downstream references:
  - `DocProducer.VideoScript.Segments[segment].Narration`
  - `DocProducer.VideoScript.Segments[segment].ImagePrompts[0]`

Those nested paths are authored structure. They are not optional runtime decorations.

Without schema-aware preparation, validation only partially checks them:

- it can confirm `DocProducer` exists
- it can confirm `VideoScript` exists
- it cannot honestly confirm that `Segments[segment].Narration` or `ImagePrompts[0]` are real graph-visible fields

That is not the contract users expect from blueprint validation.

## Current Gaps

### 1. `blueprints:validate` is schema-blind

`cli/src/commands/blueprints-validate.ts`:

- loads raw tree
- runs `validateBlueprintTree(root)`
- builds graph directly from raw tree
- prints node/edge counts from the raw graph

Consequences:

- missing `outputSchema` files are not caught during validation
- invalid JSON schemas are not caught during validation
- graph counts exclude schema-derived nodes and edges
- nested schema-derived references are only shallowly validated

### 2. CLI planning still performs raw pre-validation

`cli/src/lib/planner.ts` still does:

- raw load
- `validateBlueprintTree(blueprintRoot, { errorsOnly: true })`
- only later builds provider metadata and enters the shared prepared graph path

Consequences:

- the actual planning path is correct
- but the early validation gate still does not reflect the real authored graph contract

### 3. Viewer planning endpoint has the same issue

`viewer/server/generation/plan-handler.ts` also performs raw validation before planning.

This means the same mismatch exists outside the CLI too, even though the trigger for this plan is CLI behavior.

### 4. Raw tooling and schema-aware tooling are not clearly separated

The previous refactor plans assumed `blueprints:validate` should stay raw.

That assumption is no longer correct for the current product contract:

- if a command is named `validate`, users reasonably expect it to validate the authored blueprint contract
- if the product still needs raw inspection, it should be a separate explicit mode or command

## Non-Negotiable Rules

- `meta.outputSchema` is part of the authored blueprint contract.
- Validation must fail fast when output schema files are missing or invalid.
- Validation must not silently fall back to a raw-only interpretation when schema-backed structure is required.
- Dry-run planning and live planning must keep sharing the same planning path.
- Raw inspection remains useful, but it must be clearly labeled as raw/authored-source inspection rather than full graph validation.
- Do not reintroduce duplicated graph-preparation logic outside core.

## Existing Behavior That Should Stay

### Dry-run generation path parity

Dry-run generation already has the right architectural shape:

- it calls the same `generatePlan(...)` path as live execution
- it reaches the same `createPlanningService().generatePlan(...)` path
- it only diverges later in execution, where providers switch from `live` to `simulated`

This should stay exactly true after this work.

The fix in this plan is not "special-case dry-run validation logic." The fix is to make the shared validation layer schema-aware before both dry-run and live planning proceed.

## Architecture Direction

Introduce an explicit split between:

1. raw/source inspection
2. schema-aware blueprint validation
3. resolution-ready planning

The important change is that "validation" moves to stage 2, not stage 1.

## Proposed Core API Additions

### 1. Prepared validation entrypoint

Add a new core helper that validates the authored blueprint contract after schema-backed preparation.

Suggested shape:

```ts
interface BlueprintValidationPreparationArgs {
  root: BlueprintTreeNode;
  schemaSource: ResolutionSchemaSource;
}

interface PreparedBlueprintValidationResult {
  context: BlueprintResolutionContext;
  validation: ValidationResult;
}

async function validatePreparedBlueprintTree(
  args: BlueprintValidationPreparationArgs
): Promise<PreparedBlueprintValidationResult>;
```

Responsibilities:

- clone and prepare the tree through the shared resolution-context pipeline
- fail on missing/invalid schema files
- run structural validation against the prepared tree
- return the prepared context so callers can reuse it instead of rebuilding it

Important:

- this must use the same preparation semantics as the shared resolution-context flow
- this should not create a second preparation implementation

### 2. Optional raw validation helper naming cleanup

Keep `validateBlueprintTree(...)` for true raw-tree validation if needed, but stop presenting it as the main validation path for user-facing blueprint validation.

Optional follow-up:

- rename or alias the raw version to something like `validateRawBlueprintTree(...)`

This is not required for the first implementation if it creates too much churn, but the distinction should become explicit in code comments and callsites immediately.

## Validation Semantics To Add

Prepared/schema-aware validation must catch at least these cases:

### A. Missing schema file

Example:

- blueprint node declares `meta.outputSchema: ./missing.json`

Expected result:

- validation fails before planning
- user sees a validation-style error, not a later planning/runtime surprise

### B. Invalid schema JSON

Example:

- schema file exists but is invalid JSON

Expected result:

- validation fails before planning

### C. Invalid schema-derived field references

Example:

- edge references `DocProducer.VideoScript.Segments[segment].ImagPrompts[0]`
- actual schema defines `ImagePrompts`

Expected result:

- validation fails because the nested field path does not exist in the prepared graph contract

### D. Accurate graph counts for `blueprints:validate`

If the command prints graph counts, those counts must come from the prepared graph used for validation, not the raw graph.

## Implementation Plan

### Phase 1. Add prepared validation helper in core

Files likely involved:

- `core/src/validation/`
- `core/src/resolution/blueprint-resolution-context.ts`
- `core/src/index.ts`

Work:

- add `validatePreparedBlueprintTree(...)`
- have it call `prepareBlueprintResolutionContext(...)`
- run the existing validation passes on the prepared tree
- return both `validation` and `context`

Why:

- this keeps preparation centralized
- it allows callers to reuse the prepared context rather than rebuilding it

### Phase 2. Teach validation to actually verify prepared graph-backed nested references

This is the most important semantic step.

Current limitation:

- `validateProducerInputOutput(...)` only checks the first artifact/input segment after the producer

Needed behavior:

- when validating a prepared tree, nested schema-derived artifact paths must be checked against actual graph-visible nodes or prepared artifact definitions

Recommended direction:

- prefer validating against the prepared graph node set rather than trying to recreate path semantics by hand in the validator

Possible approach:

- build a set of valid node IDs or valid owner-local names from `context.graph`
- for each edge endpoint that targets a producer-scoped artifact path, confirm the referenced nested path resolves to an actual prepared node

Why this is better:

- it avoids duplicating schema-decomposition semantics in validator code
- it keeps validation aligned with the graph builder

### Phase 3. Migrate `blueprints:validate` to prepared validation

File:

- `cli/src/commands/blueprints-validate.ts`

Work:

- replace raw-only validation with schema-aware prepared validation using producer metadata
- use `context.graph` for node/edge counts
- keep warnings/errors presentation consistent

Expected behavior change:

- `blueprints:validate` now validates the real authored graph contract, including `meta.outputSchema`

### Phase 4. Reuse prepared validation/context in CLI planning

File:

- `cli/src/lib/planner.ts`

Work:

- replace the raw `validateBlueprintTree(...)` call with prepared validation
- reuse the returned prepared context if practical
- pass that `resolutionContext` into `createPlanningService().generatePlan(...)`

Why:

- avoids validating one graph and planning another
- avoids rebuilding the same prepared context twice

Important nuance:

- CLI planning uses provider-option schema source for the final planning path
- but provider metadata is derived from producer meta and model selections

Recommended sequence:

1. load blueprint
2. load inputs/model selections
3. build provider metadata
4. run prepared validation with `schemaSource: { kind: 'provider-options', providerOptions }`
5. pass the returned context into planning

This keeps validation and planning on the same exact prepared graph universe.

### Phase 5. Apply the same fix to viewer plan generation

File:

- `viewer/server/generation/plan-handler.ts`

Work:

- replace raw pre-validation with prepared validation
- reuse the prepared context for planning where possible

Why:

- same correctness issue exists there
- CLI and viewer should not diverge on what counts as a valid blueprint

### Phase 6. Decide whether raw inspection needs an explicit home

This is a product/API cleanup step, not necessarily part of the first correctness patch.

Options:

- keep `validateBlueprintTree(...)` as an internal raw helper only
- add an explicit raw inspection mode, such as:
  - `blueprints:inspect-raw`
  - `blueprints:validate --raw`
  - a separate dev/test helper

Recommendation:

- do not keep the current user-facing ambiguity where `blueprints:validate` sounds authoritative but silently ignores schema-backed authored graph structure

## Tests To Add

### Core tests

- prepared validation fails when `meta.outputSchema` file is missing
- prepared validation fails when `meta.outputSchema` file is invalid JSON
- prepared validation catches typos in nested schema-derived field references
- prepared validation returns graph counts / node presence consistent with `BlueprintResolutionContext`

### CLI tests

- `blueprints:validate` fails for blueprint with missing output schema
- `blueprints:validate` fails for blueprint with invalid nested schema-derived field reference
- `blueprints:validate` reports graph counts that include schema-derived nodes

### Planning tests

- CLI `generatePlan(...)` rejects schema-invalid blueprints during pre-validation
- CLI dry-run uses the same schema-aware validation path as live planning
- viewer plan handler rejects the same schema-invalid blueprints as CLI

## Risks And Tradeoffs

### 1. Validation becomes async at more callsites

That is acceptable because schema loading is already async elsewhere and is part of the real authored contract.

### 2. Some existing "raw-valid but prepared-invalid" blueprints may start failing earlier

That is a desirable change.

It means validation is becoming more honest, not more fragile.

### 3. Graph-aware validation could duplicate graph semantics if done carelessly

Avoid this by validating against the prepared graph/context, not by hand-rolling another nested-path interpreter inside the validator.

## Recommended Delivery Order

1. add core prepared validation helper
2. make nested schema-derived path validation graph-aware
3. migrate `blueprints:validate`
4. migrate CLI planning pre-validation and context reuse
5. migrate viewer plan handler
6. optionally add explicit raw inspection mode

## Definition Of Done

This work is done when all of the following are true:

- `blueprints:validate` fails on missing or invalid `meta.outputSchema`
- `blueprints:validate` validates nested schema-derived references as real graph-backed paths
- CLI planning no longer performs raw-only pre-validation
- dry-run and live generation still share the same planning path
- viewer plan generation uses the same schema-aware validation semantics as CLI
- any remaining raw-tree tooling is explicitly labeled as raw inspection rather than full blueprint validation

