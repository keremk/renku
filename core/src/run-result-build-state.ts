import {
  buildBuildStateFromEventLogState,
  readEventLogStateAtRevision,
} from './event-log-state.js';
import type { EventLog } from './event-log.js';
import { readRunLifecycleProjectionFromEventLog } from './run-lifecycle.js';
import type { BuildState, RevisionId } from './types.js';

export async function buildRunResultBuildStateSnapshot(args: {
  movieId: string;
  eventLog: EventLog;
  buildState: BuildState;
  revision: RevisionId;
  completedAt: string;
}): Promise<BuildState> {
  const eventLogState = await readEventLogStateAtRevision({
    eventLog: args.eventLog,
    movieId: args.movieId,
    targetRevision: args.revision,
  });
  const runProjection = await readRunLifecycleProjectionFromEventLog({
    eventLog: args.eventLog,
    movieId: args.movieId,
    revision: args.revision,
  });
  const snapshot = buildBuildStateFromEventLogState({
    eventLogState,
    targetRevision: args.revision,
    baseRevision: args.buildState.revision,
    createdAt: args.completedAt,
    runConfig: runProjection?.runConfig,
  });

  return {
    ...snapshot,
    ...(args.buildState.timeline !== undefined
      ? { timeline: args.buildState.timeline }
      : {}),
  };
}
