/**
 * File upload handler for input files.
 * Handles multipart/form-data uploads and stores files in the build's input-files directory.
 */

import { createWriteStream, existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import busboy from "busboy";
import type { UploadedFileInfo, MediaInputType } from "./types.js";

/** Maximum file size in bytes (100MB) */
const MAX_FILE_SIZE = 100 * 1024 * 1024;

/** Allowed MIME types by media input type */
const ALLOWED_MIME_TYPES: Record<MediaInputType, string[]> = {
  image: ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"],
  video: ["video/mp4", "video/webm", "video/quicktime"],
  audio: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg", "audio/m4a", "audio/x-m4a"],
};

/** Characters that are not allowed in filenames for security */
// eslint-disable-next-line no-control-regex
const UNSAFE_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

/**
 * Sanitizes a filename to prevent path traversal and other security issues.
 */
export function sanitizeFilename(filename: string): string {
  // Remove path components
  const basename = path.basename(filename);
  // Remove unsafe characters
  const safe = basename.replace(UNSAFE_FILENAME_CHARS, "-");
  // Replace spaces with dashes
  const normalized = safe.replace(/\s+/g, "-");
  // Remove consecutive dashes
  const cleaned = normalized.replace(/-+/g, "-");
  // Remove leading/trailing dashes and dots
  return cleaned.replace(/^[-.]|[-.]$/g, "") || "file";
}

/**
 * Generates a unique filename with timestamp prefix.
 */
export function generateUniqueFilename(originalName: string): string {
  const sanitized = sanitizeFilename(originalName);
  const timestamp = Date.now();
  return `${timestamp}-${sanitized}`;
}

/**
 * Validates that a MIME type is allowed for the given input type.
 */
export function isAllowedMimeType(mimeType: string, inputType: MediaInputType): boolean {
  const allowed = ALLOWED_MIME_TYPES[inputType];
  if (!allowed) return false;
  // Normalize MIME type comparison
  const normalized = mimeType.toLowerCase();
  return allowed.some((t) => normalized.startsWith(t.split("/")[0] + "/"));
}

/**
 * Gets the input-files directory path for a build.
 */
export function getInputFilesDir(blueprintFolder: string, movieId: string): string {
  return path.join(blueprintFolder, "builds", movieId, "input-files");
}

/**
 * Validates that a path is within the expected directory (prevents path traversal).
 */
export function isPathWithinDirectory(filePath: string, directory: string): boolean {
  const resolvedFile = path.resolve(filePath);
  const resolvedDir = path.resolve(directory);
  return resolvedFile.startsWith(resolvedDir + path.sep) || resolvedFile === resolvedDir;
}

/**
 * Handles file upload requests.
 * Expects multipart/form-data with files in a "files" field.
 * Query params: folder, movieId, inputType (optional, for validation)
 */
export async function handleFileUpload(
  req: IncomingMessage,
  res: ServerResponse,
  blueprintFolder: string,
  movieId: string,
  inputType?: MediaInputType,
): Promise<void> {
  // Validate required parameters
  if (!blueprintFolder || !movieId) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Missing blueprintFolder or movieId parameter" }));
    return;
  }

  // Validate path security
  const inputFilesDir = getInputFilesDir(blueprintFolder, movieId);
  if (!isPathWithinDirectory(inputFilesDir, blueprintFolder)) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Invalid path" }));
    return;
  }

  // Create input-files directory if it doesn't exist
  await fs.mkdir(inputFilesDir, { recursive: true });

  const contentType = req.headers["content-type"];
  if (!contentType || !contentType.includes("multipart/form-data")) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Content-Type must be multipart/form-data" }));
    return;
  }

  const uploadedFiles: UploadedFileInfo[] = [];
  const errors: string[] = [];

  try {
    const bb = busboy({
      headers: req.headers,
      limits: {
        fileSize: MAX_FILE_SIZE,
        files: 20, // Max 20 files per upload
      },
    });

    const filePromises: Promise<void>[] = [];

    bb.on("file", (_fieldname, file, info) => {
      const { filename: originalName, mimeType } = info;

      // Validate input type if specified
      if (inputType && !isAllowedMimeType(mimeType, inputType)) {
        errors.push(`Invalid file type "${mimeType}" for ${originalName}. Expected ${inputType}.`);
        file.resume(); // Drain the stream
        return;
      }

      const uniqueFilename = generateUniqueFilename(originalName);
      const filePath = path.join(inputFilesDir, uniqueFilename);

      // Double-check path security
      if (!isPathWithinDirectory(filePath, inputFilesDir)) {
        errors.push(`Invalid filename: ${originalName}`);
        file.resume();
        return;
      }

      const filePromise = new Promise<void>((resolve, reject) => {
        let fileSize = 0;
        let truncated = false;

        const writeStream = createWriteStream(filePath);

        file.on("data", (data: Buffer) => {
          fileSize += data.length;
        });

        file.on("limit", () => {
          truncated = true;
          errors.push(`File "${originalName}" exceeds maximum size of ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
        });

        file.on("end", () => {
          if (!truncated) {
            uploadedFiles.push({
              filename: uniqueFilename,
              originalName,
              size: fileSize,
              mimeType,
              fileRef: `file:./input-files/${uniqueFilename}`,
            });
          }
        });

        writeStream.on("error", (err) => {
          reject(err);
        });

        writeStream.on("finish", () => {
          if (truncated) {
            // Delete truncated file
            fs.unlink(filePath).catch(() => {});
          }
          resolve();
        });

        file.pipe(writeStream);
      });

      filePromises.push(filePromise);
    });

    bb.on("error", (err: Error) => {
      errors.push(`Upload error: ${err.message}`);
    });

    await new Promise<void>((resolve, reject) => {
      bb.on("close", async () => {
        try {
          await Promise.all(filePromises);
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      req.pipe(bb);
    });

    // Return response
    if (errors.length > 0 && uploadedFiles.length === 0) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: errors.join("; ") }));
    } else {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ files: uploadedFiles, errors: errors.length > 0 ? errors : undefined }));
    }
  } catch (error) {
    console.error("[upload-handler] Error:", error);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Upload failed" }));
  }
}

/**
 * Streams an input file from a build.
 */
export async function streamInputFile(
  req: IncomingMessage,
  res: ServerResponse,
  blueprintFolder: string,
  movieId: string,
  filename: string,
): Promise<void> {
  // Validate parameters
  if (!blueprintFolder || !movieId || !filename) {
    res.statusCode = 400;
    res.end("Missing required parameters");
    return;
  }

  // Sanitize filename to prevent path traversal
  const sanitized = sanitizeFilename(filename);
  if (sanitized !== filename && !filename.includes(sanitized)) {
    res.statusCode = 400;
    res.end("Invalid filename");
    return;
  }

  const inputFilesDir = getInputFilesDir(blueprintFolder, movieId);
  const filePath = path.join(inputFilesDir, filename);

  // Validate path security
  if (!isPathWithinDirectory(filePath, inputFilesDir)) {
    res.statusCode = 400;
    res.end("Invalid path");
    return;
  }

  if (!existsSync(filePath)) {
    res.statusCode = 404;
    res.end("File not found");
    return;
  }

  try {
    const stat = await fs.stat(filePath);

    // Infer MIME type from extension
    const ext = path.extname(filename).slice(1).toLowerCase();
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
      m4a: "audio/m4a",
    };
    const mimeType = mimeTypes[ext] ?? "application/octet-stream";

    // Import the streaming utility
    const { streamFileWithRange } = await import("../shared/stream-utils.js");
    await streamFileWithRange(req, res, filePath, mimeType, stat.size);
  } catch (error) {
    console.error("[streamInputFile] Error:", error);
    res.statusCode = 500;
    res.end("Internal server error");
  }
}
