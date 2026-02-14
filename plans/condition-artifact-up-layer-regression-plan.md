## Fix Plan: `HasTransition` Artifact Regression + `--up`/`--explain` Layer Limit Bug

### Summary
We will fix two regressions together:

1. `--up` / `--up-to-layer` is parsed in CLI but not forwarded into planning for explain/cost views, so `--explain` currently shows the full plan.
2. Condition-leaf artifacts (like `Artifact:DirectorProducer.Script.Characters[0].HasTransition`) are being treated as missing in planning, causing unnecessary layer-0 rescheduling.

The implementation will preserve strict canonical IDs and fail-fast behavior by fixing canonical condition-artifact materialization/recognition at the source (no fallback logic).
We will add regression tests that use real planner/execution flows (minimal/no mocking) and stronger assertions on exact job reasons.

---

### Code Changes (Decision Complete)

1. **Wire `upToLayer` end-to-end in CLI planning path**
- File: `cli/src/lib/planner.ts`
- Add `upToLayer?: number` to `GeneratePlanOptions`.
- Pass `upToLayer` through to `createPlanningService(...).generatePlan(...)`.
- File: `cli/src/commands/execute.ts`
- Ensure `runExecute` forwards `upToLayer` to `generatePlan(...)` consistently for `--explain`, `--costs-only`, and normal plan generation.
- Reconcile messaging around dry-run behavior so output matches actual behavior (no “limit ignored” message if limit is now honored in plan generation).

2. **Fix canonical condition-artifact pipeline (no fallbacks)**
- Files: `core/src/planning/planner.ts`, `core/src/resolution/producer-graph.ts` (and, if needed, helper in orchestration/planning layer).
- Keep canonical IDs as source of truth.
- Ensure producer output extraction, producer graph connectivity, and planner missing-artifact checks agree on the exact same canonical IDs for condition leaves (for example `Artifact:DirectorProducer.Script.Characters[0].HasTransition`).
- Do not infer, derive, or backfill condition leaves from parent artifacts during planning.
- If a required canonical condition artifact is missing at plan time, fail immediately with a descriptive error and stop plan generation.
- This fixes the regression at the root instead of masking it.

3. **Improve explanation fidelity for debugging**
- File: `core/src/planning/planner.ts` and explanation mapping
- Ensure `producesMissing` reasons include exact canonical IDs and producer job IDs so missing condition artifacts are immediately diagnosable.
- Ensure failure diagnostics clearly state that canonical condition artifacts are required and no fallback path is used.

4. **Strengthen CLI flag alias behavior coverage**
- Ensure `--up=1` and `--up-to-layer=1` paths are both asserted via test coverage (not only internal option objects).

---

### Public API / Interface / Type Changes

1. **CLI internal planning options**
- `cli/src/lib/planner.ts`:
  - `GeneratePlanOptions` gains `upToLayer?: number`.

2. **No external user-facing breaking change**
- CLI flags remain same.
- Behavior changes to align with expected semantics:
  - `--explain --up=1` now produces a layer-limited plan/explanation.

---

### Testing Strategy (Regression-First, Minimal Mocking)

#### A) CLI regression tests (real flow, stronger assertions)
1. **`--explain` honors `--up` alias**
- New/updated e2e in `cli/tests/end-to-end/...`
- Use `runExecute`/`runGenerate` path with `explain: true`, `upToLayer: 1` (and a CLI alias path test for `--up`).
- Assert:
  - planned jobs are only from layers `<= 1`
  - explanation summary layer count and job count are bounded accordingly
  - no layer > 1 job appears in plan JSON

2. **Condition artifact no false layer-0 reschedule**
- Add a dedicated regression e2e fixture replicating the failing pattern (`...HasTransition` conditional dependency).
- Execute baseline run, then re-plan with unchanged inputs.
- Assert:
  - `Producer:DirectorProducer` (or equivalent upstream producer) is **not** scheduled for `producesMissing` when canonical condition artifacts were produced correctly.
  - downstream planning still uses condition correctly.
  - if canonical condition artifacts are intentionally removed/corrupted, planning fails hard with an explicit missing-canonical-artifact error (no fallback from parent artifact).

#### B) Core planner tests (focused, deterministic, low mocking)
1. **`determineInitialDirtyJobs` condition artifact coverage**
- Add tests in `core/src/planning/planner.test.ts` for:
  - condition leaf artifact expected + present canonically => not dirty
  - condition leaf artifact expected + missing canonically => hard failure with explicit error
- Assert exact `jobReasons` payload, not just plan size.

2. **`upToLayer` propagation integration**
- Add integration-level test in planning/orchestration layer that ensures passed `upToLayer` actually affects generated plan layers (not only execution-time layer skipping).

#### C) Existing tests to harden (addressing current weakness)
- Update weak assertions that currently only check “plan has jobs” or “no throw”.
- Replace with:
  - exact producer set assertions
  - exact reason assertions (`producesMissing`, `propagated`, etc.)
  - explicit non-presence checks for unexpected layer-0 jobs

---

### Why Existing Tests Missed It (and how this plan fixes that)
- Current tests validate condition artifact production on fresh runs, but not **re-planning against existing persisted state** where this regression appears.
- Current surgical/up-layer tests allow “plan contains full jobs” assumptions and focus on execution, not explain/plan correctness.
- Current tests rely on broad success checks; they don’t assert exact scheduling reasons and layer boundaries.

This plan adds stateful regression tests and exact reason-level assertions to prevent recurrence.

---

### Assumptions and Defaults
1. We will treat this as a regression, not intended one-time backfill behavior.
2. We will preserve canonical-ID strictness and will not add any fallback or alias-guessing behavior.
3. We will prioritize correctness of planning/explanation semantics over maintaining prior “full plan in dry-run explain output” behavior.
4. We will avoid introducing new dependencies and avoid mock-heavy replacements unless absolutely necessary for isolation.
