# Deploy Guide (Maintainers)

This is the source of truth for shipping Renku.

It defines two independent deploy lanes:

- Product releases (versioned): npm packages + desktop updater artifacts + GitHub Release assets
- Website/docs deploys (non-versioned): `web/` only

This separation keeps product versioning strict while still allowing docs/landing updates without forcing a full app release.

## Release lanes

### 1) Product release lane (versioned)

This lane ships all releasable app artifacts with one canonical version and one tag.

- npm packages:
  - `@gorenku/core`
  - `@gorenku/compositions`
  - `@gorenku/providers`
  - `@gorenku/cli`
- desktop updater artifacts (Cloudflare backend):
  - `Renku-<version>-arm64.dmg`
  - `Renku-<version>-arm64-mac.zip`
  - `.blockmap` files
  - updater metadata (`latest-mac.yml` for stable, `dev-mac.yml` for dev)
- Git tag format: `vX.Y.Z`
- GitHub Release tag: `vX.Y.Z`

### 2) Website/docs lane (non-versioned)

Use this when only the landing page/docs changed.

- deploy target: Cloudflare Pages (`web/`)
- no app version bump
- no product release tag
- no npm or desktop publish

## Best-practice distribution strategy (current setup)

- npm remains the primary CLI distribution channel (`npm install -g @gorenku/cli`)
- GitHub Releases are the immutable release ledger and downloadable artifact archive
- Cloudflare stays the desktop auto-updater backend (stable URLs + cache control + dev channel protection)
- Website download links should point to stable Cloudflare alias (`Renku-latest-arm64.dmg`)

## Bump scripts (critical)

These are still central to release hygiene.

- `pnpm bump`
- `pnpm bump:minor`
- `pnpm bump:major`

`scripts/bump-versions.sh` now fails fast if package versions are out of sync before bumping.

## Product release commands

### Safe preflight (no bump, no publish)

```bash
pnpm release:preflight
```

This verifies local release readiness without changing versions, creating tags, publishing npm packages, or uploading artifacts.

Optional flags:

```bash
# Skip heavy quality gate
pnpm release:preflight -- --skip-quality-check

# Allow running preflight on feature branch / dirty tree while iterating
pnpm release:preflight -- --allow-non-main --allow-dirty
```

### Single command (recommended)

```bash
# Patch release, production desktop channel, no web deploy
pnpm release

# Patch release with unsigned desktop build (skip signing/notarization path)
pnpm release:unsigned

# Minor / major variants
pnpm release:minor
pnpm release:major
```

Equivalent explicit command:

```bash
pnpm release:ship
```

Optional flags (explicit script form):

```bash
# include website/docs deployment
node scripts/release/ship.mjs patch --deploy-web

# publish desktop artifacts to internal/dev updater channel
node scripts/release/ship.mjs patch --desktop-channel internal

# keep production channel but skip desktop signing/notarization
node scripts/release/ship.mjs patch --skip-desktop-sign
```

### Staged flow (for control or future CD)

```bash
# Stage 1: bump + checks + build + artifacts + commit + tag
pnpm release:prepare

# Stage 2: push/tag + GitHub Release upload + npm publish + Cloudflare upload
pnpm release:publish -- --tag vX.Y.Z --desktop-channel production
```

Minor/major prepare variants:

```bash
pnpm release:prepare:minor
pnpm release:prepare:major
```

## What `release:prepare` does

`scripts/release/prepare.mjs` performs:

1. Verifies clean git working tree and `main` branch.
2. Verifies versioned packages are in sync before bumping.
3. Bumps versions together (`core`, `compositions`, `providers`, `cli`, `viewer`, `desktop`).
4. Runs `pnpm check` (unless `--skip-check`).
5. Builds desktop package for selected channel (`production` or `internal`).
6. Packs npm tarballs for publishable packages.
7. Collects desktop artifacts and verifies metadata version matches release version.
8. Writes release manifest + SHA256 checksums under `release/vX.Y.Z/`.
9. Creates commit `release: vX.Y.Z` and tag `vX.Y.Z`.

If signing/notarization is not ready, pass `--skip-desktop-sign` to use the unsigned production desktop packaging path.

## What `release:publish` does

`scripts/release/publish.mjs` performs:

1. Validates tag/version consistency (`vX.Y.Z` == package versions).
2. Pushes `main` + tag to origin.
3. Creates/uses draft GitHub Release and uploads release assets.
4. Publishes npm tarballs (skips packages already published).
5. Restores desktop artifacts to `desktop/release/` and uploads to Cloudflare via:
   - `bash scripts/deploy-desktop.sh --production --skip-build`
   - or `--internal --skip-build`
6. Optionally deploys web/docs (`--deploy-web`).
7. Publishes GitHub Release (draft -> published).

Useful stage flags:

- `--skip-push`
- `--skip-github`
- `--skip-npm`
- `--skip-desktop`
- `--deploy-web`

## Website/docs-only deploy

```bash
pnpm release:web
```

This runs the existing Cloudflare Pages flow for `web/` without touching product versions.

## Required credentials

### npm publish

- logged in npm user with access to `@gorenku/*`
- OTP/2FA available at publish time

### GitHub release upload

- authenticated `gh` CLI with repo release permissions

### Desktop Cloudflare upload

In repo root `.env`:

```dotenv
CLOUDFLARE_TOKEN=<token>
CLOUDFLARE_ACCOUNT_ID=<account-id>
```

Desktop deploy details, updater channels, and access rules remain documented in `desktop/UPDATES.md`.

## Workflow examples

### Full product release + docs update

```bash
node scripts/release/ship.mjs patch --deploy-web
```

### Docs-only tweak

```bash
pnpm release:web
```

### Internal desktop channel test release

```bash
node scripts/release/ship.mjs patch --desktop-channel internal
```

## Legacy note

Older `cli-vX.Y.Z` tag references are deprecated. Use `vX.Y.Z` for all new product releases.
