import { SYSTEM_INPUTS } from '../types.js';

export type SystemInputName =
  (typeof SYSTEM_INPUTS)[keyof typeof SYSTEM_INPUTS];
export type SystemInputKind = 'user' | 'derived' | 'runtime';
export type SystemInputValueType = 'number' | 'string';

interface SystemInputMetadata {
  type: SystemInputValueType;
  kind: SystemInputKind;
  userSupplied: boolean;
  description: string;
}

export interface SystemInputDefinition extends SystemInputMetadata {
  name: SystemInputName;
  canonicalId: string;
}

export const SYSTEM_INPUT_DEFINITIONS = {
  [SYSTEM_INPUTS.DURATION]: {
    type: 'number',
    kind: 'user',
    userSupplied: true,
    description: 'System input: Duration',
  },
  [SYSTEM_INPUTS.NUM_OF_SEGMENTS]: {
    type: 'number',
    kind: 'user',
    userSupplied: true,
    description: 'System input: NumOfSegments',
  },
  [SYSTEM_INPUTS.SEGMENT_DURATION]: {
    type: 'number',
    kind: 'derived',
    userSupplied: false,
    description: 'System input: SegmentDuration',
  },
  [SYSTEM_INPUTS.MOVIE_ID]: {
    type: 'string',
    kind: 'runtime',
    userSupplied: false,
    description: 'System input: MovieId',
  },
  [SYSTEM_INPUTS.STORAGE_ROOT]: {
    type: 'string',
    kind: 'runtime',
    userSupplied: false,
    description: 'System input: StorageRoot',
  },
  [SYSTEM_INPUTS.STORAGE_BASE_PATH]: {
    type: 'string',
    kind: 'runtime',
    userSupplied: false,
    description: 'System input: StorageBasePath',
  },
} as const satisfies Record<SystemInputName, SystemInputMetadata>;

const SYSTEM_INPUT_NAME_SET = new Set<SystemInputName>(
  Object.values(SYSTEM_INPUTS)
);

export function isSystemInputName(name: string): name is SystemInputName {
  return SYSTEM_INPUT_NAME_SET.has(name as SystemInputName);
}

export function getSystemInputDefinition(
  name: SystemInputName
): SystemInputDefinition {
  const metadata = SYSTEM_INPUT_DEFINITIONS[name];
  return {
    ...metadata,
    name,
    canonicalId: `Input:${name}`,
  };
}

export function listSystemInputDefinitions(): SystemInputDefinition[] {
  return Object.values(SYSTEM_INPUTS).map((name) =>
    getSystemInputDefinition(name)
  );
}

/**
 * Well-known system input canonical IDs.
 */
export const SYSTEM_INPUT_IDS = {
  DURATION: `Input:${SYSTEM_INPUTS.DURATION}`,
  NUM_OF_SEGMENTS: `Input:${SYSTEM_INPUTS.NUM_OF_SEGMENTS}`,
  SEGMENT_DURATION: `Input:${SYSTEM_INPUTS.SEGMENT_DURATION}`,
  MOVIE_ID: `Input:${SYSTEM_INPUTS.MOVIE_ID}`,
  STORAGE_ROOT: `Input:${SYSTEM_INPUTS.STORAGE_ROOT}`,
  STORAGE_BASE_PATH: `Input:${SYSTEM_INPUTS.STORAGE_BASE_PATH}`,
} as const;

/**
 * Injects derived system inputs into the resolved inputs map.
 *
 * Currently auto-computes:
 * - SegmentDuration from Duration and NumOfSegments
 *
 * This function is used during both planning (for cost estimation) and
 * execution (for provider invocation).
 *
 * @param inputs - The resolved inputs map with canonical IDs
 * @returns A new inputs map with derived system inputs added
 */
export function injectDerivedSystemInputs(
  inputs: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...inputs };

  // Auto-compute SegmentDuration if Duration and NumOfSegments are present
  const duration = inputs[SYSTEM_INPUT_IDS.DURATION];
  const numSegments = inputs[SYSTEM_INPUT_IDS.NUM_OF_SEGMENTS];

  if (
    typeof duration === 'number' &&
    typeof numSegments === 'number' &&
    numSegments > 0 &&
    result[SYSTEM_INPUT_IDS.SEGMENT_DURATION] === undefined
  ) {
    result[SYSTEM_INPUT_IDS.SEGMENT_DURATION] = duration / numSegments;
  }

  return result;
}

/**
 * Injects base system inputs into a resolved inputs map.
 *
 * These are the minimum system inputs required for execution:
 * - MovieId: The unique identifier for the movie being generated
 * - StorageRoot: The root directory for storage
 * - StorageBasePath: The base path within the storage root
 *
 * @param inputs - The resolved inputs map with canonical IDs
 * @param movieId - The movie ID to inject
 * @param storageRoot - The storage root directory
 * @param storageBasePath - The storage base path
 * @returns A new inputs map with base system inputs added
 */
export function injectBaseSystemInputs(
  inputs: Record<string, unknown>,
  movieId: string,
  storageRoot: string,
  storageBasePath: string
): Record<string, unknown> {
  const result = { ...inputs };

  if (result[SYSTEM_INPUT_IDS.MOVIE_ID] === undefined) {
    result[SYSTEM_INPUT_IDS.MOVIE_ID] = movieId;
  }

  if (result[SYSTEM_INPUT_IDS.STORAGE_ROOT] === undefined) {
    result[SYSTEM_INPUT_IDS.STORAGE_ROOT] = storageRoot;
  }

  if (result[SYSTEM_INPUT_IDS.STORAGE_BASE_PATH] === undefined) {
    result[SYSTEM_INPUT_IDS.STORAGE_BASE_PATH] = storageBasePath;
  }

  return result;
}

/**
 * Applies all system input injections in the correct order.
 *
 * This is a convenience function that:
 * 1. Injects base system inputs (MovieId, StorageRoot, StorageBasePath)
 * 2. Injects derived system inputs (SegmentDuration)
 *
 * @param inputs - The resolved inputs map with canonical IDs
 * @param movieId - The movie ID to inject
 * @param storageRoot - The storage root directory
 * @param storageBasePath - The storage base path
 * @returns A new inputs map with all system inputs added
 */
export function injectAllSystemInputs(
  inputs: Record<string, unknown>,
  movieId: string,
  storageRoot: string,
  storageBasePath: string
): Record<string, unknown> {
  const withBase = injectBaseSystemInputs(
    inputs,
    movieId,
    storageRoot,
    storageBasePath
  );
  return injectDerivedSystemInputs(withBase);
}
