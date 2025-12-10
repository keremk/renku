import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import  process  from 'node:process';

/**
 * Check if logs should be persisted for partial runs (costs-only, declined confirmations).
 * Reads from PERSIST_LOGS_FOR_PARTIAL_RUNS environment variable.
 * Defaults to FALSE (logs are cleaned up).
 */
export function shouldPersistLogsForPartialRuns(): boolean {
  const envValue = process.env.PERSIST_LOGS_FOR_PARTIAL_RUNS;
  return envValue?.toLowerCase() === 'true';
}

/**
 * Cleanup movie directory for partial runs (costs-only, declined confirmations).
 * This removes log files that were created during planning.
 *
 * For edits (isNew: false), cleanup is skipped to preserve existing data.
 * If PERSIST_LOGS_FOR_PARTIAL_RUNS=true, cleanup is also skipped.
 *
 * @returns true if cleanup was performed, false otherwise
 */
export async function cleanupPartialRunDirectory(options: {
  storageRoot: string;
  basePath: string;
  movieId: string;
  isNew: boolean;
}): Promise<boolean> {
  // Never cleanup for edits (preserve existing data)
  if (!options.isNew) {
    return false;
  }

  // Check env var
  if (shouldPersistLogsForPartialRuns()) {
    return false;
  }

  // Delete the movie directory
  const movieDir = resolve(options.storageRoot, options.basePath, options.movieId);
  await rm(movieDir, { recursive: true, force: true });
  return true;
}
