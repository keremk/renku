import type { ArtifactEvent, BuildState, ExecutionState, InputEvent } from './types.js';
import { deriveArtifactHash } from './event-log-state.js';

export function createEmptyBuildState(): BuildState {
  return {
    revision: 'rev-0000',
    baseRevision: null,
    createdAt: new Date(0).toISOString(),
    inputs: {},
    artifacts: {},
  };
}

export function createExecutionState(args: {
  buildState: BuildState;
  inputEvents?: InputEvent[];
}): ExecutionState {
  const inputHashes = new Map<string, string>(
    Object.entries(args.buildState.inputs).map(([id, entry]) => [id, entry.hash])
  );
  const artifactHashes = new Map<string, string>(
    Object.entries(args.buildState.artifacts).map(([id, entry]) => [id, entry.hash])
  );

  for (const event of args.inputEvents ?? []) {
    inputHashes.set(event.id, event.hash);
  }

  return {
    inputHashes,
    artifactHashes,
  };
}

export function applyArtifactEventsToExecutionState(
  state: ExecutionState,
  artifactEvents: ArtifactEvent[]
): ExecutionState {
  if (artifactEvents.length === 0) {
    return state;
  }

  const artifactHashes = new Map(state.artifactHashes);
  for (const event of artifactEvents) {
    if (event.status !== 'succeeded') {
      artifactHashes.delete(event.artifactId);
      continue;
    }
    artifactHashes.set(event.artifactId, deriveArtifactHash(event));
  }

  return {
    inputHashes: state.inputHashes,
    artifactHashes,
  };
}
