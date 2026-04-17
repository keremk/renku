import type { StorageContext } from './storage.js';
import { createRuntimeError, RuntimeErrorCode } from './errors/index.js';
import type { ArtifactEvent, InputEvent, RevisionId } from './types.js';
import { hashArtifactOutput, hashInputPayload } from './hashing.js';
import { compareRevisionIds } from './revisions.js';

/* eslint-disable no-unused-vars */
export interface EventLog {
  streamInputs(
    movieId: string,
    sinceRevision?: RevisionId
  ): AsyncIterable<InputEvent>;
  streamArtifacts(
    movieId: string,
    sinceRevision?: RevisionId
  ): AsyncIterable<ArtifactEvent>;
  appendInput(movieId: string, event: InputEvent): Promise<void>;
  appendArtifact(movieId: string, event: ArtifactEvent): Promise<void>;
}

const JSONL_MIME = 'application/jsonl';
export function createEventLog(storage: StorageContext): EventLog {
  return {
    streamInputs(movieId, sinceRevision) {
      const path = storage.resolve(movieId, 'events', 'inputs.log');
      return iterateEvents<InputEvent>(storage, path, sinceRevision);
    },
    streamArtifacts(movieId, sinceRevision) {
      const path = storage.resolve(movieId, 'events', 'artifacts.log');
      return iterateEvents<ArtifactEvent>(storage, path, sinceRevision);
    },
    async appendInput(movieId, event) {
      const path = storage.resolve(movieId, 'events', 'inputs.log');
      await appendEvent(storage, path, event);
    },
    async appendArtifact(movieId, event) {
      const path = storage.resolve(movieId, 'events', 'artifacts.log');
      await appendEvent(storage, path, event);
    },
  };
}

export { hashInputPayload, hashArtifactOutput };

async function* iterateEvents<T extends { revision: RevisionId }>(
  storage: StorageContext,
  path: string,
  sinceRevision?: RevisionId
): AsyncGenerator<T> {
  if (!(await storage.storage.fileExists(path))) {
    return;
  }
  const raw = await storage.storage.readToString(path);
  const lines = raw.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let event: T;
    try {
      event = JSON.parse(trimmed) as T;
    } catch (error) {
      throw createRuntimeError(
        RuntimeErrorCode.INVALID_BUILD_HISTORY_JSON,
        `Failed to parse build history JSON in "${path}" at line ${index + 1}.`,
        {
          filePath: path,
          context: `line ${index + 1}`,
          cause: error,
        }
      );
    }
    if (!sinceRevision || isRevisionAfter(event.revision, sinceRevision)) {
      yield event;
    }
  }
}

async function appendEvent(
  storage: StorageContext,
  path: string,
  event: unknown
): Promise<void> {
  const serialized = JSON.stringify(event);
  const payload = serialized.endsWith('\n') ? serialized : `${serialized}\n`;
  const targetPayload = payload.endsWith('\n') ? payload : `${payload}\n`;
  await storage.append(path, targetPayload, JSONL_MIME);
}

function isRevisionAfter(candidate: RevisionId, pivot: RevisionId): boolean {
  return compareRevisionIds(candidate, pivot) > 0;
}
