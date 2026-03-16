import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { repoRoot, versionedPackages } from './context.mjs';

export function runCommand(command, args, options = {}) {
  const { cwd = repoRoot, stdio = 'inherit', allowFailure = false, env } = options;
  const result = spawnSync(command, args, {
    cwd,
    stdio,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
  });

  if (!allowFailure && result.status !== 0) {
    const renderedArgs = args.join(' ');
    throw new Error(
      `Command failed (${command} ${renderedArgs}) with exit code ${String(result.status)}`
    );
  }

  return result;
}

export function ensureCommandAvailable(command) {
  const result = runCommand('which', [command], { stdio: 'pipe', allowFailure: true });
  if (result.status !== 0) {
    throw new Error(`Required command is not available: ${command}`);
  }
}

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function getPackageJsonPath(packageDir) {
  return resolve(repoRoot, packageDir, 'package.json');
}

export function getPackageVersion(packageDir) {
  const packageJson = readJson(getPackageJsonPath(packageDir));
  if (typeof packageJson.version !== 'string' || packageJson.version.trim() === '') {
    throw new Error(`Missing or invalid version in ${packageDir}/package.json`);
  }
  return packageJson.version;
}

export function setPackageVersion(packageDir, version) {
  const packageJsonPath = getPackageJsonPath(packageDir);
  const packageJson = readJson(packageJsonPath);
  packageJson.version = version;
  writeJson(packageJsonPath, packageJson);
}

export function getVersionMap() {
  const map = new Map();
  for (const pkg of versionedPackages) {
    map.set(pkg.dir, getPackageVersion(pkg.dir));
  }
  return map;
}

export function ensureVersionsInSync() {
  const versions = getVersionMap();
  const first = versions.values().next().value;

  for (const [pkg, version] of versions.entries()) {
    if (version !== first) {
      const details = Array.from(versions.entries())
        .map(([name, value]) => `${name}: ${value}`)
        .join(', ');
      throw new Error(`Package versions are not in sync: ${details}`);
    }
  }

  return first;
}

export function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Version must be strict semver (x.y.z), got: ${version}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function bumpSemver(version, bumpType) {
  const parsed = parseSemver(version);

  if (bumpType === 'major') {
    return `${String(parsed.major + 1)}.0.0`;
  }
  if (bumpType === 'minor') {
    return `${String(parsed.major)}.${String(parsed.minor + 1)}.0`;
  }
  if (bumpType === 'patch') {
    return `${String(parsed.major)}.${String(parsed.minor)}.${String(parsed.patch + 1)}`;
  }

  throw new Error(`Unsupported bump type: ${bumpType}`);
}

export function ensureCleanGitState() {
  const result = runCommand('git', ['status', '--porcelain'], { stdio: 'pipe' });
  if ((result.stdout ?? '').trim() !== '') {
    throw new Error('Working tree is not clean. Commit or stash changes before preparing a release.');
  }
}

export function ensureOnMainBranch() {
  const result = runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    stdio: 'pipe',
  });
  const branch = (result.stdout ?? '').trim();
  if (branch !== 'main') {
    throw new Error(`Release commands must run on main. Current branch: ${branch}`);
  }
}

export function ensureTagMissing(tag) {
  const localTag = runCommand('git', ['rev-parse', '--verify', `refs/tags/${tag}`], {
    stdio: 'pipe',
    allowFailure: true,
  });
  if (localTag.status === 0) {
    throw new Error(`Tag already exists locally: ${tag}`);
  }

  const remoteTag = runCommand('git', ['ls-remote', '--tags', 'origin', tag], {
    stdio: 'pipe',
    allowFailure: true,
  });
  if ((remoteTag.stdout ?? '').trim() !== '') {
    throw new Error(`Tag already exists on origin: ${tag}`);
  }
}

export function ensureTagExists(tag) {
  const localTag = runCommand('git', ['rev-parse', '--verify', `refs/tags/${tag}`], {
    stdio: 'pipe',
    allowFailure: true,
  });
  if (localTag.status !== 0) {
    throw new Error(`Tag does not exist locally: ${tag}`);
  }
}

export function ensureTagPointsToHead(tag) {
  const tagSha = (runCommand('git', ['rev-list', '-n', '1', tag], { stdio: 'pipe' }).stdout ?? '').trim();
  const headSha = (runCommand('git', ['rev-parse', 'HEAD'], { stdio: 'pipe' }).stdout ?? '').trim();
  if (tagSha !== headSha) {
    throw new Error(`Tag ${tag} does not point to HEAD.`);
  }
}

export function parseReleaseTag(tag) {
  const match = /^v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!match) {
    throw new Error(`Release tag must match vX.Y.Z. Received: ${tag}`);
  }
  return match[1];
}

export function recreateDir(dirPath) {
  rmSync(dirPath, { recursive: true, force: true });
  mkdirSync(dirPath, { recursive: true });
}

export function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

export function copyFiles(sourceDir, destinationDir, fileNames) {
  ensureDir(destinationDir);
  for (const name of fileNames) {
    const sourcePath = join(sourceDir, name);
    if (!existsSync(sourcePath)) {
      throw new Error(`Expected file does not exist: ${sourcePath}`);
    }
    copyFileSync(sourcePath, join(destinationDir, name));
  }
}

export function readDesktopMetadataVersion(metadataPath) {
  const lines = readFileSync(metadataPath, 'utf8').split('\n');
  const versionLine = lines.find((line) => line.startsWith('version:'));
  if (!versionLine) {
    throw new Error(`Missing version entry in desktop metadata: ${metadataPath}`);
  }
  const version = versionLine.slice('version:'.length).trim();
  if (!version) {
    throw new Error(`Desktop metadata has empty version: ${metadataPath}`);
  }
  return version;
}

export function listFilesRecursively(rootDir) {
  const files = [];

  function walk(currentPath) {
    for (const entry of readdirSync(currentPath)) {
      const fullPath = join(currentPath, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        walk(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }

  walk(rootDir);
  files.sort((left, right) => left.localeCompare(right));
  return files;
}

export async function computeSha256(filePath) {
  return await new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', (chunk) => {
      hash.update(chunk);
    });
    stream.on('error', (error) => {
      rejectHash(error);
    });
    stream.on('end', () => {
      resolveHash(hash.digest('hex'));
    });
  });
}

export function formatRelativePath(baseDir, absolutePath) {
  return relative(baseDir, absolutePath).split('\\').join('/');
}

export function printStep(title) {
  process.stdout.write(`\n==> ${title}\n`);
}
