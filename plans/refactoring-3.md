# Boundary/cleanup issues

- canonical-ids.ts (root) is a shared bag of canonical ID helpers (formats/resolvers) used by parsing, resolution, and planning (canonical-ids.ts:3-114). It isn’t stage-scoped, so ownership of “canonical ID definition” is unclear. If parsing is meant to be the single source of canonical ID generation, move/alias this into parsing/ (or a dedicated identifiers/ module referenced by each    stage) and make resolution/planning depend on that, not a global utility.

ANSWER: Actually the ownership is clear. Only the parsing stage can create new canonical IDs. So all canonical ID creation should belong there. Resolution can be done across the codebase of course. So yes we should move generation of canonical IDs to parsing. And then have a global utility for resolving.

- parsing/blueprint-loader/index.ts re-exports buildBlueprintGraph and graph types from resolution (parsing/blueprint-loader/index.ts:1-7), effectively making the parsing package a façade over resolution. This blurs the stage boundary and encourages callers to think graph building is part of parsing. Move those exports to a resolution-facing entrypoint (e.g., resolution/index.ts) and keep the parsing index limited to YAML/tree loading.

ANSWER: Yes, agreed.

- planning/service.ts is a God object in the planning folder. It loads/creates manifests, appends input and artifact events, seeds defaults, builds/expands the blueprint graph, constructs the producer graph, and then calls the planner (planning/service.ts:1-144). That mixes stage 1 (input/default handling), stage 2 (graph build + expansion), and stage 3 orchestration. Consider:
  - Extracting a top-level orchestration layer (outside planning/) to own IO and cross-stage wiring.
  - Keeping planning/ to the pure planner (computePlan) and maybe a thin adapter that only invokes it.

ANSWER: Agreed, and include the thin adapter as well.

- createProducerGraph lives in planning/planner.ts (planning/planner.ts:96-215). It transforms the canonical blueprint into producer job nodes and edges (binding provider options, fan-in specs, and input bindings). That’s connection/expansion work and fits better in the resolution layer (or its own “job-graph” module) to keep planner.ts focused on dirty detection and layer building.

ANSWER: Yes agreed.

- Duplicate canonical name helpers: formatQualifiedName exists in canonical-ids.ts and again in resolution/canonical-expander.ts. Consolidate on the shared helper to avoid drift in naming semantics between stages.

ANSWER: Yes again this should go in the parsing stage after consolidation, since nothing else should be formatting, let me know if I am missing something

- Default seeding is split: parsing/input-loader.ts applies defaults from blueprints when loading inputs, but planning/service.ts also seeds defaults into resolvedInputs after writing events (planning/service.ts:97-144). Decide which stage owns defaulting (ideally parsing/input loading) and remove the duplicate to avoid inconsistent behavior between manual plan generation and other callers.

ANSWER: Yes defaults should be applied after parsing in the parsing module.

- Stage exports: core/index.ts re-exports everything, which is convenient but makes it easy for consumers to bypass stage boundaries. If strict boundaries are desired, consider curated entrypoints per stage (parsing/index, resolution/index, planning/index) and avoid umbrella exports that mix them.

ANSWER: Yes absolutely.