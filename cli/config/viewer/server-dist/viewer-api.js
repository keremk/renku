import { createReadStream, existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
const TIMELINE_ARTEFACT_ID = "Artifact:TimelineComposer.Timeline";
export function createViewerApiHandler(rootFolder) {
    const buildsRoot = path.resolve(rootFolder, "builds");
    return async (req, res) => {
        if (!req.url) {
            return false;
        }
        try {
            const url = new URL(req.url, "http://viewer.local");
            const segments = url.pathname.replace(/^\/viewer-api\/?/, "").split("/").filter(Boolean);
            if (segments.length === 0) {
                return respondNotFound(res);
            }
            if (segments[0] === "health") {
                if (req.method !== "GET") {
                    res.statusCode = 405;
                    res.end("Method Not Allowed");
                    return true;
                }
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ ok: true }));
                return true;
            }
            if (segments[0] !== "movies" || segments.length < 3) {
                return respondNotFound(res);
            }
            const movieId = decodeURIComponent(segments[1] ?? "");
            const action = segments[2];
            switch (action) {
                case "manifest": {
                    const manifest = await loadManifest(buildsRoot, movieId);
                    res.setHeader("Content-Type", "application/json");
                    res.end(JSON.stringify(manifest));
                    return true;
                }
                case "timeline": {
                    const manifest = await loadManifest(buildsRoot, movieId);
                    const timeline = await readTimeline(manifest, buildsRoot, movieId);
                    res.setHeader("Content-Type", "application/json");
                    res.end(JSON.stringify(timeline));
                    return true;
                }
                case "assets": {
                    const assetId = decodeURIComponent(segments.slice(3).join("/"));
                    if (!assetId) {
                        res.statusCode = 400;
                        res.end("Missing assetId");
                        return true;
                    }
                    await streamAsset(req, res, buildsRoot, movieId, assetId);
                    return true;
                }
                case "files": {
                    const hash = segments[3];
                    if (!hash) {
                        res.statusCode = 400;
                        res.end("Missing hash");
                        return true;
                    }
                    await streamBlobFile(req, res, buildsRoot, movieId, hash);
                    return true;
                }
                default: {
                    return respondNotFound(res);
                }
            }
        }
        catch (error) {
            console.error("[viewer-api]", error);
            if (!res.headersSent) {
                res.statusCode = 500;
                res.end("Internal Server Error");
            }
            else {
                res.end();
            }
            return true;
        }
    };
}
export function createViewerApiMiddleware(rootFolder) {
    const handler = createViewerApiHandler(rootFolder);
    return async (req, res, next) => {
        if (!req || !req.url || !req.url.startsWith("/viewer-api")) {
            next();
            return;
        }
        const handled = await handler(req, res);
        if (!handled) {
            next();
        }
    };
}
async function loadManifest(buildsRoot, movieId) {
    const movieDir = resolveMovieDir(buildsRoot, movieId);
    const pointerPath = path.join(movieDir, "current.json");
    const pointer = JSON.parse(await fs.readFile(pointerPath, "utf8"));
    if (!pointer.manifestPath) {
        throw new Error(`Manifest pointer missing path for movie ${movieId}`);
    }
    const manifestPath = path.join(movieDir, pointer.manifestPath);
    return JSON.parse(await fs.readFile(manifestPath, "utf8"));
}
async function readTimeline(manifest, buildsRoot, movieId) {
    const artefact = manifest.artefacts?.[TIMELINE_ARTEFACT_ID];
    if (!artefact) {
        throw new Error(`Timeline artefact not found for movie ${movieId}`);
    }
    if (artefact.blob?.hash) {
        const timelinePath = await resolveExistingBlobPath(buildsRoot, movieId, artefact.blob.hash, artefact.blob.mimeType);
        const contents = await fs.readFile(timelinePath, "utf8");
        return JSON.parse(contents);
    }
    throw new Error("Timeline artefact missing payload");
}
async function streamAsset(req, res, buildsRoot, movieId, canonicalId) {
    const manifest = await loadManifest(buildsRoot, movieId);
    const artefact = manifest.artefacts?.[canonicalId];
    if (!artefact) {
        res.statusCode = 404;
        res.end("Asset not found");
        return;
    }
    if (artefact.blob?.hash) {
        const filePath = await resolveExistingBlobPath(buildsRoot, movieId, artefact.blob.hash, artefact.blob.mimeType);
        const mimeType = artefact.blob.mimeType ?? "application/octet-stream";
        await streamFileWithRange(req, res, filePath, mimeType, artefact.blob.size);
        return;
    }
    res.statusCode = 404;
    res.end("Asset missing data");
}
async function streamBlobFile(req, res, buildsRoot, movieId, hash) {
    const filePath = await resolveExistingBlobPath(buildsRoot, movieId, hash);
    await streamFileWithRange(req, res, filePath, "application/octet-stream");
}
function resolveMovieDir(buildsRoot, movieId) {
    const movieDir = path.join(buildsRoot, movieId);
    if (!movieDir.startsWith(buildsRoot)) {
        throw new Error("Invalid movie path");
    }
    return movieDir;
}
async function resolveExistingBlobPath(buildsRoot, movieId, hash, mimeType) {
    const prefix = hash.slice(0, 2);
    const fileName = formatBlobFileName(hash, mimeType);
    const primary = path.join(resolveMovieDir(buildsRoot, movieId), "blobs", prefix, fileName);
    if (existsSync(primary)) {
        return primary;
    }
    const legacy = path.join(resolveMovieDir(buildsRoot, movieId), "blobs", prefix, hash);
    if (existsSync(legacy)) {
        return legacy;
    }
    throw new Error("Blob not found");
}
function formatBlobFileName(hash, mimeType) {
    const safeHash = hash.replace(/[^a-f0-9]/gi, "");
    const extension = inferExtension(mimeType);
    if (!extension) {
        return safeHash;
    }
    return safeHash.endsWith(`.${extension}`) ? safeHash : `${safeHash}.${extension}`;
}
function inferExtension(mimeType) {
    if (!mimeType) {
        return null;
    }
    const normalized = mimeType.toLowerCase();
    const known = {
        "audio/mpeg": "mp3",
        "audio/mp3": "mp3",
        "audio/wav": "wav",
        "audio/x-wav": "wav",
        "audio/webm": "webm",
        "audio/ogg": "ogg",
        "audio/flac": "flac",
        "audio/aac": "aac",
        "video/mp4": "mp4",
        "video/webm": "webm",
        "video/quicktime": "mov",
        "video/x-matroska": "mkv",
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/webp": "webp",
        "application/json": "json",
        "text/plain": "txt",
    };
    if (known[normalized]) {
        return known[normalized];
    }
    if (normalized.startsWith("audio/")) {
        return normalized.slice("audio/".length);
    }
    if (normalized.startsWith("video/")) {
        return normalized.slice("video/".length);
    }
    if (normalized.startsWith("image/")) {
        return normalized.slice("image/".length);
    }
    if (normalized === "application/octet-stream") {
        return null;
    }
    return null;
}
function respondNotFound(res) {
    res.statusCode = 404;
    res.end("Not Found");
    return true;
}
async function streamFileWithRange(req, res, filePath, mimeType, expectedSize) {
    const stat = await fs.stat(filePath);
    const totalSize = stat.size;
    const size = Number.isFinite(expectedSize) ? Math.min(Number(expectedSize), totalSize) : totalSize;
    const rangeHeader = req.headers.range;
    if (rangeHeader) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
        const start = match && match[1] ? Number.parseInt(match[1], 10) : 0;
        const end = match && match[2] ? Number.parseInt(match[2], 10) : size - 1;
        if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end < start || start >= size) {
            res.statusCode = 416;
            res.setHeader("Content-Range", `bytes */${size}`);
            res.end("Requested Range Not Satisfiable");
            return;
        }
        const chunkSize = end - start + 1;
        res.statusCode = 206;
        res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Length", chunkSize.toString());
        res.setHeader("Content-Type", mimeType);
        createReadStream(filePath, { start, end }).pipe(res);
        return;
    }
    res.statusCode = 200;
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", size.toString());
    res.setHeader("Content-Type", mimeType);
    createReadStream(filePath).pipe(res);
}
