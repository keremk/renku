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
  const payloadPath = args.payload ?? process.env.RENDER_INPUT_PATH;
  const width = args.width ? Number(args.width) : 1920;
  const height = args.height ? Number(args.height) : 1080;
  const fps = args.fps ? Number(args.fps) : 30;

  if (!movieId) {
    throw new Error("movieId is required (via --movieId or MOVIE_ID)");
  }
  if (!payloadPath) {
    throw new Error("render payload path is required (via --payload or RENDER_INPUT_PATH)");
  }

  // Start static file server for serving external assets
  const staticServer = await startStaticServer(storageRoot);

  try {
    const payload = JSON.parse(await readFile(payloadPath, "utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Render payload must be a JSON object");
    }
    const timeline = payload.timeline;
    if (
      typeof timeline !== "object" ||
      timeline === null ||
      Array.isArray(timeline) ||
      typeof timeline.id !== "string" ||
      typeof timeline.duration !== "number" ||
      !Array.isArray(timeline.tracks)
    ) {
      throw new Error("Render payload timeline is invalid");
    }
    const assetPaths = payload.assetPaths;
    if (
      typeof assetPaths !== "object" ||
      assetPaths === null ||
      Array.isArray(assetPaths)
    ) {
      throw new Error("Render payload assetPaths is invalid");
    }

    const assets = {};
    for (const [artifactId, assetPath] of Object.entries(assetPaths)) {
      if (typeof assetPath !== "string" || !assetPath) {
        throw new Error(`Render payload asset path for ${artifactId} is invalid`);
      }
      const relativePath = path.isAbsolute(assetPath)
        ? path.relative(storageRoot, assetPath)
        : assetPath;
      assets[artifactId] = `http://localhost:8080/${relativePath}`;
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
