#!/usr/bin/env node
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  desktopChannels,
  getTarballFileName,
  npmPublishPackages,
  repoRoot,
  versionedPackages,
} from './lib/context.mjs';
import {
  bumpSemver,
  computeSha256,
  copyFiles,
  ensureCleanGitState,
  ensureCommandAvailable,
  ensureOnMainBranch,
  ensureTagMissing,
  ensureVersionsInSync,
  formatRelativePath,
  parseSemver,
  printStep,
  readDesktopMetadataVersion,
  recreateDir,
  runCommand,
  setPackageVersion,
} from './lib/utils.mjs';

function parseArgs(argv) {
  const options = {
    bumpType: 'patch',
    desktopChannel: 'production',
    skipCheck: false,
  };

  let bumpTypeFromPositional = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      continue;
    }

    if (arg === '--desktop-channel') {
      const channel = argv[index + 1];
      if (!channel) {
        throw new Error(
          '--desktop-channel requires a value: production|internal'
        );
      }
      options.desktopChannel = channel;
      index += 1;
      continue;
    }

    if (arg === '--skip-check') {
      options.skipCheck = true;
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (bumpTypeFromPositional) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    options.bumpType = arg;
    bumpTypeFromPositional = true;
  }

  if (!['patch', 'minor', 'major'].includes(options.bumpType)) {
    throw new Error(
      `Invalid bump type: ${options.bumpType}. Use patch|minor|major.`
    );
  }

  if (!desktopChannels[options.desktopChannel]) {
    throw new Error(
      `Invalid desktop channel: ${options.desktopChannel}. Use production|internal.`
    );
  }

  return options;
}

function expectedDesktopArtifacts(version, metadataFile) {
  return [
    `Renku-${version}-arm64.dmg`,
    `Renku-${version}-arm64.dmg.blockmap`,
    `Renku-${version}-arm64-mac.zip`,
    `Renku-${version}-arm64-mac.zip.blockmap`,
    metadataFile,
  ];
}

function collectNpmTarballs(npmArtifactsDir, version) {
  const tarballPaths = [];
  for (const pkg of npmPublishPackages) {
    const tarballName = getTarballFileName(pkg.tarballBase, version);
    const tarballPath = join(npmArtifactsDir, tarballName);
    if (!existsSync(tarballPath)) {
      throw new Error(`Expected tarball not found: ${tarballPath}`);
    }
    tarballPaths.push(tarballPath);
  }
  return tarballPaths;
}

async function writeChecksums(releaseDir, filePaths) {
  const checksumLines = [];

  for (const filePath of filePaths) {
    const hash = await computeSha256(filePath);
    checksumLines.push(`${hash}  ${formatRelativePath(releaseDir, filePath)}`);
  }

  const checksumsPath = join(releaseDir, 'SHA256SUMS');
  writeFileSync(checksumsPath, `${checksumLines.join('\n')}\n`);
  return checksumsPath;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const desktopChannel = desktopChannels[options.desktopChannel];

  ensureCommandAvailable('git');
  ensureCommandAvailable('pnpm');

  printStep('Validating repository state');
  ensureCleanGitState();
  ensureOnMainBranch();

  const currentVersion = ensureVersionsInSync();
  parseSemver(currentVersion);
  const nextVersion = bumpSemver(currentVersion, options.bumpType);
  const tag = `v${nextVersion}`;
  ensureTagMissing(tag);

  printStep(`Bumping versions (${options.bumpType}) to ${nextVersion}`);
  for (const pkg of versionedPackages) {
    setPackageVersion(pkg.dir, nextVersion);
  }

  if (!options.skipCheck) {
    printStep('Running quality checks (pnpm check)');
    runCommand('pnpm', ['check']);
  }

  printStep(`Packaging desktop artifacts (${desktopChannel.name})`);
  runCommand('pnpm', [desktopChannel.packageScript]);

  const releaseDir = resolve(repoRoot, 'release', tag);
  const npmArtifactsDir = join(releaseDir, 'npm');
  const desktopArtifactsDir = join(releaseDir, 'desktop');

  printStep(
    `Preparing release directory (${formatRelativePath(repoRoot, releaseDir)})`
  );
  recreateDir(releaseDir);
  recreateDir(npmArtifactsDir);
  recreateDir(desktopArtifactsDir);

  printStep('Packing npm publish tarballs');
  for (const pkg of npmPublishPackages) {
    runCommand('pnpm', [
      '--filter',
      pkg.filter,
      'pack',
      '--pack-destination',
      npmArtifactsDir,
    ]);
  }

  const tarballPaths = collectNpmTarballs(npmArtifactsDir, nextVersion);

  const metadataPath = resolve(
    repoRoot,
    'desktop',
    'release',
    desktopChannel.metadataFile
  );
  if (!existsSync(metadataPath)) {
    throw new Error(`Desktop metadata file does not exist: ${metadataPath}`);
  }
  const desktopVersion = readDesktopMetadataVersion(metadataPath);
  if (desktopVersion !== nextVersion) {
    throw new Error(
      `Desktop metadata version mismatch. Expected ${nextVersion}, got ${desktopVersion} (${metadataPath})`
    );
  }

  const desktopReleaseDir = resolve(repoRoot, 'desktop', 'release');
  const desktopFileNames = expectedDesktopArtifacts(
    nextVersion,
    desktopChannel.metadataFile
  );
  printStep('Collecting desktop release artifacts');
  copyFiles(desktopReleaseDir, desktopArtifactsDir, desktopFileNames);

  const manifestPath = join(releaseDir, 'manifest.json');
  const npmTarballs = readdirSync(npmArtifactsDir)
    .filter((entry) => entry.endsWith('.tgz'))
    .sort();
  const desktopArtifacts = readdirSync(desktopArtifactsDir).sort();

  const manifest = {
    version: nextVersion,
    tag,
    desktopChannel: desktopChannel.name,
    createdAt: new Date().toISOString(),
    npmTarballs,
    desktopArtifacts,
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  printStep('Generating release checksums');
  const checksumInputs = [
    ...tarballPaths,
    ...desktopFileNames.map((name) => join(desktopArtifactsDir, name)),
    manifestPath,
  ];
  const checksumsPath = await writeChecksums(releaseDir, checksumInputs);

  printStep('Creating release commit and tag');
  const packageJsonPaths = versionedPackages.map(
    (pkg) => `${pkg.dir}/package.json`
  );
  runCommand('git', ['add', ...packageJsonPaths]);
  runCommand('git', ['commit', '-m', `release: ${tag}`]);
  runCommand('git', ['tag', tag]);

  const releaseDirRelative = formatRelativePath(repoRoot, releaseDir);
  process.stdout.write(`\nRelease prepared successfully.\n`);
  process.stdout.write(`- Version: ${nextVersion}\n`);
  process.stdout.write(`- Tag: ${tag}\n`);
  process.stdout.write(`- Release artifacts: ${releaseDirRelative}\n`);
  process.stdout.write(
    `- Checksums: ${formatRelativePath(repoRoot, checksumsPath)}\n`
  );
  process.stdout.write(
    `\nNext step: pnpm release:publish -- --tag ${tag} --desktop-channel ${desktopChannel.name}\n`
  );
}

main().catch((error) => {
  process.stderr.write(
    `\n[release:prepare] ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
