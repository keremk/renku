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

Use a single R2 bucket with custom domains and channel paths:

- Stable: `https://downloads.gorenku.com/desktop/stable/darwin/arm64`
- Dev: `https://updates-dev.gorenku.com/desktop/dev/darwin/arm64`

Recommended objects for each release:

- `Renku-<version>-arm64.dmg`
- `Renku-<version>-arm64-mac.zip`
- `Renku-<version>-arm64-mac.zip.blockmap`
- `Renku-<version>-arm64.dmg.blockmap`
- `latest-mac.yml`

For the website download button, maintain a stable alias object:

- `Renku-latest-arm64.dmg`

## Cloudflare setup checklist

1. Create the R2 bucket (for example `renku-downloads`).
2. Attach custom domains:
   - public: `downloads.gorenku.com`
   - private/internal: `updates-dev.gorenku.com`
3. Disable `r2.dev` public access after custom domains are active.
4. Configure cache behavior:
   - binaries (`.dmg`, `.zip`, `.blockmap`): long immutable cache
   - metadata (`latest-mac.yml`): `no-cache, must-revalidate`
5. Upload order for every release:
   - upload binaries first
   - upload `latest-mac.yml` last

## Restricting dev channel access

Use Cloudflare Access (Service Auth) on `updates-dev.gorenku.com`.

Renku desktop supports optional headers via environment values loaded from:

- `~/.config/renku/.env`

Set both values together:

```dotenv
RENKU_UPDATER_CF_ACCESS_CLIENT_ID=<client-id>
RENKU_UPDATER_CF_ACCESS_CLIENT_SECRET=<client-secret>
```

If only one value is set, the updater throws and fails fast.

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
