# CLI Recovery Parity Plan

## Goal

Make CLI `renku generate` use the same pre-plan recovery behavior as Viewer:

- Before planning, check recoverable failed artifacts with stored provider request IDs.
- If provider reports completed output, download and persist artifact success event.
- Then plan with the standard precedence model:
  - `dirty-detected` + `explicit regenerate` - `explicit pin`

## Scope

### Change Set B (CLI parity)

1. **Recovery prepass integration in CLI planner path**
   - Hook into `cli/src/lib/planner.ts` before `createPlanningService().generatePlan(...)`.
   - Reuse the same recovery helper logic used by Viewer (shared module in `core` or shared utility package path).

2. **Provider scope (first pass)**
   - Implement `fal-ai` parity first (same as Viewer).
   - Keep behavior deterministic and fail-fast for malformed recovery diagnostics.
   - Recovery attempt itself remains best-effort (non-blocking for planning).

3. **Plan/explain visibility**
   - Extend `--explain` output with a recovery section:
     - checked artifacts
     - recovered artifacts
     - pending artifacts
     - failed recovery attempts
   - Keep output concise and actionable.

4. **Tests**
   - Add CLI coverage for:
     - completed recovery removes unnecessary rerun jobs
     - pending recovery keeps failed artifacts in plan
     - malformed diagnostics does not silently recover
     - dirty + aid + pin precedence remains correct

5. **Docs updates**
   - Update `docs/cli-commands.md`:
     - describe auto recovery on rerun
     - keep quoted canonical ID examples for zsh (`--aid`, `--pin`)
     - clarify precedence model and pin override behavior

## Non-goals for Change Set B

- Adding provider recovery beyond fal-ai.
- Changing planning precedence rules.
- Introducing per-artifact retry command surfaces in CLI.
