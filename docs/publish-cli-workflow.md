# Publishing Renku Packages to npm - Complete Guide

This guide walks you through publishing the Renku CLI and its dependencies to npm. **It's written for someone who has never published to npm before**, so every step is explained in detail.

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

Renku uses a **monorepo** with multiple packages. We publish 4 packages to npm:

- `@gorenku/core` - Core functionality (can be used independently)
- `@gorenku/compositions` - Remotion compositions (can be used independently)
- `@gorenku/providers` - AI provider integrations (depends on core & compositions)
- `@gorenku/cli` - CLI with bundled viewer (depends on core & providers)

**Key architectural decisions:**
- Separate packages for reusability (client can use core/providers)
- Viewer is bundled into CLI (not published separately)
- Zero impact on development workflow
- Trusted publishing for security (no long-lived tokens)

---

## What Gets Published

### Package Dependencies

```
@gorenku/core          <- Independent
@gorenku/compositions  <- Independent
   |
@gorenku/providers     <- Depends on core & compositions
   |
@gorenku/cli           <- Depends on core & providers
   +-- Bundled: viewer assets    <- Not published separately
   +-- Bundled: catalog assets   <- Not published separately
```

**What users install:**
```bash
npm install -g @gorenku/cli
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
2. Click your profile icon -> "Account"
3. Go to "Two-Factor Authentication" section
4. Click "Enable 2FA"
5. Choose "Authorization and Publishing" (recommended)
6. Scan QR code with authenticator app (Google Authenticator, Authy, 1Password, etc.)
7. Save recovery codes in a safe place!

### 3. Check Package Name Availability

Before manual publishing, verify the package names are available:

1. Go to [npmjs.com/package/@gorenku/cli](https://www.npmjs.com/package/@gorenku/cli)
2. If it shows "404 - Not Found", the name is available
3. Repeat for:
   - [npmjs.com/package/@gorenku/core](https://www.npmjs.com/package/@gorenku/core)
   - [npmjs.com/package/@gorenku/providers](https://www.npmjs.com/package/@gorenku/providers)
   - [npmjs.com/package/@gorenku/compositions](https://www.npmjs.com/package/@gorenku/compositions)

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

**Important:**
- Make sure all packages are built before publishing!
- Use `pnpm publish` (not `npm publish`) to handle `workspace:*` references

```bash
# From repo root
cd /path/to/renku

# Build all packages
pnpm install
pnpm build
```

Now publish in dependency order:

```bash
# 1. Publish core (no dependencies)
cd core
pnpm publish --access public
cd ..

# 2. Publish compositions (no dependencies)
cd compositions
pnpm publish --access public
cd ..

# 3. Publish providers (depends on core & compositions)
cd providers
pnpm publish --access public
cd ..

# 4. Publish CLI (depends on core & providers, includes viewer & catalog)
cd cli
pnpm publish --access public
cd ..
```

**Why pnpm publish?**
The packages use `workspace:*` references (e.g., `"@gorenku/core": "workspace:*"`).
- `pnpm publish` automatically converts these to actual version numbers
- `npm publish` does NOT handle this and will fail when users try to install

**What to expect:**
- You'll be prompted for an OTP (from authenticator app) for each publish
- Each publish takes ~5-10 seconds
- You'll see output like: `+ @gorenku/core@0.1.4`

**Verify on npm:**
1. Visit [npmjs.com/package/@gorenku/cli](https://www.npmjs.com/package/@gorenku/cli)
2. You should see your package!
3. Repeat for core, providers, compositions

### Step 3: Configure Trusted Publishing on npm

Now that packages exist, configure GitHub Actions to publish automatically.

**For EACH package, repeat these steps:**

#### For @gorenku/core:

1. Go to [npmjs.com/package/@gorenku/core/access](https://www.npmjs.com/package/@gorenku/core/access)
2. Scroll to "Publishing access" section
3. You'll see "Require two-factor authentication or automation tokens"
4. Click the dropdown and select "Automation tokens and granular access tokens only"
5. Scroll down to "Add GitHub Actions as a publisher"
6. Click "Add GitHub Actions"
7. Fill in the form:
   - **Repository**: `YOUR_GITHUB_USERNAME/renku` (e.g., `keremk/renku`)
   - **Workflow**: `.github/workflows/publish-packages.yml`
   - **Environment**: Leave blank (no environment)
8. Click "Add GitHub Actions publisher"

#### Repeat for the other 3 packages:

- [npmjs.com/package/@gorenku/compositions/access](https://www.npmjs.com/package/@gorenku/compositions/access)
- [npmjs.com/package/@gorenku/providers/access](https://www.npmjs.com/package/@gorenku/providers/access)
- [npmjs.com/package/@gorenku/cli/access](https://www.npmjs.com/package/@gorenku/cli/access)

**What does this do?**
- npm trusts your GitHub repository
- When GitHub Actions runs, it proves its identity via OIDC
- npm allows publishing without long-lived tokens
- More secure: tokens can't leak or be stolen

---

## Regular Publishing Workflow

Once initial setup is complete, publishing new versions is streamlined with helper scripts.

### Publishing a New Version

#### Option 1: Using bump-n-push.sh (Recommended)

This script handles everything: bumping versions, committing, tagging, and pushing.

```bash
# From repo root
./scripts/bump-n-push.sh patch   # For bug fixes (0.1.3 -> 0.1.4)
./scripts/bump-n-push.sh minor   # For new features (0.1.3 -> 0.2.0)
./scripts/bump-n-push.sh major   # For breaking changes (0.1.3 -> 1.0.0)
```

The script will:
1. Bump versions in all 5 packages (core, compositions, providers, cli, viewer)
2. Show you the changes for review
3. Ask for confirmation before committing
4. Create a git tag (e.g., `cli-v0.1.4`)
5. Push to origin (main + tag)

#### Option 2: Step by Step

If you prefer manual control:

**1. Bump versions:**
```bash
./scripts/bump-versions.sh patch
```

**2. Review and commit:**
```bash
git diff */package.json
git add */package.json
git commit -m "release: bump to 0.1.4"
```

**3. Tag and push:**
```bash
git tag cli-v0.1.4
git push origin main cli-v0.1.4
```

**Important:** The tag must start with `cli-v` (e.g., `cli-v0.1.4`, `cli-v1.0.0`)

#### After Pushing

1. Go to your repo on GitHub
2. Click "Actions" tab
3. You'll see "Publish Renku Packages" workflow running
4. Click on it to watch progress
5. After ~2-3 minutes, all packages will be published!

#### Verify on npm and GitHub

**Check npm packages:**
- [npmjs.com/package/@gorenku/cli](https://www.npmjs.com/package/@gorenku/cli)
- [npmjs.com/package/@gorenku/core](https://www.npmjs.com/package/@gorenku/core)
- [npmjs.com/package/@gorenku/providers](https://www.npmjs.com/package/@gorenku/providers)
- [npmjs.com/package/@gorenku/compositions](https://www.npmjs.com/package/@gorenku/compositions)

You should see:
- New version number
- "Provenance" badge (shows it was published by GitHub Actions)
- Updated timestamp

**Check GitHub Release:**
- Go to your repo -> Releases tab
- You should see a new release for `cli-v0.1.4`
- Contains auto-generated release notes from commits

### Testing Installation

After publishing, test that the package installs correctly:

```bash
# Create isolated test environment
mkdir /tmp/cli-test && cd /tmp/cli-test
npm init -y
npm install @gorenku/cli

# Test the CLI
npx renku --help

# Clean up
cd ~ && rm -rf /tmp/cli-test
```

Or use npx for a quick test:
```bash
npx @gorenku/cli --help
```

### Testing Before Publishing (Dry Run)

Want to test the workflow without actually publishing?

1. Go to GitHub -> Actions -> "Publish Renku Packages"
2. Click "Run workflow" (right side)
3. Set `dry_run` to `true`
4. Click "Run workflow" (green button)

This runs the entire pipeline but skips `npm publish`. Great for testing changes!

---

## How Trusted Publishing Works

Traditional npm publishing uses **automation tokens** (long-lived secrets stored in GitHub):
- Tokens can leak or be stolen
- Tokens need manual rotation
- Difficult to audit who published

**Trusted publishing** uses **OIDC** (OpenID Connect):
- No secrets in GitHub (more secure)
- GitHub proves its identity to npm via cryptographic tokens
- Short-lived tokens (expire in minutes)
- Audit trail: npm knows exactly which workflow/commit published

**How it works:**

```
+---------------+                 +-----------+                 +---------+
| GitHub        |  1. Request     | GitHub    |   2. Verify     | npm     |
| Actions       |  ------------->  | OIDC      |   ----------->  | Registry|
|               |  OIDC token     | Provider  |   identity      |         |
+---------------+                 +-----------+                 +---------+
       |                                                             |
       |  3. Publish with provenance signature                      |
       +------------------------------------------------------------>|
```

1. GitHub Actions requests an OIDC token from GitHub
2. GitHub verifies the workflow is running in the correct repo
3. GitHub gives a short-lived token with repo/workflow info
4. npm verifies the token signature with GitHub's public key
5. npm checks: Is this repo allowed to publish this package?
6. npm allows publishing and adds provenance signature

**The provenance signature proves:**
- Which GitHub repo published it
- Which commit/tag was used
- Which workflow file ran
- No tampering occurred

---

## Troubleshooting

### "Unsupported URL Type workspace:"

**Cause:** Used `npm publish` instead of `pnpm publish`.

**Solution:** Always use `pnpm publish` for packages with `workspace:*` dependencies. pnpm automatically converts these to actual version numbers.

### "Refusing to publish: tag commit is not on main branch"

**Cause:** You tagged a commit from a feature branch, not from main.

**Solution:**
1. Check which branch your tag is on: `git branch --contains <tag-name>`
2. If not on main, delete the tag: `git tag -d cli-v0.1.4 && git push origin :refs/tags/cli-v0.1.4`
3. Switch to main: `git checkout main`
4. Pull latest: `git pull origin main`
5. Re-tag from main: `git tag cli-v0.1.4 && git push origin cli-v0.1.4`

### "Tag does not match package.json version"

**Cause:** The git tag version doesn't match the CLI package.json version.

**Solution:**
1. Delete the incorrect tag: `git tag -d cli-v0.1.5`
2. Use the bump scripts to ensure versions are in sync:
   ```bash
   ./scripts/bump-versions.sh patch
   git add */package.json && git commit -m "release: bump to 0.1.4"
   git tag cli-v0.1.4
   git push origin main cli-v0.1.4
   ```

### Type check failures

**Cause:** TypeScript errors in one or more packages.

**Solution:**
1. Run type check locally: `pnpm check`
2. Fix all TypeScript errors
3. Commit fixes: `git commit -am "fix: type errors"`
4. Re-tag and push

### "npm ERR! 403 Forbidden"

**Cause:** You don't have permission to publish this package.

**Solutions:**
1. If first time: Package name might be taken by someone else
2. If trusted publishing: Check npm package settings -> Publishing access
3. If missing OIDC config: Repeat Step 3 of Initial Setup

### "npm ERR! E401 Unauthorized"

**Cause:** OIDC authentication failed.

**Solutions:**
1. Check workflow has `id-token: write` permission (our workflow has this)
2. Verify GitHub Actions is added as publisher on npm (Step 3)
3. Check repository name matches exactly: `your-username/renku`

### Workspace dependencies not resolved

**Symptom:** `@gorenku/cli` package has `"@gorenku/core": "workspace:*"` on npm

**Cause:** Used `npm publish` instead of `pnpm publish`.

**Solution:** Always use `pnpm publish` which automatically converts:
- Before: `"@gorenku/core": "workspace:*"`
- After: `"@gorenku/core": "0.1.4"`

### CLI viewer not working after install

**Symptom:** `renku viewer:start` fails with "viewer bundle not found"

**Check:**
1. The CLI's prepack script should bundle the viewer automatically
2. Verify `cli/package.json` includes `"files": ["dist", "viewer-bundle", "catalog"]`
3. Check that `pnpm --filter viewer build` runs before publish

---

## Quick Reference

### Publishing Checklist

- [ ] Run `./scripts/bump-n-push.sh patch` (or minor/major)
- [ ] Review changes when prompted
- [ ] Confirm commit, tag, and push
- [ ] Watch GitHub Actions
- [ ] Verify on npmjs.com
- [ ] Test installation: `npx @gorenku/cli --help`

### Useful Commands

```bash
# Bump versions (all 5 packages)
./scripts/bump-versions.sh patch

# Bump + commit + tag + push (interactive)
./scripts/bump-n-push.sh patch

# Build all packages
pnpm build

# Type check all packages
pnpm check

# Manual publish (use pnpm, not npm!)
cd core && pnpm publish --access public

# Check npm login status
npm whoami

# View package on npm
open https://www.npmjs.com/package/@gorenku/cli

# Test installation in isolation
mkdir /tmp/cli-test && cd /tmp/cli-test && npm init -y && npm install @gorenku/cli
```

### Version Management

All packages are kept in sync for simplicity:

| Package               | Published |
|-----------------------|-----------|
| @gorenku/core         | Yes       |
| @gorenku/compositions | Yes       |
| @gorenku/providers    | Yes       |
| @gorenku/cli          | Yes       |
| viewer                | No (private, bundled into CLI) |

### GitHub Actions Workflow

**File:** `.github/workflows/publish-packages.yml`

**Triggers:**
- Push tag: `cli-v*` (e.g., `cli-v0.1.4`)
- Manual: "Run workflow" with optional dry run

**Steps:**
1. Verify tag commit is on main branch
2. Install dependencies
3. Type check all packages
4. Verify tag matches package.json version
5. Build all packages
6. Publish core -> compositions -> providers -> CLI (in order)
7. Create GitHub Release with auto-generated notes

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
3. Check npm package settings -> Publishing access
4. Verify OIDC configuration is correct

**Remember:** The initial setup is the hardest part. Once configured, publishing is just:
1. Run `./scripts/bump-n-push.sh patch`
2. Confirm the prompts
3. Done!
