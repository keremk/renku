# Publishing Tutopanda Packages to npm - Complete Guide

This guide walks you through publishing the Tutopanda CLI and its dependencies to npm. **It's written for someone who has never published to npm before**, so every step is explained in detail.

## Table of Contents

1. [Overview](#overview)
2. [What Gets Published](#what-gets-published)
3. [Prerequisites](#prerequisites)
4. [Initial Setup (One-Time)](#initial-setup-one-time)
5. [Regular Publishing Workflow](#regular-publishing-workflow)
6. [How Trusted Publishing Works](#how-trusted-publishing-works)
7. [Troubleshooting](#troubleshooting)

---

## Overview

Tutopanda uses a **monorepo** with multiple packages. We publish 4 packages to npm:

- `@tutopanda/core` - Core functionality (can be used independently)
- `@tutopanda/compositions` - Remotion compositions (can be used independently)
- `@tutopanda/providers` - AI provider integrations (depends on core & compositions)
- `tutopanda` - CLI with bundled viewer (depends on core & providers)

**Key architectural decisions:**
- ✅ Separate packages for reusability (client can use core/providers)
- ✅ Viewer is bundled into CLI (not published separately)
- ✅ Zero impact on development workflow
- ✅ Trusted publishing for security (no long-lived tokens)

---

## What Gets Published

### Package Dependencies

```
@tutopanda/core (1.0.0)          <- Independent
@tutopanda/compositions (1.0.0)  <- Independent
   ↓
@tutopanda/providers (1.0.0)     <- Depends on core & compositions
   ↓
tutopanda (CLI) (1.0.0)         <- Depends on core & providers
   └─ Bundled: viewer assets    <- Not published separately
```

**What users install:**
```bash
npm install -g tutopanda
```

npm automatically installs the dependencies (core, providers, compositions).

**For development:**
```bash
pnpm install  # Monorepo stays unchanged
pnpm dev      # Hot reloading works as before
```

---

## Prerequisites

Before you can publish to npm, you need:

### 1. npm Account

1. Go to [npmjs.com](https://www.npmjs.com/)
2. Click "Sign Up" in the top right
3. Choose a username (this will be public)
4. Enter email and password
5. Verify your email (check inbox/spam)

### 2. Enable Two-Factor Authentication (Required!)

npm **requires** 2FA for publishing packages.

1. Log in to [npmjs.com](https://www.npmjs.com/)
2. Click your profile icon → "Account"
3. Go to "Two-Factor Authentication" section
4. Click "Enable 2FA"
5. Choose "Authorization and Publishing" (recommended)
6. Scan QR code with authenticator app (Google Authenticator, Authy, 1Password, etc.)
7. Save recovery codes in a safe place!

### 3. Check Package Name Availability

Before manual publishing, verify the package names are available:

1. Go to [npmjs.com/package/tutopanda](https://www.npmjs.com/package/tutopanda)
2. If it shows "404 - Not Found", the name is available ✅
3. Repeat for:
   - [npmjs.com/package/@tutopanda/core](https://www.npmjs.com/package/@tutopanda/core)
   - [npmjs.com/package/@tutopanda/providers](https://www.npmjs.com/package/@tutopanda/providers)
   - [npmjs.com/package/@tutopanda/compositions](https://www.npmjs.com/package/@tutopanda/compositions)

If any name is taken, you'll need to choose a different name (like `@your-username/tutopanda`).

---

## Initial Setup (One-Time)

This section is only done **once** to set up npm publishing.

### Step 1: Login to npm CLI

On your local machine:

```bash
npm login
```

You'll be prompted for:
- **Username**: Your npm username
- **Password**: Your npm password
- **Email**: Your email (this is public)
- **OTP**: One-time password from your authenticator app

After successful login, npm stores your credentials locally.

### Step 2: Manual First Publish (Required for Trusted Publishing)

npm requires packages to exist before you can configure GitHub Actions OIDC. So we publish manually first.

**Important:** Make sure all packages are built before publishing!

```bash
# From repo root
cd /path/to/tutopanda

# Build all packages
pnpm install
pnpm --filter @tutopanda/core build
pnpm --filter @tutopanda/compositions build
pnpm --filter @tutopanda/providers build
pnpm --filter tutopanda build
```

Now publish in dependency order:

```bash
# 1. Publish core (no dependencies)
cd core
npm publish --access public
cd ..

# 2. Publish compositions (no dependencies)
cd compositions
npm publish --access public
cd ..

# 3. Publish providers (depends on core & compositions)
cd providers
npm publish --access public
cd ..

# 4. Build and publish CLI (depends on core & providers, includes viewer)
pnpm package:cli
npm publish release/tutopanda-*.tgz --access public
```

**What to expect:**
- You'll be prompted for an OTP (from authenticator app) for each publish
- Each publish takes ~5-10 seconds
- You'll see output like: `+ @tutopanda/core@1.0.0`

**Verify on npm:**
1. Visit [npmjs.com/package/tutopanda](https://www.npmjs.com/package/tutopanda)
2. You should see your package!
3. Repeat for core, providers, compositions

### Step 3: Configure Trusted Publishing on npm

Now that packages exist, configure GitHub Actions to publish automatically.

**For EACH package, repeat these steps:**

#### For @tutopanda/core:

1. Go to [npmjs.com/package/@tutopanda/core/access](https://www.npmjs.com/package/@tutopanda/core/access)
2. Scroll to "Publishing access" section
3. You'll see "Require two-factor authentication or automation tokens"
4. Click the dropdown and select "Automation tokens and granular access tokens only"
5. Scroll down to "Add GitHub Actions as a publisher"
6. Click "Add GitHub Actions"
7. Fill in the form:
   - **Repository**: `YOUR_GITHUB_USERNAME/tutopanda` (e.g., `keremk/tutopanda`)
   - **Workflow**: `.github/workflows/publish-packages.yml`
   - **Environment**: Leave blank (no environment)
8. Click "Add GitHub Actions publisher"

#### Repeat for the other 3 packages:

- [npmjs.com/package/@tutopanda/compositions/access](https://www.npmjs.com/package/@tutopanda/compositions/access)
- [npmjs.com/package/@tutopanda/providers/access](https://www.npmjs.com/package/@tutopanda/providers/access)
- [npmjs.com/package/tutopanda/access](https://www.npmjs.com/package/tutopanda/access)

**What does this do?**
- npm trusts your GitHub repository
- When GitHub Actions runs, it proves its identity via OIDC
- npm allows publishing without long-lived tokens
- More secure: tokens can't leak or be stolen

---

## Regular Publishing Workflow

Once initial setup is complete, publishing new versions is automated.

### Publishing a New Version

#### 1. Bump versions in all 4 packages

Edit the `version` field in each package.json:

```bash
# Recommended: Keep all packages in sync
# From repo root
cd core && npm version patch && cd ..              # 1.0.0 → 1.0.1
cd compositions && npm version patch && cd ..      # 1.0.0 → 1.0.1
cd providers && npm version patch && cd ..         # 1.0.0 → 1.0.1
cd cli && npm version patch && cd ..               # 0.1.1 → 0.1.2
```

**Version bump types:**
- `patch` - Bug fixes (1.0.0 → 1.0.1)
- `minor` - New features (1.0.0 → 1.1.0)
- `major` - Breaking changes (1.0.0 → 2.0.0)

Or manually edit package.json files:
```json
{
  "version": "1.0.1"
}
```

#### 2. Commit and tag

```bash
git add core/package.json compositions/package.json providers/package.json cli/package.json
git commit -m "release: bump to 1.0.1"
git tag cli-v1.0.1
```

**Important:** The tag must start with `cli-v` (e.g., `cli-v1.0.1`, `cli-v2.0.0`)

#### 3. Push to GitHub

```bash
git push origin main
git push origin cli-v1.0.1
```

#### 4. Watch GitHub Actions

1. Go to your repo on GitHub
2. Click "Actions" tab
3. You'll see "Publish Tutopanda Packages" workflow running
4. Click on it to watch progress
5. After ~2-3 minutes, all packages will be published!

#### 5. Verify on npm and GitHub

**Check npm packages:**
- [npmjs.com/package/tutopanda](https://www.npmjs.com/package/tutopanda)
- [npmjs.com/package/@tutopanda/core](https://www.npmjs.com/package/@tutopanda/core)
- [npmjs.com/package/@tutopanda/providers](https://www.npmjs.com/package/@tutopanda/providers)
- [npmjs.com/package/@tutopanda/compositions](https://www.npmjs.com/package/@tutopanda/compositions)

You should see:
- ✅ New version number
- ✅ "Provenance" badge (shows it was published by GitHub Actions)
- ✅ Updated timestamp

**Check GitHub Release:**
- Go to your repo → Releases tab
- You should see a new release for `cli-v1.0.1`
- Contains auto-generated release notes from commits
- Includes the CLI tarball as a downloadable asset

### Testing Before Publishing (Dry Run)

Want to test the workflow without actually publishing?

1. Go to GitHub → Actions → "Publish Tutopanda Packages"
2. Click "Run workflow" (right side)
3. Set `dry_run` to `true`
4. Click "Run workflow" (green button)

This runs the entire pipeline but skips `npm publish`. Great for testing changes!

---

## How Trusted Publishing Works

Traditional npm publishing uses **automation tokens** (long-lived secrets stored in GitHub):
- ❌ Tokens can leak or be stolen
- ❌ Tokens need manual rotation
- ❌ Difficult to audit who published

**Trusted publishing** uses **OIDC** (OpenID Connect):
- ✅ No secrets in GitHub (more secure)
- ✅ GitHub proves its identity to npm via cryptographic tokens
- ✅ Short-lived tokens (expire in minutes)
- ✅ Audit trail: npm knows exactly which workflow/commit published

**How it works:**

```
┌──────────────┐                 ┌──────────┐                 ┌─────────┐
│ GitHub       │  1. Request     │ GitHub   │   2. Verify     │ npm     │
│ Actions      │  ────────────>  │ OIDC     │   ───────────>  │ Registry│
│              │  OIDC token     │ Provider │   identity      │         │
└──────────────┘                 └──────────┘                 └─────────┘
       │                                                             │
       │  3. Publish with provenance signature                      │
       └──────────────────────────────────────────────────────────>│
```

1. GitHub Actions requests an OIDC token from GitHub
2. GitHub verifies the workflow is running in the correct repo
3. GitHub gives a short-lived token with repo/workflow info
4. npm verifies the token signature with GitHub's public key
5. npm checks: Is this repo allowed to publish this package?
6. npm allows publishing and adds provenance signature

**The provenance signature proves:**
- ✅ Which GitHub repo published it
- ✅ Which commit/tag was used
- ✅ Which workflow file ran
- ✅ No tampering occurred

---

## Troubleshooting

### "Refusing to publish: tag commit is not on main branch"

**Cause:** You tagged a commit from a feature branch, not from main.

**Why this matters:** Only commits on main should be published to prevent accidental releases from development branches.

**Solution:**
1. Check which branch your tag is on: `git branch --contains <tag-name>`
2. If not on main, delete the tag: `git tag -d cli-v1.0.1 && git push origin :refs/tags/cli-v1.0.1`
3. Switch to main: `git checkout main`
4. Pull latest: `git pull origin main`
5. Re-tag from main: `git tag cli-v1.0.1 && git push origin cli-v1.0.1`

### "Tag does not match package.json version"

**Cause:** The git tag version doesn't match the CLI package.json version.

**Example:** Tag is `cli-v1.0.2` but `cli/package.json` has `"version": "1.0.1"`

**Solution:**
1. Delete the incorrect tag: `git tag -d cli-v1.0.2`
2. Either:
   - Fix package.json: `cd cli && npm version 1.0.2`
   - Or use correct tag: `git tag cli-v1.0.1`
3. Commit if you changed package.json: `git commit -am "fix: version"`
4. Push: `git push origin main cli-v1.0.1`

### Type check failures

**Cause:** TypeScript errors in one or more packages.

**Solution:**
1. Run type check locally: `pnpm type-check`
2. Fix all TypeScript errors
3. Commit fixes: `git commit -am "fix: type errors"`
4. Re-tag and push

The workflow will not publish if type checking fails, preventing broken code from being published.

### "npm ERR! 403 Forbidden"

**Cause:** You don't have permission to publish this package.

**Solutions:**
1. If first time: Package name might be taken by someone else
2. If trusted publishing: Check npm package settings → Publishing access
3. If missing OIDC config: Repeat Step 3 of Initial Setup

### "npm ERR! E401 Unauthorized"

**Cause:** OIDC authentication failed.

**Solutions:**
1. Check workflow has `id-token: write` permission ✅ (our workflow has this)
2. Verify GitHub Actions is added as publisher on npm (Step 3)
3. Check repository name matches exactly: `your-username/tutopanda`

### "npm ERR! need auth"

**Cause:** npm doesn't know how to authenticate.

**Solutions:**
1. For manual publish: Run `npm login` first
2. For GitHub Actions: Check `registry-url: https://registry.npmjs.org` in workflow

### Workflow runs but doesn't publish

**Cause:** Publish conditions not met.

**Check:**
1. Did you push a tag starting with `cli-v`? (e.g., `cli-v1.0.1`)
2. Is `dry_run` set to `false`?
3. Check workflow logs: Do publish steps show "skipped"?

### Packages published out of order

**Cause:** GitHub Actions published providers before core.

**Solution:**
Our workflow publishes in order:
1. core (no deps)
2. compositions (no deps)
3. providers (deps: core, compositions)
4. CLI (deps: core, providers)

This ensures dependencies are always available.

### Workspace dependencies not resolved

**Symptom:** `tutopanda` package has `"@tutopanda/core": "workspace:*"` on npm

**Cause:** pnpm didn't convert workspace protocol to version.

**Solution:**
Our workflow uses `pnpm pack` which automatically converts:
- Before: `"@tutopanda/core": "workspace:*"`
- After: `"@tutopanda/core": "1.0.1"`

If this happens, check `pnpm` version matches `package.json` (`10.15.0`).

### "Provenance" badge missing

**Cause:** Published without `--provenance` flag.

**Solution:**
Our workflow includes `--provenance` on all `npm publish` commands. If missing:
1. Check workflow file: `.github/workflows/publish-packages.yml`
2. Look for: `npm publish ... --provenance`
3. Re-publish with flag included

### CLI viewer not working after install

**Symptom:** `tutopanda viewer:start` fails with "viewer bundle not found"

**Check:**
1. Verify tarball includes viewer: `tar -tzf release/tutopanda-*.tgz | grep viewer`
2. Check `pnpm bundle:viewer` ran before packing
3. Ensure `cli/package.json` includes `"files": ["dist", "config"]`

Our workflow verifies viewer assets are present before publishing.

---

## Architecture Reference

### Why separate packages?

**Scenario 1: CLI user**
```bash
npm install -g tutopanda
# Gets: tutopanda + core + providers + compositions
# Viewer is bundled (no extra download)
```

**Scenario 2: tutopanda-client (web app) wants AI features**
```json
{
  "dependencies": {
    "@tutopanda/core": "^1.0.0",
    "@tutopanda/providers": "^1.0.0"
  }
}
```
No need to install CLI!

**Scenario 3: Another project wants Remotion compositions**
```json
{
  "dependencies": {
    "@tutopanda/compositions": "^1.0.0"
  }
}
```

### Why bundle viewer?

**Alternatives considered:**
1. ❌ Publish viewer as separate package → Users need to install two packages
2. ❌ Download viewer from CDN at runtime → Requires internet, version skew
3. ✅ Bundle into CLI → "Just works", offline, version-locked

**Similar patterns:**
- Storybook: Bundles UI into CLI
- Remotion: Bundles player/studio into CLI
- Next.js: Bundles dev server into CLI

---

## Quick Reference

### Publishing Checklist

- [ ] Bump versions in all 4 package.json files
- [ ] Commit changes: `git commit -am "release: 1.0.1"`
- [ ] Create tag: `git tag cli-v1.0.1`
- [ ] Push: `git push origin main cli-v1.0.1`
- [ ] Watch GitHub Actions
- [ ] Verify on npmjs.com

### Useful Commands

```bash
# Test build locally
pnpm package:cli

# Extract and inspect tarball
tar -tzf release/tutopanda-*.tgz

# Check CLI works
node cli/dist/cli.js --help

# Verify viewer is bundled
tar -tzf release/tutopanda-*.tgz | grep viewer

# Manual publish (first time only)
npm publish --access public --provenance

# Check npm login status
npm whoami

# View package on npm
open https://www.npmjs.com/package/tutopanda
```

### Version Management

Keep all packages in sync for simplicity:

| Package               | Version |
|-----------------------|---------|
| @tutopanda/core        | 1.0.1   |
| @tutopanda/compositions| 1.0.1   |
| @tutopanda/providers   | 1.0.1   |
| tutopanda (CLI)       | 1.0.1   |

### GitHub Actions Workflow

**File:** `.github/workflows/publish-packages.yml`

**Triggers:**
- Push tag: `cli-v*` (e.g., `cli-v1.0.1`)
- Manual: "Run workflow" with optional dry run

**Robustness Checks:**
- ✅ Verifies tag commit is on main branch
- ✅ Type checks all packages before publishing
- ✅ Verifies tag version matches CLI package.json
- ✅ Logs all package versions for verification

**Steps:**
1. Verify tag commit is on main branch (prevents publishing from feature branches)
2. Install dependencies
3. Type check all packages (catches TypeScript errors)
4. Verify tag matches package.json version (prevents version mismatches)
5. Build all packages
6. Publish core → compositions → providers → CLI (in order)
7. Bundle viewer into CLI
8. Pack CLI tarball
9. Verify viewer assets are bundled
10. Smoke test CLI
11. Publish CLI with provenance
12. Create GitHub Release with auto-generated notes
13. Upload tarball as artifact

---

## Additional Resources

- [npm Trusted Publishing Documentation](https://docs.npmjs.com/generating-provenance-statements)
- [GitHub OIDC for npm](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
- [pnpm Workspace Documentation](https://pnpm.io/workspaces)
- [Semantic Versioning](https://semver.org/)

---

## Support

If you encounter issues:
1. Check [Troubleshooting](#troubleshooting) section
2. Review GitHub Actions logs for error messages
3. Check npm package settings → Publishing access
4. Verify OIDC configuration is correct

**Remember:** The initial setup is the hardest part. Once configured, publishing is just:
1. Bump version
2. Tag
3. Push
4. Done! 🎉


# Summary Manual First Publish
Step 2: Manual First Publish

  # Login to npm
  npm login

  # Build all packages
  pnpm install
  pnpm --filter tutopanda-core build
  pnpm --filter tutopanda-compositions build
  pnpm --filter tutopanda-providers build
  pnpm --filter tutopanda build

  # Publish in order (you'll be prompted for OTP each time)
  cd core && npm publish --access public && cd ..
  cd compositions && npm publish --access public && cd ..
  cd providers && npm publish --access public && cd ..
  pnpm package:cli
  npm publish release/tutopanda-*.tgz --access public

  Step 3: Configure Trusted Publishing on npm

  For each of the 4 packages, go to the package settings and add GitHub Actions as publisher:

  1. https://www.npmjs.com/package/tutopanda-core/access
  2. https://www.npmjs.com/package/tutopanda-compositions/access
  3. https://www.npmjs.com/package/tutopanda-providers/access
  4. https://www.npmjs.com/package/tutopanda/access

  For each:
  - Click "Add GitHub Actions"
  - Repository: keremk/tutopanda (or your username)
  - Workflow: .github/workflows/publish-packages.yml
  - Environment: Leave blank

  Step 4: Test the Workflow

  # Go to GitHub → Actions → "Publish Tutopanda Packages"
  # Click "Run workflow"
  # Set dry_run = true
  # This tests everything without actually publishing

  Step 5: Future Releases (Automated!)

  # Bump versions
  cd core && npm version patch && cd ..
  cd compositions && npm version patch && cd ..
  cd providers && npm version patch && cd ..
  cd cli && npm version patch && cd ..

  # Commit and tag
  git add */package.json
  git commit -m "release: 1.0.1"
  git tag cli-v1.0.1

  # Push (GitHub Actions does the rest!)
  git push origin main cli-v1.0.1