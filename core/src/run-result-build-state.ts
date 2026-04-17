import { buildBuildStateFromEventLogState, readEventLogState } from './event-log-state.js';
import type { EventLog } from './event-log.js';
import type { BuildState, RevisionId } from './types.js';

export async function buildRunResultBuildStateSnapshot(args: {
  movieId: string;
  eventLog: EventLog;
  buildState: BuildState;
  revision: RevisionId;
  completedAt: string;
}): Promise<BuildState> {
  const eventLogState = await readEventLogState({
    eventLog: args.eventLog,
    movieId: args.movieId,
  });
  const snapshot = buildBuildStateFromEventLogState({
    eventLogState,
    targetRevision: args.revision,
    baseRevision: args.buildState.revision,
    createdAt: args.completedAt,
    runConfig: args.buildState.runConfig,
  });

  return {
    ...snapshot,
    ...(args.buildState.timeline !== undefined
      ? { timeline: args.buildState.timeline }
      : {}),
  };
}
