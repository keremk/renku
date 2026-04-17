#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

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
    buildsWithRunRecords: 0,
    buildsChanged: 0,
    buildsAlreadyMigrated: 0,
    buildsSkipped: 0,
    buildsFailed: 0,
    revisionsScanned: 0,
    eventsAppended: 0,
    changedBuilds: [],
    skippedBuilds: [],
    failures: [],
  };
}

function compareRevisions(left, right) {
  return REVISION_COLLATOR.compare(left, right);
}

async function listBuildDirectories(root) {
  const buildDirectories = [];

  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isPermissionError(error)) {
        return;
      }
      throw error;
    }
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

function isPermissionError(error) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EACCES'
  );
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

function summarizePlan(planPath, plan) {
  if (typeof plan !== 'object' || plan === null) {
    throw new Error(`${planPath}: plan must be an object.`);
  }
  if (!Array.isArray(plan.layers)) {
    throw new Error(`${planPath}: missing a valid "layers" array.`);
  }

  const jobIds = [];
  for (const [layerIndex, layer] of plan.layers.entries()) {
    if (!Array.isArray(layer)) {
      throw new Error(`${planPath}: layer ${layerIndex} must be an array.`);
    }
    for (const [jobIndex, job] of layer.entries()) {
      if (typeof job !== 'object' || job === null) {
        throw new Error(
          `${planPath}: job ${jobIndex} in layer ${layerIndex} must be an object.`
        );
      }
      if (typeof job.jobId !== 'string' || job.jobId.length === 0) {
        throw new Error(
          `${planPath}: job ${jobIndex} in layer ${layerIndex} is missing a valid "jobId".`
        );
      }
      jobIds.push(job.jobId);
    }
  }

  return {
    layers: plan.layers.length,
    jobIds,
  };
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

async function listRunRecordFiles(buildDir) {
  const runsDir = join(buildDir, 'runs');
  if (!existsSync(runsDir)) {
    return [];
  }

  const entries = await readdir(runsDir, { withFileTypes: true });
  entries.sort((left, right) => compareRevisions(left.name, right.name));

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('-run.json'))
    .map((entry) => join(runsDir, entry.name));
}

function validateRunRecord(record, filePath) {
  if (typeof record !== 'object' || record === null) {
    throw new Error(`${filePath}: run record must be an object.`);
  }

  if (typeof record.revision !== 'string' || record.revision.length === 0) {
    throw new Error(`${filePath}: missing a valid "revision".`);
  }

  if (typeof record.createdAt !== 'string' || record.createdAt.length === 0) {
    throw new Error(`${filePath}: missing a valid "createdAt".`);
  }

  if (
    typeof record.inputSnapshotPath !== 'string' ||
    record.inputSnapshotPath.length === 0
  ) {
    throw new Error(`${filePath}: missing a valid "inputSnapshotPath".`);
  }

  if (
    typeof record.inputSnapshotHash !== 'string' ||
    record.inputSnapshotHash.length === 0
  ) {
    throw new Error(`${filePath}: missing a valid "inputSnapshotHash".`);
  }

  if (typeof record.planPath !== 'string' || record.planPath.length === 0) {
    throw new Error(`${filePath}: missing a valid "planPath".`);
  }

  if (typeof record.runConfig !== 'object' || record.runConfig === null) {
    throw new Error(`${filePath}: missing a valid "runConfig" object.`);
  }

  if (
    record.status !== 'planned' &&
    record.status !== 'succeeded' &&
    record.status !== 'failed' &&
    record.status !== 'cancelled'
  ) {
    throw new Error(`${filePath}: unsupported status "${String(record.status)}".`);
  }

  if (record.startedAt !== undefined && typeof record.startedAt !== 'string') {
    throw new Error(`${filePath}: "startedAt" must be a string when present.`);
  }

  if (record.completedAt !== undefined && typeof record.completedAt !== 'string') {
    throw new Error(`${filePath}: "completedAt" must be a string when present.`);
  }
}

function deriveCompletedAt(args) {
  if (args.record.completedAt) {
    return args.record.completedAt;
  }

  const artifactEvents = args.artifactEventsByRevision.get(args.record.revision) ?? [];
  const latestArtifactTimestamp = artifactEvents.reduce((latest, event) => {
    if (typeof event.createdAt !== 'string' || event.createdAt.length === 0) {
      return latest;
    }
    return latest === null || event.createdAt > latest ? event.createdAt : latest;
  }, null);

  return latestArtifactTimestamp ?? args.record.createdAt;
}

function deriveSummary(args) {
  if (typeof args.record.summary === 'object' && args.record.summary !== null) {
    return args.record.summary;
  }

  const counts = {
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };

  const latestStatusByJobId = new Map();
  const artifactEvents = args.artifactEventsByRevision.get(args.record.revision) ?? [];

  for (const event of artifactEvents) {
    if (typeof event.producedBy !== 'string' || event.producedBy.length === 0) {
      continue;
    }
    if (
      event.status !== 'succeeded' &&
      event.status !== 'failed' &&
      event.status !== 'skipped'
    ) {
      continue;
    }
    latestStatusByJobId.set(event.producedBy, event.status);
  }

  for (const jobId of args.planSummary.jobIds) {
    const status = latestStatusByJobId.get(jobId);
    if (status === 'succeeded') {
      counts.succeeded += 1;
      continue;
    }
    if (status === 'failed') {
      counts.failed += 1;
      continue;
    }
    counts.skipped += 1;
  }

  return {
    jobCount: args.planSummary.jobIds.length,
    counts,
    layers: args.planSummary.layers,
  };
}

function buildDesiredEventsFromRunRecord(args) {
  const { record } = args;
  const events = [
    {
      type: 'run-planned',
      revision: args.record.revision,
      createdAt: args.record.createdAt,
      inputSnapshotPath: args.record.inputSnapshotPath,
      inputSnapshotHash: args.record.inputSnapshotHash,
      planPath: args.record.planPath,
      runConfig: args.record.runConfig,
    },
  ];

  if (record.startedAt) {
    events.push({
      type: 'run-started',
      revision: args.record.revision,
      startedAt: args.record.startedAt,
      ...(Object.keys(args.record.runConfig).length > 0
        ? { runConfig: args.record.runConfig }
        : {}),
    });
  }

  if (args.record.status === 'cancelled') {
    events.push({
      type: 'run-cancelled',
      revision: args.record.revision,
      completedAt: deriveCompletedAt(args),
    });
  } else if (args.record.status === 'succeeded' || args.record.status === 'failed') {
    events.push({
      type: 'run-completed',
      revision: args.record.revision,
      completedAt: deriveCompletedAt(args),
      status: args.record.status,
      summary: deriveSummary(args),
    });
  }

  return events;
}

function groupExistingRunEvents(eventLines) {
  const grouped = new Map();

  for (const line of eventLines) {
    const event = line.value;
    if (typeof event !== 'object' || event === null) {
      throw new Error(
        `events/runs.log line ${line.lineNumber}: run lifecycle event must be an object.`
      );
    }
    if (typeof event.revision !== 'string' || event.revision.length === 0) {
      throw new Error(
        `events/runs.log line ${line.lineNumber}: missing a valid "revision".`
      );
    }
    if (typeof event.type !== 'string' || event.type.length === 0) {
      throw new Error(
        `events/runs.log line ${line.lineNumber}: missing a valid "type".`
      );
    }

    const revisionEvents = grouped.get(event.revision) ?? [];
    revisionEvents.push(event);
    grouped.set(event.revision, revisionEvents);
  }

  return grouped;
}

function assertExistingEventsAreCompatible(buildDir, revision, existingEvents, desiredEvents) {
  if (existingEvents.length > desiredEvents.length) {
    throw new Error(
      `${buildDir}: revision "${revision}" already has ${existingEvents.length} lifecycle events, but the legacy run record only maps to ${desiredEvents.length}.`
    );
  }

  for (let index = 0; index < existingEvents.length; index += 1) {
    const existingSerialized = JSON.stringify(existingEvents[index]);
    const desiredSerialized = JSON.stringify(desiredEvents[index]);
    if (existingSerialized !== desiredSerialized) {
      throw new Error(
        `${buildDir}: revision "${revision}" has existing lifecycle event #${index + 1} that does not match the legacy run record.\n` +
          `existing: ${existingSerialized}\n` +
          `desired:  ${desiredSerialized}`
      );
    }
  }
}

async function appendRunEvents(logPath, events) {
  if (events.length === 0) {
    return;
  }

  await mkdir(dirname(logPath), { recursive: true });
  const payload = `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
  await appendFile(logPath, payload, 'utf8');
}

async function migrateBuild(buildDir, options) {
  const runRecordPaths = await listRunRecordFiles(buildDir);
  if (runRecordPaths.length === 0) {
    return {
      kind: 'skipped',
      reason: 'no legacy runs/*-run.json files found',
      buildDir,
    };
  }

  const runsLogPath = join(buildDir, 'events', 'runs.log');
  const artifactsLogPath = join(buildDir, 'events', 'artifacts.log');
  const existingEventLines = await readJsonLines(runsLogPath, runsLogPath);
  const artifactEventLines = await readJsonLines(artifactsLogPath, artifactsLogPath);
  const existingEventsByRevision = groupExistingRunEvents(existingEventLines);
  const artifactEventsByRevision = groupExistingRunEvents(
    artifactEventLines.map((line) => ({
      ...line,
      value: {
        ...line.value,
        type: line.value.status,
      },
    }))
  );

  const pendingWrites = [];
  let revisionsScanned = 0;

  for (const runRecordPath of runRecordPaths) {
    const record = await readJsonFile(runRecordPath, runRecordPath);
    validateRunRecord(record, runRecordPath);
    revisionsScanned += 1;

    const planPath = join(buildDir, record.planPath);
    const plan = await readJsonFile(planPath, planPath);
    const planSummary = summarizePlan(planPath, plan);

    const desiredEvents = buildDesiredEventsFromRunRecord({
      record,
      artifactEventsByRevision,
      planSummary,
    });
    const existingEvents = existingEventsByRevision.get(record.revision) ?? [];
    assertExistingEventsAreCompatible(
      buildDir,
      record.revision,
      existingEvents,
      desiredEvents
    );

    const eventsToAppend = desiredEvents.slice(existingEvents.length);
    if (eventsToAppend.length > 0) {
      pendingWrites.push({
        revision: record.revision,
        events: eventsToAppend,
      });
    }
  }

  if (options.write) {
    for (const change of pendingWrites) {
      await appendRunEvents(runsLogPath, change.events);
    }
  }

  return {
    kind: pendingWrites.length === 0 ? 'already-migrated' : 'migrated',
    buildDir,
    revisionsScanned,
    eventsAppended: pendingWrites.reduce(
      (total, change) => total + change.events.length,
      0
    ),
    changes: pendingWrites.map((change) => ({
      revision: change.revision,
      eventTypes: change.events.map((event) => event.type),
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
        summary.buildsSkipped += 1;
        summary.skippedBuilds.push({
          buildDir: result.buildDir,
          reason: result.reason,
        });
        continue;
      }

      summary.buildsWithRunRecords += 1;
      summary.revisionsScanned += result.revisionsScanned;

      if (result.kind === 'already-migrated') {
        summary.buildsAlreadyMigrated += 1;
        continue;
      }

      summary.buildsChanged += 1;
      summary.eventsAppended += result.eventsAppended;
      summary.changedBuilds.push({
        buildDir: result.buildDir,
        eventsAppended: result.eventsAppended,
        changes: result.changes,
      });
    } catch (error) {
      summary.buildsFailed += 1;
      summary.failures.push({
        buildDir,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  printSummary(summary);

  if (summary.buildsFailed > 0) {
    process.exitCode = 1;
  }
}

await main();
