import { createHash } from 'node:crypto';
import type { ArtifactEventOutput } from './types.js';
import { isCanonicalInputId, isCanonicalArtifactId } from './canonical-ids.js';
import type { BuildState, ExecutionState } from './types.js';

type HashStateSnapshot = {
  inputs: Record<string, { hash: string }>;
  artifacts: Record<string, { hash: string }>;
};

export interface HashedValue {
  hash: string;
  canonical: string;
}

export function hashPayload(payload: unknown): HashedValue {
  const canonical = canonicalStringify(payload);
  return {
    canonical,
    hash: hashCanonical(canonical),
  };
}

export function hashInputPayload(payload: unknown): string {
  return hashPayload(payload).hash;
}

export function hashArtifactOutput(output: ArtifactEventOutput): string {
  return hashPayload(output).hash;
}

/**
 * Compute a content-aware hash of a job's inputs.
 * For Input:* entries, uses the input's value hash from the execution state.
 * For Artifact:* entries, uses the artifact's blob hash from the execution state.
 * Falls back to hashing the input ID if content hash is not available.
 */
export function hashInputContents(
  inputs: readonly string[],
  state?:
    | ExecutionState
    | Pick<BuildState, 'inputs' | 'artifacts'>
    | HashStateSnapshot
): string {
  const contentHashes: string[] = [];
  const executionState =
    state &&
    'inputHashes' in state &&
    state.inputHashes instanceof Map &&
    'artifactHashes' in state &&
    state.artifactHashes instanceof Map
      ? state
      : null;
  const buildStateSnapshot = executionState
    ? null
    : (state as HashStateSnapshot | undefined);
  for (const id of [...inputs].sort()) {
    if (isCanonicalInputId(id)) {
      const baseId = id.replace(/\[.*?\]/g, '');
      const hash = executionState
        ? executionState.inputHashes.get(baseId) ??
          executionState.inputHashes.get(id)
        : buildStateSnapshot?.inputs[baseId]?.hash ??
          buildStateSnapshot?.inputs[id]?.hash;
      contentHashes.push(hash ?? id);
    } else if (isCanonicalArtifactId(id)) {
      const hash = executionState
        ? executionState.artifactHashes.get(id)
        : buildStateSnapshot?.artifacts[id]?.hash;
      contentHashes.push(hash ?? id);
    } else {
      contentHashes.push(id);
    }
  }
  return hashPayload(contentHashes).hash;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(normalizeForSerialization(value));
}

export function normalizeForSerialization(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForSerialization(item));
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    entries.sort(([aKey], [bKey]) => aKey.localeCompare(bKey));
    const output: Record<string, unknown> = {};
    for (const [key, val] of entries) {
      output[key] = normalizeForSerialization(val);
    }
    return output;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return value.toString();
  }
  return value;
}

export function hashCanonical(canonical: string): string {
  return createHash('sha256').update(canonical).digest('hex');
}
