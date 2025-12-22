import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import handler from "serve-handler";
import { DOCUMENTARY_COMPOSITION_ID } from "@gorenku/compositions";

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = args[i + 1];
    out[key] = value;
    i++;
  }
  return out;
}

async function loadManifest(manifestPath) {
  const data = await readFile(manifestPath, "utf8");
  return JSON.parse(data);
}

function inferBlobExtension(mimeType) {
  const EXTENSION_MAP = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'video/mp4': 'mp4',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'text/plain': 'txt',
    'application/json': 'json',
  };
  if (!mimeType) return null;
  const normalized = mimeType.toLowerCase();
  if (EXTENSION_MAP[normalized]) {
    return EXTENSION_MAP[normalized];
  }
  // Handle audio/, video/, image/ prefixes
  if (normalized.startsWith('audio/')) return normalized.slice(6);
  if (normalized.startsWith('video/')) return normalized.slice(6);
  if (normalized.startsWith('image/')) return normalized.slice(6);
  return null;
}

function formatBlobFileName(hash, mimeType) {
  const extension = inferBlobExtension(mimeType);
  if (!extension) return hash;
  if (hash.endsWith(`.${extension}`)) return hash;
  return `${hash}.${extension}`;
}

function resolveBlobPath(root, basePath, movieId, blobRef, mimeType) {
  const prefix = blobRef.slice(0, 2);
  const fileName = formatBlobFileName(blobRef, mimeType);
  return path.join(root, basePath, movieId, "blobs", prefix, fileName);
}

async function startStaticServer(directory, port = 8080) {
  const server = http.createServer((request, response) => {
    return handler(request, response, {
      public: directory,
      cleanUrls: false,
    });
  });

  await new Promise((resolve, reject) => {
    server.listen(port, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  console.log(`Static file server started on http://localhost:${port}`);
  return server;
}

async function main() {
  const args = parseArgs();
  const movieId = args.movieId ?? process.env.MOVIE_ID;
  const storageRoot = args.root ?? process.env.STORAGE_ROOT ?? "/data";
  const basePath = args.basePath ?? process.env.STORAGE_BASE_PATH ?? "builds";
  const outputName = args.output ?? process.env.OUTPUT_NAME ?? "FinalVideo.mp4";
  const width = args.width ? Number(args.width) : 1920;
  const height = args.height ? Number(args.height) : 1080;
  const fps = args.fps ? Number(args.fps) : 30;

  if (!movieId) {
    throw new Error("movieId is required (via --movieId or MOVIE_ID)");
  }

  // Start static file server for serving external assets
  const staticServer = await startStaticServer(storageRoot);

  try {
    const manifestPath = path.join(storageRoot, basePath, movieId, "manifests");
    const pointerRaw = await readFile(path.join(manifestPath, "..", "current.json"), "utf8");
    const pointer = JSON.parse(pointerRaw);
    if (!pointer.manifestPath) {
      throw new Error("Manifest pointer missing manifestPath");
    }
    const manifest = await loadManifest(path.join(storageRoot, basePath, movieId, pointer.manifestPath));

    const timelineArtefact = manifest.artefacts?.["Artifact:TimelineComposer.Timeline"];
    if (!timelineArtefact || !timelineArtefact.blob?.hash) {
      throw new Error("Timeline artefact missing blob payload in manifest");
    }
    const timelineBlobPath = resolveBlobPath(
      storageRoot,
      basePath,
      movieId,
      timelineArtefact.blob.hash,
      timelineArtefact.blob.mimeType
    );
    const timeline = JSON.parse(await readFile(timelineBlobPath, "utf8"));

    const assets = {};
    for (const [artefactId, entry] of Object.entries(manifest.artefacts ?? {})) {
      if (!entry.blob?.hash) continue;
      const filePath = resolveBlobPath(storageRoot, basePath, movieId, entry.blob.hash, entry.blob.mimeType);
      // Convert absolute path to HTTP URL served by our static server
      const relativePath = path.relative(storageRoot, filePath);
      assets[artefactId] = `http://localhost:8080/${relativePath}`;
    }

    const outputFile = path.join(storageRoot, basePath, movieId, outputName);
    const serveUrl = await bundleRemotion();
    const composition = await selectComposition({
      serveUrl,
      id: DOCUMENTARY_COMPOSITION_ID,
      inputProps: { timeline, assets, width, height, fps },
      chromiumOptions: { enableMultiProcessOnLinux: true },
    });

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "remotion-render-"));
    try {
      await renderMedia({
        composition,
        serveUrl,
        inputProps: { timeline, assets, width, height, fps },
        codec: "h264",
        audioCodec: "aac",
        outputLocation: outputFile,
        chromiumOptions: { enableMultiProcessOnLinux: true },
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }

    console.log(`Rendered ${outputFile}`);
  } finally {
    // Close the static file server
    staticServer.close();
    console.log("Static file server stopped");
  }
}

async function bundleRemotion() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const entryPoint = path.join(__dirname, "remotion", "entry.tsx");
  return bundle({
    entryPoint,
    enableCaching: true,
    minify: true,
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...config.resolve,
        extensionAlias: {
          '.js': ['.tsx', '.ts', '.js'],
        },
      },
    }),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
