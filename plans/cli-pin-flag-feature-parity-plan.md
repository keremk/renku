# CLI Feature Parity Plan: `--pin` Support with Systematic Error Codes

## Summary

This plan adds CLI parity with Viewer pinning by introducing repeated `--pin` flags on `renku generate`, with support for canonical artifact IDs and canonical producer IDs.

The plan is intentionally aligned with Renku's structured error system:

- `createRuntimeError(...)`
- `RuntimeErrorCode.*`
- CLI display using `isRenkuError(...)` + `formatError(...)`

This avoids plain ad-hoc `Error(...)` for new validation paths and ensures every failure mode is machine-identifiable and user-readable.

## Goal

Enable flows like:

```bash
renku generate --movie-id=foo --inputs=./inputs.yaml --pin="Artifact:ScriptProducer.NarrationScript[0]"
renku generate --last --inputs=./inputs.yaml --pin="Producer:ScriptProducer" --from=1 --up=2
renku generate --last --inputs=./inputs.yaml --pin="Artifact:..." --pin="Producer:..."
```

while preserving existing flags (`--up`, `--re-run-from`, `--artifact-id` / `--aid`) and keeping behavior deterministic and fail-fast.

## Architecture Guardrail (Mandatory)

There must be no behavior divergence between CLI and Viewer.

To guarantee this:

1. All pin business logic (validation, normalization, producer expansion, reusability checks, conflict checks) lives in `core`.
2. CLI and Viewer only collect user input and pass it through.
3. CLI and Viewer must both call the same `core` planning-service contract for pin handling.
4. No duplicate pin logic in `cli/*` or `viewer/*` beyond basic transport/parsing.

## Locked Decisions

1. `--pin` accepts only canonical IDs:
   - `Artifact:...`
   - `Producer:...`
2. `--pin` requires targeting an existing movie (`--last` or `--movie-id/--id`).
3. Invalid / unknown / non-reusable pins fail fast with structured runtime errors.
4. Conflict between pinning and surgical regeneration on the same artifact fails fast.
5. Surgical `--artifact-id/--aid` keeps short-ID compatibility for now, but docs move to canonical IDs (deprecation phase).

## Why Error-System Alignment Matters

Without code-based errors, CLI failures are hard to test and hard to reason about.

With code-based errors we get:

- stable behavior checks in tests (`error.code === 'Rxxx'`),
- structured suggestions surfaced to users,
- clear mapping from failure type to fix.

## Error Code Strategy

### New runtime codes to add in `core/src/errors/codes.ts`

Add the following to `RuntimeErrorCode` under planning/execution range:

- `PIN_REQUIRES_EXISTING_MOVIE: 'R121'`
- `INVALID_PIN_ID: 'R122'`
- `PIN_PRODUCER_NOT_FOUND: 'R123'`
- `PIN_TARGET_NOT_REUSABLE: 'R124'`
- `PIN_CONFLICT_WITH_SURGICAL_TARGET: 'R125'`

Notes:

- These are runtime concerns (CLI planning/execution flow), so `R` category is correct.
- Keep messages descriptive and include `context` and `suggestion` on every throw.

### Error construction standard

All new failures must use:

```ts
throw createRuntimeError(RuntimeErrorCode.SOME_CODE, 'message', {
  context: '...',
  suggestion: '...'
});
```

No plain `throw new Error(...)` for new pin-related validations.

### CLI error rendering standard

In `cli/src/cli.tsx`, for the `generate` command catch path:

- If error is RenkuError (`isRenkuError(error)`), log `formatError(error)`.
- Otherwise keep fallback `Error: ...` formatting.

This ensures users see code + suggestion, not only raw text.

## Implementation Plan

## 1) CLI Flag Parsing and Validation (`cli/src/cli.tsx`)

### Changes

1. Add Meow flag:
   - `pin: { type: 'string', isMultiple: true }`
2. Extend typed flags with `pin?: string[]`.
3. Collect `pinFlags = flags.pin ?? []`.
4. Pass pin flags into `runGenerate` as `pinIds`.

CLI remains thin here: no pin semantics implemented at this layer.

## 2) Generate Command Plumbing (`cli/src/commands/generate.ts`)

### Interface changes

Extend `GenerateOptions` with:

- `pinIds?: string[]`

### Behavior

1. Keep existing validations for `artifactIds`, `reRunFrom`, etc.
2. Keep surgical ID deprecation behavior:
   - canonical `Artifact:...` accepted directly,
   - short IDs still accepted for now, converted to canonical,
   - emit warning message encouraging canonical use.
3. Forward `pinIds` into `runExecute` as `pinnedIds` without pin-specific business checks.

## 3) Execute Plumbing (`cli/src/commands/execute.ts`)

### Interface changes

Extend `ExecuteOptions` with:

- `pinnedIds?: string[]`

### Behavior

Pass `pinnedIds` through to `generatePlan(...)` in CLI planner layer.

No execution-runner changes needed for this flag; planning handles pin filtering.

## 4) CLI Planner Layer (`cli/src/lib/planner.ts`)

### Interface changes

Extend `GeneratePlanOptions` with:

- `pinnedIds?: string[]`

### Behavior

Pass pin IDs through to `createPlanningService().generatePlan(...)` unchanged.

No pin resolution logic here. This layer is transport only.

## 5) Core Planning Service: Resolve Producer Pins and Validate Reusability

File: `core/src/orchestration/planning-service.ts`

### Interface changes

Extend `GeneratePlanArgs` with:

- `pinIds?: string[]`
- `pinnedProducerIds?: string[]`

Notes:

- Keep `pinnedArtifactIds` for backward compatibility during transition, but `pinIds` is the preferred unified path.
- Existing-movie validation is derived centrally from manifest/event-log state (no wrapper-specific branching).

### New helper flow

Add helper(s), e.g.:

- `resolveAndValidatePinIds(...)`
- `resolvePinnedProducerIdsToArtifacts(...)`
- `validatePinnedTargetsReusable(...)`
- `assertNoPinSurgicalConflict(...)`

### Resolution rules

1. Fail with `R121` if pinning is requested but there is no prior reusable successful artifact state in manifest/event log.
2. For each pin, require canonical prefix:
   - `Artifact:...` or `Producer:...`
   - otherwise `R122`.
3. `Artifact:` pins:
   - keep as canonical artifact IDs.
4. `Producer:` pins:
   - verify producer job exists in producer graph, else `R123`.
   - collect canonical produced artifacts from matching producer node(s).
5. Merge artifact pins from:
   - direct `Artifact:` pins,
   - expanded producer pins,
   - optional legacy `pinnedArtifactIds`/`pinnedProducerIds` fields (temporary compatibility).
6. Deduplicate final pinned artifact IDs.

### Reusability checks

For each resolved pinned artifact, confirm reusable now:

- not latest-failed,
- and has a successful artifact available (event log success or manifest succeeded entry).

If not reusable, throw `R124` with list of failing IDs and reason details.

### Surgical conflict check

If `targetArtifactIds` intersects resolved pinned artifact IDs, throw `R125`.

### Adapter call

Pass only validated resolved artifact pins into planner adapter as `pinnedArtifactIds`.

This keeps planning deterministic and aligned with recent pin correctness fixes.

## 6) Viewer and CLI Wrapper Thinness

### Viewer (`viewer/server/generation/plan-handler.ts`)

Keep viewer as a thin wrapper:

1. Read request payload.
2. Pass `pinIds` (or mapped equivalent) and existing plan options directly to `createPlanningService().generatePlan(...)`.
3. Do not duplicate pin validation/expansion in viewer server code.

### CLI (`cli/src/cli.tsx`, `cli/src/commands/*`, `cli/src/lib/planner.ts`)

Keep CLI as a thin wrapper:

1. Parse repeated `--pin`.
2. Pass through to core planning service inputs.
3. Let core own all semantic decisions and coded failures.

## 7) Docs Updates

## A) `web/src/content/docs/docs/cli-reference.mdx`

Update `renku generate` section:

1. Usage blocks include `--pin=<id>` (repeatable).
2. Options table adds `--pin` with canonical-format requirement.
3. Add examples for:
   - single artifact pin,
   - producer pin,
   - multiple `--pin` flags,
   - combining with `--from` / `--up`.
4. Update all surgical examples to canonical `Artifact:...` format.
5. Add note that short surgical IDs are deprecated.

## B) `renku-plugin/skills/create-blueprint/docs/comprehensive-blueprint-guide.md`

In debugging/testing command area:

- add one canonical `--pin` example,
- add one canonical surgical example,
- note that canonical IDs are the preferred format.

## C) `renku-plugin/skills/create-blueprint/docs/common-errors-guide.md`

Add troubleshooting entries for:

- invalid pin format (`R122`),
- pin requires existing movie (`R121`),
- unresolved producer pin (`R123`),
- non-reusable pinned targets (`R124`),
- pin/surgical conflict (`R125`).

## Test Plan

## CLI tests (`cli/src/commands/generate.test.ts`)

Add cases:

1. `--pin` on new movie fails with `R121` (originating from core).
2. Non-canonical `--pin` fails with `R122` (originating from core).
3. Artifact pin with existing movie works and excludes expected producer job(s).
4. Producer pin works (expands to artifact pins) and excludes expected jobs.
5. Surgical + pin overlap fails with `R125`.
6. Short `--artifact-id` accepted but warns (deprecation), canonical form preferred.

## Core tests (`core/src/orchestration/planning-service.test.ts`)

Add cases:

1. `pinnedProducerIds` resolves to artifact IDs.
2. Unknown pinned producer fails with `R123`.
3. Non-reusable pinned artifact fails with `R124`.
4. Pin + surgical overlap fails with `R125`.
5. Valid mixed producer+artifact pins pass through and influence plan as expected.

## Viewer tests (`viewer/server/generation/plan-handler.test.ts` + integration-style server tests)

Add or extend tests to confirm thin-wrapper behavior:

1. Viewer forwards pin inputs to core planning service unchanged.
2. Viewer returns core error code for pin validation failures (e.g. `R122`, `R124`) without reinterpreting logic.
3. No viewer-local pin resolution logic is required for correctness.

## Error rendering tests (CLI)

Add lightweight coverage that `generate` command catch path formats RenkuError via `formatError(...)` so code and suggestion are shown.

## Recommended verification commands

Per repo rules:

```bash
cd core && pnpm vitest run src/orchestration/planning-service.test.ts --pool=threads --poolOptions.threads.singleThread
cd cli && pnpm vitest run src/commands/generate.test.ts --pool=threads --poolOptions.threads.singleThread
```

Optional broader confidence:

```bash
cd core && pnpm vitest run src/planning/planner.test.ts --pool=threads --poolOptions.threads.singleThread
```

## API / Type Changes Summary

1. `cli/src/commands/generate.ts`
   - `GenerateOptions.pinIds?: string[]`
2. `cli/src/commands/execute.ts`
   - `ExecuteOptions.pinnedIds?: string[]`
3. `cli/src/lib/planner.ts`
   - `GeneratePlanOptions.pinnedIds?: string[]`
4. `core/src/orchestration/planning-service.ts`
   - `GeneratePlanArgs.pinIds?: string[]`
   - `GeneratePlanArgs.pinnedProducerIds?: string[]` (compat bridge)
   - existing `pinnedArtifactIds?: string[]` used after resolution/validation
5. `core/src/errors/codes.ts`
   - add `R121-R125` pin-related runtime codes

## Rollout Notes

- This is backward-compatible for current users except invalid pin usage (new strict checks).
- Surgical short IDs remain temporarily accepted but docs switch to canonical now.
- No fallback behavior is introduced; all unknowns fail with explicit coded errors.

## Assumptions

1. Canonical producer IDs map to job IDs prefixed with `Producer:` in graph.
2. Producer pin means pin all canonical artifacts produced by that producer node(s).
3. Pinning is only meaningful for existing runs where prior artifacts can be reused.
4. Both CLI and Viewer call the same core pin logic; no wrapper-specific semantics.
