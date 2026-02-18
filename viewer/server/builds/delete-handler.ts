/**
 * Build deletion handler.
 */

import { createStorageContext, deleteMovieStorage } from "@gorenku/core";

/**
 * Deletes a build's storage directory.
 */
export async function deleteBuild(
  blueprintFolder: string,
  movieId: string,
): Promise<void> {
  const storageContext = createStorageContext({
    kind: "local",
    rootDir: blueprintFolder,
    basePath: "builds",
  });
  await deleteMovieStorage(storageContext, movieId);
}
