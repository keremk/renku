import {
  BuildStateNotFoundError,
  createBuildStateService,
} from '../build-state.js';
import { createEventLog } from '../event-log.js';
import { createRunLifecycleService } from '../run-lifecycle.js';
import { compareRevisionIds, nextRevisionId } from '../revisions.js';
import { planStore, type StorageContext } from '../storage.js';
import type {
  ArtifactEvent,
  ExecutionPlan,
  InputEvent,
  RevisionId,
  RunConfig,
} from '../types.js';

export interface CommitExecutionDraftArgs {
  movieId: string;
  storage: StorageContext;
  draftPlan: ExecutionPlan;
  draftInputEvents: InputEvent[];
  draftArtifactEvents?: ArtifactEvent[];
  inputSnapshotContents: Uint8Array;
  runConfig: RunConfig;
  startedAt?: string;
}

export interface CommitExecutionDraftResult {
  revision: RevisionId;
  plan: ExecutionPlan;
  inputEvents: InputEvent[];
  artifactEvents: ArtifactEvent[];
  planPath: string;
  inputSnapshotPath: string;
  inputSnapshotHash: string;
  startedAt: string;
}

export async function commitExecutionDraft(
  args: CommitExecutionDraftArgs
): Promise<CommitExecutionDraftResult> {
  const startedAt = args.startedAt ?? new Date().toISOString();
  const revision = await allocateNextRevision(args.storage, args.movieId);
  const eventLog = createEventLog(args.storage);
  const runLifecycleService = createRunLifecycleService(args.storage);

  const plan = {
    ...args.draftPlan,
    revision,
    createdAt: startedAt,
  };
  const inputEvents = args.draftInputEvents.map((event) => ({
    ...event,
    revision,
  }));
  const artifactEvents = (args.draftArtifactEvents ?? []).map((event) => ({
    ...event,
    revision,
  }));

  for (const event of inputEvents) {
    await eventLog.appendInput(args.movieId, event);
  }
  for (const event of artifactEvents) {
    await eventLog.appendArtifact(args.movieId, event);
  }

  await planStore.save(plan, {
    movieId: args.movieId,
    storage: args.storage,
  });

  const { path: inputSnapshotPath, hash: inputSnapshotHash } =
    await runLifecycleService.writeInputSnapshot(
      args.movieId,
      revision,
      args.inputSnapshotContents
    );

  const planPath = `runs/${revision}-plan.json`;
  await runLifecycleService.appendStarted(args.movieId, {
    type: 'run-started',
    revision,
    startedAt,
    inputSnapshotPath,
    inputSnapshotHash,
    planPath,
    runConfig: args.runConfig,
  });

  return {
    revision,
    plan,
    inputEvents,
    artifactEvents,
    planPath,
    inputSnapshotPath,
    inputSnapshotHash,
    startedAt,
  };
}

async function allocateNextRevision(
  storage: StorageContext,
  movieId: string
): Promise<RevisionId> {
  const buildStateService = createBuildStateService(storage);
  const runLifecycleService = createRunLifecycleService(storage);

  let latestRevision: RevisionId | null = null;
  try {
    const current = await buildStateService.loadCurrent(movieId);
    latestRevision = current.buildState.revision;
  } catch (error) {
    if (!(error instanceof BuildStateNotFoundError)) {
      throw error;
    }
  }

  const latestRun = await runLifecycleService.loadLatest(movieId);
  if (
    latestRun &&
    (!latestRevision ||
      compareRevisionIds(latestRun.revision, latestRevision) > 0)
  ) {
    latestRevision = latestRun.revision;
  }

  let candidate = nextRevisionId(latestRevision);
  while (await committedRevisionExists(storage, movieId, candidate)) {
    candidate = nextRevisionId(candidate);
  }
  return candidate;
}

async function committedRevisionExists(
  storage: StorageContext,
  movieId: string,
  revision: RevisionId
): Promise<boolean> {
  const planPath = storage.resolve(movieId, 'runs', `${revision}-plan.json`);
  const snapshotPath = storage.resolve(movieId, 'runs', `${revision}-inputs.yaml`);
  return (
    (await storage.storage.fileExists(planPath)) ||
    (await storage.storage.fileExists(snapshotPath))
  );
}
