#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

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

  return {
    root,
    write,
  };
}

function createSummary(root, write) {
  return {
    root,
    write,
    buildsScanned: 0,
    buildsWithRunsLog: 0,
    buildsChanged: 0,
    buildsAlreadyMigrated: 0,
    buildsFailed: 0,
    revisionsScanned: 0,
    revisionsDropped: 0,
    revisionsRewritten: 0,
    changedBuilds: [],
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

function groupRunEvents(eventLines, buildDir) {
  const grouped = new Map();

  for (const line of eventLines) {
    const event = line.value;
    if (typeof event !== 'object' || event === null) {
      throw new Error(
        `${buildDir}: events/runs.log line ${line.lineNumber} must contain an object.`
      );
    }
    if (typeof event.revision !== 'string' || event.revision.length === 0) {
      throw new Error(
        `${buildDir}: events/runs.log line ${line.lineNumber} is missing a valid revision.`
      );
    }
    if (typeof event.type !== 'string' || event.type.length === 0) {
      throw new Error(
        `${buildDir}: events/runs.log line ${line.lineNumber} is missing a valid type.`
      );
    }

    const revisionEvents = grouped.get(event.revision) ?? [];
    revisionEvents.push(event);
    grouped.set(event.revision, revisionEvents);
  }

  return grouped;
}

function normalizeRunConfig(value, buildDir, revision, sourceType) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(
      `${buildDir}: revision "${revision}" has invalid runConfig on ${sourceType}.`
    );
  }
  return value;
}

function requireStringField(value, label, buildDir, revision) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${buildDir}: revision "${revision}" is missing ${label}.`);
  }
  return value;
}

function normalizeStartedEvent(event, buildDir, revision) {
  return {
    type: 'run-started',
    revision,
    startedAt: requireStringField(event.startedAt, 'startedAt', buildDir, revision),
    inputSnapshotPath: requireStringField(
      event.inputSnapshotPath,
      'inputSnapshotPath',
      buildDir,
      revision
    ),
    inputSnapshotHash: requireStringField(
      event.inputSnapshotHash,
      'inputSnapshotHash',
      buildDir,
      revision
    ),
    planPath: requireStringField(event.planPath, 'planPath', buildDir, revision),
    runConfig: normalizeRunConfig(
      event.runConfig ?? {},
      buildDir,
      revision,
      'run-started'
    ),
  };
}

function createStartedEventFromPlanned(planned, buildDir, revision) {
  return {
    type: 'run-started',
    revision,
    startedAt: requireStringField(planned.createdAt, 'createdAt', buildDir, revision),
    inputSnapshotPath: requireStringField(
      planned.inputSnapshotPath,
      'inputSnapshotPath',
      buildDir,
      revision
    ),
    inputSnapshotHash: requireStringField(
      planned.inputSnapshotHash,
      'inputSnapshotHash',
      buildDir,
      revision
    ),
    planPath: requireStringField(planned.planPath, 'planPath', buildDir, revision),
    runConfig: normalizeRunConfig(
      planned.runConfig ?? {},
      buildDir,
      revision,
      'run-planned'
    ),
  };
}

function rewriteRevisionEvents(buildDir, revision, events) {
  const planned = events.find((event) => event.type === 'run-planned');
  const started = events.find((event) => event.type === 'run-started');
  const completed = events.find((event) => event.type === 'run-completed');
  const cancelled = events.find((event) => event.type === 'run-cancelled');
  const terminalEvents = [completed, cancelled].filter(Boolean);

  if (terminalEvents.length > 1) {
    throw new Error(
      `${buildDir}: revision "${revision}" has multiple terminal lifecycle events.`
    );
  }

  for (const event of events) {
    if (
      event.type !== 'run-planned' &&
      event.type !== 'run-started' &&
      event.type !== 'run-completed' &&
      event.type !== 'run-cancelled'
    ) {
      throw new Error(
        `${buildDir}: revision "${revision}" has unsupported lifecycle event type "${event.type}".`
      );
    }
  }

  if (!planned) {
    if (!started) {
      throw new Error(
        `${buildDir}: revision "${revision}" has no run-started event to anchor execution-only history.`
      );
    }
    return {
      desiredEvents: [
        normalizeStartedEvent(started, buildDir, revision),
        ...(completed ? [completed] : []),
        ...(cancelled ? [cancelled] : []),
      ],
      changed: false,
      dropped: false,
    };
  }

  if (!started) {
    if (completed || cancelled) {
      return {
        desiredEvents: [
          createStartedEventFromPlanned(planned, buildDir, revision),
          ...(completed ? [completed] : []),
          ...(cancelled ? [cancelled] : []),
        ],
        changed: true,
        dropped: false,
      };
    }

    return {
      desiredEvents: [],
      changed: true,
      dropped: true,
    };
  }

  const plannedRunConfig = normalizeRunConfig(
    planned.runConfig ?? {},
    buildDir,
    revision,
    'run-planned'
  );
  const startedRunConfig = normalizeRunConfig(
    started.runConfig ?? {},
    buildDir,
    revision,
    'run-started'
  );

  const rewrittenStarted = {
    type: 'run-started',
    revision,
    startedAt: requireStringField(started.startedAt, 'startedAt', buildDir, revision),
    inputSnapshotPath: requireStringField(
      planned.inputSnapshotPath,
      'inputSnapshotPath',
      buildDir,
      revision
    ),
    inputSnapshotHash: requireStringField(
      planned.inputSnapshotHash,
      'inputSnapshotHash',
      buildDir,
      revision
    ),
    planPath: requireStringField(planned.planPath, 'planPath', buildDir, revision),
    runConfig: {
      ...plannedRunConfig,
      ...startedRunConfig,
    },
  };

  return {
    desiredEvents: [
      rewrittenStarted,
      ...(completed ? [completed] : []),
      ...(cancelled ? [cancelled] : []),
    ],
    changed: true,
    dropped: false,
  };
}

function serializeEvents(events) {
  if (events.length === 0) {
    return '';
  }
  return `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
}

async function migrateBuild(buildDir, summary, write) {
  summary.buildsScanned += 1;

  const runsLogPath = join(buildDir, 'events', 'runs.log');
  if (!existsSync(runsLogPath)) {
    return;
  }

  summary.buildsWithRunsLog += 1;

  const eventLines = await readJsonLines(runsLogPath, runsLogPath);
  const grouped = groupRunEvents(eventLines, buildDir);
  const revisions = Array.from(grouped.keys()).sort(compareRevisions);
  summary.revisionsScanned += revisions.length;

  const desiredEvents = [];
  let buildChanged = false;
  let droppedCount = 0;
  let rewrittenCount = 0;

  for (const revision of revisions) {
    const existingEvents = grouped.get(revision) ?? [];
    const result = rewriteRevisionEvents(buildDir, revision, existingEvents);
    desiredEvents.push(...result.desiredEvents);
    if (result.changed) {
      buildChanged = true;
    }
    if (result.dropped) {
      droppedCount += 1;
    } else if (result.changed) {
      rewrittenCount += 1;
    }
  }

  const currentRaw = existsSync(runsLogPath) ? await readFile(runsLogPath, 'utf8') : '';
  const desiredRaw = serializeEvents(desiredEvents);

  if (currentRaw === desiredRaw) {
    summary.buildsAlreadyMigrated += 1;
    return;
  }

  summary.buildsChanged += 1;
  summary.revisionsDropped += droppedCount;
  summary.revisionsRewritten += rewrittenCount;
  summary.changedBuilds.push({
    buildDir,
    droppedCount,
    rewrittenCount,
  });

  if (write) {
    await writeFile(runsLogPath, desiredRaw, 'utf8');
  }
}

function printSummary(summary) {
  console.log(`Execution-only revision migration (${summary.write ? 'write' : 'dry-run'})`);
  console.log(`Root: ${summary.root}`);
  console.log(`Builds scanned: ${summary.buildsScanned}`);
  console.log(`Builds with runs.log: ${summary.buildsWithRunsLog}`);
  console.log(`Builds changed: ${summary.buildsChanged}`);
  console.log(`Builds already migrated: ${summary.buildsAlreadyMigrated}`);
  console.log(`Builds failed: ${summary.buildsFailed}`);
  console.log(`Revisions scanned: ${summary.revisionsScanned}`);
  console.log(`Revisions rewritten: ${summary.revisionsRewritten}`);
  console.log(`Preview-only revisions dropped: ${summary.revisionsDropped}`);

  if (summary.changedBuilds.length > 0) {
    console.log('\nChanged builds:');
    for (const build of summary.changedBuilds) {
      console.log(
        `- ${build.buildDir} (rewritten: ${build.rewrittenCount}, dropped previews: ${build.droppedCount})`
      );
    }
  }

  if (summary.failures.length > 0) {
    console.log('\nFailures:');
    for (const failure of summary.failures) {
      console.log(`- ${failure.buildDir}: ${failure.message}`);
    }
  }
}

async function main() {
  const { root, write } = parseArgs(process.argv.slice(2));
  const summary = createSummary(root, write);
  const buildDirectories = await listBuildDirectories(root);

  for (const buildDir of buildDirectories) {
    try {
      await migrateBuild(buildDir, summary, write);
    } catch (error) {
      summary.buildsFailed += 1;
      summary.failures.push({
        buildDir,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  printSummary(summary);

  if (summary.buildsFailed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : `Unknown error: ${String(error)}`
  );
  process.exitCode = 1;
});
