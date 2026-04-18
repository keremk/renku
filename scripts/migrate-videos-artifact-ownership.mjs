#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  compareRevisionIds,
  deriveProducerFamilyId,
  isCanonicalArtifactId,
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

    if (arg === '--dry-run') {
      continue;
    }

    if (arg === '--skip-unresolved') {
      skipUnresolved = true;
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
    producerJobIdsBackfilled: 0,
    producerIdsBackfilled: 0,
    producerIdsCorrected: 0,
    legacyFieldRenames: 0,
    revisionAuthorshipBackfilled: 0,
    changedBuilds: [],
    unresolved: [],
  };
}

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function listBuildDirectories(root) {
  const buildDirectories = [];

  async function visit(directory) {
    let entries = [];
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
      originalLine: line,
      value,
    });
  }

  return records;
}

function compareRevisions(left, right) {
  return REVISION_COLLATOR.compare(left, right);
}

function needsOwnershipLookup(record) {
  return (
    typeof record === 'object' &&
    record !== null &&
    !Array.isArray(record) &&
    (
      typeof record.producedBy === 'string' ||
      typeof record.producerJobId !== 'string' ||
      typeof record.producerId !== 'string'
    )
  );
}

function needsLegacyFieldRename(record) {
  return (
    typeof record === 'object' &&
    record !== null &&
    !Array.isArray(record) &&
    (
      Object.prototype.hasOwnProperty.call(record, 'producedBy') ||
      Object.prototype.hasOwnProperty.call(record, 'editedBy') ||
      Object.prototype.hasOwnProperty.call(record, 'originalHash')
    )
  );
}

function collectOwnershipLookupRevisions(artifactEventLines) {
  const revisions = new Set();

  for (const line of artifactEventLines) {
    const event = line.value;
    if (!needsOwnershipLookup(event)) {
      continue;
    }

    if (typeof event.revision !== 'string' || event.revision.length === 0) {
      throw new Error(
        `${line.label}: artifact event is missing a valid "revision".`
      );
    }

    revisions.add(event.revision);
  }

  return Array.from(revisions).sort(compareRevisions);
}

function buildOwnershipIndexFromPlan(plan, label) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error(`${label}: execution plan must be an object.`);
  }

  if (!Array.isArray(plan.layers)) {
    throw new Error(`${label}: execution plan is missing a valid "layers" array.`);
  }

  const ownershipByArtifactId = new Map();

  for (const layer of plan.layers) {
    if (!Array.isArray(layer)) {
      throw new Error(`${label}: execution plan layer must be an array.`);
    }

    for (const job of layer) {
      if (!job || typeof job !== 'object' || Array.isArray(job)) {
        throw new Error(`${label}: execution plan job must be an object.`);
      }

      if (typeof job.jobId !== 'string' || job.jobId.length === 0) {
        throw new Error(`${label}: execution plan job is missing a valid "jobId".`);
      }

      if (!Array.isArray(job.produces)) {
        throw new Error(
          `${label}: execution plan job "${job.jobId}" is missing a valid "produces" array.`
        );
      }

      const producerJobId = job.jobId;
      const producerId = deriveProducerFamilyId(job.jobId);

      for (const artifactId of job.produces) {
        if (typeof artifactId !== 'string' || !isCanonicalArtifactId(artifactId)) {
          throw new Error(
            `${label}: job "${job.jobId}" declares a non-canonical artifact ID "${String(artifactId)}".`
          );
        }

        const existing = ownershipByArtifactId.get(artifactId);
        if (
          existing &&
          (existing.producerJobId !== producerJobId || existing.producerId !== producerId)
        ) {
          throw new Error(
            `${label}: artifact "${artifactId}" has conflicting ownership (${existing.producerJobId} / ${existing.producerId} vs ${producerJobId} / ${producerId}).`
          );
        }

        ownershipByArtifactId.set(artifactId, {
          producerJobId,
          producerId,
        });
      }
    }
  }

  return ownershipByArtifactId;
}

async function buildOwnershipLookupByRevision({ buildDir, targetRevisions }) {
  if (targetRevisions.length === 0) {
    return {
      startedRevisions: [],
      ownershipBySourceRevision: new Map(),
    };
  }

  const runsLogPath = join(buildDir, 'events', 'runs.log');
  if (!existsSync(runsLogPath)) {
    throw new Error(`${buildDir}: missing events/runs.log.`);
  }

  const runEventLines = await readJsonLines(runsLogPath, runsLogPath);
  const planPathByRevision = new Map();

  for (const line of runEventLines) {
    const event = line.value;
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new Error(`${runsLogPath} line ${line.lineNumber}: run event must be an object.`);
    }

    if (event.type !== 'run-started') {
      continue;
    }

    if (typeof event.revision !== 'string' || event.revision.length === 0) {
      throw new Error(
        `${runsLogPath} line ${line.lineNumber}: run-started event is missing a valid "revision".`
      );
    }

    if (typeof event.planPath !== 'string' || event.planPath.length === 0) {
      throw new Error(
        `${runsLogPath} line ${line.lineNumber}: run-started event is missing a valid "planPath".`
      );
    }

    if (planPathByRevision.has(event.revision)) {
      throw new Error(
        `${runsLogPath}: found duplicate run-started events for revision "${event.revision}".`
      );
    }

    planPathByRevision.set(event.revision, event.planPath);
  }

  const startedRevisions = Array.from(planPathByRevision.keys()).sort(compareRevisionIds);

  const ownershipBySourceRevision = new Map();
  for (const sourceRevision of startedRevisions) {
    const relativePlanPath = planPathByRevision.get(sourceRevision);
    if (!relativePlanPath) {
      throw new Error(
        `${buildDir}: no run-started event declares a plan path for revision "${sourceRevision}".`
      );
    }

    const absolutePlanPath = join(buildDir, relativePlanPath);
    if (!existsSync(absolutePlanPath)) {
      throw new Error(
        `${buildDir}: declared plan path does not exist for revision "${sourceRevision}": ${absolutePlanPath}`
      );
    }

    const plan = await readJsonFile(absolutePlanPath, absolutePlanPath);
    const ownershipByArtifactId = buildOwnershipIndexFromPlan(
      plan,
      `${buildDir} plan source "${sourceRevision}"`
    );
    ownershipBySourceRevision.set(sourceRevision, ownershipByArtifactId);
  }

  return {
    startedRevisions,
    ownershipBySourceRevision,
  };
}

function findLatestStartedRevisionAtOrBefore(startedRevisions, targetRevision) {
  let latest = null;
  for (const revision of startedRevisions) {
    if (compareRevisionIds(revision, targetRevision) <= 0) {
      latest = revision;
      continue;
    }
    break;
  }
  return latest;
}

function resolveOwnershipForArtifact({
  lookupByRevision,
  revision,
  artifactId,
  label,
}) {
  const candidateRevisions = lookupByRevision.startedRevisions.filter(
    (sourceRevision) => compareRevisionIds(sourceRevision, revision) <= 0
  );

  for (let index = candidateRevisions.length - 1; index >= 0; index -= 1) {
    const sourceRevision = candidateRevisions[index];
    const lookup = lookupByRevision.ownershipBySourceRevision.get(sourceRevision);
    if (!lookup) {
      throw new Error(
        `${label}: no ownership lookup was built for source revision "${sourceRevision}".`
      );
    }

    const ownership = lookup.get(artifactId);
    if (ownership) {
      return ownership;
    }
  }

  throw new Error(
    `${label}: artifact "${artifactId}" does not exist in any execution plan at or before revision "${revision}".`
  );
}

function normalizeLegacyLastRevisionBy(value, label) {
  if (value === undefined) {
    return undefined;
  }

  if (value === 'user' || value === 'producer') {
    return value;
  }

  if (value === 'system') {
    return 'producer';
  }

  throw new Error(
    `${label}: unsupported artifact revision author "${String(value)}".`
  );
}

function migrateOwnershipFields(record, expectedOwnership, label, counts) {
  const legacyProducedBy = record.producedBy;
  if (
    legacyProducedBy !== undefined &&
    (typeof legacyProducedBy !== 'string' || legacyProducedBy.length === 0)
  ) {
    throw new Error(`${label}: "producedBy" must be a non-empty string when present.`);
  }

  let producerJobId = record.producerJobId;
  if (
    producerJobId !== undefined &&
    (typeof producerJobId !== 'string' || producerJobId.length === 0)
  ) {
    throw new Error(`${label}: "producerJobId" must be a non-empty string when present.`);
  }

  if (legacyProducedBy !== undefined) {
    if (
      legacyProducedBy !== expectedOwnership.producerJobId &&
      legacyProducedBy !== expectedOwnership.producerId
    ) {
      throw new Error(
        `${label}: legacy "producedBy" value "${legacyProducedBy}" does not match resolved ownership (${expectedOwnership.producerJobId} / ${expectedOwnership.producerId}).`
      );
    }

    if (
      producerJobId !== undefined &&
      producerJobId !== expectedOwnership.producerJobId
    ) {
      throw new Error(
        `${label}: found conflicting "producedBy" (${legacyProducedBy}) and "producerJobId" (${producerJobId}).`
      );
    }

    producerJobId = expectedOwnership.producerJobId;
    delete record.producedBy;
    counts.legacyFieldRenames += 1;
  }

  if (producerJobId === undefined) {
    producerJobId = expectedOwnership.producerJobId;
    counts.producerJobIdsBackfilled += 1;
  }

  if (producerJobId !== expectedOwnership.producerJobId) {
    throw new Error(
      `${label}: stored producer job "${producerJobId}" does not match resolved ownership "${expectedOwnership.producerJobId}".`
    );
  }

  record.producerJobId = producerJobId;

  if (record.producerId === undefined) {
    record.producerId = expectedOwnership.producerId;
    counts.producerIdsBackfilled += 1;
  } else if (record.producerId !== expectedOwnership.producerId) {
    record.producerId = expectedOwnership.producerId;
    counts.producerIdsCorrected += 1;
  }
}

function migrateTerminologyFields(record, label, counts) {
  const legacyEditedBy = record.editedBy;
  const normalizedLegacyRevisionAuthor = normalizeLegacyLastRevisionBy(
    legacyEditedBy,
    label
  );

  if (legacyEditedBy !== undefined) {
    const nextValue =
      record.lastRevisionBy === undefined ? normalizedLegacyRevisionAuthor : record.lastRevisionBy;
    if (
      record.lastRevisionBy !== undefined &&
      record.lastRevisionBy !== normalizedLegacyRevisionAuthor
    ) {
      throw new Error(
        `${label}: found conflicting "editedBy" (${legacyEditedBy}) and "lastRevisionBy" (${record.lastRevisionBy}).`
      );
    }
    record.lastRevisionBy = nextValue;
    delete record.editedBy;
    counts.legacyFieldRenames += 1;
  }

  if (record.originalHash !== undefined) {
    if (
      record.preEditArtifactHash !== undefined &&
      record.preEditArtifactHash !== record.originalHash
    ) {
      throw new Error(
        `${label}: found conflicting "originalHash" (${record.originalHash}) and "preEditArtifactHash" (${record.preEditArtifactHash}).`
      );
    }
    record.preEditArtifactHash = record.originalHash;
    delete record.originalHash;
    counts.legacyFieldRenames += 1;
  }

  if (record.lastRevisionBy === undefined) {
    record.lastRevisionBy = 'producer';
    counts.revisionAuthorshipBackfilled += 1;
  }

  if (record.lastRevisionBy !== 'producer' && record.lastRevisionBy !== 'user') {
    throw new Error(
      `${label}: "lastRevisionBy" must be "producer" or "user", received "${String(record.lastRevisionBy)}".`
    );
  }
}

function createMutableCounts() {
  return {
    eventRowsUpdated: 0,
    producerJobIdsBackfilled: 0,
    producerIdsBackfilled: 0,
    producerIdsCorrected: 0,
    legacyFieldRenames: 0,
    revisionAuthorshipBackfilled: 0,
  };
}

function copyCounts(counts) {
  return {
    eventRowsUpdated: counts.eventRowsUpdated,
    producerJobIdsBackfilled: counts.producerJobIdsBackfilled,
    producerIdsBackfilled: counts.producerIdsBackfilled,
    producerIdsCorrected: counts.producerIdsCorrected,
    legacyFieldRenames: counts.legacyFieldRenames,
    revisionAuthorshipBackfilled: counts.revisionAuthorshipBackfilled,
  };
}

async function planBuildMigration(buildDir) {
  const counts = createMutableCounts();
  const artifactsLogPath = join(buildDir, 'events', 'artifacts.log');
  const artifactEventLinesRaw = await readJsonLines(artifactsLogPath, artifactsLogPath);
  const artifactEventLines = artifactEventLinesRaw.map((line) => ({
    ...line,
    label: `${artifactsLogPath} line ${line.lineNumber}`,
  }));

  const targetRevisions = collectOwnershipLookupRevisions(artifactEventLines);
  const lookupByRevision = await buildOwnershipLookupByRevision({
    buildDir,
    targetRevisions,
  });

  const writes = [];
  const nextLines = [];
  let artifactsLogChanged = false;

  for (const line of artifactEventLines) {
    const event = line.value;
    if (typeof event !== 'object' || event === null || Array.isArray(event)) {
      throw new Error(`${line.label}: artifact event must be an object.`);
    }

    if (typeof event.artifactId !== 'string' || event.artifactId.length === 0) {
      throw new Error(`${line.label}: artifact event is missing a valid "artifactId".`);
    }

    if (typeof event.revision !== 'string' || event.revision.length === 0) {
      throw new Error(`${line.label}: artifact event is missing a valid "revision".`);
    }

    const before = JSON.stringify(event);
    if (needsOwnershipLookup(event)) {
      const expectedOwnership = resolveOwnershipForArtifact({
        lookupByRevision,
        revision: event.revision,
        artifactId: event.artifactId,
        label: line.label,
      });
      migrateOwnershipFields(event, expectedOwnership, line.label, counts);
    }
    if (needsLegacyFieldRename(event) || event.lastRevisionBy === undefined) {
      migrateTerminologyFields(event, line.label, counts);
    }

    const serialized = JSON.stringify(event);
    if (serialized !== before) {
      artifactsLogChanged = true;
      counts.eventRowsUpdated += 1;
    }

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

  return {
    buildDir,
    changed: writes.length > 0,
    writes,
    counts: copyCounts(counts),
  };
}

async function applyWrites(plan) {
  for (const write of plan.writes) {
    await writeFile(write.path, write.content, 'utf8');
  }
}

function printSummary(summary) {
  console.log(
    `[videos:artifact-ownership-migrate] mode=${summary.write ? 'write' : 'dry-run'} root=${summary.root} skipUnresolved=${summary.skipUnresolved}`
  );
  console.log(
    `[videos:artifact-ownership-migrate] builds scanned=${summary.buildsScanned} changed=${summary.buildsChanged} eventRowsUpdated=${summary.eventRowsUpdated}`
  );
  console.log(
    `[videos:artifact-ownership-migrate] producerJobIdsBackfilled=${summary.producerJobIdsBackfilled} producerIdsBackfilled=${summary.producerIdsBackfilled} producerIdsCorrected=${summary.producerIdsCorrected} legacyFieldRenames=${summary.legacyFieldRenames} revisionAuthorshipBackfilled=${summary.revisionAuthorshipBackfilled} unresolved=${summary.unresolved.length}`
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

export async function main(argv = process.argv.slice(2)) {
  const { root, write, skipUnresolved } = parseArgs(argv);
  if (!existsSync(root)) {
    throw new Error(`Workspace root does not exist: ${root}`);
  }

  const summary = createSummary(root, write, skipUnresolved);
  const buildDirs = await listBuildDirectories(root);
  const plans = [];

  for (const buildDir of buildDirs) {
    summary.buildsScanned += 1;

    try {
      const plan = await planBuildMigration(buildDir);
      plans.push(plan);

      if (plan.changed) {
        summary.buildsChanged += 1;
        summary.changedBuilds.push(buildDir);
      }

      summary.eventRowsUpdated += plan.counts.eventRowsUpdated;
      summary.producerJobIdsBackfilled += plan.counts.producerJobIdsBackfilled;
      summary.producerIdsBackfilled += plan.counts.producerIdsBackfilled;
      summary.producerIdsCorrected += plan.counts.producerIdsCorrected;
      summary.legacyFieldRenames += plan.counts.legacyFieldRenames;
      summary.revisionAuthorshipBackfilled += plan.counts.revisionAuthorshipBackfilled;
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
    return summary;
  }

  if (!write) {
    return summary;
  }

  for (const plan of plans) {
    await applyWrites(plan);
  }

  if (summary.unresolved.length > 0 && skipUnresolved) {
    console.log(
      `[videos:artifact-ownership-migrate] skipped unresolved builds=${summary.unresolved.length}`
    );
  }

  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
