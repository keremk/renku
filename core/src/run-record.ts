import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { FileStorage } from '@flystorage/file-storage';
import { createRuntimeError, RuntimeErrorCode } from './errors/index.js';
import { compareRevisionIds } from './revisions.js';
import type { StorageContext } from './storage.js';
import type {
  RevisionId,
  RunConfig,
  RunRecord,
  RunRecordStatus,
  RunSummary,
} from './types.js';

/* eslint-disable no-unused-vars */
export interface RunRecordService {
  load(movieId: string, revision: RevisionId): Promise<RunRecord | null>;
  loadLatest(movieId: string): Promise<RunRecord | null>;
  list(movieId: string): Promise<RunRecord[]>;
  write(movieId: string, record: RunRecord): Promise<void>;
  writeInputSnapshot(
    movieId: string,
    revision: RevisionId,
    contents: Uint8Array
  ): Promise<{ path: string; hash: string }>;
  finalize(args: {
    movieId: string;
    revision: RevisionId;
    status: RunRecordStatus;
    startedAt?: string;
    completedAt?: string;
    summary?: RunSummary;
    runConfig?: RunConfig;
  }): Promise<RunRecord>;
}

export function createRunRecordService(storage: StorageContext): RunRecordService {
  return {
    async load(movieId, revision) {
      const recordPath = storage.resolve(movieId, runRecordRelativePath(revision));
      if (!(await storage.storage.fileExists(recordPath))) {
        return null;
      }
      const raw = await storage.storage.readToString(recordPath);
      try {
        return JSON.parse(raw) as RunRecord;
      } catch (error) {
        throw createRuntimeError(
          RuntimeErrorCode.INVALID_BUILD_HISTORY_JSON,
          `Failed to parse run record JSON at "${recordPath}".`,
          {
            filePath: recordPath,
            context: movieId,
            cause: error,
          }
        );
      }
    },

    async loadLatest(movieId) {
      const records = await this.list(movieId);
      return records.length > 0 ? records[records.length - 1] ?? null : null;
    },

    async list(movieId) {
      const runsDir = storage.resolve(movieId, 'runs');
      if (!(await storage.storage.directoryExists(runsDir))) {
        return [];
      }

      const records: RunRecord[] = [];
      const listing = storage.storage.list(runsDir, { deep: false });
      for await (const item of listing) {
        if (item.type !== 'file' || !item.path.endsWith('-run.json')) {
          continue;
        }
        const raw = await storage.storage.readToString(item.path);
        try {
          records.push(JSON.parse(raw) as RunRecord);
        } catch (error) {
          throw createRuntimeError(
            RuntimeErrorCode.INVALID_BUILD_HISTORY_JSON,
            `Failed to parse run record JSON at "${item.path}".`,
            {
              filePath: item.path,
              context: movieId,
              cause: error,
            }
          );
        }
      }

      records.sort((a, b) => compareRevisionIds(a.revision, b.revision));
      return records;
    },

    async write(movieId, record) {
      const recordPath = storage.resolve(movieId, runRecordRelativePath(record.revision));
      await ensureParentDirectories(storage.storage, recordPath);
      await storage.storage.write(recordPath, JSON.stringify(record, null, 2), {
        mimeType: 'application/json',
      });
    },

    async writeInputSnapshot(movieId, revision, contents) {
      const relativePath = inputSnapshotRelativePath(revision);
      const snapshotPath = storage.resolve(movieId, relativePath);
      await ensureParentDirectories(storage.storage, snapshotPath);
      await storage.storage.write(snapshotPath, Buffer.from(contents), {
        mimeType: 'application/x-yaml',
      });
      return {
        path: relativePath,
        hash: hashBytes(contents),
      };
    },

    async finalize(args) {
      const record = await this.load(args.movieId, args.revision);
      if (!record) {
        throw new Error(
          `Run record missing for ${args.movieId} revision ${args.revision}.`
        );
      }
      const updated: RunRecord = {
        ...record,
        status: args.status,
        ...(args.startedAt ? { startedAt: args.startedAt } : {}),
        ...(args.completedAt ? { completedAt: args.completedAt } : {}),
        ...(args.summary ? { summary: args.summary } : {}),
        ...(args.runConfig
          ? {
              runConfig: {
                ...record.runConfig,
                ...args.runConfig,
              },
            }
          : {}),
      };
      await this.write(args.movieId, updated);
      return updated;
    },
  };
}

export function runRecordRelativePath(revision: RevisionId): string {
  return `runs/${revision}-run.json`;
}

export function inputSnapshotRelativePath(revision: RevisionId): string {
  return `runs/${revision}-inputs.yaml`;
}

export function hashBytes(contents: Uint8Array): string {
  return createHash('sha256').update(contents).digest('hex');
}

async function ensureParentDirectories(
  storage: FileStorage,
  targetPath: string
): Promise<void> {
  const segments = targetPath.split('/').slice(0, -1).filter(Boolean);
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    if (!(await storage.directoryExists(current))) {
      await storage.createDirectory(current, {});
    }
  }
}
