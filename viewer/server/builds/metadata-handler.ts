/**
 * Build metadata update handler.
 */

import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { MovieMetadata } from "./types.js";

/**
 * Updates build metadata (displayName).
 */
export async function updateBuildMetadata(
  blueprintFolder: string,
  movieId: string,
  displayName: string,
): Promise<void> {
  const metadataPath = path.join(blueprintFolder, "builds", movieId, "movie-metadata.json");

  let metadata: MovieMetadata = {};
  if (existsSync(metadataPath)) {
    const content = await fs.readFile(metadataPath, "utf8");
    try {
      metadata = JSON.parse(content) as MovieMetadata;
    } catch {
      // Ignore parse errors, start fresh
    }
  }

  metadata.displayName = displayName;
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
}
