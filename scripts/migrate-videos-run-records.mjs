#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import {
  extractModelSelectionsFromInputs,
  serializeInputsToYaml,
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

  for (const arg of argv) {
    if (arg === '--') {
      continue;
    }

    if (arg === '--write') {
      write = true;
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

  return { root, write };
}

function createSummary(root, write) {
  return {
    root,
    write,
    buildsScanned: 0,
    eligibleBuilds: 0,
    skippedIncompleteBuilds: 0,
    failedBuilds: 0,
    buildsChanged: 0,
    revisionsScanned: 0,
    revisionsChanged: 0,
    runRecordsWritten: 0,
    snapshotsWritten: 0,
    alreadyBackfilledRevisions: 0,
    skippedBuilds: [],
    changedBuilds: [],
    failures: [],
  };
}

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex');
}

function compareRevisions(left, right) {
  return REVISION_COLLATOR.compare(left, right);
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
        `${label}: invalid JSON on line ${index + 1}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    records.push({
      lineNumber: index + 1,
      value,
    });
  }

  return records;
}

async function listPlanFiles(buildDir) {
  const runsDir = join(buildDir, 'runs');
  if (!existsSync(runsDir)) {
    return [];
  }

  const entries = await readdir(runsDir, { withFileTypes: true });
  entries.sort((left, right) => compareRevisions(left.name, right.name));

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('-plan.json'))
    .map((entry) => join(runsDir, entry.name));
}

function getRevisionFromPlanPath(planPath) {
  const fileName = basename(planPath);
  if (!fileName.endsWith('-plan.json')) {
    throw new Error(`Plan file name must end with "-plan.json", received "${fileName}".`);
  }
  return fileName.slice(0, -'-plan.json'.length);
}

async function readBuildMetadata(buildDir) {
  const metadataPaths = [
    join(buildDir, 'metadata.json'),
    join(buildDir, 'movie-metadata.json'),
  ];

  for (const metadataPath of metadataPaths) {
    if (existsSync(metadataPath)) {
      return {
        path: metadataPath,
        value: await readJsonFile(metadataPath, metadataPath),
      };
    }
  }

  return null;
}

function evaluateBuildEligibility(buildDir, metadata, planPaths) {
  const inputsLogPath = join(buildDir, 'events', 'inputs.log');
  const artifactsLogPath = join(buildDir, 'events', 'artifacts.log');

  if (!existsSync(inputsLogPath)) {
    return {
      eligible: false,
      reason: 'missing events/inputs.log',
    };
  }

  if (!existsSync(artifactsLogPath)) {
    return {
      eligible: false,
      reason: 'missing events/artifacts.log',
    };
  }

  if (planPaths.length === 0) {
    return {
      eligible: false,
      reason: 'missing runs/*-plan.json',
    };
  }

  if (!metadata) {
    return {
      eligible: false,
      reason: 'missing metadata.json or movie-metadata.json',
    };
  }

  if (
    typeof metadata.value.blueprintPath !== 'string' ||
    metadata.value.blueprintPath.length === 0
  ) {
    return {
      eligible: false,
      reason: `${metadata.path}: missing a valid "blueprintPath"`,
    };
  }

  if (!existsSync(metadata.value.blueprintPath)) {
    return {
      eligible: false,
      reason: `${metadata.path}: blueprint does not exist: ${metadata.value.blueprintPath}`,
    };
  }

  return {
    eligible: true,
    inputsLogPath,
    artifactsLogPath,
  };
}

function buildRevisionInputs(inputEventLines, revisions, buildDir) {
  const sortedEvents = inputEventLines
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

  for (const revision of revisions) {
    while (
      eventIndex < sortedEvents.length &&
      compareRevisions(String(sortedEvents[eventIndex].value.revision ?? ''), revision) <= 0
    ) {
      const event = sortedEvents[eventIndex].value;
      if (typeof event.id !== 'string' || event.id.length === 0) {
        throw new Error(
          `${buildDir}/events/inputs.log line ${sortedEvents[eventIndex].lineNumber}: input event is missing a valid "id".`
        );
      }

      if (typeof event.revision !== 'string' || event.revision.length === 0) {
        throw new Error(
          `${buildDir}/events/inputs.log line ${sortedEvents[eventIndex].lineNumber}: input event is missing a valid "revision".`
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

function groupArtifactEventsByRevision(artifactEventLines, buildDir) {
  const eventsByRevision = new Map();

  for (const line of artifactEventLines) {
    const event = line.value;
    if (typeof event.revision !== 'string' || event.revision.length === 0) {
      throw new Error(
        `${buildDir}/events/artifacts.log line ${line.lineNumber}: artifact event is missing a valid "revision".`
      );
    }

    const revisionEvents = eventsByRevision.get(event.revision) ?? [];
    revisionEvents.push(event);
    eventsByRevision.set(event.revision, revisionEvents);
  }

  return eventsByRevision;
}

function buildSnapshotYaml(revisionInputs) {
  const normalizedInputs = {};

  for (const [inputId, value] of Object.entries(revisionInputs)) {
    const cleanKey = inputId.startsWith('Input:')
      ? inputId.slice('Input:'.length)
      : inputId;
    normalizedInputs[cleanKey] = value;
  }

  const { modelSelections, remainingInputs } =
    extractModelSelectionsFromInputs(normalizedInputs);

  return serializeInputsToYaml({
    inputs: remainingInputs,
    models: modelSelections,
  });
}

function determineRunStatus(revision, artifactEventsByRevision) {
  const events = artifactEventsByRevision.get(revision) ?? [];
  if (events.length === 0) {
    return 'planned';
  }

  if (events.some((event) => event.status === 'failed')) {
    return 'failed';
  }

  return 'succeeded';
}

async function ensureNoPartialBackfill(snapshotPath, runRecordPath) {
  const hasSnapshot = existsSync(snapshotPath);
  const hasRunRecord = existsSync(runRecordPath);

  if (hasSnapshot && hasRunRecord) {
    return 'already-backfilled';
  }

  if (hasSnapshot || hasRunRecord) {
    throw new Error(
      `Refusing partial migration because only one backfill file exists:\n` +
        `- snapshot: ${snapshotPath} (${hasSnapshot ? 'present' : 'missing'})\n` +
        `- run record: ${runRecordPath} (${hasRunRecord ? 'present' : 'missing'})`
    );
  }

  return 'needs-backfill';
}

async function writeTextFile(targetPath, content) {
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, 'utf8');
}

async function migrateBuild(buildDir, options) {
  const metadata = await readBuildMetadata(buildDir);
  const planPaths = await listPlanFiles(buildDir);
  const eligibility = evaluateBuildEligibility(buildDir, metadata, planPaths);

  if (!eligibility.eligible) {
    return {
      kind: 'skipped',
      reason: eligibility.reason,
      buildDir,
    };
  }

  const inputEventLines = await readJsonLines(eligibility.inputsLogPath, eligibility.inputsLogPath);
  const artifactEventLines = await readJsonLines(
    eligibility.artifactsLogPath,
    eligibility.artifactsLogPath
  );

  const revisions = planPaths.map((planPath) => getRevisionFromPlanPath(planPath));
  const revisionInputs = buildRevisionInputs(inputEventLines, revisions, buildDir);
  const artifactEventsByRevision = groupArtifactEventsByRevision(artifactEventLines, buildDir);

  const buildChanges = [];
  let alreadyBackfilledRevisions = 0;

  for (const planPath of planPaths) {
    const revision = getRevisionFromPlanPath(planPath);
    const snapshotPath = join(buildDir, 'runs', `${revision}-inputs.yaml`);
    const runRecordPath = join(buildDir, 'runs', `${revision}-run.json`);
    const partialState = await ensureNoPartialBackfill(snapshotPath, runRecordPath);

    if (partialState === 'already-backfilled') {
      alreadyBackfilledRevisions += 1;
      continue;
    }

    const plan = await readJsonFile(planPath, planPath);
    if (typeof plan.createdAt !== 'string' || plan.createdAt.length === 0) {
      throw new Error(`${planPath}: missing a valid "createdAt" timestamp.`);
    }

    const snapshotContent = buildSnapshotYaml(revisionInputs.get(revision));
    const snapshotHash = hashContent(snapshotContent);
    const relativeSnapshotPath = `runs/${revision}-inputs.yaml`;
    const relativePlanPath = `runs/${revision}-plan.json`;
    const runRecord = {
      revision,
      createdAt: plan.createdAt,
      blueprintPath: metadata.value.blueprintPath,
      inputSnapshotPath: relativeSnapshotPath,
      inputSnapshotHash: snapshotHash,
      planPath: relativePlanPath,
      runConfig: {},
      status: determineRunStatus(revision, artifactEventsByRevision),
    };

    buildChanges.push({
      revision,
      snapshotPath,
      snapshotContent,
      runRecordPath,
      runRecordContent: JSON.stringify(runRecord, null, 2),
    });
  }

  if (options.write) {
    for (const change of buildChanges) {
      await writeTextFile(change.snapshotPath, change.snapshotContent);
      await writeTextFile(change.runRecordPath, change.runRecordContent);
    }
  }

  return {
    kind: 'migrated',
    buildDir,
    revisionsScanned: revisions.length,
    revisionsChanged: buildChanges.length,
    alreadyBackfilledRevisions,
    changes: buildChanges.map((change) => ({
      revision: change.revision,
      snapshotPath: change.snapshotPath,
      runRecordPath: change.runRecordPath,
    })),
  };
}

function printSummary(summary) {
  console.log(JSON.stringify(summary, null, 2));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary = createSummary(options.root, options.write);
  const buildDirectories = await listBuildDirectories(options.root);

  for (const buildDir of buildDirectories) {
    summary.buildsScanned += 1;

    try {
      const result = await migrateBuild(buildDir, options);

      if (result.kind === 'skipped') {
        summary.skippedIncompleteBuilds += 1;
        summary.skippedBuilds.push({
          buildDir: result.buildDir,
          reason: result.reason,
        });
        continue;
      }

      summary.eligibleBuilds += 1;
      summary.revisionsScanned += result.revisionsScanned;
      summary.revisionsChanged += result.revisionsChanged;
      summary.runRecordsWritten += result.revisionsChanged;
      summary.snapshotsWritten += result.revisionsChanged;
      summary.alreadyBackfilledRevisions += result.alreadyBackfilledRevisions;

      if (result.revisionsChanged > 0) {
        summary.buildsChanged += 1;
        summary.changedBuilds.push({
          buildDir: result.buildDir,
          revisionsChanged: result.revisionsChanged,
          changes: result.changes,
        });
      }
    } catch (error) {
      summary.failedBuilds += 1;
      summary.failures.push({
        buildDir,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  printSummary(summary);

  if (summary.failedBuilds > 0) {
    process.exitCode = 1;
  }
}

await main();
