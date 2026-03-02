# Cloudflare/R2 Cleanup Plan

## Context

We have already removed provider-side blob upload fallback behavior and switched to strict native provider uploads:

- Providers now resolve blob inputs only through provider-native upload APIs.
- Live mode fails fast when native upload support is missing.
- CLI and viewer execution paths no longer inject cloud storage into providers.

This plan covers the remaining Cloudflare/R2-related code and docs that are now dead or outdated.

## Current Remaining Surface Area

### Runtime code still in repository

1. `core/src/cloud-storage.ts`

- Contains env loading (`S3_*`), dry-run cloud stubs, and cloud context resolution.
- No longer imported by CLI/viewer/provider runtime code.

2. `core/src/cloud-storage.test.ts`

- Tests only the helper module above.

3. `core/src/index.ts`

- Re-exports `./cloud-storage.js`.

4. `core/src/storage.ts`

- Still defines cloud storage support:
  - `StorageConfig` union member `kind: 'cloud'`
  - `CloudStorageConfig`
  - S3 adapter setup and `temporaryUrl` handling
- After recent provider/CLI/viewer changes, no internal runtime code currently instantiates `kind: 'cloud'`.

5. `core/package.json`

- Still includes `@aws-sdk/client-s3` and `@flystorage/aws-s3` dependencies used only by cloud storage branch in `storage.ts`.

### Docs/config still referencing cloud setup

1. `.env.example`

- `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`
- `CLOUDFLARE_TOKEN`

2. `docs/concurrency.md`

- Mentions S3-compatible/Cloudflare R2 as a storage mode.

3. `renku-plugin/skills/create-blueprint/references/common-errors-guide.md`

- `S043` still instructs users to configure cloud storage env vars for blob inputs.

## Proposal

### Phase 1 - Remove dead helper API (low risk)

Goal: remove unused cloud helper module and exports with minimal behavioral impact.

Changes:

- Delete `core/src/cloud-storage.ts`
- Delete `core/src/cloud-storage.test.ts`
- Remove `export * from './cloud-storage.js';` from `core/src/index.ts`

Why this phase first:

- It removes stale entry points that no longer participate in runtime behavior.
- It keeps the broader storage abstraction untouched for one step.

### Phase 2 - Remove cloud storage branch from core storage abstraction (medium risk)

Goal: fully remove S3/Cloudflare/R2 runtime support from core storage.

Changes:

- In `core/src/storage.ts`:
  - Remove `CloudStorageConfig` type
  - Remove `kind: 'cloud'` from `StorageConfig`
  - Remove cloud adapter branch (`S3Client` + `AwsS3StorageAdapter`)
  - Remove `temporaryUrl` from `StorageContext` (or keep as deprecated optional if we want one transitional release)
- In `core/package.json`:
  - Remove `@aws-sdk/client-s3`
  - Remove `@flystorage/aws-s3`

Notes:

- This is the true removal step and may be a breaking change for any external consumers of `@gorenku/core` using cloud storage directly.
- If we want compatibility padding, we can do a short deprecation cycle before deletion.

### Phase 3 - Update docs and env templates (low risk)

Goal: stop telling users to configure Cloudflare/S3 for file inputs.

Changes:

- Update `.env.example`:
  - Remove S3-related variables unless still needed for another product surface.
  - Remove `CLOUDFLARE_TOKEN` unless there is an active CLI command that consumes it.
- Update `docs/concurrency.md` to reflect actual supported storage modes.
- Update `renku-plugin/skills/create-blueprint/references/common-errors-guide.md`:
  - Replace `S043` cloud-storage guidance with native-upload guidance.

### Phase 4 - Validation and release checks

Minimum checks:

- `pnpm type-check:core`
- `pnpm type-check:providers`
- `pnpm type-check:cli`
- `pnpm test:core`
- `pnpm --filter renku-providers test`

Optional (if we want extra confidence):

- Run targeted provider e2e tests for blob/image inputs in live mode.

## Risks and Mitigations

1. Breaking external API for `@gorenku/core`

- Risk: external users may still rely on `createStorageContext({ kind: 'cloud' })`.
- Mitigation: announce in changelog and version accordingly.

2. Hidden internal references in scripts/docs

- Risk: stale setup docs confuse users after code cleanup.
- Mitigation: include Phase 3 in same PR/stack.

3. Dist artifacts mismatch

- Risk: stale `dist/` may still show removed code until rebuilt.
- Mitigation: rebuild relevant packages before release validation.

## Recommended Execution Order

1. Phase 1 + Phase 3 in one PR (fast cleanup, low risk).
2. Phase 2 in a follow-up PR with explicit breaking-change note.
3. Run Phase 4 validation after each PR.

## Acceptance Criteria

- No runtime code path in CLI/viewer/providers uses Cloudflare/R2/S3 for blob inputs.
- `core/src/cloud-storage.ts` and related exports/tests are gone.
- `core/src/storage.ts` no longer contains cloud storage branch (if Phase 2 completed).
- `.env.example` and docs no longer instruct users to configure cloud storage for blob input handling.
- Typecheck/tests pass for core, providers, and CLI.
