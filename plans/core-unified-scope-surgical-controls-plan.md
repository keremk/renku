# Core-Unified Scope + Surgical Planning Controls Plan

Date: 2026-04-05

## Non-Negotiable Engineering Constraints

  - Layered architecture:
      - All scheduling/validation/precedence logic lives in core planning services.
      - cli only parses flags and renders output; viewer only captures UI state and calls server APIs.
  - Always respect CanonicalID. All ids must be canonical internally and converted to canonical ids as soon as they are parsed from sources of input.
      - Never introduce aliases, fallbacks, guesses for canonical ids.
  - Error architecture:
      - Use numbered core error codes for all invalid combinations and invalid producer/count/dependency cases.
      - Fail fast; no silent fallback, no implicit substitution, no guessing. Errors can also be in the form of warnings if instructed explicitly in the plan.
  - Dirty planning integrity:
      - Existing dirty logic remains the baseline source of schedulable work.
  - Testability:
      - Core logic must be fully unit testable with a comprehensive coverage and test matrix of edge cases.
  - Fixture discipline:
      - Integration/E2E tests use package-owned fixtures only.
      - No cross-package fixture dependency.
      - No tests referencing catalog blueprints; use targeted, explicitly named local fixture blueprints.

## 1) Goal and Design Promise

We want one clean planning model that matches product behavior across CLI and Viewer:

- `core` owns all scheduling semantics.
- CLI and Viewer are clients that only collect input and display output.
- Baseline planning (dirty tracking + dependency graph) remains the source of truth.
- User controls modify baseline behavior through two explicit layers:
  - Scope controls: `--up`, `--pid`
  - Surgical controls: `--regen`, `--pin`

### Success criteria

- Same logical request from Viewer and CLI yields the same plan.
- `--up` is always honored, even when producer overrides exist.
- Unmentioned producers run normally (inherit baseline behavior).
- Producer disable and cap behavior is explicit, deterministic, and test-covered.
- Out-of-scope control inputs are ignored with explicit warnings (never silently).
- Core test matrix covers all scope/surgical combinations and edge cases.

---

## 2) Shared Mental Model (Product Semantics)

This model will be the canonical behavior contract.

### Baseline layer

- Baseline planner computes what should run from dirty/missing/failed/dependency state.
- Baseline planner does not know about UX mode differences.

### Scope controls (shape the run boundary)

- `upToLayer`:
  - Include only jobs in layers `<= upToLayer`.
  - Always applied when provided.

- Producer directives (`--pid`):
  - Directives are **per-producer constraints**, not global allow-list mode.
  - If producer is omitted, it inherits baseline behavior.
  - Every `--pid` entry must include an explicit count (`Producer:<Id>:<count>`).
  - `Producer:X:2` means cap producer X to first-dimension count 2.
  - `Producer:Y:0` means producer Y disabled.
  - If a producer is beyond `> upToLayer`, it does not run. `upToLayer` strictly controls the upper bound. If directives exists beyond the `upToLayer` they are ignored with a warning. 

### Surgical controls (force/restrict regeneration decisions)

- `--regen` forces regeneration targeting artifacts/producers within scope.
- `--pin` keeps artifacts from regeneration when in scope and ignored when out of scope.
- Both are applied on top of baseline + scope.

### Precedence and validity

- Scope is evaluated first as run boundary.
- Surgical controls are then applied within that boundary.
- Conflicting directive and resolution examples:
  - A producer is marked for regen but it is out of the scope to run. It does not run.
  - A Producer:X is pinned and also the --pid mentions the Producer:X:2. Producer:X:2 defines the scope of the action, it should not impose the action. Producer:X does not run because it is pinned.
  - A Producer:X is marked for regen and also the --pid mentions the Producer:X:2. Producer:X only regenerates 2 artifacts. The action is regeneration, pid defined the scope.
  - A Producer:X is marked for regen and also the --pid mentions the Producer:X:0. Producer:X does not run because it is out of scope.
- If a surgical request conflicts with scope (for example target outside `upToLayer`), core ignores with a warning. Warning is visible in the CLI planning summary. In the viewer, it is normal for users to pin or mark for regeneration but freely change the scope, we should continue enabling this. Being out of scope is the same as not running something. 
  - For testing, core should provide warnings back to the caller and tests should assert these warnings to ensure that the correctness of the final plan.
- Other conflict scenarios:
  - Producer:X is marked both for --regen and --pin. This is a conflict and hard error. The viewer UI should prevent this from happening in the first place. The CLI should return an error, no valid plan can be generated.
  - Producer:X is in layer 5 but it is marked in --pid. Layer `--up=3`. --up wins. This is not a hard error but a warning.

---

## 3) Core Interface Consolidation

Introduce one canonical core input contract for user controls and one canonical resolved output contract.

## Proposed canonical input types (core)

```ts
interface PlanningScopeControls {
  upToLayer?: number;
  producerDirectives?: ProducerDirective[];
}

interface ProducerDirective {
  producerId: string;          // canonical Producer:...
  count: number;               // integer >= 0; 0 disables, >=1 caps first-dimension count
}

interface PlanningSurgicalControls {
  regenerateIds?: string[];    // canonical Artifact:... or Producer:...
  pinIds?: string[];           // canonical Artifact:... or Producer:...
}

interface PlanningUserControls {
  scope?: PlanningScopeControls;
  surgical?: PlanningSurgicalControls;
}
```

## Proposed canonical resolved output (core internal)

```ts
interface ResolvedPlanningControls {
  effectiveUpToLayer?: number;
  blockedProducerJobIds: string[];       // from disable/caps
  cappedProducerJobIds: string[];        // optional explicit trace for diagnostics
  forcedJobIds: string[];                // resolved from --regen
  pinnedArtifactIds: string[];           // normalized pin targets
  producerSummaries: ProducerRunSummary[];
  warnings: PlanningWarning[];
}

interface ProducerRunSummary {
  producerId: string;
  mode: 'inherit' | 'capped' | 'disabled';
  maxSelectableCount: number;
  effectiveCountLimit: number | null;    // null for inherit/no-directive, 0 disabled
  scheduledCount: number;
  scheduledJobCount: number;
  upstreamProducerIds: string[];
  warnings: string[];
  appliedDirective?: {
    count: number;
  };
}
```

## Interface migration note

- `selectedCount` is currently overloaded and confusing.
- Replace with `effectiveCountLimit` in the new summary contract.
- Keep `selectedCount` temporarily only for compatibility (derived from `effectiveCountLimit`) and deprecate in one follow-up step.

---

## 4) Single Consolidation Pipeline in Core

Create a single orchestration function in `core` that resolves control semantics before planner execution.

## Proposed module

- New module: `core/src/orchestration/planning-controls.ts`

## Proposed public function

```ts
resolvePlanningControls(args: {
  producerGraph: ProducerGraph;
  baselineInputs: {
    upToLayer?: number;
    regenerateIds?: string[];
    pinIds?: string[];
  };
  userControls?: PlanningUserControls;
  latestSnapshot: LatestArtifactSnapshot;
  manifest: Manifest;
}): ResolvedPlanningControls
```

## Resolution algorithm (single source of truth)

1. Validate and normalize canonical IDs for all controls.
2. Normalize producer directives:
   - Require explicit `count` for every directive.
   - Interpret `count=0` as disabled; `count>=1` as cap.
   - Enforce duplicates/unknown IDs as hard errors.
3. Build producer family map and cardinality metadata.
4. Compute producer-blocked job set from disable/caps only.
   - No global allow-list pruning for unmentioned families.
5. Resolve explicit regenerate targets to concrete job/artifact targets.
6. Apply scope validity checks to regenerate targets.
   - Out-of-scope target => ignored with structured warning.
   - Out-of-scope producer directives => ignored with structured warning.
7. Resolve and validate pins against regenerate set and artifact reusability.
   - Pin/regen overlap on the same target => hard error.
8. Return `ResolvedPlanningControls`, warnings, and deterministic producer summary.

Planner invocation then becomes simple and stable:

- `upToLayer = resolved.effectiveUpToLayer`
- `blockedProducerJobIds = resolved.blockedProducerJobIds`
- `forceTargetJobIds = resolved.forcedJobIds`
- `pinnedArtifactIds = resolved.pinnedArtifactIds`

Important: remove any branching like `hasOverrides ? undefined : upToLayer`.

---

## 5) Client Responsibilities (Thin Adapters)

## CLI responsibilities

- Parse CLI flags to canonical `PlanningUserControls`.
- Keep CLI syntax ergonomic but normalize in adapter layer:
  - `Producer:X:0` means disabled.
  - `Producer:X` (no count) is invalid.
- Do not apply scheduling semantics in CLI command layer.
- Never suppress `--up` when `--pid` exists.
- Always print planning warnings in CLI planning output.

## Viewer responsibilities

- Build the same `PlanningUserControls` payload from UI state.
- Do not simulate planner semantics in viewer context.
- Display `ProducerRunSummary` fields from core response.
- Display core warnings in plan UI as non-blocking notices.
- Copy CLI command generation should serialize the same controls:
  - include both `--up` and `--pid` when both present.
  - include disable as `--pid Producer:Y:0`.

## Shared cross-client guarantee

- Both clients must route through the same core contract.
- Any behavior difference across surfaces is treated as a bug.

---

## 6) Implementation Plan (No Feature Behavior Hidden in Clients)

## Phase A: Core semantic extraction and contract setup

1. Add `planning-controls.ts` with normalization + resolution pipeline.
2. Move producer override normalization and summary generation under this module.
3. Move regen-scope validation and pin interaction checks under this module.
4. Replace ad hoc branches in `planning-service.ts` with resolved controls output.
5. Introduce/align runtime warning and error codes:
   - warnings for out-of-scope controls,
   - hard errors for true contradictions and invalid inputs.

## Phase B: Remove split semantics and dead paths

1. Remove `hasOverrides`-driven scope decisions.
2. Remove implicit selected-only behavior from producer directive presence.
3. Ensure unmentioned families inherit baseline behavior.
4. Update summary fields (`effectiveCountLimit` primary, `selectedCount` compatibility alias if needed).
5. Ensure out-of-scope directives are warning-based ignores, not planning failures.

## Phase C: CLI and Viewer adapter alignment

1. CLI `--pid` parser requires explicit `:<count>` for every entry, accepts `:0` for disable.
2. CLI stops suppressing `upToLayer` when producer directives exist.
3. Viewer plan handler/copy command includes both `--up` and `--pid` as provided.
4. Viewer UI consumes new summary fields; remove dependence on ambiguous `selectedCount` semantics.

## Phase D: Regression hardening and cleanup

1. Add compatibility tests for legacy payload forms (if needed).
2. Remove obsolete branches and comments referencing previous mode split.
3. Update help text and docs to reflect single model.

---

## 7) Test Matrix (Core-First, Full Edge Coverage)

The matrix below is the minimum required. Most of these should be unit tests in core, with a focused set of integration tests.

## A. Baseline-only controls

1. No controls: baseline dirty result unchanged.
2. `upToLayer` only:
   - limits layers strictly.
   - higher-than-max layer is no-op.
3. Clean manifest + no controls => empty plan.

## B. Producer directives only (`--pid`)

1. Unmentioned producer inherits baseline scheduling.
2. `Producer:X:2` caps first-dimension count.
3. `Producer:Y:0` disables Y.
4. `Producer:X` (no count) fails fast.
5. Duplicate directive fails fast.
6. Unknown producer ID fails fast.
7. Out-of-range count fails fast.
8. Multi-dimensional producer cap semantics (`count * inner-dim`) validated.

## C. `upToLayer` + producer directives

1. `upToLayer` remains active when directives exist.
2. Disable-only directive does not clear layer cap.
3. Cap + layer together limits both dimension and depth.
4. `--pid` targeting a producer above `upToLayer` is ignored with warning.
5. Scoped-out producers are excluded without failing plan generation.

## D. Surgical controls inside scope

1. `regen` artifact in-scope forces scheduling as expected.
2. `regen` producer in-scope forces producer jobs.
3. `pin` keeps reusable artifacts from regeneration.
4. `regen` + `pin` on different targets combines correctly within scope.

## E. Surgical controls conflicting with scope

1. `regen` target above `upToLayer` => ignored with warning.
2. `regen` target disabled by producer directive (`Producer:X:0`) => ignored with warning.
3. `pin` target outside scope => ignored with warning.
4. Warning payload includes enough detail to explain each ignored control.

## F. True hard conflicts and invalid controls

1. Same canonical target appears in both `--regen` and `--pin` => hard error.
2. Unknown producer ID in `--pid` => hard error.
3. Duplicate producer directive => hard error.
4. Missing count in `--pid` (for example `Producer:X`) => hard error.
5. Invalid count format/range (except supported `:0` disable form) => hard error.

## G. Summary metadata correctness

1. `effectiveCountLimit` reflects inherit/cap/disable correctly.
2. `scheduledCount` matches scheduled jobs.
3. No synthetic zero counts for untouched producers.
4. Warnings appear only when actually relevant.

## H. Cross-client parity tests

1. Viewer payload and CLI payload equivalent -> identical core plan output.
2. CLI command roundtrip from Viewer includes all controls (`--up`, `--pid`, `--regen`, `--pin`) and reproduces plan.

## I. Existing regression reproduction tests (must be permanent)

1. P1 regression guard: disable-only override + `upToLayer` keeps cap active.
2. P2 regression guard: untouched producers do not report misleading `selectedCount=0` (or equivalent field semantics).
3. Out-of-scope regen/pin/directive warnings are asserted in plan response tests.

---

## 8) Acceptance Criteria

Implementation is complete only when all of the following are true:

1. Core has one control-resolution module that owns scope+surgical semantics.
2. `planning-service` no longer carries split/duplicated override logic.
3. CLI and Viewer both pass only canonical controls, no semantic branching.
4. `--up` and `--pid` can be combined and are both honored.
5. Unmentioned producers follow baseline planner behavior.
6. Full matrix tests pass in core; parity tests pass in CLI/viewer.
7. No silent drops: ignored out-of-scope controls emit warnings.
8. True contradictions (for example same-target `--regen` + `--pin`) fail fast.

---

## 9) Migration/Compatibility Notes

- The project has not shipped publicly. We want to keep a very clean codebase with no backwards compatibility and fallbacks. So remove all obsolete APIs, code etc. immediately in the same PR.
- If `selectedCount` is currently consumed in UI:
  - migrate UI in same PR and remove it cleanly.
- Prefer same-PR migration to avoid dual semantics living too long.

---

## 10) Suggested Delivery Slices

1. Core contract + resolver + core tests (no client changes yet).
2. CLI adapter update + CLI tests.
3. Viewer server/client adapter update + viewer tests.
4. Parity/integration tests + docs/help cleanup.

This sequencing keeps semantics stable, reviewable, and easy to bisect if behavior changes.
