# Major Refactor Plan

This document defines the step-by-step plan for migrating Tutopanda to the new blueprint + universal node ID architecture. Each phase is self-contained; after completing a phase the tree should be green (lint/tests) and ready for the next phase. If context resets, simply re-open this doc at the current phase and follow the checklist.

---

## Phase 0 – Reset & Prep (current status)

**Goal:** Confirm we are starting from the legacy implementation with no lingering “v2” forks.

- [ ] Remove any `*-v2*` files introduced during experiments (e.g. `cli/src/lib/blueprint-loader/*v2*`, `core/src/blueprint-loader/v2`). Only keep the canonical files listed in subsequent phases.
- [ ] Ensure `git status` only shows intentional changes tied to this plan.
- [ ] Document this plan (`cli/docs/major-refactor.md`). ✅ (done)

_Exit criteria:_ Repo matches the last known-good legacy state plus this plan.

---

## Phase 1 – New Blueprint Parser & Bundle Loader (CLI)

**Purpose:** Teach the CLI to read the new TOML schema (as defined in `cli/docs/TOML-based-config.md`) and expose it via a canonical tree without touching core yet.

1. **Parser**
   - Replace `cli/src/lib/blueprint-loader/toml-parser.ts` with the new schema that understands:
     - `[[inputs]]`, `[[artefacts]]`, `[[producers]]`, `[[producers.sdkMapping]]`, `[[producers.outputs]]`, `[[subBlueprints]]`.
     - `countInput` for artefacts, descriptive metadata, sdk mapping fields, etc.
   - Add coverage in `cli/src/lib/blueprint-loader/toml-parser.test.ts` using the sample blueprints under `cli/blueprints/`.

2. **Bundle loader**
   - Replace `loadBlueprintFromToml` with a recursive loader that resolves the new schema into a `BlueprintTreeNode` (namespace path + document + children). No duplicate “v2” files—this becomes the only loader under `cli/src/lib/blueprint-loader/`.
   - Provide cycle detection & path resolution (`name` or optional `path` fields).
   - Tests: `cli/src/lib/blueprint-loader/loader.test.ts` verifying nested trees using actual fixtures.

3. **CLI consumers**
   - Update every CLI entry point that currently imports `parseBlueprintToml`/`loadBlueprintFromToml`:
     - `cli/src/lib/planner.ts`
     - `cli/src/commands/blueprints-*`
     - `cli/src/commands/providers-list.ts`
     - Any other helper modules (search for `parseBlueprintToml` / `loadBlueprintFromToml` references).
   - Each consumer now works with the tree structure (`BlueprintTreeNode`). If a command still needs a flattened view (e.g. listing inputs), derive it locally (e.g. traverse the tree and aggregate data).

4. **Provider metadata helper (separation of concerns)**
   - Move the logic that builds provider options/catalog (currently in `cli/src/lib/producer-options.ts`) into core as part of the blueprint graph utilities. Export a helper like `core.providers.buildProviderOptions(tree)` so both CLI and future cloud runtime can reuse it.
   - Update CLI callers to use the core helper instead of maintaining their own traversal logic.

5. **Input validation helper**
   - Relocate the input validation/defaulting logic (currently `cli/src/lib/input-loader.ts`) into core so it can be reused by cloud services. Expose an API such as `core.inputs.applyDefaults(tree.document, rawValues)`.
   - Keep the CLI helper only responsible for reading TOML and passing the raw object to the new core function.

6. **No legacy adapter**
   - 😄 We are skipping the temporary adapter: CLI code will move to the new tree immediately, and core will be updated in Phase 2 before this phase lands. This keeps the codebase clean (per user guidance) even if there’s a short window during development where things are temporarily broken.

7. **Testing**
   - Run `cd cli && pnpm vitest run --pool=threads --poolOptions.threads.singleThread`.
   - Smoke test `pnpm --filter tutopanda-cli test` if feasible.

_Exit criteria:_ CLI commands operate solely on the new schema; the only legacy dependency is the temporary adapter feeding core.

---

## Phase 2 – Core Graph + Planner Rewrite

**Purpose:** Eliminate the legacy cardinality/flattening logic and replace it with the universal node ID model. Core becomes the single source of truth for graph expansion.

1. **Types & Graph Builder**
   - Extend `core/src/types.ts` with the canonical graph types (node IDs like `Artefact:ScriptGenerator.NarrationScript[i]`, sdk mappings, etc.).
   - Port the graph composition logic (currently prototyped in `core/src/blueprint-loader/v2/graph.ts`). This becomes the **only** implementation; remove `flattener.ts` and friends.

2. **Blueprint expansion**
   - Delete `expandBlueprint` / `flattenBlueprint` and replace them with:
     - `buildBlueprintGraph(tree: BlueprintTreeNode)` – already built in Phase 1 tree.
     - `expandGraph(graph, inputValues)` – enumerates producer/input/artefact instances, handling index notation and node collapsing.

3. **Planner + Runner / Planning Service**
   - Update `createProducerGraph`, `createPlanner`, `mergeResolvedArtifacts`, etc. to use the universal IDs.
   - Remove heuristic alias logic (`buildInputAliasIndex`, string slicing). Instead rely on the metadata produced by the new expander (per-job bindings, sdk mapping).
   - Manifest/event-log storage should now store canonical IDs; adjust serializers/deserializers accordingly.
   - **New goal:** Extract the orchestration currently in `cli/src/lib/planner.ts` (input event creation, manifest handling, plan storage) into a reusable core service (e.g., `core/src/planning/service.ts`). Expose a high-level API such as `createPlanningService().generatePlan({ blueprintTree, inputValues, providerCatalog, storage, manifestService, eventLog, logger })`.
   - With this service in place, slim down the CLI planner so it only:
     - Reads user inputs & writes prompt files.
     - Prepares storage paths and CLI logging.
     - Calls the core planning service and relays the result.
   - This ensures the future cloud runtime can reuse the same planning logic with different storage/event-log implementations.

5. **Testing**
   - Update / add tests under `core/src/*` covering:
     - Graph building (dimensions, namespace collapsing).
     - Planner dirty-tracking with the new IDs.
     - Runner integration (artefact resolution, diagnostics).
   - Run `pnpm --filter tutopanda-core test`.

_Exit criteria:_ Core consumes the new tree directly and produces universal node IDs end-to-end; no references to legacy cardinalities remain.

---

## Phase 3 – CLI Build & Provider Context (Universal IDs)

**Purpose:** Ensure the CLI build step hands off the new metadata to providers so producers can stop guessing input names.

1. **Plan serialization**
   - Embed the following per-job metadata in the execution plan / job context:
     - `inputs`: array of canonical IDs.
     - `inputBindings`: map from human alias (e.g. Prompt) to canonical ID.
     - `sdkMapping`: map from alias → provider field definition.
     - `produces`: canonical artefact IDs.

2. **Build pipeline separation**
   - Aim to move the heavy lifting (resolving artefacts, merging bindings) into core so both CLI and cloud runtimes share the same logic. Expose a helper such as `core.providers.prepareJobContext(planJob, resolvedInputs)` that returns the payload the providers need.
   - Update `cli/src/lib/build.ts` to become a thin shell that:
     - Streams jobs from the plan.
     - Calls the new core helper to build provider contexts and diagnostics.
     - Handles CLI-specific logging/output only.

3. **Testing**
   - Extend CLI tests to assert plan JSON contains the new metadata (can add a golden fixture or snapshot for a simple blueprint).

_Exit criteria:_ Providers receive everything they need (canonical IDs + sdk mapping) via the job context.

---

## Phase 4 – Provider Runtime & Producer Refactors

**Purpose:** Remove all heuristic prompt/array logic from providers; make them consume the canonical inputs directly.

1. **Runtime helpers**
   - Update `providers/src/sdk/runtime.ts` (or add helper modules) to expose:
     - `runtime.inputs.getByNodeId('Artefact:...')`.
     - `runtime.sdk.buildPayload(sdkMapping)`.
   - Fail fast if required fields are missing—no fallbacks.

2. **Producers**
   - `providers/src/producers/llm/openai.ts`: use the new payload builder; drop implicit JSON field inference.
   - `providers/src/producers/image/replicate-text-to-image.ts`: remove `resolvePrompt` and rely on the canonical artefact IDs.
   - `providers/src/producers/audio/replicate-audio.ts`: same simplification.

3. **Provider tests**
   - Update unit/integration tests to assert they now read from canonical IDs and honour the sdk mappings.
   - Run `pnpm --filter tutopanda-providers test` (threads pool per AGENT rule).

_Exit criteria:_ Providers no longer contain any legacy ID/prompt heuristics; they only interact with canonical IDs and sdk mappings.

---

## Phase 5 – Cleanup & Documentation

**Purpose:** Remove any leftover shims, update docs, and ensure the codebase reflects the new architecture.

- [ ] Delete deprecated docs (e.g., `cli/docs/current.md` once replaced) and update `cli/docs/TOML-based-config.md` with any final learnings.
- [ ] Ensure `AGENTS.md` references the new workflow (e.g., canonical IDs, sdk mapping).
- [ ] Final full test sweep: `pnpm --filter tutopanda-{cli,core,providers} test` plus any integration scripts the team uses.

_Exit criteria:_ Repo contains a single cohesive implementation; plan can be archived.

---

**General guidelines for every phase:**
- No parallel “v2” files—rename or delete the legacy version before landing the new one.
- Update or remove tests in lockstep; don’t leave dead tests referencing deleted code.
- Prefer fail-fast errors with actionable messages (per AGENT rules).
- Each phase should leave the repo green; if a phase requires large changes, consider sub-steps but still land them fully (no partially migrated states).

Keep this document up to date if we discover new sub-steps or need to adjust scope. When context resets, reload this file and resume at the current unchecked phase. Remember to remove this plan once Phase 5 is complete.



# Issues need to be fixed:
### 1. Dimension Namespacing

  Goal: i, j, k remain author-friendly tokens, but the canonical graph treats them as unique per node/namespace.

  Plan:

  1. Collect dimension scopes while building the blueprint graph. For every artefact or producer edge that declares [symbol], record
     (nodeId, symbol) → source input.
  2. Store scoped keys in resolveDimensionSizes: instead of a flat Map<string, number> keyed by symbol, use Map<string, number> keyed
     by namespaceKey(nodeId, symbol). When resolving edges, derive the same scoped key by walking up the namespace path.
  3. Backwards compatibility: if a symbol truly is shared intentionally (same node, same symbol), the map still detects conflicting
     countInput sizes.

  Result: authors can keep writing [i], [j], etc.; internally we never confuse different loops.

  ———

  ### 2. Deterministic Input Collapsing (No Alias Ambiguity)

  Goal: every canonical input/artefact ends up with one ID, matching “Artefact:ScriptGenerator.NarrationScript[i]”.

  Plan:

  1. Restrict collapse to cases where there is exactly one upstream producer/artefact. Instead of throwing when resolveInputAlias sees     multiple inbound edges, choose the canonical artefact that sits at the root of that chain (the child inherits the parent’s ID).
     This is valid because author intent is “this input is just a passthrough of that artefact”.
  2. Stop emitting standalone input nodes after collapsing; their canonical ID becomes the upstream artefact ID. Any edges that
     previously targeted Input:… now target Artifact:… directly.
  3. Edge rewrite: while collapsing, rewrite downstream edges so producers refer to the artefact ID; no alias map needed later.
  4. Validation: if genuinely ambiguous (two different artefacts feeding the same input), we detect it at collapse time and throw with     a clearer error (“Input X receives artefacts A and B; blueprint must disambiguate”). This is the true misconfiguration scenario.

  Result: each logical artefact/input has one canonical ID, and the rest of the pipeline (planner, runner, providers) never deals with  alias maps.

  ———

  ### 3. Planner / Runner alignment

  With canonical IDs guaranteed unique:

  1. Planner uses the canonical edges directly; ProducerGraphNode.inputs already list canonical IDs, so no change needed except
     removing the alias-building helper.
  2. Runner no longer needs to merge alias names. resolveArtifactsFromEventLog already keys by canonical IDs; we simply drop the alias     augmentation logic and pass resolvedInputs[canonicalId] through.
  3. Provider runtime still gets resolvedInputs + sdkMapping, but the mapping now points directly to canonical IDs, so
     runtime.sdk.buildPayload becomes a simple lookup without fallback heuristics.

  ———

  ### 4. Validation & Tests

  1. Add integration fixture that mirrors image-only.toml (segment loop feeding prompt generator, which feeds image
     generator). Expand it via expandBlueprintGraph to ensure no duplicate IDs and that artefact IDs look like
     Artifact:ScriptGenerator.NarrationScript[segment=0].
  2. Add regression test in core runner to confirm resolvedInputs contains only canonical keys and providers receive the expected
     payload.
  3. CLI sys test (existing query.test) already catches regressions.