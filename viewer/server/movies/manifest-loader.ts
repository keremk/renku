/**
 * Manifest loading and timeline reading utilities.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { ManifestFile, ManifestPointer } from "./types.js";
import { resolveMovieDir, resolveExistingBlobPath } from "./stream-utils.js";
import { TIMELINE_ARTEFACT_ID } from "./types.js";

/**
 * Loads the manifest file for a movie.
 */
export async function loadManifest(buildsRoot: string, movieId: string): Promise<ManifestFile> {
  const movieDir = resolveMovieDir(buildsRoot, movieId);
  const pointerPath = path.join(movieDir, "current.json");
  const pointer = JSON.parse(await fs.readFile(pointerPath, "utf8")) as ManifestPointer;

  if (!pointer.manifestPath) {
    throw new Error(`Manifest pointer missing path for movie ${movieId}`);
  }

  const manifestPath = path.join(movieDir, pointer.manifestPath);
  return JSON.parse(await fs.readFile(manifestPath, "utf8")) as ManifestFile;
}

/**
 * Reads the timeline data from a manifest.
 */
export async function readTimeline(
  manifest: ManifestFile,
  buildsRoot: string,
  movieId: string,
): Promise<unknown> {
  const artefact = manifest.artefacts?.[TIMELINE_ARTEFACT_ID];
  if (!artefact) {
    throw new Error(`Timeline artefact not found for movie ${movieId}`);
  }

  if (artefact.blob?.hash) {
    const timelinePath = await resolveExistingBlobPath(
      buildsRoot,
      movieId,
      artefact.blob.hash,
      artefact.blob.mimeType,
    );
    const contents = await fs.readFile(timelinePath, "utf8");
    return JSON.parse(contents);
  }

  throw new Error("Timeline artefact missing payload");
}
