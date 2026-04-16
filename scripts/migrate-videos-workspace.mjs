#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import YAML, { isMap } from 'yaml';

const DEFAULT_ROOT = resolve(homedir(), 'videos');
const MAX_PREVIEW_ITEMS = 20;

function parseArgs(argv) {
  let dryRun = false;
  let root = DEFAULT_ROOT;
  let rootProvided = false;

  for (const arg of argv) {
    if (arg === '--') {
      continue;
    }

    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    if (rootProvided) {
      throw new Error(`Only one workspace root may be provided, received: ${arg}`);
    }

    root = resolve(arg);
    rootProvided = true;
  }

  return { dryRun, root };
}

function createSummary(root, dryRun) {
  return {
    root,
    dryRun,
    blueprints: {
      scanned: 0,
      changed: 0,
      unchanged: 0,
      changedPaths: [],
    },
    builds: {
      scanned: 0,
      completed: 0,
      incomplete: 0,
      eventLogsChanged: 0,
      manifestFilesChanged: 0,
      pointersChanged: 0,
      changedBuilds: [],
    },
  };
}

function isYamlFile(filePath) {
  const extension = extname(filePath).toLowerCase();
  return extension === '.yaml' || extension === '.yml';
}

function getScalarValue(node) {
  if (!node || typeof node !== 'object') {
    return null;
  }

  if ('value' in node) {
    return node.value;
  }

  return null;
}

function getMapPair(mapNode, keyName) {
  return mapNode.items.find((item) => getScalarValue(item.key) === keyName) ?? null;
}

function renameYamlTopLevelKey(mapNode, fromKey, toKey, filePath) {
  const fromPair = getMapPair(mapNode, fromKey);
  const toPair = getMapPair(mapNode, toKey);

  if (fromPair && toPair) {
    throw new Error(
      `${filePath}: found both "${fromKey}" and "${toKey}" at the top level.`
    );
  }

  if (!fromPair) {
    return false;
  }

  if (fromPair.key && typeof fromPair.key === 'object' && 'value' in fromPair.key) {
    fromPair.key.value = toKey;
    return true;
  }

  fromPair.key = toKey;
  return true;
}

function renderYamlDocument(document) {
  const rendered = String(document);
  return rendered.endsWith('\n') ? rendered : `${rendered}\n`;
}

function renameObjectKey(object, fromKey, toKey, label) {
  const hasFrom = Object.prototype.hasOwnProperty.call(object, fromKey);
  const hasTo = Object.prototype.hasOwnProperty.call(object, toKey);

  if (hasFrom && hasTo) {
    throw new Error(`${label}: found both "${fromKey}" and "${toKey}".`);
  }

  if (!hasFrom) {
    return { changed: false, value: object };
  }

  const renamed = {};
  for (const [key, value] of Object.entries(object)) {
    renamed[key === fromKey ? toKey : key] = value;
  }

  return { changed: true, value: renamed };
}

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function listBlueprintFiles(root) {
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);

      if (entry.isDirectory()) {
        if (
          entry.name === 'catalog' ||
          entry.name === 'builds' ||
          entry.name === 'node_modules' ||
          entry.name === '.git'
        ) {
          continue;
        }

        await visit(absolutePath);
        continue;
      }

      if (!entry.isFile() || !isYamlFile(absolutePath)) {
        continue;
      }

      files.push(absolutePath);
    }
  }

  await visit(root);
  return files;
}

async function listBuildDirectories(root) {
  const buildDirectories = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);

      if (!entry.isDirectory()) {
        continue;
      }

      if (entry.name === 'catalog' || entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }

      if (entry.name === 'builds') {
        const movieEntries = await readdir(absolutePath, { withFileTypes: true });
        movieEntries.sort((left, right) => left.name.localeCompare(right.name));

        for (const movieEntry of movieEntries) {
          if (movieEntry.isDirectory() && movieEntry.name.startsWith('movie-')) {
            buildDirectories.push(join(absolutePath, movieEntry.name));
          }
        }

        continue;
      }

      await visit(absolutePath);
    }
  }

  await visit(root);
  return buildDirectories;
}

async function migrateBlueprintFile(filePath, dryRun) {
  const raw = await readFile(filePath, 'utf8');
  const document = YAML.parseDocument(raw);

  if (document.errors.length > 0) {
    throw new Error(`${filePath}: ${document.errors[0]?.message ?? 'Failed to parse YAML.'}`);
  }

  if (!isMap(document.contents)) {
    return { isBlueprint: false, changed: false };
  }

  const metaPair = getMapPair(document.contents, 'meta');
  if (!metaPair || !isMap(metaPair.value)) {
    return { isBlueprint: false, changed: false };
  }

  const kindPair = getMapPair(metaPair.value, 'kind');
  const kind = getScalarValue(kindPair?.value);
  const looksLikeBlueprint =
    kind === 'blueprint' ||
    kind === 'producer' ||
    Boolean(
      getMapPair(document.contents, 'artifacts') ||
        getMapPair(document.contents, 'outputs') ||
        getMapPair(document.contents, 'producers') ||
        getMapPair(document.contents, 'imports') ||
        getMapPair(document.contents, 'connections') ||
        getMapPair(document.contents, 'loops') ||
        getMapPair(document.contents, 'conditions') ||
        getMapPair(document.contents, 'mappings')
    );

  if (!looksLikeBlueprint) {
    return { isBlueprint: false, changed: false };
  }

  let changed = false;
  changed =
    renameYamlTopLevelKey(document.contents, 'artifacts', 'outputs', filePath) || changed;
  changed =
    renameYamlTopLevelKey(document.contents, 'producers', 'imports', filePath) || changed;

  if (changed && !dryRun) {
    await writeFile(filePath, renderYamlDocument(document), 'utf8');
  }

  return { isBlueprint: true, changed };
}

async function rewriteArtifactEventLog(buildDir, dryRun) {
  const oldPath = join(buildDir, 'events', 'artefacts.log');
  const newPath = join(buildDir, 'events', 'artifacts.log');
  const oldExists = existsSync(oldPath);
  const newExists = existsSync(newPath);

  if (oldExists && newExists) {
    throw new Error(`${buildDir}: found both events/artefacts.log and events/artifacts.log.`);
  }

  if (!oldExists && !newExists) {
    return { changed: false };
  }

  const sourcePath = oldExists ? oldPath : newPath;
  const raw = await readFile(sourcePath, 'utf8');
  const nextLines = [];
  let contentChanged = false;

  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) {
      continue;
    }

    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `${sourcePath}: invalid JSON on line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const { changed, value } = renameObjectKey(
      event,
      'artefactId',
      'artifactId',
      `${sourcePath} line ${index + 1}`
    );
    const serialized = JSON.stringify(value);
    nextLines.push(serialized);
    contentChanged = contentChanged || changed || serialized !== line;
  }

  const nextRaw = nextLines.length === 0 ? '' : `${nextLines.join('\n')}\n`;
  const pathChanged = sourcePath !== newPath;

  if (!contentChanged && !pathChanged) {
    return { changed: false };
  }

  if (!dryRun) {
    await mkdir(dirname(newPath), { recursive: true });

    if (oldExists && !contentChanged) {
      await rename(oldPath, newPath);
    } else {
      await writeFile(newPath, nextRaw, 'utf8');
      if (oldExists) {
        await unlink(oldPath);
      }
    }
  }

  return { changed: true };
}

async function listManifestFiles(buildDir) {
  const manifestsDir = join(buildDir, 'manifests');
  if (!existsSync(manifestsDir)) {
    return [];
  }

  const entries = await readdir(manifestsDir, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  return entries
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.json')
    .map((entry) => join(manifestsDir, entry.name));
}

async function rewriteManifestFilesAndPointer(buildDir, dryRun) {
  const currentPath = join(buildDir, 'current.json');
  const currentExists = existsSync(currentPath);
  const manifestFiles = await listManifestFiles(buildDir);

  let current = null;
  let currentManifestPath = null;
  let pointerChanged = false;

  if (currentExists) {
    try {
      current = JSON.parse(await readFile(currentPath, 'utf8'));
    } catch (error) {
      throw new Error(
        `${currentPath}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (current.manifestPath != null) {
      if (
        typeof current.manifestPath !== 'string' ||
        current.manifestPath.length === 0
      ) {
        throw new Error(`${currentPath}: "manifestPath" must be a non-empty string or null.`);
      }

      currentManifestPath = join(buildDir, current.manifestPath);
      if (!existsSync(currentManifestPath)) {
        throw new Error(
          `${currentPath}: referenced manifest does not exist: ${currentManifestPath}`
        );
      }

      const currentManifestRaw = await readFile(currentManifestPath, 'utf8');
      const existingHash = hashContent(currentManifestRaw);
      if (current.hash !== existingHash) {
        throw new Error(
          `${currentPath}: pointer hash ${current.hash ?? 'null'} does not match manifest hash ${existingHash}.`
        );
      }
    }
  }

  let manifestFilesChanged = 0;
  let currentManifestNextHash = null;

  for (const manifestPath of manifestFiles) {
    const manifestRaw = await readFile(manifestPath, 'utf8');
    let manifest;
    try {
      manifest = JSON.parse(manifestRaw);
    } catch (error) {
      throw new Error(
        `${manifestPath}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const { changed, value } = renameObjectKey(
      manifest,
      'artefacts',
      'artifacts',
      manifestPath
    );

    if (!changed) {
      continue;
    }

    manifestFilesChanged += 1;
    const nextManifestRaw = `${JSON.stringify(value, null, 2)}\n`;

    if (currentManifestPath === manifestPath) {
      currentManifestNextHash = hashContent(nextManifestRaw);
    }

    if (!dryRun) {
      await writeFile(manifestPath, nextManifestRaw, 'utf8');
    }
  }

  if (current && currentManifestNextHash) {
    const nextPointer = {
      ...current,
      hash: currentManifestNextHash,
    };
    const nextPointerRaw = `${JSON.stringify(nextPointer, null, 2)}\n`;
    pointerChanged = true;

    if (!dryRun) {
      await writeFile(currentPath, nextPointerRaw, 'utf8');
    }
  }

  return {
    complete: Boolean(currentManifestPath),
    manifestFilesChanged,
    pointerChanged,
  };
}

async function migrateBuildDirectory(buildDir, dryRun) {
  const logResult = await rewriteArtifactEventLog(buildDir, dryRun);
  const manifestResult = await rewriteManifestFilesAndPointer(buildDir, dryRun);

  return {
    complete: manifestResult.complete,
    incomplete: !manifestResult.complete,
    changed:
      logResult.changed ||
      manifestResult.manifestFilesChanged > 0 ||
      manifestResult.pointerChanged,
    eventLogChanged: logResult.changed,
    manifestFilesChanged: manifestResult.manifestFilesChanged,
    pointerChanged: manifestResult.pointerChanged,
  };
}

function printPreview(title, items) {
  if (items.length === 0) {
    return;
  }

  console.log(`\n${title} (${items.length}):`);
  for (const item of items.slice(0, MAX_PREVIEW_ITEMS)) {
    console.log(`  - ${item}`);
  }
  if (items.length > MAX_PREVIEW_ITEMS) {
    console.log(`  ...and ${items.length - MAX_PREVIEW_ITEMS} more`);
  }
}

function printSummary(summary) {
  const mode = summary.dryRun ? 'dry-run' : 'write';

  console.log(
    `[videos:migrate] mode=${mode} root=${summary.root}`
  );
  console.log(
    `[videos:migrate] blueprints scanned=${summary.blueprints.scanned} changed=${summary.blueprints.changed} unchanged=${summary.blueprints.unchanged}`
  );
  console.log(
    `[videos:migrate] builds scanned=${summary.builds.scanned} completed=${summary.builds.completed} incomplete=${summary.builds.incomplete} eventLogsChanged=${summary.builds.eventLogsChanged} manifestFilesChanged=${summary.builds.manifestFilesChanged} pointersChanged=${summary.builds.pointersChanged}`
  );

  printPreview('Changed blueprint files', summary.blueprints.changedPaths);
  printPreview('Changed build directories', summary.builds.changedBuilds);
}

async function main() {
  const { dryRun, root } = parseArgs(process.argv.slice(2));
  if (!existsSync(root)) {
    throw new Error(`Workspace root does not exist: ${root}`);
  }

  const summary = createSummary(root, dryRun);
  const blueprintFiles = await listBlueprintFiles(root);
  const buildDirs = await listBuildDirectories(root);

  for (const filePath of blueprintFiles) {
    const result = await migrateBlueprintFile(filePath, dryRun);
    if (!result.isBlueprint) {
      continue;
    }

    summary.blueprints.scanned += 1;
    if (result.changed) {
      summary.blueprints.changed += 1;
      summary.blueprints.changedPaths.push(filePath);
    } else {
      summary.blueprints.unchanged += 1;
    }
  }

  for (const buildDir of buildDirs) {
    const result = await migrateBuildDirectory(buildDir, dryRun);

    summary.builds.scanned += 1;
    if (result.complete) {
      summary.builds.completed += 1;
    } else {
      summary.builds.incomplete += 1;
    }

    if (result.eventLogChanged) {
      summary.builds.eventLogsChanged += 1;
    }
    summary.builds.manifestFilesChanged += result.manifestFilesChanged;
    if (result.pointerChanged) {
      summary.builds.pointersChanged += 1;
    }
    if (result.changed) {
      summary.builds.changedBuilds.push(buildDir);
    }
  }

  printSummary(summary);
}

main().catch((error) => {
  console.error(
    '[videos:migrate] Failed:',
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
