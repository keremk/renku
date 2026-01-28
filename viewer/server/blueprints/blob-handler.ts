/**
 * Blueprint build blob streaming handler.
 */

import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { streamFileWithRange } from "../shared/stream-utils.js";

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

/**
 * Streams an asset from a blueprint build by canonical ID.
 */
export async function streamBuildAsset(
  req: IncomingMessage,
  res: ServerResponse,
  blueprintFolder: string,
  movieId: string,
  canonicalId: string,
): Promise<void> {
  const movieDir = path.join(blueprintFolder, "builds", movieId);
  const currentPath = path.join(movieDir, "current.json");

  if (!existsSync(currentPath)) {
    res.statusCode = 404;
    res.end("Build not found");
    return;
  }

  try {
    // Load current manifest pointer
    const currentContent = await fs.readFile(currentPath, "utf8");
    const current = JSON.parse(currentContent) as { manifestPath?: string | null };

    if (!current.manifestPath) {
      res.statusCode = 404;
      res.end("Manifest not found");
      return;
    }

    // Load manifest
    const manifestPath = path.join(movieDir, current.manifestPath);
    const manifestContent = await fs.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestContent) as {
      artefacts?: Record<string, { blob?: { hash: string; size?: number; mimeType?: string } }>;
    };

    // Find the artifact
    const artefact = manifest.artefacts?.[canonicalId];
    if (!artefact?.blob?.hash) {
      res.statusCode = 404;
      res.end("Asset not found");
      return;
    }

    // Resolve blob path
    const { hash, mimeType: blobMimeType, size } = artefact.blob;
    const blobsDir = path.join(movieDir, "blobs");
    const prefix = hash.slice(0, 2);

    // Try different possible file paths
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
      res.end("Asset blob not found");
      return;
    }

    // Use the MIME type from the manifest or infer from extension
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
    const mimeType = blobMimeType ?? mimeTypes[ext] ?? "application/octet-stream";

    await streamFileWithRange(req, res, filePath, mimeType, size);
  } catch (error) {
    console.error("[streamBuildAsset]", error);
    res.statusCode = 500;
    res.end("Internal server error");
  }
}
