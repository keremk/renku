# Preview Binding Integrity Plan (No Fallbacks, No Duplicate Binding Logic)

## Status

- Owner: Core + Viewer models-pane workstream
- Mode: planning document (no implementation in this step)
- Scope: producer binding summaries used by models-pane config + SDK preview

## Why This Plan Exists

The preview surface exists to give users confidence **before spending money**. If preview hides missing/invalid wiring behind fallback behavior, it can show a "looks fine" state that fails during generation. That is unacceptable.

This plan makes preview behavior match execution reality:

1. No fallback masking of missing graph/binding state.
2. No duplicate binding inference logic across layers.
3. JSON field references (`Producer.Artifact.Path...`) stay correct and regression-safe.

## How JSON Works Today (Layman Version)

Think of prompt-producer JSON output like a big tree we cut into labeled leaves.

Example:

- A prompt producer returns one JSON blob called `Script`.
- Inside it, there are nested values like:
  - `Characters[0].ThenImagePrompt`
  - `Characters[0].MeetingVideoPrompt`
  - `Characters[1].ThenImagePrompt`

What the system does:

1. It uses `meta.outputSchema` + `artifacts[].arrays` metadata to understand the JSON shape.
2. It creates virtual leaf artifacts for each routable value.
3. It builds graph edges from those leaves to downstream producer inputs.
4. At runtime, providers read JSON values by path and emit one artifact event per leaf artifact ID.

So generation is not using one opaque JSON artifact only. It uses many decomposed leaf artifacts, each with a canonical ID, and those IDs are what downstream jobs consume.

## Non-Negotiables

1. **No masking fallbacks** in binding summary logic.
2. **No heuristic alias guessing** (`best effort` parsing when canonical nodes are missing).
3. **JSON field references must resolve through canonical graph nodes**, not string tricks.
4. **Viewer must not duplicate core binding logic** for the same contract.
5. **Package-local fixtures only** (core fixtures in `core/tests/fixtures`, viewer fixtures in `viewer/server/fixtures`).
6. **Errors must be explicit** (typed/runtime) when the preview contract cannot be trusted.
7. **Do not rewrite canonical-expander JSON/alias mechanics as part of fallback cleanup** unless characterization tests prove behavior-equivalence first.

---

## Deep Dive Findings (Current Behavior)

## 1) Where binding summaries are consumed

- `viewer/server/blueprints/config-schemas-handler.ts` uses `buildProducerBindingSummary(...)` to classify mapping sources.
- `viewer/server/blueprints/sdk-preview-handler.ts` uses `buildProducerBindingSummary(...)` to build preview input context.
- `viewer/server/blueprints/mapping-binding-context.ts` is a pure re-export from core.

Implication: viewer boundary tests for that re-export provide little value and duplicate core behavior.

## 2) Why JSON field references are fragile today

JSON field references in connections (example `AdScriptProducer.AdScript.CharacterImagePrompt`) are resolved in graph building only if decomposed artifact nodes exist.

Current canonical graph decomposition requires artifact schema on the artifact (`artifact.schema`), but many producer blueprints provide schema via `meta.outputSchema` file and not inline artifact schema.

### Critical details

- Parser records `meta.outputSchema`, but does **not** load and attach it to `artifact.schema` during tree load.
- `buildBlueprintGraph(...)` node creation/decomposition depends on `artifact.schema` being present.
- When a connection references a JSON leaf path and the node does not exist, edge `from.nodeId` can exist without a matching node.

## 3) Measured evidence from catalog scan

Using a scan over loadable catalog blueprints:

- Loaded blueprints: `16`
- Total canonical edges: `718`
- Missing source endpoint nodes (`edge.from.nodeId` not present): `23`
- Missing target endpoint nodes: `0`

All 23 missing source endpoints are JSON output field references from prompt/script producers (for example):

- `AdScriptProducer.AdScript.CharacterImagePrompt`
- `DirectorProducer.Script.Characters[character].ThenImagePrompt`
- `DocProducer.VideoScript.Segments[segment].TalkingHeadText`

## 4) What Is Actually Fallback vs Core Runtime Mechanic

Important distinction:

1. `core/src/resolution/producer-binding-summary.ts` contains true preview-side fallback behavior:
   - `resolveSourceBindingFromNodeId(...)` string-parses missing endpoints.
   - runtime->static downgrade on selected errors.
2. `core/src/resolution/canonical-expander.ts` mostly contains core runtime mechanics that generation depends on:
   - loop/index expansion,
   - alias propagation from inputs to producer bindings,
   - collection-element alias propagation (`Foo`, `Foo[0]`, `Foo[1]`).

The plan treats these differently:

- Summary fallbacks are targeted for removal.
- Canonical-expander behavior is preserved first and only tightened behind characterization tests.

## 5) Key validation result

When output schemas are hydrated from producer `meta.outputSchema` and applied before graph build, missing endpoint count dropped from `23` to `0` in the same scan.

This indicates summary-level masking fallbacks are not fundamentally required if schema hydration/integrity is done correctly.

It also explains the historical behavior:

- generation path usually worked because planning applies output-schema hydration,
- preview path could drift because it did not always apply the same hydration contract before deriving bindings.

## 6) Keep vs Change (Explicit)

### Keep (first wave)

- JSON decomposition model (one structured output -> many leaf artifact IDs).
- Existing `resolveEdgeEndpoint(...)` JSON reference semantics.
- Canonical-expander alias/loop/collection propagation behavior.

### Change (first wave)

- Ensure preview callsites hydrate output schemas the same way generation does.
- Remove summary-side masking behavior and heuristic source parsing.
- Remove duplicate viewer boundary test burden where viewer only re-exports core logic.

### Optional Later (only if proven safe)

- Tighten canonical-expander unresolved-upstream behavior from tolerant to strict, but only after compatibility characterization proves no JSON routing regressions.

---

## Design Principles for the Fix

1. **Graph integrity first**: binding summary must consume a complete canonical graph.
2. **Generation parity first**: preview must use the same schema hydration assumptions as planning/runtime.
3. **Single binding contract owner**: core only.
4. **Fail fast on structural issues**: unresolved graph nodes are errors, not inferred aliases.
5. **No speculative JSON inference**:
   - do not infer array dimension mappings from names,
   - do not invent selectors,
   - rely on declared `arrays` metadata + output schema.
6. **Preserve existing JSON path semantics** in `resolveEdgeEndpoint(...)`:
   - progressive namespace split,
   - full node-name vs stripped node-name lookup,
   - constant-index preservation in final segment.
7. **Do not conflate fallback cleanup with expander redesign** in one change.

---

## Target End State

1. Every canonical graph edge endpoint points to an existing node (for supported blueprint trees after schema hydration).
2. `buildProducerBindingSummary(...)` does not parse missing node IDs as fallback aliases.
3. Runtime fallback branches in summary are removed.
4. Canonical-expander JSON/alias mechanics remain behavior-equivalent in first wave (no accidental redesign).
5. Viewer handlers consume a strict binding contract from core.
6. Viewer no longer carries duplicate boundary tests/fixtures that only mirror core exports.

---

## Implementation Plan

## Phase 0 - Safety Net Before Refactor

### Goals

- Lock current JSON reference behavior with characterization tests before changing internals.

### Deliverables

1. Core characterization fixtures (package-local):
   - scalar JSON field reference,
   - array JSON field reference with declared `arrays` path,
   - nested array JSON field reference,
   - loop selector reference (`[segment]`, `[character]`).
2. Core tests asserting endpoint integrity after schema hydration.
3. Remove low-value viewer boundary duplication test and its mirrored fixture copies:
   - remove `viewer/server/blueprints/mapping-binding-context.test.ts` (or reduce to minimal smoke import test only),
   - remove viewer fixture copies that existed only for re-export boundary parity.

### Exit Criteria

- JSON reference characterization tests are green and fail if resolver semantics drift.

---

## Phase 1 - Shared Output-Schema Hydration (Core)

### Goals

- Ensure graph-building callsites that need preview correctness can materialize JSON field nodes.

### Deliverables

1. Introduce a core utility (new module) to hydrate output schemas from producer metadata:
   - walk blueprint tree nodes,
   - for nodes with `meta.outputSchema`, read and validate schema JSON from `node.sourcePath` relative path,
   - build alias-keyed schema map,
   - apply to corresponding producer artifacts (existing decomposition path).
2. Reuse existing mutation helper logic (currently in planning service) instead of duplicating schema application paths.
3. Keep behavior deterministic:
   - no default schema,
   - no silent ignore when file is missing/invalid,
   - throw typed runtime/parser error.

### Notes

- This phase does **not** change JSON reference resolution rules; it only ensures required schema data is present before graph build.

### Exit Criteria

- Catalog scan endpoint integrity check: unresolved source endpoints reduced to zero for loadable blueprints using hydration utility.

---

## Phase 2 - Preview Path Parity + Source Node Strictness

### Goals

- Make preview use the same schema-hydrated graph assumptions as generation.
- Remove summary-side heuristic source parsing.

### Deliverables

1. Update preview-callsite flow so schema hydration runs before binding-summary generation:
   - `config-schemas-handler`,
   - `sdk-preview-handler`.
2. In binding summary collection, require source graph node existence for consumed edges.
   - remove `resolveSourceBindingFromNodeId(...)` fallback parsing path.
3. Keep canonical-expander behavior unchanged in this phase.
4. Add/extend runtime error codes/messages for unresolved graph endpoint conditions if needed.

### Exit Criteria

- Preview no longer depends on summary-side source-id string parsing heuristics.

---

## Phase 3 - Remove Summary Fallback Branches

### Goals

- Binding summary should never silently downgrade correctness.

### Deliverables

1. Remove runtime->static fallback set (`RUNTIME_BINDING_FALLBACK_CODES`) in `buildProducerBindingSummary(...)`.
2. Keep explicit mode behavior clear:
   - static graph summary for schema/source classification use-cases,
   - runtime expanded summary for value preview use-cases.
3. Ensure callsites intentionally choose mode and handle typed errors.

### Important UX Handling

Current UI treats `sdkPreviewErrorsByProducer` as blocking producer errors. With strict no-fallback behavior, incomplete user inputs could create excessive blocking.

Plan adjustment:

- SDK preview contract errors due missing runtime inputs should be surfaced as preview warnings/non-blocking status, not hide full config editor.
- Structural graph/schema errors remain blocking.

### Exit Criteria

- No fallback masking remains in producer binding summary flow.

---

## Phase 4 - Optional Canonical-Expander Strictness Audit (Gated)

### Goals

- Decide, with evidence, whether any unresolved-upstream tolerance in canonical-expander should be tightened.

### Deliverables

1. Add targeted characterization tests around `collapseInputNodes` alias behavior for JSON/decomposed cases.
2. Audit all current cases where upstream node lookup misses inside expander.
3. Branch decision:
   - **If safe**: tighten to explicit structural error and keep tests.
   - **If not safe**: keep existing behavior, document why it is runtime-mechanic (not fallback), and lock with tests.

### Exit Criteria

- The expander strictness decision is explicit, documented, and test-backed.

---

## Phase 5 - Viewer/Core Cleanup and Regression Net

### Goals

- Ensure long-term maintainability and prevent reintroduction of fallback creep.

### Deliverables

1. Remove dead fallback code and outdated comments.
2. Add regression tests for:
   - `ThenImageProducer.SourceImages[0]/[1]` correctness,
   - JSON leaf references from script producers,
   - missing schema file behavior (explicit error),
   - unresolved endpoint invariant violations in preview summary path.
3. Remove low-value viewer boundary duplication tests/fixtures where viewer only re-exports core behavior.
4. Add a lightweight endpoint-integrity test helper (core) for fixture/canonical graph checks.

### Exit Criteria

- CI fails on unresolved endpoint regressions rather than allowing runtime fallback.

---

## Detailed Risk Mitigation for JSON Field References

JSON field references have regressed previously, so this plan preserves the resolver contract explicitly:

1. Do **not** rewrite `resolveEdgeEndpoint(...)` matching strategy in the same change as fallback removal.
2. Add golden tests around current resolver semantics:
   - progressively shorter namespace path matching,
   - full decomposed node name matching first,
   - stripped final-segment loop selector fallback,
   - constant index preservation (`[0]`, `[1]`).
3. Land schema hydration parity first, then summary fallback cleanup second.
4. Treat canonical-expander strictness as a separate gated phase, not bundled with summary cleanup.
5. Keep each phase in separate PR to isolate regressions.
6. Validate against both:
   - fixture blueprints (deterministic),
   - representative catalog snapshots (audit script in tests/tooling).

---

## Verification Gates

Before completion:

1. Core tests pass:
   - `pnpm --filter @gorenku/core vitest run src/resolution/producer-binding-summary.test.ts`
   - additional new endpoint integrity/JSON-path characterization tests.
2. Viewer tests pass:
   - `pnpm --filter viewer vitest run server/blueprints/config-schemas-handler.test.ts`
   - `pnpm --filter viewer vitest run server/blueprints/sdk-preview-handler.test.ts`
3. Type checks pass:
   - `pnpm --filter @gorenku/core type-check`
   - `pnpm --filter viewer test:typecheck`
4. No unresolved endpoint tolerance remains in binding summary path.
5. Canonical-expander strictness outcome is documented and test-backed (tightened or intentionally retained).

---

## Definition of Done

The work is complete only when all are true:

1. Preview binding logic has no fallback masking and no heuristic source parsing.
2. JSON field references resolve via canonical graph nodes after schema hydration.
3. Viewer does not duplicate core binding behavior for boundary-parity tests.
4. Missing/invalid graph/schema states are explicit errors, not silent substitutions.
5. `ThenImageProducer` multi-source preview behavior remains correct and regression-tested.
6. Canonical-expander JSON/alias behavior is either:
   - unchanged and locked by characterization tests, or
   - tightened with proof of behavior-equivalence and no JSON-routing regression.
