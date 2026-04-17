/**
 * Build list handler.
 */

import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createBuildStateService,
  createStorageContext,
  createMovieMetadataService,
  resolveCurrentBuildContext,
} from "@gorenku/core";
import type { BuildInfo, BuildsListResponse } from "./types.js";

/**
 * Lists all builds in the builds/ subfolder of the blueprint folder.
 * Sorted by updatedAt (most recent first).
 * Filters out builds that have neither succeeded artifacts nor saved inputs.
 */
export async function listBuilds(blueprintFolder: string): Promise<BuildsListResponse> {
  const buildsDir = path.join(blueprintFolder, "builds");
  const builds: BuildInfo[] = [];

  try {
    if (!existsSync(buildsDir)) {
      return { builds: [], blueprintFolder };
    }

    // Create storage context for reading metadata
    const storageContext = createStorageContext({
      kind: "local",
      rootDir: blueprintFolder,
      basePath: "builds",
    });
    const metadataService = createMovieMetadataService(storageContext);
    const buildStateService = createBuildStateService(storageContext);

    const entries = await fs.readdir(buildsDir, { withFileTypes: true });
    const movieDirs = entries.filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("movie-"),
    );

    for (const dir of movieDirs) {
      const movieId = dir.name;
      const movieDir = path.join(buildsDir, movieId);
      const inputsPath = path.join(movieDir, "inputs.yaml");

      try {
        const stat = await fs.stat(movieDir);
        const updatedAt = stat.mtime.toISOString();

        const { currentBuildRevision, snapshotSourceRun } =
          await resolveCurrentBuildContext({
            storage: storageContext,
            movieId,
          });
        const revision = currentBuildRevision;
        let hasBuildState = false;
        if (revision) {
          const buildState = await buildStateService.buildFromEvents({
            movieId,
            targetRevision: revision,
          });
          hasBuildState = Object.keys(buildState.artifacts).length > 0;
        }

        const snapshotInputsPath = snapshotSourceRun
          ? path.join(movieDir, snapshotSourceRun.inputSnapshotPath)
          : null;
        const hasInputsFile = existsSync(inputsPath);
        const hasInputSnapshot = snapshotInputsPath
          ? existsSync(snapshotInputsPath)
          : false;

        // Read displayName from metadata using the core service
        let displayName: string | null = null;
        try {
          const metadata = await metadataService.read(movieId);
          displayName = metadata?.displayName ?? null;
        } catch {
          // Ignore read errors
        }

        const hasRealBuild =
          currentBuildRevision !== null || snapshotSourceRun !== null;

        // Only show real execution-backed builds. Preview-only leftovers and
        // inputs-only folders are not real builds and should stay hidden.
        if (!hasRealBuild) {
          continue;
        }

        builds.push({
          movieId,
          updatedAt,
          revision,
          hasBuildState,
          hasInputSnapshot,
          hasInputsFile,
          displayName,
        });
      } catch {
        // Skip builds that can't be read
        continue;
      }
    }

    // Sort by updatedAt descending (most recent first)
    builds.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return { builds, blueprintFolder };
  } catch {
    return { builds: [], blueprintFolder };
  }
}
