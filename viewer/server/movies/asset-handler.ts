/**
 * Asset streaming handler for movie assets.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { loadManifest } from "./manifest-loader.js";
import { resolveExistingBlobPath, streamFileWithRange } from "./stream-utils.js";

/**
 * Streams an asset from a movie's manifest.
 */
export async function streamAsset(
  req: IncomingMessage,
  res: ServerResponse,
  buildsRoot: string,
  movieId: string,
  canonicalId: string,
): Promise<void> {
  const manifest = await loadManifest(buildsRoot, movieId);
  const artefact = manifest.artefacts?.[canonicalId];

  if (!artefact) {
    res.statusCode = 404;
    res.end("Asset not found");
    return;
  }

  if (artefact.blob?.hash) {
    const filePath = await resolveExistingBlobPath(
      buildsRoot,
      movieId,
      artefact.blob.hash,
      artefact.blob.mimeType,
    );
    const mimeType = artefact.blob.mimeType ?? "application/octet-stream";
    await streamFileWithRange(req, res, filePath, mimeType, artefact.blob.size);
    return;
  }

  res.statusCode = 404;
  res.end("Asset missing data");
}
