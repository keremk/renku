#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from './lib/context.mjs';
import {
  ensureCleanGitState,
  ensureCommandAvailable,
  ensureOnMainBranch,
  ensureVersionsInSync,
  parseSemver,
  runCommand,
} from './lib/utils.mjs';

function parseArgs(argv) {
  const options = {
    allowDirty: false,
    allowNonMain: false,
    skipQualityCheck: false,
    skipCloudflare: false,
  };

  for (const arg of argv) {
    if (arg === '--') {
      continue;
    }
    if (arg === '--allow-dirty') {
      options.allowDirty = true;
      continue;
    }
    if (arg === '--allow-non-main') {
      options.allowNonMain = true;
      continue;
    }
    if (arg === '--skip-quality-check') {
      options.skipQualityCheck = true;
      continue;
    }
    if (arg === '--skip-cloudflare') {
      options.skipCloudflare = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function step(label) {
  process.stdout.write(`\n==> ${label}\n`);
}

function ok(message) {
  process.stdout.write(`✓ ${message}\n`);
}

function fail(message) {
  throw new Error(message);
}

function readCloudflareVarsFromDotEnv() {
  const envPath = resolve(repoRoot, '.env');
  if (!existsSync(envPath)) {
    return { CLOUDFLARE_TOKEN: undefined, CLOUDFLARE_ACCOUNT_ID: undefined };
  }

  const values = {
    CLOUDFLARE_TOKEN: undefined,
    CLOUDFLARE_ACCOUNT_ID: undefined,
  };

  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, '');

    if (key === 'CLOUDFLARE_TOKEN') {
      values.CLOUDFLARE_TOKEN = value;
    }
    if (key === 'CLOUDFLARE_ACCOUNT_ID') {
      values.CLOUDFLARE_ACCOUNT_ID = value;
    }
  }

  return values;
}

function assertCloudflareCredentialsPresent() {
  const envValues = readCloudflareVarsFromDotEnv();
  const token = process.env.CLOUDFLARE_TOKEN ?? envValues.CLOUDFLARE_TOKEN;
  const accountId =
    process.env.CLOUDFLARE_ACCOUNT_ID ?? envValues.CLOUDFLARE_ACCOUNT_ID;

  if (!token || token.trim() === '') {
    fail('Missing CLOUDFLARE_TOKEN (set in shell env or repo-root .env)');
  }
  if (!accountId || accountId.trim() === '') {
    fail('Missing CLOUDFLARE_ACCOUNT_ID (set in shell env or repo-root .env)');
  }

  ok('Cloudflare credentials are configured (value redacted)');
}

function checkGitHubAuth() {
  const status = runCommand('gh', ['auth', 'status'], {
    stdio: 'pipe',
    allowFailure: true,
  });

  if (status.status !== 0) {
    fail('gh is not authenticated. Run: gh auth login');
  }

  ok('gh authentication is active');
}

function checkNpmAuth() {
  const result = runCommand('npm', ['whoami'], {
    stdio: 'pipe',
    allowFailure: true,
  });

  if (result.status !== 0) {
    fail('npm auth missing. Run: npm login');
  }

  const account = (result.stdout ?? '').trim();
  if (!account) {
    fail('npm auth missing. Run: npm login');
  }

  ok(`npm auth is active (${account})`);
}

function checkScriptSyntax() {
  const files = [
    'scripts/release/lib/context.mjs',
    'scripts/release/lib/utils.mjs',
    'scripts/release/preflight.mjs',
    'scripts/release/prepare.mjs',
    'scripts/release/publish.mjs',
    'scripts/release/ship.mjs',
  ];

  for (const file of files) {
    runCommand('node', ['--check', file]);
  }

  runCommand('bash', ['-n', 'scripts/bump-versions.sh']);
  runCommand('bash', ['-n', 'scripts/bump-n-push.sh']);
  ok('Release script syntax checks passed');
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  step('Checking required tools');
  ensureCommandAvailable('git');
  ensureCommandAvailable('gh');
  ensureCommandAvailable('npm');
  ensureCommandAvailable('pnpm');
  ensureCommandAvailable('node');
  ok('Required tools found: git gh npm pnpm node');

  step('Checking git state');
  if (!options.allowNonMain) {
    ensureOnMainBranch();
    ok('Current branch is main');
  } else {
    ok('Skipped main-branch check (--allow-non-main)');
  }

  if (!options.allowDirty) {
    ensureCleanGitState();
    ok('Working tree is clean');
  } else {
    ok('Skipped clean-tree check (--allow-dirty)');
  }

  step('Checking synchronized versions');
  const version = ensureVersionsInSync();
  parseSemver(version);
  ok(`Release package versions are synchronized at ${version}`);

  step('Checking authentication');
  checkGitHubAuth();
  checkNpmAuth();

  step('Checking release script syntax');
  checkScriptSyntax();

  if (!options.skipCloudflare) {
    step('Checking Cloudflare deploy credentials');
    assertCloudflareCredentialsPresent();
  } else {
    step('Skipping Cloudflare credential check (--skip-cloudflare)');
  }

  if (!options.skipQualityCheck) {
    step('Running quality gate (pnpm check)');
    runCommand('pnpm', ['check']);
    ok('pnpm check passed');
  } else {
    step('Skipping quality gate (--skip-quality-check)');
  }

  process.stdout.write('\nPreflight passed. You can run a release safely.\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `\n[release:preflight] ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
}
