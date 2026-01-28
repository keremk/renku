/**
 * Build list handler.
 */

import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { BuildInfo, BuildsListResponse, MovieMetadata } from "./types.js";

/**
 * Lists all builds in the builds/ subfolder of the blueprint folder.
 * Sorted by updatedAt (most recent first).
 * Filters out builds that have neither a manifest nor an inputs file.
 */
export async function listBuilds(blueprintFolder: string): Promise<BuildsListResponse> {
  const buildsDir = path.join(blueprintFolder, "builds");
  const builds: BuildInfo[] = [];

  try {
    if (!existsSync(buildsDir)) {
      return { builds: [], blueprintFolder };
    }

    const entries = await fs.readdir(buildsDir, { withFileTypes: true });
    const movieDirs = entries.filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("movie-"),
    );

    for (const dir of movieDirs) {
      const movieId = dir.name;
      const movieDir = path.join(buildsDir, movieId);
      const currentPath = path.join(movieDir, "current.json");
      const inputsPath = path.join(movieDir, "inputs.yaml");
      const metadataPath = path.join(movieDir, "movie-metadata.json");

      try {
        const stat = await fs.stat(movieDir);
        const updatedAt = stat.mtime.toISOString();

        let revision: string | null = null;
        let hasManifest = false;

        if (existsSync(currentPath)) {
          const currentContent = await fs.readFile(currentPath, "utf8");
          const current = JSON.parse(currentContent) as {
            revision?: string;
            manifestPath?: string | null;
          };
          revision = current.revision ?? null;
          hasManifest = !!current.manifestPath;
        }

        // Check for inputs.yaml
        const hasInputsFile = existsSync(inputsPath);

        // Read displayName from movie-metadata.json
        let displayName: string | null = null;
        if (existsSync(metadataPath)) {
          try {
            const metaContent = await fs.readFile(metadataPath, "utf8");
            const metadata = JSON.parse(metaContent) as MovieMetadata;
            displayName = metadata.displayName ?? null;
          } catch {
            // Ignore parse errors
          }
        }

        // Filter out builds that have neither manifest nor inputs file
        if (!hasManifest && !hasInputsFile) {
          continue;
        }

        builds.push({
          movieId,
          updatedAt,
          revision,
          hasManifest,
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
