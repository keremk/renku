#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  desktopChannels,
  getTarballFileName,
  npmPublishPackages,
  repoRoot,
} from './lib/context.mjs';
import {
  copyFiles,
  ensureCommandAvailable,
  ensureOnMainBranch,
  ensureTagExists,
  ensureTagPointsToHead,
  ensureVersionsInSync,
  formatRelativePath,
  getPackageVersion,
  parseReleaseTag,
  printStep,
  recreateDir,
  runCommand,
} from './lib/utils.mjs';

function parseArgs(argv) {
  const options = {
    tag: null,
    desktopChannel: 'production',
    deployWeb: false,
    skipPush: false,
    skipGithub: false,
    skipNpm: false,
    skipDesktop: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      continue;
    }

    if (arg === '--tag') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--tag requires a value (example: v0.2.0)');
      }
      options.tag = value;
      index += 1;
      continue;
    }

    if (arg === '--desktop-channel') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(
          '--desktop-channel requires a value: production|internal'
        );
      }
      options.desktopChannel = value;
      index += 1;
      continue;
    }

    if (arg === '--deploy-web') {
      options.deployWeb = true;
      continue;
    }

    if (arg === '--skip-push') {
      options.skipPush = true;
      continue;
    }

    if (arg === '--skip-github') {
      options.skipGithub = true;
      continue;
    }

    if (arg === '--skip-npm') {
      options.skipNpm = true;
      continue;
    }

    if (arg === '--skip-desktop') {
      options.skipDesktop = true;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (!desktopChannels[options.desktopChannel]) {
    throw new Error(
      `Invalid desktop channel: ${options.desktopChannel}. Use production|internal.`
    );
  }

  return options;
}

function ensureTagMatchesVersion(tag) {
  const versionFromTag = parseReleaseTag(tag);
  const syncedVersion = ensureVersionsInSync();
  if (syncedVersion !== versionFromTag) {
    throw new Error(
      `Tag/version mismatch. Tag ${tag} implies ${versionFromTag}, but package versions are ${syncedVersion}.`
    );
  }
  return versionFromTag;
}

function getReleaseDirs(tag) {
  const releaseDir = resolve(repoRoot, 'release', tag);
  const npmDir = join(releaseDir, 'npm');
  const desktopDir = join(releaseDir, 'desktop');

  if (!existsSync(releaseDir)) {
    throw new Error(`Release directory is missing: ${releaseDir}`);
  }
  if (!existsSync(npmDir)) {
    throw new Error(`NPM artifact directory is missing: ${npmDir}`);
  }
  if (!existsSync(desktopDir)) {
    throw new Error(`Desktop artifact directory is missing: ${desktopDir}`);
  }

  return { releaseDir, npmDir, desktopDir };
}

function ensureNpmTarballs(npmDir, version) {
  const tarballs = [];
  for (const pkg of npmPublishPackages) {
    const fileName = getTarballFileName(pkg.tarballBase, version);
    const absolutePath = join(npmDir, fileName);
    if (!existsSync(absolutePath)) {
      throw new Error(`Expected npm tarball not found: ${absolutePath}`);
    }
    tarballs.push({ ...pkg, fileName, absolutePath });
  }
  return tarballs;
}

function releaseExists(tag) {
  const result = runCommand('gh', ['release', 'view', tag], {
    stdio: 'pipe',
    allowFailure: true,
  });
  return result.status === 0;
}

function ensureDraftGithubRelease(tag) {
  if (releaseExists(tag)) {
    return;
  }

  runCommand('gh', [
    'release',
    'create',
    tag,
    '--draft',
    '--title',
    `Renku ${tag}`,
    '--notes',
    `Release ${tag}`,
  ]);
}

function uploadGithubAssets(tag, releaseDir, npmDir, desktopDir) {
  const npmAssets = readdirSync(npmDir).map((entry) => join(npmDir, entry));
  const desktopAssets = readdirSync(desktopDir).map((entry) =>
    join(desktopDir, entry)
  );
  const extraAssets = ['manifest.json', 'SHA256SUMS']
    .map((name) => join(releaseDir, name))
    .filter((filePath) => existsSync(filePath));

  const assets = [...npmAssets, ...desktopAssets, ...extraAssets].sort();
  if (assets.length === 0) {
    throw new Error(`No assets found to upload for ${tag}`);
  }

  runCommand('gh', ['release', 'upload', tag, ...assets, '--clobber']);
}

function isPackagePublished(npmName, version) {
  const result = runCommand(
    'npm',
    ['view', `${npmName}@${version}`, 'version', '--json'],
    {
      stdio: 'pipe',
      allowFailure: true,
    }
  );
  if (result.status !== 0) {
    return false;
  }

  const raw = (result.stdout ?? '').trim();
  if (raw === '') {
    return false;
  }

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') {
      return parsed === version;
    }
    if (Array.isArray(parsed)) {
      return parsed.includes(version);
    }
    return false;
  } catch {
    return raw === version;
  }
}

function publishNpmTarballs(tarballs, version) {
  for (const tarball of tarballs) {
    if (isPackagePublished(tarball.npmName, version)) {
      process.stdout.write(
        `- Skipping ${tarball.npmName}@${version} (already published)\n`
      );
      continue;
    }

    process.stdout.write(`- Publishing ${tarball.npmName}@${version}\n`);
    runCommand('npm', ['publish', tarball.absolutePath, '--access', 'public']);
  }
}

function restoreDesktopArtifacts(desktopArtifactsDir) {
  const sourceFiles = readdirSync(desktopArtifactsDir).sort();
  const targetDir = resolve(repoRoot, 'desktop', 'release');
  recreateDir(targetDir);
  copyFiles(desktopArtifactsDir, targetDir, sourceFiles);
}

function resolveTagFromCliVersion(tagOverride) {
  if (tagOverride) {
    return tagOverride;
  }
  const cliVersion = getPackageVersion('cli');
  return `v${cliVersion}`;
}

function pushReleaseRefs(tag) {
  runCommand('git', ['push', 'origin', 'main']);
  runCommand('git', ['push', 'origin', tag]);
}

function deployDesktop(channel) {
  runCommand('bash', [
    'scripts/deploy-desktop.sh',
    channel.deployFlag,
    '--skip-build',
  ]);
}

function deployWeb() {
  runCommand('pnpm', ['deploy:web']);
}

function finalizeGithubRelease(tag) {
  runCommand('gh', ['release', 'edit', tag, '--draft=false']);
}

function printSummary({ tag, releaseDir, channel, deployWebEnabled }) {
  process.stdout.write('\nRelease publish completed.\n');
  process.stdout.write(`- Tag: ${tag}\n`);
  process.stdout.write(
    `- Release artifacts: ${formatRelativePath(repoRoot, releaseDir)}\n`
  );
  process.stdout.write(`- Desktop channel: ${channel.name}\n`);
  process.stdout.write(`- Web deployed: ${deployWebEnabled ? 'yes' : 'no'}\n`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const channel = desktopChannels[options.desktopChannel];

  ensureCommandAvailable('git');
  ensureCommandAvailable('npm');
  ensureCommandAvailable('pnpm');

  if (!options.skipGithub) {
    ensureCommandAvailable('gh');
  }

  ensureOnMainBranch();

  const tag = resolveTagFromCliVersion(options.tag);
  const version = ensureTagMatchesVersion(tag);
  ensureTagExists(tag);
  ensureTagPointsToHead(tag);

  const { releaseDir, npmDir, desktopDir } = getReleaseDirs(tag);
  const tarballs = ensureNpmTarballs(npmDir, version);

  if (!options.skipPush) {
    printStep('Pushing release commit and tag');
    pushReleaseRefs(tag);
  }

  if (!options.skipGithub) {
    printStep('Preparing GitHub release (draft)');
    ensureDraftGithubRelease(tag);
    printStep('Uploading release assets to GitHub release');
    uploadGithubAssets(tag, releaseDir, npmDir, desktopDir);
  }

  if (!options.skipNpm) {
    printStep('Publishing npm packages');
    publishNpmTarballs(tarballs, version);
  }

  if (!options.skipDesktop) {
    printStep('Deploying desktop updater artifacts to Cloudflare');
    restoreDesktopArtifacts(desktopDir);
    deployDesktop(channel);
  }

  if (options.deployWeb) {
    printStep('Deploying website/docs');
    deployWeb();
  }

  if (!options.skipGithub) {
    printStep('Publishing GitHub release');
    finalizeGithubRelease(tag);
  }

  printSummary({
    tag,
    releaseDir,
    channel,
    deployWebEnabled: options.deployWeb,
  });
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `\n[release:publish] ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
}
