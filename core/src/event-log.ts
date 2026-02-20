import type { StorageContext } from './storage.js';
import type { ArtefactEvent, InputEvent, RevisionId } from './types.js';
import { hashArtefactOutput, hashInputPayload } from './hashing.js';

/* eslint-disable no-unused-vars */
export interface EventLog {
  streamInputs(
    movieId: string,
    sinceRevision?: RevisionId
  ): AsyncIterable<InputEvent>;
  streamArtefacts(
    movieId: string,
    sinceRevision?: RevisionId
  ): AsyncIterable<ArtefactEvent>;
  appendInput(movieId: string, event: InputEvent): Promise<void>;
  appendArtefact(movieId: string, event: ArtefactEvent): Promise<void>;
}

const JSONL_MIME = 'application/jsonl';
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

export function createEventLog(storage: StorageContext): EventLog {
  return {
    streamInputs(movieId, sinceRevision) {
      const path = storage.resolve(movieId, 'events', 'inputs.log');
      return iterateEvents<InputEvent>(storage, path, sinceRevision);
    },
    streamArtefacts(movieId, sinceRevision) {
      const path = storage.resolve(movieId, 'events', 'artefacts.log');
      return iterateEvents<ArtefactEvent>(storage, path, sinceRevision);
    },
    async appendInput(movieId, event) {
      const path = storage.resolve(movieId, 'events', 'inputs.log');
      await appendEvent(storage, path, event);
    },
    async appendArtefact(movieId, event) {
      const path = storage.resolve(movieId, 'events', 'artefacts.log');
      await appendEvent(storage, path, event);
    },
  };
}

export { hashInputPayload, hashArtefactOutput };

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
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const event = JSON.parse(trimmed) as T;
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
  return collator.compare(candidate, pivot) > 0;
}
