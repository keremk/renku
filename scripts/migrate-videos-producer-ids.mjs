#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import {
  loadBlueprintResolutionContext,
  selectBlueprintResolutionInputs,
  expandBlueprintResolutionContext,
  deriveProducerFamilyId,
} from '../core/dist/index.js';

const DEFAULT_ROOT = resolve(homedir(), 'videos');
const REVISION_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

function parseArgs(argv) {
  let root = DEFAULT_ROOT;
  let rootProvided = false;
  let write = false;
  let skipUnresolved = false;

  for (const arg of argv) {
    if (arg === '--') {
      continue;
    }

    if (arg === '--write') {
      write = true;
      continue;
    }

    if (arg === '--skip-unresolved') {
      skipUnresolved = true;
      continue;
    }

    if (arg === '--dry-run') {
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

  return { root, write, skipUnresolved };
}

function createSummary(root, write, skipUnresolved) {
  return {
    root,
    write,
    skipUnresolved,
    buildsScanned: 0,
    buildsChanged: 0,
    eventRowsUpdated: 0,
    manifestEntriesUpdated: 0,
    manifestFilesChanged: 0,
    currentPointersUpdated: 0,
    backfilledProducerIds: 0,
    correctedProducerIds: 0,
    unresolved: [],
    changedBuilds: [],
  };
}

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function listBuildDirectories(root) {
  const buildDirectories = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const absolutePath = join(directory, entry.name);
      if (
        entry.name === 'catalog' ||
        entry.name === 'node_modules' ||
        entry.name === '.git' ||
        entry.name === 'artifacts'
      ) {
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

async function readJsonFile(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `${label}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function readJsonLines(filePath, label) {
  if (!existsSync(filePath)) {
    return [];
  }

  const raw = await readFile(filePath, 'utf8');
  const records = [];

  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) {
      continue;
    }

    let value;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `${label}: invalid JSON on line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    records.push({
      lineNumber: index + 1,
      originalLine: line,
      value,
    });
  }

  return records;
}

function compareRevisions(left, right) {
  return REVISION_COLLATOR.compare(left, right);
}

function collectNeededRevisions(artifactEventLines, manifests) {
  const revisions = new Set();

  for (const line of artifactEventLines) {
    const event = line.value;
    if (
      typeof event.producedBy === 'string' &&
      event.producedBy.length > 0 &&
      typeof event.revision === 'string' &&
      event.revision.length > 0
    ) {
      revisions.add(event.revision);
    }
  }

  for (const manifest of manifests) {
    if (
      typeof manifest.value.revision !== 'string' ||
      manifest.value.revision.length === 0
    ) {
      throw new Error(`${manifest.path}: manifest is missing a valid "revision" string.`);
    }

    const artifacts = manifest.value.artifacts;
    if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)) {
      continue;
    }

    if (
      Object.values(artifacts).some(
        (artifact) =>
          artifact &&
          typeof artifact === 'object' &&
          !Array.isArray(artifact) &&
          typeof artifact.producedBy === 'string' &&
          artifact.producedBy.length > 0
      )
    ) {
      revisions.add(manifest.value.revision);
    }
  }

  return Array.from(revisions).sort(compareRevisions);
}

function buildRevisionInputs(inputEventLines, targetRevisions, buildDir) {
  if (targetRevisions.length === 0) {
    return new Map();
  }

  const inputEvents = inputEventLines
    .map((line, index) => ({
      index,
      lineNumber: line.lineNumber,
      value: line.value,
    }))
    .sort((left, right) => {
      const revisionOrder = compareRevisions(
        String(left.value.revision ?? ''),
        String(right.value.revision ?? '')
      );
      if (revisionOrder !== 0) {
        return revisionOrder;
      }
      return left.index - right.index;
    });

  const revisionInputs = new Map();
  const currentInputs = new Map();
  let eventIndex = 0;

  for (const revision of targetRevisions) {
    while (
      eventIndex < inputEvents.length &&
      compareRevisions(String(inputEvents[eventIndex].value.revision ?? ''), revision) <= 0
    ) {
      const event = inputEvents[eventIndex].value;
      if (typeof event.id !== 'string' || event.id.length === 0) {
        throw new Error(
          `${buildDir}/events/inputs.log line ${inputEvents[eventIndex].lineNumber}: input event is missing a valid "id".`
        );
      }

      if (typeof event.revision !== 'string' || event.revision.length === 0) {
        throw new Error(
          `${buildDir}/events/inputs.log line ${inputEvents[eventIndex].lineNumber}: input event is missing a valid "revision".`
        );
      }

      currentInputs.set(event.id, event.payload);
      eventIndex += 1;
    }

    if (currentInputs.size === 0) {
      throw new Error(
        `${buildDir}: no input events are available at or before revision "${revision}".`
      );
    }

    revisionInputs.set(revision, Object.fromEntries(currentInputs.entries()));
  }

  return revisionInputs;
}

async function buildProducerIdLookupByRevision({
  buildDir,
  root,
  targetRevisions,
}) {
  if (targetRevisions.length === 0) {
    return new Map();
  }

  const metadataPath = join(buildDir, 'metadata.json');
  if (!existsSync(metadataPath)) {
    throw new Error(`${buildDir}: missing metadata.json.`);
  }

  const metadata = await readJsonFile(metadataPath, metadataPath);
  if (typeof metadata.blueprintPath !== 'string' || metadata.blueprintPath.length === 0) {
    throw new Error(`${metadataPath}: missing a valid "blueprintPath".`);
  }

  const blueprintPath = metadata.blueprintPath;
  if (!existsSync(blueprintPath)) {
    throw new Error(`${metadataPath}: blueprint does not exist: ${blueprintPath}`);
  }

  const inputsLogPath = join(buildDir, 'events', 'inputs.log');
  if (!existsSync(inputsLogPath)) {
    throw new Error(`${buildDir}: missing events/inputs.log.`);
  }

  const inputEventLines = await readJsonLines(inputsLogPath, inputsLogPath);
  const revisionInputs = buildRevisionInputs(inputEventLines, targetRevisions, buildDir);
  const context = await loadBlueprintResolutionContext({
    blueprintPath,
    catalogRoot: join(root, 'catalog'),
    schemaSource: { kind: 'producer-metadata' },
  });

  const lookups = new Map();
  for (const revision of targetRevisions) {
    const resolvedInputs = revisionInputs.get(revision);
    if (!resolvedInputs) {
      throw new Error(`${buildDir}: failed to resolve inputs for revision "${revision}".`);
    }

    const canonicalInputs = selectBlueprintResolutionInputs(context, resolvedInputs);
    const expanded = expandBlueprintResolutionContext(context, canonicalInputs);
    const producerLookup = new Map();

    for (const node of expanded.canonical.nodes) {
      if (node.type !== 'Producer') {
        continue;
      }
      producerLookup.set(node.id, deriveProducerFamilyId(node.id));
    }

    lookups.set(revision, producerLookup);
  }

  return lookups;
}

function resolveExpectedProducerId(lookupByRevision, revision, producedBy, label) {
  const lookup = lookupByRevision.get(revision);
  if (!lookup) {
    throw new Error(`${label}: no producer lookup was built for revision "${revision}".`);
  }

  const expectedProducerId = lookup.get(producedBy);
  if (!expectedProducerId) {
    throw new Error(
      `${label}: producer job "${producedBy}" does not exist in the resolved blueprint graph for revision "${revision}".`
    );
  }

  return expectedProducerId;
}

function updateProducerIdField(record, expectedProducerId) {
  if (record.producerId === expectedProducerId) {
    return { changed: false, kind: null };
  }

  if (record.producerId === undefined) {
    record.producerId = expectedProducerId;
    return { changed: true, kind: 'backfill' };
  }

  record.producerId = expectedProducerId;
  return { changed: true, kind: 'correct' };
}

async function planBuildMigration(buildDir, root) {
  const artifactsLogPath = join(buildDir, 'events', 'artifacts.log');
  const artifactEventLines = await readJsonLines(artifactsLogPath, artifactsLogPath);

  const manifestFiles = await listManifestFiles(buildDir);
  const manifests = [];
  for (const manifestPath of manifestFiles) {
    manifests.push({
      path: manifestPath,
      value: await readJsonFile(manifestPath, manifestPath),
    });
  }

  const targetRevisions = collectNeededRevisions(artifactEventLines, manifests);
  const currentPath = join(buildDir, 'current.json');
  const current = existsSync(currentPath)
    ? await readJsonFile(currentPath, currentPath)
    : null;

  if (
    current &&
    current.manifestPath !== null &&
    current.manifestPath !== undefined &&
    (typeof current.manifestPath !== 'string' || current.manifestPath.length === 0)
  ) {
    throw new Error(`${currentPath}: "manifestPath" must be a non-empty string or null.`);
  }

  let currentManifestPath = null;
  let currentManifestOriginalHash = null;

  if (current && typeof current.manifestPath === 'string') {
    currentManifestPath = join(buildDir, current.manifestPath);
    if (!existsSync(currentManifestPath)) {
      throw new Error(
        `${currentPath}: referenced manifest does not exist: ${currentManifestPath}`
      );
    }

    const currentManifestRaw = await readFile(currentManifestPath, 'utf8');
    currentManifestOriginalHash = hashContent(currentManifestRaw);
    if (current.hash !== currentManifestOriginalHash) {
      throw new Error(
        `${currentPath}: pointer hash ${current.hash ?? 'null'} does not match manifest hash ${currentManifestOriginalHash}.`
      );
    }
  }

  if (targetRevisions.length === 0) {
    return {
      buildDir,
      changed: false,
      writes: [],
      counts: {
        eventRowsUpdated: 0,
        manifestEntriesUpdated: 0,
        manifestFilesChanged: 0,
        currentPointersUpdated: 0,
        backfilledProducerIds: 0,
        correctedProducerIds: 0,
      },
    };
  }

  const lookupByRevision = await buildProducerIdLookupByRevision({
    buildDir,
    root,
    targetRevisions,
  });

  const writes = [];
  let eventRowsUpdated = 0;
  let manifestEntriesUpdated = 0;
  let manifestFilesChanged = 0;
  let currentPointersUpdated = 0;
  let backfilledProducerIds = 0;
  let correctedProducerIds = 0;

  if (existsSync(artifactsLogPath)) {
    const nextLines = [];
    let artifactsLogChanged = false;

    for (const line of artifactEventLines) {
      const event = line.value;
      if (typeof event.producedBy === 'string' && event.producedBy.length > 0) {
        if (typeof event.revision !== 'string' || event.revision.length === 0) {
          throw new Error(
            `${artifactsLogPath} line ${line.lineNumber}: artifact event is missing a valid "revision".`
          );
        }

        const expectedProducerId = resolveExpectedProducerId(
          lookupByRevision,
          event.revision,
          event.producedBy,
          `${artifactsLogPath} line ${line.lineNumber}`
        );
        const update = updateProducerIdField(event, expectedProducerId);
        if (update.changed) {
          artifactsLogChanged = true;
          eventRowsUpdated += 1;
          if (update.kind === 'backfill') {
            backfilledProducerIds += 1;
          } else {
            correctedProducerIds += 1;
          }
        }
      }

      const serialized = JSON.stringify(event);
      nextLines.push(serialized);
      if (serialized !== line.originalLine) {
        artifactsLogChanged = true;
      }
    }

    if (artifactsLogChanged) {
      writes.push({
        path: artifactsLogPath,
        content: nextLines.length === 0 ? '' : `${nextLines.join('\n')}\n`,
      });
    }
  }

  let nextCurrentHash = null;

  for (const manifest of manifests) {
    const artifacts = manifest.value.artifacts;
    if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)) {
      continue;
    }

    let manifestChanged = false;

    for (const [artifactId, artifact] of Object.entries(artifacts)) {
      if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
        continue;
      }

      if (typeof artifact.producedBy !== 'string' || artifact.producedBy.length === 0) {
        continue;
      }

      const expectedProducerId = resolveExpectedProducerId(
        lookupByRevision,
        manifest.value.revision,
        artifact.producedBy,
        `${manifest.path} artifact "${artifactId}"`
      );
      const update = updateProducerIdField(artifact, expectedProducerId);
      if (update.changed) {
        manifestChanged = true;
        manifestEntriesUpdated += 1;
        if (update.kind === 'backfill') {
          backfilledProducerIds += 1;
        } else {
          correctedProducerIds += 1;
        }
      }
    }

    if (!manifestChanged) {
      continue;
    }

    manifestFilesChanged += 1;
    const nextManifestRaw = `${JSON.stringify(manifest.value, null, 2)}\n`;
    writes.push({
      path: manifest.path,
      content: nextManifestRaw,
    });

    if (currentManifestPath === manifest.path) {
      nextCurrentHash = hashContent(nextManifestRaw);
    }
  }

  if (current && nextCurrentHash) {
    const nextPointer = {
      ...current,
      hash: nextCurrentHash,
    };
    const nextPointerRaw = `${JSON.stringify(nextPointer, null, 2)}\n`;
    currentPointersUpdated += 1;
    writes.push({
      path: currentPath,
      content: nextPointerRaw,
    });
  } else if (current && currentManifestPath && currentManifestOriginalHash === null) {
    throw new Error(`${buildDir}: expected current manifest hash to be available.`);
  }

  return {
    buildDir,
    changed: writes.length > 0,
    writes,
    counts: {
      eventRowsUpdated,
      manifestEntriesUpdated,
      manifestFilesChanged,
      currentPointersUpdated,
      backfilledProducerIds,
      correctedProducerIds,
    },
  };
}

async function applyWrites(plan) {
  for (const write of plan.writes) {
    await writeFile(write.path, write.content, 'utf8');
  }
}

function printSummary(summary) {
  console.log(
    `[videos:producer-id-migrate] mode=${summary.write ? 'write' : 'dry-run'} root=${summary.root} skipUnresolved=${summary.skipUnresolved}`
  );
  console.log(
    `[videos:producer-id-migrate] builds scanned=${summary.buildsScanned} changed=${summary.buildsChanged} eventRowsUpdated=${summary.eventRowsUpdated} manifestEntriesUpdated=${summary.manifestEntriesUpdated} manifestFilesChanged=${summary.manifestFilesChanged} currentPointersUpdated=${summary.currentPointersUpdated}`
  );
  console.log(
    `[videos:producer-id-migrate] producerIds backfilled=${summary.backfilledProducerIds} corrected=${summary.correctedProducerIds} unresolved=${summary.unresolved.length}`
  );

  if (summary.changedBuilds.length > 0) {
    console.log('\nChanged builds:');
    for (const buildDir of summary.changedBuilds) {
      console.log(`  - ${buildDir}`);
    }
  }

  if (summary.unresolved.length > 0) {
    console.log('\nUnresolved builds:');
    for (const item of summary.unresolved) {
      console.log(`  - ${item.buildDir}`);
      console.log(`    ${item.reason}`);
    }
  }
}

async function main() {
  const { root, write, skipUnresolved } = parseArgs(process.argv.slice(2));
  if (!existsSync(root)) {
    throw new Error(`Workspace root does not exist: ${root}`);
  }

  const summary = createSummary(root, write, skipUnresolved);
  const buildDirs = await listBuildDirectories(root);
  const plans = [];

  for (const buildDir of buildDirs) {
    summary.buildsScanned += 1;

    try {
      const plan = await planBuildMigration(buildDir, root);
      plans.push(plan);

      if (plan.changed) {
        summary.buildsChanged += 1;
        summary.changedBuilds.push(buildDir);
      }

      summary.eventRowsUpdated += plan.counts.eventRowsUpdated;
      summary.manifestEntriesUpdated += plan.counts.manifestEntriesUpdated;
      summary.manifestFilesChanged += plan.counts.manifestFilesChanged;
      summary.currentPointersUpdated += plan.counts.currentPointersUpdated;
      summary.backfilledProducerIds += plan.counts.backfilledProducerIds;
      summary.correctedProducerIds += plan.counts.correctedProducerIds;
    } catch (error) {
      summary.unresolved.push({
        buildDir,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  printSummary(summary);

  if (summary.unresolved.length > 0 && !skipUnresolved) {
    process.exitCode = 1;
    return;
  }

  if (!write) {
    return;
  }

  for (const plan of plans) {
    await applyWrites(plan);
  }

  if (summary.unresolved.length > 0 && skipUnresolved) {
    console.log(
      `[videos:producer-id-migrate] skipped unresolved builds=${summary.unresolved.length}`
    );
  }
}

await main();
