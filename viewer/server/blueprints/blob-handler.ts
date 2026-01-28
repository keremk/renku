/**
 * Blueprint build blob streaming handler.
 */

import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { streamFileWithRange } from "../movies/stream-utils.js";

/**
 * Streams a blob file from a blueprint build.
 */
export async function streamBuildBlob(
  req: IncomingMessage,
  res: ServerResponse,
  blueprintFolder: string,
  movieId: string,
  hash: string,
): Promise<void> {
  const blobsDir = path.join(blueprintFolder, "builds", movieId, "blobs");
  const prefix = hash.slice(0, 2);

  // Try different possible file paths (with and without extension)
  const possiblePaths = [path.join(blobsDir, prefix, hash)];

  // Also try common extensions
  const extensions = ["png", "jpg", "jpeg", "mp4", "mp3", "wav", "webm", "json", "txt"];
  for (const ext of extensions) {
    possiblePaths.push(path.join(blobsDir, prefix, `${hash}.${ext}`));
  }

  let filePath: string | null = null;
  for (const p of possiblePaths) {
    if (existsSync(p)) {
      filePath = p;
      break;
    }
  }

  if (!filePath) {
    res.statusCode = 404;
    res.end("Blob not found");
    return;
  }

  // Infer MIME type from file extension or use octet-stream
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mimeTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    json: "application/json",
    txt: "text/plain",
  };
  const mimeType = mimeTypes[ext] ?? "application/octet-stream";

  await streamFileWithRange(req, res, filePath, mimeType);
}
