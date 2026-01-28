/**
 * Blob file streaming handler for movie files.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveExistingBlobPath, streamFileWithRange } from "./stream-utils.js";

/**
 * Streams a blob file by hash from a movie's blobs directory.
 */
export async function streamBlobFile(
  req: IncomingMessage,
  res: ServerResponse,
  buildsRoot: string,
  movieId: string,
  hash: string,
): Promise<void> {
  const filePath = await resolveExistingBlobPath(buildsRoot, movieId, hash);
  await streamFileWithRange(req, res, filePath, "application/octet-stream");
}
