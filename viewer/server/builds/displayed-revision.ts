import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  compareRevisionIds,
  type RevisionId,
  type RunLifecycleService,
} from '@gorenku/core';

interface ResolveDisplayedRevisionArgs {
  movieDir: string;
  movieId: string;
  runLifecycleService: RunLifecycleService;
}

interface DisplayedRevisionResolution {
  displayedRevision: RevisionId | null;
  latestRunRevision: RevisionId | null;
}

async function readLatestArtifactRevision(
  movieDir: string
): Promise<RevisionId | null> {
  const logPath = path.join(movieDir, 'events', 'artifacts.log');
  if (!existsSync(logPath)) {
    return null;
  }

  let latestRevision: RevisionId | null = null;

  try {
    const content = await fs.readFile(logPath, 'utf8');
    const lines = content.split(/\r?\n/).filter((line) => line.trim());

    for (const line of lines) {
      try {
        const event = JSON.parse(line) as { revision?: string };
        if (!event.revision) {
          continue;
        }
        if (
          !latestRevision ||
          compareRevisionIds(event.revision as RevisionId, latestRevision) > 0
        ) {
          latestRevision = event.revision as RevisionId;
        }
      } catch {
        // Ignore malformed artifact history lines here. The full build-state
        // handler still surfaces invalid JSON when the user opens the build.
      }
    }
  } catch {
    return null;
  }

  return latestRevision;
}

export async function resolveDisplayedRevision(
  args: ResolveDisplayedRevisionArgs
): Promise<DisplayedRevisionResolution> {
  const runs = await args.runLifecycleService.list(args.movieId);
  const latestRunRevision = runs[runs.length - 1]?.revision ?? null;
  const latestStartedOrCompletedRun =
    [...runs].reverse().find((run) => run.status !== 'planned') ?? null;
  const latestArtifactRevision = await readLatestArtifactRevision(args.movieDir);

  let displayedRevision = latestStartedOrCompletedRun?.revision ?? null;
  if (
    latestArtifactRevision &&
    (!displayedRevision ||
      compareRevisionIds(latestArtifactRevision, displayedRevision) > 0)
  ) {
    displayedRevision = latestArtifactRevision;
  }

  return {
    displayedRevision,
    latestRunRevision,
  };
}
