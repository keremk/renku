import { createReadStream, existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { createViewerApiHandler } from "./viewer-api.js";
export async function startViewerServer(options) {
    const host = options.host ?? "127.0.0.1";
    const distDir = path.resolve(options.distPath);
    const port = options.port ?? 0;
    const log = options.log ?? (() => { });
    if (!existsSync(distDir)) {
        throw new Error(`Viewer assets not found at ${distDir}`);
    }
    const apiHandler = createViewerApiHandler(options.rootFolder);
    const server = createServer(async (req, res) => {
        if (!req.url) {
            res.statusCode = 400;
            res.end("Missing URL");
            return;
        }
        if (req.url.startsWith("/viewer-api")) {
            await apiHandler(req, res);
            return;
        }
        await serveStaticAsset(req, res, distDir);
    });
    return await new Promise((resolve, reject) => {
        server.once("error", (error) => {
            reject(error);
        });
        server.listen(port, host, () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                reject(new Error("Unable to determine viewer server address"));
                return;
            }
            const actualPort = address.port;
            const url = `http://${host}:${actualPort}`;
            log(`Viewer server listening on ${url}`);
            resolve({
                url,
                host,
                port: actualPort,
                stop: () => new Promise((stopResolve, stopReject) => {
                    server.close((error) => {
                        if (error) {
                            stopReject(error);
                            return;
                        }
                        stopResolve();
                    });
                }),
            });
        });
    });
}
async function serveStaticAsset(req, res, distDir) {
    const url = new URL(req.url ?? "/", "http://viewer.local");
    const method = req.method ?? "GET";
    const originalPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const safePath = sanitizePath(originalPath);
    const candidatePath = path.join(distDir, safePath);
    if (!candidatePath.startsWith(distDir)) {
        res.statusCode = 403;
        res.end("Forbidden");
        return;
    }
    let targetPath = candidatePath;
    try {
        const stats = await fs.stat(targetPath);
        if (stats.isDirectory()) {
            targetPath = path.join(targetPath, "index.html");
        }
    }
    catch {
        // Fallback to index.html for SPA routes.
        targetPath = path.join(distDir, "index.html");
    }
    if (!existsSync(targetPath)) {
        res.statusCode = 404;
        res.end("Not Found");
        return;
    }
    const mimeType = getMimeType(targetPath);
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", cacheControlForPath(targetPath, distDir));
    if (method === "HEAD") {
        res.statusCode = 200;
        res.end();
        return;
    }
    await streamFile(targetPath, res);
}
function sanitizePath(requestPath) {
    const decoded = decodeURIComponent(requestPath);
    const normalized = path.normalize(decoded);
    if (normalized.startsWith("..")) {
        return "index.html";
    }
    return normalized.replace(/^[/\\]+/, "");
}
function cacheControlForPath(targetPath, distDir) {
    const relative = path.relative(distDir, targetPath);
    if (relative.startsWith("assets/")) {
        return "public, max-age=31536000, immutable";
    }
    return "no-cache";
}
async function streamFile(filePath, res) {
    await new Promise((resolve, reject) => {
        const stream = createReadStream(filePath);
        stream.on("error", (error) => {
            if (!res.headersSent) {
                res.statusCode = 500;
                res.end("Internal Server Error");
            }
            else {
                res.end();
            }
            reject(error);
        });
        stream.on("end", resolve);
        stream.pipe(res);
    });
}
function getMimeType(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    const map = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".cjs": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".ico": "image/x-icon",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".txt": "text/plain; charset=utf-8",
    };
    return map[extension] ?? "application/octet-stream";
}
