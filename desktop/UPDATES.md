# Desktop App Updates

This document explains how Renku desktop updates are configured and released.

## What is implemented

- `Check for Updates...` menu action in the app menu.
- Automatic periodic update checks (startup delay + recurring checks).
- Background download + `Restart to Install Update` flow.
- Catalog sync hook after app version changes.
- Manual `Update Catalog Templates...` menu action.

## Build modes

- Local unsigned package (stable feed metadata):

```bash
pnpm --filter renku-desktop package
```

- Local unsigned package (dev feed metadata):

```bash
pnpm --filter renku-desktop package:dev
```

- Production signed package (stable feed metadata):

```bash
pnpm --filter renku-desktop package:prod
```

Root-level shortcuts:

```bash
pnpm package:desktop
pnpm package:desktop:dev
pnpm package:desktop:prod
```

`package:prod` enables production signing mode with `RENKU_DESKTOP_SIGN=1`.

## Cloudflare R2 layout

Single R2 bucket **`renku-downloads`** (Western Europe / WEUR) with two custom domains:

- Stable (public): `https://downloads.gorenku.com/desktop/stable/darwin/arm64`
- Dev (restricted): `https://updates-dev.gorenku.com/desktop/dev/darwin/arm64`

Recommended objects for each release:

- `Renku-<version>-arm64.dmg`
- `Renku-<version>-arm64-mac.zip`
- `Renku-<version>-arm64-mac.zip.blockmap`
- `Renku-<version>-arm64.dmg.blockmap`
- Stable channel: `latest-mac.yml`
- Dev channel: `dev-mac.yml`

For the website download button, maintain a stable alias object (production only):

- `Renku-latest-arm64.dmg`

## Cloudflare setup checklist

1. Create R2 bucket `renku-downloads`.
2. Attach custom domains (bucket Settings > Custom Domains):
   - `downloads.gorenku.com` (public, stable channel)
   - `updates-dev.gorenku.com` (restricted via Zero Trust)
3. Disable the `r2.dev` public development URL to prevent bypassing access controls.
4. Subscribe to the Zero Trust Free plan (required for Access applications).
5. Create a Service Token under Access Controls > Service Credentials:
   - Name: `renku-desktop-updater`
6. Create an Access Application under Access Controls > Applications:
   - Type: Self-hosted
   - Name: `Renku Dev Updates`
   - Domain: `updates-dev.gorenku.com`
   - Policy action: Service Auth with Service Token selector
7. Configure cache rules (zone-level: gorenku.com > Caching > Cache Rules):
   - **Cache Renku Binaries**: matches `.dmg`, `.zip`, `.blockmap` on both domains.
     Edge TTL = 1 year (ignore origin cache-control).
   - **Bypass Cache Update Metadata**: matches `.yml` on both domains. Bypass cache
     so the updater always fetches fresh version metadata.
8. Upload order for every release:
   - upload binaries first
   - upload `latest-mac.yml` last

### Verifying the setup

```bash
# Public stable -- should return content
curl https://downloads.gorenku.com/desktop/stable/darwin/arm64/latest-mac.yml

# Dev without auth -- should return 403
curl https://updates-dev.gorenku.com/desktop/dev/darwin/arm64/dev-mac.yml

# Dev with service token -- should return content
curl -H "CF-Access-Client-Id: <id>" \
     -H "CF-Access-Client-Secret: <secret>" \
     https://updates-dev.gorenku.com/desktop/dev/darwin/arm64/dev-mac.yml
```

## Deploying releases

> **Important:** electron-updater compares the version in `dev-mac.yml` (from the server)
> against `app.getVersion()` (from the running app). If they match, no update is detected.
> Always bump the version before building a new release.

### Full release workflow

Use the root release pipeline for a full product release (npm + desktop + GitHub Release):

```bash
pnpm release
```

For desktop-only channel testing or ad hoc uploads:

1. **Bump versions** (all packages including desktop):

```bash
pnpm bump           # patch bump (0.1.4 → 0.1.5)
pnpm bump:minor     # minor bump (0.1.4 → 0.2.0)
```

2. **Build + deploy desktop artifacts**:

```bash
pnpm build-deploy-app:dev      # dev channel
pnpm build-deploy-app          # production channel
```

3. **Test the update** on a second macOS user account (see Manual verification flow below).

### Deploy script options

```bash
# Build + upload to stable (production) channel
pnpm build-deploy-app

# Build + upload to dev (internal) channel
pnpm build-deploy-app:dev

# Upload only (skip build, reuse existing artifacts in desktop/release/)
bash scripts/deploy-desktop.sh --internal --skip-build

# Validate everything without uploading
bash scripts/deploy-desktop.sh --internal --dry-run
```

### Required environment variables

In the repo root `.env`:

```dotenv
CLOUDFLARE_TOKEN=<your-api-token>
CLOUDFLARE_ACCOUNT_ID=<your-account-id>
```

The script uploads binaries first and metadata (`latest-mac.yml` or `dev-mac.yml`) last,
so the updater never sees stale references to files that haven't been uploaded yet.

## Restricting dev channel access

The dev channel is protected by a Cloudflare Access application (`Renku Dev Updates`)
using Service Auth. Only requests with valid service token headers are allowed through.

The desktop app sends these headers automatically when the environment values are present.
Values are loaded from `~/.config/renku/.env` on each user account that needs dev channel access.

Set both values together:

```dotenv
RENKU_UPDATER_CF_ACCESS_CLIENT_ID=<client-id>.access
RENKU_UPDATER_CF_ACCESS_CLIENT_SECRET=<client-secret>
```

> **Important:** These env var names use underscores and the `RENKU_UPDATER_` prefix.
> Do NOT use `CF-ACCESS-CLIENT-ID` (hyphens, no prefix) — those are the Cloudflare
> dashboard names, not what the app expects.

If only one value is set, the updater throws and fails fast.
If neither is set, the updater logs a warning and skips auth headers
(which is fine for stable channel, but will cause 403 errors on the dev channel).

## Onboarding edge case behavior

If user installs Renku but does not finish onboarding:

1. No workspace exists yet, so catalog sync is skipped.
2. User updates app later; startup sync still skips because workspace is not initialized.
3. User finishes onboarding; workspace catalog is copied from the currently installed app bundle.
4. On the next app version upgrade, startup version-change sync updates catalog in place.

This prevents accidental workspace creation and still guarantees catalog freshness.

## Manual verification flow

For a second macOS user account:

1. Build/install version A from dev channel.
2. Publish version B to the same dev channel path.
3. Open app and run `Check for Updates...`.
4. Verify download completes and restart installs update.
5. Verify `Update Catalog Templates...` succeeds after onboarding.
