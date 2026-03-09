Edge Case Coverage (your 3-step scenario)
- Right now onboarding already copies catalog from the app’s bundled resources via initWorkspace({ catalogSourceRoot: catalogPath }) in viewer/server/onboarding/handler.ts:133.
- Desktop passes that catalogPath from the installed app bundle (getResourcePath('catalog')) in desktop/src/main.ts:122.
- So if user installs app, does not onboard, updates app later, and only then onboards: onboarding will copy the newer app’s catalog (good).
- The only important guard: startup catalog-sync must be conditional on workspace init (isWorkspaceInitialized), so when no workspace exists it should cleanly skip (no folder auto-create).
- Optional hardening: after onboarding succeeds, run one explicit updateWorkspaceCatalog to guarantee the catalog is canonical even if user picked a folder with pre-existing stale files.
One subtle case to account for
- If update is downloaded but not yet installed (no restart), onboarding in that session uses old app catalog.
- That’s fine because once restart installs new app, startup version-change sync updates catalog.
---
How Dev/Test Channel Access Actually Works
- Update “channel” is selection logic, not security.
- Access is controlled by who can fetch your update URLs.
Recommended model:
1) stable feed (public)  
- URL example: https://downloads.gorenku.com/desktop/stable/darwin/arm64
- Everyone gets stable updates.
2) dev feed (private now)  
- URL example: https://updates-dev.gorenku.com/desktop/dev/darwin/arm64
- Protect this hostname/path with Cloudflare Access Service Auth.
- Desktop dev builds send CF-Access-Client-Id + CF-Access-Client-Secret headers.
3) Future “frequent updates” opt-in (beta)  
- Add app preference: stable | beta.
- beta users point to .../desktop/beta/darwin/arm64.
- If you want strict invite-only beta later, that needs backend-issued auth/signed manifests (more than simple channel toggle).
Note: do not use short-lived presigned URLs for periodic updater checks; expiration breaks background polling.
---
Cloudflare Setup Runbook (full)
1. Create R2 bucket (e.g. renku-downloads).
2. Add custom domain for public downloads: downloads.gorenku.com.
3. Add custom domain for private dev updates: updates-dev.gorenku.com.
4. Disable r2.dev public URL after custom domains are active.
5. Protect updates-dev.gorenku.com with Cloudflare Access:
   - Access app type: self-hosted
   - Policy action: Service Auth
   - Create service token (Client ID/Secret)
6. Define object layout:
   - desktop/stable/darwin/arm64/...
   - desktop/dev/darwin/arm64/...
   - desktop/beta/darwin/arm64/... (future)
7. Upload artifacts per release:
   - versioned .dmg, .zip, .blockmap
   - latest-mac.yml
8. Cache headers:
   - binaries/blockmaps: public, max-age=31536000, immutable
   - latest-mac.yml: no-cache, must-revalidate
9. Upload order:
   - binaries first
   - metadata (latest-mac.yml) last
10. Website button:
   - point homepage CTA to stable alias, e.g. .../Renku-latest-arm64.dmg
   - keep alias updated each release.


Plan (implementation-ready)
1) Split desktop builds into dev vs production signing modes
Why: you want fast local iteration without always signing.
- Dev/Test mode
  - Ad-hoc or unsigned packaging.
  - Separate update channel URL (e.g. /desktop/dev/...) so dev tests never pollute stable.
- Production mode
  - Developer ID signed + notarized.
  - Stable channel URL (e.g. /desktop/stable/...).
Important current issue:
- desktop/build/afterSign.cjs:17 force re-signs ad-hoc today. That will conflict with real production signing/notarization, so we’ll gate or replace this behavior by build mode.
2) Add app updater service (manual + periodic)
Why: clean state machine, reusable from menu + timer.
- Use electron-updater in main process.
- Add menu item in app menu: Check for Updates… in desktop/src/main.ts:134.
- Periodic checks:
  - first check after startup delay (e.g. 2 min),
  - then every ~6 hours with small jitter.
- UX:
  - manual check shows explicit result dialog,
  - periodic checks are quiet unless update is downloaded,
  - downloaded update prompts: Restart now / Later.
Important packaging note:
- desktop/electron-builder.yml:40 excludes node_modules right now.
- If we add runtime updater deps, this needs adjusting so runtime deps are included.
3) Cloudflare R2 setup (full)
Recommended structure: one public bucket, channel/arch partitioned paths.
1. Create R2 bucket (e.g. renku-downloads).
2. Connect custom domain (e.g. downloads.gorenku.com) to that bucket.
3. Disable r2.dev public URL once custom domain is active.
4. Create path layout:
   - desktop/stable/darwin/arm64/...
   - desktop/dev/darwin/arm64/...
5. Upload artifacts:
   - DMG for manual installs
   - ZIP + blockmap + latest-mac.yml for updater
6. Cache behavior:
   - versioned binaries (.dmg, .zip, .blockmap): long immutable cache
   - metadata (latest-mac.yml): no-cache / short TTL
7. Publish ordering:
   - upload binaries first,
   - upload latest-mac.yml last (atomic release switch).
4) Release upload pipeline
Use R2 S3 API credentials in CI (or local release script).
- Create R2 token with bucket-scoped object read/write.
- Generate Access Key ID + Secret.
- Use S3-compatible upload script to set per-file Cache-Control.
- Add stable alias for website download, e.g.:
  - desktop/stable/darwin/arm64/Renku-latest-arm64.dmg
  - this avoids changing homepage links each release.
5) Website download CTA (Cloudflare Pages-hosted web app)
You already have hero CTAs in web/src/components/Hero.astro:54.
Plan:
- Add Download for macOS button in hero (and optional footer CTA).
- Read URL from env var (Pages env): PUBLIC_DESKTOP_DOWNLOAD_URL.
- Point env var to your stable alias DMG URL on downloads.gorenku.com.
- Keep docs link as secondary CTA.
6) Hook catalog update into desktop update experience
You called this out — great catch.
Recommended behavior:
- On startup, detect app version change (store last-synced app version in userData).
- If app version changed and workspace exists, run catalog sync once using existing core logic (updateWorkspaceCatalog from core/src/workspace.ts:210).
- Add manual menu action: Update Catalog Templates….
- In viewer home empty-state (viewer/src/components/home/viewer-home-page.tsx:209), replace “Run renku update…” with a button that triggers catalog sync endpoint and refreshes templates list.
This gives:
- automatic catalog refresh after app upgrades,
- manual retry path if sync fails,
- better UX than requiring terminal command.
7) Testing strategy (including unsigned pre-prod)
Yes, you can test manually from another user account before production signing.
- Dev channel test (pre-sign)
  1. Build vA in dev mode, upload to /desktop/dev/....
  2. Install in second macOS user account.
  3. Build vB, upload to same dev channel.
  4. Use Check for Updates…, verify download + restart flow.
- Catalog hook test
  - Confirm templates change after app version bump + startup.
  - Confirm manual Update Catalog Templates… works.
- Production validation (required once)
  - Do at least one full signed+notarized end-to-end update test before public rollout, since mac updater trust chain is tied to signing.
---
Planned repo touchpoints
- desktop/package.json
- desktop/electron-builder.yml
- desktop/build/afterSign.cjs
- desktop/src/main.ts
- new desktop/src/updater.ts
- possibly viewer/server/blueprints/templates-handler.ts
- possibly viewer/server/blueprints/blueprint-handler.ts
- viewer/src/components/home/viewer-home-page.tsx
- web/src/components/Hero.astro

Updated Implementation Plan (no edits yet)
- Add updater service in main process with manual check + periodic polling + restart-to-install UX.
- Add menu items:
  - Check for Updates...
  - Restart to Update (when downloaded)
  - Update Catalog Templates... (manual catalog sync)
- Add startup “version-changed” catalog sync:
  - if workspace initialized => run sync
  - else skip/defer (no folder creation)
- Add dev/prod build modes:
  - dev: unsigned/ad-hoc testing allowed
  - prod: Developer ID signing + notarization only
- Enforce Apple Silicon only in packaging target (arm64).
- Add homepage download CTA in web package.