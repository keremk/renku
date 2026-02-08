/**
 * Build metadata update handler.
 */

import { createStorageContext, createMovieMetadataService } from "@gorenku/core";

/**
 * Updates build metadata (displayName).
 */
export async function updateBuildMetadata(
  blueprintFolder: string,
  movieId: string,
  displayName: string,
): Promise<void> {
  // Create a storage context with builds as the basePath
  const storageContext = createStorageContext({
    kind: "local",
    rootDir: blueprintFolder,
    basePath: "builds",
  });

  const metadataService = createMovieMetadataService(storageContext);
  await metadataService.merge(movieId, { displayName });
}
