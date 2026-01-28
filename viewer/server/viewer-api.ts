import { createReadStream, existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Connect } from "vite";
import {
  loadYamlBlueprintTree,
  loadInputsFromYaml,
  computeTopologyLayers,
  getProducerMappings,
  serializeInputsToYaml,
  toSerializableModelSelection,
  extractModelSelectionsFromInputs,
  type BlueprintTreeNode,
  type BlueprintInputDefinition,
  type BlueprintArtefactDefinition,
  type ProducerMappings,
  type ProducerImportDefinition,
  type SerializableModelSelection,
  type ExtractedModelSelection,
} from "@gorenku/core";
import { loadModelCatalog, type LoadedModelCatalog } from "@gorenku/providers";
import {
  handlePlanRequest,
  handleExecuteRequest,
  handleJobsListRequest,
  handleJobStatusRequest,
  handleStreamRequest,
  handleCancelRequest,
  sendMethodNotAllowed,
  resolveBlueprintPaths,
  readCliConfig,
} from "./generation/index.js";

interface BlueprintGraphData {
  meta: {
    id: string;
    name: string;
    description?: string;
    version?: string;
  };
  nodes: BlueprintGraphNode[];
  edges: BlueprintGraphEdge[];
  inputs: BlueprintInputDef[];
  outputs: BlueprintOutputDef[];
  conditions?: ConditionDef[];
  /** Pre-computed layer assignments for producer nodes (nodeId -> layer index) */
  layerAssignments?: Record<string, number>;
  /** Total number of layers in the blueprint topology */
  layerCount?: number;
}

interface BlueprintGraphNode {
  id: string;
  type: "input" | "producer" | "output";
  label: string;
  loop?: string;
  producerType?: string;
  description?: string;
}

interface BlueprintGraphEdge {
  id: string;
  source: string;
  target: string;
  conditionName?: string;
  isConditional?: boolean;
}

interface BlueprintInputDef {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  itemType?: string;
}

interface BlueprintOutputDef {
  name: string;
  type: string;
  description?: string;
  itemType?: string;
}

interface ConditionDef {
  name: string;
  definition: unknown;
}

interface ManifestPointer {
  revision: string | null;
  manifestPath: string | null;
}

interface ManifestFile {
  artefacts?: Record<
    string,
    {
      blob: {
        hash: string;
        size: number;
        mimeType?: string;
      };
    }
  >;
}

const TIMELINE_ARTEFACT_ID = "Artifact:TimelineComposer.Timeline";

export type ViewerApiHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

export function createViewerApiHandler(rootFolder: string): ViewerApiHandler {
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

      // Handle blueprint endpoints
      if (segments[0] === "blueprints") {
        return handleBlueprintRequest(req, res, url, segments.slice(1));
      }

      // Handle generation endpoints
      if (segments[0] === "generate") {
        return handleGenerateRequest(req, res, segments.slice(1));
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
    } catch (error) {
      console.error("[viewer-api]", error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal Server Error");
      } else {
        res.end();
      }
      return true;
    }
  };
}

export function createViewerApiMiddleware(rootFolder: string): Connect.NextHandleFunction {
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

async function loadManifest(buildsRoot: string, movieId: string): Promise<ManifestFile> {
  const movieDir = resolveMovieDir(buildsRoot, movieId);
  const pointerPath = path.join(movieDir, "current.json");
  const pointer = JSON.parse(await fs.readFile(pointerPath, "utf8")) as ManifestPointer;

  if (!pointer.manifestPath) {
    throw new Error(`Manifest pointer missing path for movie ${movieId}`);
  }

  const manifestPath = path.join(movieDir, pointer.manifestPath);
  return JSON.parse(await fs.readFile(manifestPath, "utf8")) as ManifestFile;
}

async function readTimeline(manifest: ManifestFile, buildsRoot: string, movieId: string): Promise<unknown> {
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

async function streamAsset(
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
    const filePath = await resolveExistingBlobPath(buildsRoot, movieId, artefact.blob.hash, artefact.blob.mimeType);
    const mimeType = artefact.blob.mimeType ?? "application/octet-stream";
    await streamFileWithRange(req, res, filePath, mimeType, artefact.blob.size);
    return;
  }

  res.statusCode = 404;
  res.end("Asset missing data");
}

async function streamBlobFile(
  req: IncomingMessage,
  res: ServerResponse,
  buildsRoot: string,
  movieId: string,
  hash: string,
): Promise<void> {
  const filePath = await resolveExistingBlobPath(buildsRoot, movieId, hash);
  await streamFileWithRange(req, res, filePath, "application/octet-stream");
}

function resolveMovieDir(buildsRoot: string, movieId: string): string {
  const movieDir = path.join(buildsRoot, movieId);
  if (!movieDir.startsWith(buildsRoot)) {
    throw new Error("Invalid movie path");
  }
  return movieDir;
}

async function resolveExistingBlobPath(
  buildsRoot: string,
  movieId: string,
  hash: string,
  mimeType?: string,
): Promise<string> {
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

function formatBlobFileName(hash: string, mimeType?: string): string {
  const safeHash = hash.replace(/[^a-f0-9]/gi, "");
  const extension = inferExtension(mimeType);
  if (!extension) {
    return safeHash;
  }
  return safeHash.endsWith(`.${extension}`) ? safeHash : `${safeHash}.${extension}`;
}

function inferExtension(mimeType?: string): string | null {
  if (!mimeType) {
    return null;
  }
  const normalized = mimeType.toLowerCase();
  const known: Record<string, string> = {
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

function respondNotFound(res: ServerResponse): true {
  res.statusCode = 404;
  res.end("Not Found");
  return true;
}

async function streamFileWithRange(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
  mimeType: string,
  expectedSize?: number,
): Promise<void> {
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

// --- Blueprint API handlers ---

async function handleBlueprintRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  segments: string[],
): Promise<boolean> {
  const action = segments[0];
  const subAction = segments[1];

  const catalogRoot = url.searchParams.get("catalog") ?? undefined;

  // Handle builds sub-routes that support POST/PUT
  if (action === "builds" && subAction) {
    return handleBuildsSubRoute(req, res, url, subAction);
  }

  // All other routes require GET
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return true;
  }

  switch (action) {
    case "parse": {
      const blueprintPath = url.searchParams.get("path");
      if (!blueprintPath) {
        res.statusCode = 400;
        res.end("Missing path parameter");
        return true;
      }
      const graphData = await parseBlueprintToGraph(blueprintPath, catalogRoot);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(graphData));
      return true;
    }
    case "inputs": {
      const inputsPath = url.searchParams.get("path");
      if (!inputsPath) {
        res.statusCode = 400;
        res.end("Missing path parameter");
        return true;
      }
      const inputData = await parseInputsFile(inputsPath);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(inputData));
      return true;
    }
    case "builds": {
      const folder = url.searchParams.get("folder");
      if (!folder) {
        res.statusCode = 400;
        res.end("Missing folder parameter");
        return true;
      }
      const buildsData = await listBuilds(folder);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(buildsData));
      return true;
    }
    case "manifest": {
      const folder = url.searchParams.get("folder");
      const movieId = url.searchParams.get("movieId");
      if (!folder || !movieId) {
        res.statusCode = 400;
        res.end("Missing folder or movieId parameter");
        return true;
      }
      const manifestData = await getBuildManifest(folder, movieId);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(manifestData));
      return true;
    }
    case "blob": {
      const folder = url.searchParams.get("folder");
      const movieId = url.searchParams.get("movieId");
      const hash = url.searchParams.get("hash");
      if (!folder || !movieId || !hash) {
        res.statusCode = 400;
        res.end("Missing folder, movieId, or hash parameter");
        return true;
      }
      await streamBuildBlob(req, res, folder, movieId, hash);
      return true;
    }
    case "resolve": {
      // Resolve blueprint name to full paths using CLI config
      const name = url.searchParams.get("name");
      if (!name) {
        res.statusCode = 400;
        res.end("Missing name parameter");
        return true;
      }
      try {
        const paths = await resolveBlueprintName(name);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(paths));
        return true;
      } catch (error) {
        res.statusCode = 400;
        const message = error instanceof Error ? error.message : "Failed to resolve blueprint";
        res.end(JSON.stringify({ error: message }));
        return true;
      }
    }
    case "producer-models": {
      const blueprintPath = url.searchParams.get("path");
      if (!blueprintPath) {
        res.statusCode = 400;
        res.end("Missing path parameter");
        return true;
      }
      const producerModels = await getProducerModelsFromBlueprint(blueprintPath, catalogRoot);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(producerModels));
      return true;
    }
    default:
      return respondNotFound(res);
  }
}

interface ResolvedBlueprintInfo {
  blueprintPath: string;
  blueprintFolder: string;
  inputsPath: string;
  buildsFolder: string;
  catalogRoot?: string;
}

async function resolveBlueprintName(name: string): Promise<ResolvedBlueprintInfo> {
  const cliConfig = await readCliConfig();
  if (!cliConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }
  const paths = await resolveBlueprintPaths(name, undefined, cliConfig);
  return {
    blueprintPath: paths.blueprintPath,
    blueprintFolder: paths.blueprintFolder,
    inputsPath: paths.inputsPath,
    buildsFolder: paths.buildsFolder,
    catalogRoot: cliConfig.catalog?.root,
  };
}

// --- Build management sub-routes ---

interface CreateBuildRequest {
  blueprintFolder: string;
  displayName?: string;
}

interface CreateBuildResponse {
  movieId: string;
  inputsPath: string;
}

interface BuildInputsRequest {
  blueprintFolder: string;
  blueprintPath: string;
  movieId: string;
  inputs: Record<string, unknown>;
  models: SerializableModelSelection[];
}

interface BuildMetadataRequest {
  blueprintFolder: string;
  movieId: string;
  displayName: string;
}

interface EnableEditingRequest {
  blueprintFolder: string;
  movieId: string;
}

interface MovieMetadata {
  blueprintPath?: string;
  lastInputsPath?: string;
  displayName?: string;
  createdAt?: string;
}

/**
 * Handles builds sub-routes: create, inputs (GET/PUT), metadata (PUT)
 */
async function handleBuildsSubRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  subAction: string
): Promise<boolean> {
  switch (subAction) {
    case "create": {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end("Method Not Allowed");
        return true;
      }
      const body = await readJsonBody<CreateBuildRequest>(req);
      if (!body.blueprintFolder) {
        res.statusCode = 400;
        res.end("Missing blueprintFolder");
        return true;
      }
      const result = await createBuild(body.blueprintFolder, body.displayName);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result));
      return true;
    }

    case "inputs": {
      if (req.method === "GET") {
        const folder = url.searchParams.get("folder");
        const movieId = url.searchParams.get("movieId");
        const blueprintPath = url.searchParams.get("blueprintPath");
        const catalogRoot = url.searchParams.get("catalog") ?? undefined;
        if (!folder || !movieId || !blueprintPath) {
          res.statusCode = 400;
          res.end("Missing folder, movieId, or blueprintPath parameter");
          return true;
        }
        const result = await getBuildInputs(folder, movieId, blueprintPath, catalogRoot);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(result));
        return true;
      }
      if (req.method === "PUT") {
        const body = await readJsonBody<BuildInputsRequest>(req);
        if (!body.blueprintFolder || !body.movieId || !body.inputs || !body.models) {
          res.statusCode = 400;
          res.end("Missing blueprintFolder, movieId, inputs, or models");
          return true;
        }
        await saveBuildInputs(body.blueprintFolder, body.movieId, body.inputs, body.models);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ success: true }));
        return true;
      }
      res.statusCode = 405;
      res.end("Method Not Allowed");
      return true;
    }

    case "metadata": {
      if (req.method !== "PUT") {
        res.statusCode = 405;
        res.end("Method Not Allowed");
        return true;
      }
      const body = await readJsonBody<BuildMetadataRequest>(req);
      if (!body.blueprintFolder || !body.movieId || !body.displayName) {
        res.statusCode = 400;
        res.end("Missing blueprintFolder, movieId, or displayName");
        return true;
      }
      await updateBuildMetadata(body.blueprintFolder, body.movieId, body.displayName);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ success: true }));
      return true;
    }

    case "enable-editing": {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end("Method Not Allowed");
        return true;
      }
      const body = await readJsonBody<EnableEditingRequest>(req);
      if (!body.blueprintFolder || !body.movieId) {
        res.statusCode = 400;
        res.end("Missing blueprintFolder or movieId");
        return true;
      }
      await enableBuildEditing(body.blueprintFolder, body.movieId);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ success: true }));
      return true;
    }

    default:
      return respondNotFound(res);
  }
}

/**
 * Reads JSON body from request.
 */
async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body) as T);
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Generates a unique movie ID.
 */
function generateMovieId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `movie-${suffix}`;
}

/**
 * Creates a new build with inputs.yaml copied from input-template.yaml.
 */
async function createBuild(blueprintFolder: string, displayName?: string): Promise<CreateBuildResponse> {
  const movieId = generateMovieId();
  const buildDir = path.join(blueprintFolder, "builds", movieId);

  // Create the build directory
  await fs.mkdir(buildDir, { recursive: true });

  // Copy input-template.yaml to inputs.yaml
  const templatePath = path.join(blueprintFolder, "input-template.yaml");
  const inputsPath = path.join(buildDir, "inputs.yaml");

  let templateContent = "";
  if (existsSync(templatePath)) {
    templateContent = await fs.readFile(templatePath, "utf8");
  }
  await fs.writeFile(inputsPath, templateContent, "utf8");

  // Create movie-metadata.json with displayName and createdAt
  const metadata: MovieMetadata = {
    displayName: displayName || undefined,
    createdAt: new Date().toISOString(),
  };
  const metadataPath = path.join(buildDir, "movie-metadata.json");
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");

  return { movieId, inputsPath };
}

/**
 * Response type for GET /blueprints/builds/inputs.
 * Returns parsed inputs and model selections as structured JSON.
 */
interface BuildInputsResponse {
  inputs: Record<string, unknown>;
  models: SerializableModelSelection[];
  inputsPath: string;
}

/**
 * Gets the inputs.yaml content for a build, parsed using core's loadInputsFromYaml.
 * Returns structured JSON instead of raw YAML content.
 */
async function getBuildInputs(
  blueprintFolder: string,
  movieId: string,
  blueprintPath: string,
  catalogRoot?: string,
): Promise<BuildInputsResponse> {
  const inputsPath = path.join(blueprintFolder, "builds", movieId, "inputs.yaml");

  // Return empty response if no inputs file exists
  if (!existsSync(inputsPath)) {
    return { inputs: {}, models: [], inputsPath };
  }

  try {
    // Load blueprint tree for validation context
    const { root: blueprint } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });

    // Parse inputs using core's loader
    const loaded = await loadInputsFromYaml(inputsPath, blueprint);

    // Convert model selections to serializable form (strip runtime fields)
    const models = loaded.modelSelections.map(toSerializableModelSelection);

    // Strip "Input:" prefix from keys for client consumption
    const inputs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(loaded.values)) {
      const cleanKey = key.startsWith("Input:") ? key.slice(6) : key;
      inputs[cleanKey] = value;
    }

    return {
      inputs,
      models,
      inputsPath,
    };
  } catch (error) {
    // If parsing fails, return empty data
    console.error("[viewer-api] Failed to parse build inputs:", error);
    return { inputs: {}, models: [], inputsPath };
  }
}

/**
 * Saves inputs.yaml content for a build using core's serialization.
 * Accepts structured JSON and serializes to YAML.
 */
async function saveBuildInputs(
  blueprintFolder: string,
  movieId: string,
  inputs: Record<string, unknown>,
  models: SerializableModelSelection[],
): Promise<void> {
  const buildDir = path.join(blueprintFolder, "builds", movieId);
  await fs.mkdir(buildDir, { recursive: true });
  const inputsPath = path.join(buildDir, "inputs.yaml");

  // Serialize to YAML using core's serializer
  const content = serializeInputsToYaml({ inputs, models });
  await fs.writeFile(inputsPath, content, "utf8");
}

/**
 * Updates build metadata (displayName).
 */
async function updateBuildMetadata(blueprintFolder: string, movieId: string, displayName: string): Promise<void> {
  const metadataPath = path.join(blueprintFolder, "builds", movieId, "movie-metadata.json");

  let metadata: MovieMetadata = {};
  if (existsSync(metadataPath)) {
    const content = await fs.readFile(metadataPath, "utf8");
    try {
      metadata = JSON.parse(content) as MovieMetadata;
    } catch {
      // Ignore parse errors, start fresh
    }
  }

  metadata.displayName = displayName;
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
}

/**
 * Enables editing for an existing build by copying input-template.yaml to the build folder.
 */
async function enableBuildEditing(blueprintFolder: string, movieId: string): Promise<void> {
  const buildDir = path.join(blueprintFolder, "builds", movieId);
  const inputsPath = path.join(buildDir, "inputs.yaml");

  // Don't overwrite if inputs.yaml already exists
  if (existsSync(inputsPath)) {
    return;
  }

  // Copy input-template.yaml to inputs.yaml
  const templatePath = path.join(blueprintFolder, "input-template.yaml");
  let templateContent = "";
  if (existsSync(templatePath)) {
    templateContent = await fs.readFile(templatePath, "utf8");
  }
  await fs.writeFile(inputsPath, templateContent, "utf8");
}

async function parseBlueprintToGraph(blueprintPath: string, catalogRoot?: string): Promise<BlueprintGraphData> {
  const { root } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });
  return convertTreeToGraph(root);
}

// --- Producer Models API ---

interface AvailableModelOption {
  provider: string;
  model: string;
}

type ProducerCategory = 'asset' | 'prompt' | 'composition';

interface ProducerModelInfo {
  description?: string;
  producerType?: string;
  category: ProducerCategory;
  availableModels: AvailableModelOption[];
}

interface ProducerModelsResponse {
  producers: Record<string, ProducerModelInfo>;
}

/**
 * Detects the producer category based on producer import data.
 * - 'composition': Producer name starts with 'composition/'
 * - 'asset': Producer name starts with 'asset/'
 * - 'prompt': Custom blueprints with path or promptFile
 */
function detectProducerCategory(
  producerImport: ProducerImportDefinition,
  childNode: BlueprintTreeNode | undefined
): ProducerCategory {
  // Check for composition producers (e.g., composition/timeline, composition/video-exporter)
  if (producerImport.producer?.startsWith('composition/')) {
    return 'composition';
  }
  // Check for asset producers (e.g., asset/text-to-image, asset/text-to-speech)
  if (producerImport.producer?.startsWith('asset/')) {
    return 'asset';
  }
  // Custom blueprints with path or promptFile are prompt producers
  if (producerImport.path || childNode?.document.meta.promptFile) {
    return 'prompt';
  }
  // Default fallback to asset
  return 'asset';
}

/**
 * Extracts LLM models (type: 'text' or 'llm') from the model catalog.
 */
function getLlmModelsFromCatalog(
  catalog: LoadedModelCatalog
): AvailableModelOption[] {
  const llmModels: AvailableModelOption[] = [];
  for (const [provider, models] of catalog.providers) {
    for (const [modelName, modelDef] of models) {
      if (modelDef.type === 'text' || modelDef.type === 'llm') {
        llmModels.push({ provider, model: modelName });
      }
    }
  }
  return llmModels;
}

/**
 * Extracts available models from each producer in the blueprint tree.
 * Models are extracted based on producer category:
 * - Asset producers: Models from producer mappings
 * - Prompt producers: LLM models from catalog
 * - Composition producers: No models (empty array)
 */
async function getProducerModelsFromBlueprint(
  blueprintPath: string,
  catalogRoot?: string,
): Promise<ProducerModelsResponse> {
  const { root } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });
  const producers: Record<string, ProducerModelInfo> = {};

  // Load model catalog for prompt producers
  let llmModels: AvailableModelOption[] = [];
  if (catalogRoot) {
    const catalogModelsDir = path.join(catalogRoot, "models");
    const catalog = await loadModelCatalog(catalogModelsDir);
    llmModels = getLlmModelsFromCatalog(catalog);
  }

  // Visit all producer imports in the blueprint
  const visitNode = (node: BlueprintTreeNode) => {
    for (const producerImport of node.document.producerImports) {
      const producerId = producerImport.name;

      // Find child node if this is a path-based import
      const childNode = producerImport.path
        ? node.children.get(producerId)
        : undefined;

      // Detect producer category
      const category = detectProducerCategory(producerImport, childNode);

      // Get available models based on category
      let availableModels: AvailableModelOption[] = [];

      if (category === 'asset') {
        // Asset producers: Extract models from mappings
        const mappings: ProducerMappings | undefined = getProducerMappings(root, producerId);
        if (mappings) {
          for (const [provider, modelMappings] of Object.entries(mappings)) {
            for (const model of Object.keys(modelMappings)) {
              availableModels.push({ provider, model });
            }
          }
        }
      } else if (category === 'prompt') {
        // Prompt producers: Use LLM models from catalog
        availableModels = llmModels;
      }
      // Composition producers: Leave availableModels empty

      producers[producerId] = {
        description: producerImport.description,
        producerType: producerImport.producer,
        category,
        availableModels,
      };
    }

    // Visit children
    for (const child of node.children.values()) {
      visitNode(child);
    }
  };

  visitNode(root);
  return { producers };
}

function convertTreeToGraph(root: BlueprintTreeNode): BlueprintGraphData {
  const nodes: BlueprintGraphNode[] = [];
  const edges: BlueprintGraphEdge[] = [];
  const conditions: ConditionDef[] = [];

  // Collect all nodes and edges from the tree
  collectNodesAndEdges(root, nodes, edges, conditions);

  // Convert inputs
  const inputs: BlueprintInputDef[] = root.document.inputs.map((inp: BlueprintInputDefinition) => ({
    name: inp.name,
    type: inp.type,
    required: inp.required,
    description: inp.description,
  }));

  // Convert outputs (artefacts)
  const outputs: BlueprintOutputDef[] = root.document.artefacts.map((art: BlueprintArtefactDefinition) => ({
    name: art.name,
    type: art.type,
    description: art.description,
    itemType: art.itemType,
  }));

  // Compute layer assignments for producer nodes using the core topology service
  const producerNodes = nodes.filter((n) => n.type === "producer");
  const producerEdges = edges
    .filter(
      (e) =>
        e.source.startsWith("Producer:") && e.target.startsWith("Producer:")
    )
    .map((e) => ({
      from: e.source,
      to: e.target,
    }));

  const topologyResult = computeTopologyLayers(producerNodes, producerEdges);

  // Convert Map to Record for JSON serialization
  const layerAssignments: Record<string, number> = {};
  for (const [nodeId, layer] of topologyResult.layerAssignments) {
    layerAssignments[nodeId] = layer;
  }

  return {
    meta: {
      id: root.document.meta.id,
      name: root.document.meta.name,
      description: root.document.meta.description,
      version: root.document.meta.version,
    },
    nodes,
    edges,
    inputs,
    outputs,
    conditions: conditions.length > 0 ? conditions : undefined,
    layerAssignments,
    layerCount: topologyResult.layerCount,
  };
}

function collectNodesAndEdges(
  node: BlueprintTreeNode,
  nodes: BlueprintGraphNode[],
  edges: BlueprintGraphEdge[],
  conditions: ConditionDef[],
): void {
  const doc = node.document;

  // Collect names for reference resolution
  const inputNames = new Set(doc.inputs.map((inp) => inp.name));
  const producerNames = new Set(doc.producerImports.map((p) => p.name));
  const artifactNames = new Set(doc.artefacts.map((a) => a.name));

  // Add single "Inputs" node representing all blueprint inputs
  nodes.push({
    id: "Inputs",
    type: "input",
    label: "Inputs",
    description: `${doc.inputs.length} input${doc.inputs.length !== 1 ? "s" : ""}`,
  });

  // Add producer nodes from producer imports
  for (const producerImport of doc.producerImports) {
    nodes.push({
      id: `Producer:${producerImport.name}`,
      type: "producer",
      label: producerImport.name,
      loop: producerImport.loop,
      producerType: producerImport.producer,
      description: producerImport.description,
    });
  }

  // Add single "Outputs" node representing all blueprint outputs
  nodes.push({
    id: "Outputs",
    type: "output",
    label: "Outputs",
    description: `${doc.artefacts.length} artifact${doc.artefacts.length !== 1 ? "s" : ""}`,
  });

  // Track which producers have input dependencies and which produce outputs
  const producersWithInputDeps = new Set<string>();
  const producersWithOutputs = new Set<string>();
  const addedEdges = new Set<string>();

  // Process edges to create producer-to-producer connections
  for (const edge of doc.edges) {
    const isConditional = Boolean(edge.if || edge.conditions);
    const { sourceType, sourceProducer, targetType, targetProducer } = resolveEdgeEndpoints(
      edge.from,
      edge.to,
      inputNames,
      producerNames,
      artifactNames
    );

    // Input -> Producer: track that this producer has input dependencies
    if (sourceType === "input" && targetType === "producer" && targetProducer) {
      producersWithInputDeps.add(targetProducer);
    }

    // Producer -> Output: track that this producer produces outputs
    if (sourceType === "producer" && targetType === "output" && sourceProducer) {
      producersWithOutputs.add(sourceProducer);
    }

    // Producer -> Producer: create edge between producers
    if (sourceType === "producer" && targetType === "producer" && sourceProducer && targetProducer) {
      // Normalize loop references like "VideoProducer[segment-1]" to "VideoProducer"
      const normalizedSource = normalizeProducerName(sourceProducer);
      const normalizedTarget = normalizeProducerName(targetProducer);

      // Skip edges where source or target is not an actual producer (e.g., derived values like "Duration")
      if (!producerNames.has(normalizedSource) || !producerNames.has(normalizedTarget)) {
        continue;
      }

      // Skip self-loops from loop iteration references (e.g., VideoProducer[segment-1] -> VideoProducer[segment])
      // Instead, we'll show a self-loop indicator on the node
      if (normalizedSource === normalizedTarget) {
        // Mark the producer as having a loop (self-reference)
        const producerNode = nodes.find((n) => n.id === `Producer:${normalizedSource}`);
        if (producerNode && !producerNode.loop) {
          producerNode.loop = "self";
        }
        continue;
      }

      const edgeId = `Producer:${normalizedSource}->Producer:${normalizedTarget}`;
      if (!addedEdges.has(edgeId)) {
        addedEdges.add(edgeId);
        edges.push({
          id: edgeId,
          source: `Producer:${normalizedSource}`,
          target: `Producer:${normalizedTarget}`,
          conditionName: edge.if,
          isConditional,
        });
      }
    }
  }

  // Add edges from Inputs to producers with input dependencies
  for (const producer of producersWithInputDeps) {
    const normalizedProducer = normalizeProducerName(producer);
    const edgeId = `Inputs->Producer:${normalizedProducer}`;
    if (!addedEdges.has(edgeId)) {
      addedEdges.add(edgeId);
      edges.push({
        id: edgeId,
        source: "Inputs",
        target: `Producer:${normalizedProducer}`,
        isConditional: false,
      });
    }
  }

  // Add edges from producers to Outputs for those that produce artifacts
  for (const producer of producersWithOutputs) {
    const normalizedProducer = normalizeProducerName(producer);
    const edgeId = `Producer:${normalizedProducer}->Outputs`;
    if (!addedEdges.has(edgeId)) {
      addedEdges.add(edgeId);
      edges.push({
        id: edgeId,
        source: `Producer:${normalizedProducer}`,
        target: "Outputs",
        isConditional: false,
      });
    }
  }

  // Collect named conditions
  if (doc.conditions) {
    for (const [name, def] of Object.entries(doc.conditions)) {
      conditions.push({ name, definition: def });
    }
  }
}

function normalizeProducerName(name: string): string {
  // Remove loop index suffixes like "[segment]", "[segment-1]", "[0]"
  return name.replace(/\[[^\]]+\]$/, "");
}

interface EdgeEndpoints {
  sourceType: "input" | "producer" | "output" | "unknown";
  sourceProducer?: string;
  targetType: "input" | "producer" | "output" | "unknown";
  targetProducer?: string;
}

function resolveEdgeEndpoints(
  from: string,
  to: string,
  inputNames: Set<string>,
  producerNames: Set<string>,
  artifactNames: Set<string>
): EdgeEndpoints {
  const source = resolveEndpoint(from, inputNames, producerNames, artifactNames);
  const target = resolveEndpoint(to, inputNames, producerNames, artifactNames);
  return {
    sourceType: source.type,
    sourceProducer: source.producer,
    targetType: target.type,
    targetProducer: target.producer,
  };
}

interface EndpointInfo {
  type: "input" | "producer" | "output" | "unknown";
  producer?: string;
}

function resolveEndpoint(
  ref: string,
  inputNames: Set<string>,
  producerNames: Set<string>,
  artifactNames: Set<string>
): EndpointInfo {
  const parts = ref.split(".");

  if (parts.length === 1) {
    const name = normalizeProducerName(parts[0]);
    if (inputNames.has(name)) {
      return { type: "input" };
    }
    if (producerNames.has(name)) {
      return { type: "producer", producer: parts[0] };
    }
    if (artifactNames.has(name)) {
      return { type: "output" };
    }
    // Unknown single reference - might be a derived value, treat as producer
    return { type: "producer", producer: parts[0] };
  }

  const first = parts[0];
  const rest = parts.slice(1).join(".");

  if (first === "Input") {
    return { type: "input" };
  }
  if (first === "Output") {
    return { type: "output" };
  }

  // Producer.Output reference - the source/target is the producer
  const normalizedFirst = normalizeProducerName(first);
  if (producerNames.has(normalizedFirst)) {
    return { type: "producer", producer: first };
  }

  // Artifact reference (e.g., "SegmentVideos[segment]")
  const normalizedRest = normalizeProducerName(rest);
  if (artifactNames.has(normalizedRest) || artifactNames.has(rest)) {
    return { type: "output" };
  }

  return { type: "unknown" };
}

async function parseInputsFile(inputsPath: string): Promise<{ inputs: Array<{ name: string; value: unknown }> }> {
  try {
    if (!existsSync(inputsPath)) {
      return { inputs: [] };
    }
    const content = await fs.readFile(inputsPath, "utf8");
    // Parse YAML - simple key-value extraction
    const lines = content.split("\n");
    const inputs: Array<{ name: string; value: unknown }> = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const colonIndex = trimmed.indexOf(":");
      if (colonIndex > 0) {
        const name = trimmed.slice(0, colonIndex).trim();
        let value: unknown = trimmed.slice(colonIndex + 1).trim();

        // Strip YAML quotes and handle escapes
        if (typeof value === "string") {
          if (value.startsWith('"') && value.endsWith('"')) {
            // Double-quoted: handle escape sequences
            const inner = value.slice(1, -1);
            value = inner
              .replace(/\\n/g, "\n")
              .replace(/\\"/g, '"')
              .replace(/\\\\/g, "\\");
          } else if (value.startsWith("'") && value.endsWith("'")) {
            // Single-quoted: no escape handling in YAML
            value = value.slice(1, -1);
          } else if (value === "true") {
            value = true;
          } else if (value === "false") {
            value = false;
          } else if (value !== "" && !isNaN(Number(value))) {
            value = Number(value);
          }
        }

        inputs.push({ name, value });
      }
    }

    return { inputs };
  } catch {
    return { inputs: [] };
  }
}

interface BuildInfo {
  movieId: string;
  updatedAt: string;
  revision: string | null;
  hasManifest: boolean;
  hasInputsFile: boolean;     // Has builds/{movieId}/inputs.yaml
  displayName: string | null; // User-friendly name from movie-metadata.json
}

interface BuildsListResponse {
  builds: BuildInfo[];
  blueprintFolder: string;
}

interface ArtifactInfo {
  id: string;
  name: string;
  hash: string;
  size: number;
  mimeType: string;
  status: string;
  createdAt: string | null;
}

interface BuildManifestResponse {
  movieId: string;
  revision: string | null;
  inputs: Record<string, unknown>;
  models?: ExtractedModelSelection[];
  artefacts: ArtifactInfo[];
  createdAt: string | null;
}

/**
 * Lists all builds in the builds/ subfolder of the blueprint folder.
 * Sorted by updatedAt (most recent first).
 * Filters out builds that have neither a manifest nor an inputs file.
 */
async function listBuilds(blueprintFolder: string): Promise<BuildsListResponse> {
  const buildsDir = path.join(blueprintFolder, "builds");
  const builds: BuildInfo[] = [];

  try {
    if (!existsSync(buildsDir)) {
      return { builds: [], blueprintFolder };
    }

    const entries = await fs.readdir(buildsDir, { withFileTypes: true });
    const movieDirs = entries.filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("movie-"),
    );

    for (const dir of movieDirs) {
      const movieId = dir.name;
      const movieDir = path.join(buildsDir, movieId);
      const currentPath = path.join(movieDir, "current.json");
      const inputsPath = path.join(movieDir, "inputs.yaml");
      const metadataPath = path.join(movieDir, "movie-metadata.json");

      try {
        const stat = await fs.stat(movieDir);
        const updatedAt = stat.mtime.toISOString();

        let revision: string | null = null;
        let hasManifest = false;

        if (existsSync(currentPath)) {
          const currentContent = await fs.readFile(currentPath, "utf8");
          const current = JSON.parse(currentContent) as { revision?: string; manifestPath?: string | null };
          revision = current.revision ?? null;
          hasManifest = !!current.manifestPath;
        }

        // Check for inputs.yaml
        const hasInputsFile = existsSync(inputsPath);

        // Read displayName from movie-metadata.json
        let displayName: string | null = null;
        if (existsSync(metadataPath)) {
          try {
            const metaContent = await fs.readFile(metadataPath, "utf8");
            const metadata = JSON.parse(metaContent) as MovieMetadata;
            displayName = metadata.displayName ?? null;
          } catch {
            // Ignore parse errors
          }
        }

        // Filter out builds that have neither manifest nor inputs file
        if (!hasManifest && !hasInputsFile) {
          continue;
        }

        builds.push({
          movieId,
          updatedAt,
          revision,
          hasManifest,
          hasInputsFile,
          displayName,
        });
      } catch {
        // Skip builds that can't be read
        continue;
      }
    }

    // Sort by updatedAt descending (most recent first)
    builds.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return { builds, blueprintFolder };
  } catch {
    return { builds: [], blueprintFolder };
  }
}

/**
 * Gets the manifest data for a specific build.
 */
async function getBuildManifest(blueprintFolder: string, movieId: string): Promise<BuildManifestResponse> {
  const movieDir = path.join(blueprintFolder, "builds", movieId);
  const currentPath = path.join(movieDir, "current.json");

  const emptyResponse: BuildManifestResponse = {
    movieId,
    revision: null,
    inputs: {},
    artefacts: [],
    createdAt: null,
  };

  try {
    if (!existsSync(currentPath)) {
      return emptyResponse;
    }

    const currentContent = await fs.readFile(currentPath, "utf8");
    const current = JSON.parse(currentContent) as {
      revision?: string;
      manifestPath?: string | null;
    };

    const revision = current.revision ?? null;

    if (!current.manifestPath) {
      return { ...emptyResponse, revision };
    }

    const manifestPath = path.join(movieDir, current.manifestPath);
    if (!existsSync(manifestPath)) {
      return { ...emptyResponse, revision };
    }

    const manifestContent = await fs.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestContent) as {
      inputs?: Record<string, { payloadDigest?: unknown }>;
      artefacts?: Record<string, {
        hash?: string;
        blob?: { hash: string; size: number; mimeType?: string };
        status?: string;
        createdAt?: string;
      }>;
      createdAt?: string;
    };

    const stat = await fs.stat(manifestPath);

    // Parse inputs - extract values from payloadDigest and clean up names
    const parsedInputs: Record<string, unknown> = {};
    if (manifest.inputs) {
      for (const [key, entry] of Object.entries(manifest.inputs)) {
        // Remove "Input:" prefix if present
        const cleanName = key.startsWith("Input:") ? key.slice(6) : key;
        // Extract value from payloadDigest
        if (entry && typeof entry === "object" && "payloadDigest" in entry) {
          let value = entry.payloadDigest;
          // payloadDigest may contain JSON-encoded strings (e.g., "\"actual string\"")
          // Try to parse it if it's a string that looks like JSON
          if (typeof value === "string") {
            try {
              value = JSON.parse(value);
            } catch {
              // If parsing fails, use the raw string
            }
          }
          parsedInputs[cleanName] = value;
        }
      }
    }

    // Extract model selections from inputs
    const { modelSelections } = extractModelSelectionsFromInputs(parsedInputs);

    // Parse artifacts - extract blob info and clean up names
    const parsedArtifacts: ArtifactInfo[] = [];
    if (manifest.artefacts) {
      for (const [key, entry] of Object.entries(manifest.artefacts)) {
        if (!entry || !entry.blob) continue;

        // Extract name from artifact ID (e.g., "Artifact:Producer.Output" -> "Producer.Output")
        const cleanName = key.startsWith("Artifact:") ? key.slice(9) : key;

        parsedArtifacts.push({
          id: key,
          name: cleanName,
          hash: entry.blob.hash,
          size: entry.blob.size,
          mimeType: entry.blob.mimeType ?? "application/octet-stream",
          status: entry.status ?? "unknown",
          createdAt: entry.createdAt ?? null,
        });
      }
    }

    return {
      movieId,
      revision,
      inputs: parsedInputs,
      models: modelSelections.length > 0 ? modelSelections : undefined,
      artefacts: parsedArtifacts,
      createdAt: manifest.createdAt ?? stat.mtime.toISOString(),
    };
  } catch {
    return emptyResponse;
  }
}

// --- Generation API handlers ---

/**
 * Routes generation API requests to appropriate handlers.
 * Routes:
 *   POST /viewer-api/generate/plan
 *   POST /viewer-api/generate/execute
 *   GET  /viewer-api/generate/jobs
 *   GET  /viewer-api/generate/jobs/:jobId
 *   GET  /viewer-api/generate/jobs/:jobId/stream
 *   POST /viewer-api/generate/jobs/:jobId/cancel
 */
async function handleGenerateRequest(
  req: IncomingMessage,
  res: ServerResponse,
  segments: string[]
): Promise<boolean> {
  const action = segments[0];

  switch (action) {
    case "plan": {
      if (req.method !== "POST") {
        sendMethodNotAllowed(res);
        return true;
      }
      return handlePlanRequest(req, res);
    }

    case "execute": {
      if (req.method !== "POST") {
        sendMethodNotAllowed(res);
        return true;
      }
      return handleExecuteRequest(req, res);
    }

    case "jobs": {
      // /viewer-api/generate/jobs
      if (segments.length === 1) {
        if (req.method !== "GET") {
          sendMethodNotAllowed(res);
          return true;
        }
        return handleJobsListRequest(req, res);
      }

      // /viewer-api/generate/jobs/:jobId
      const jobId = decodeURIComponent(segments[1]);

      // /viewer-api/generate/jobs/:jobId/stream
      if (segments.length === 3 && segments[2] === "stream") {
        if (req.method !== "GET") {
          sendMethodNotAllowed(res);
          return true;
        }
        return handleStreamRequest(req, res, jobId);
      }

      // /viewer-api/generate/jobs/:jobId/cancel
      if (segments.length === 3 && segments[2] === "cancel") {
        if (req.method !== "POST") {
          sendMethodNotAllowed(res);
          return true;
        }
        return handleCancelRequest(req, res, jobId);
      }

      // /viewer-api/generate/jobs/:jobId
      if (segments.length === 2) {
        if (req.method !== "GET") {
          sendMethodNotAllowed(res);
          return true;
        }
        return handleJobStatusRequest(req, res, jobId);
      }

      return respondNotFound(res);
    }

    default:
      return respondNotFound(res);
  }
}

/**
 * Streams a blob file from a blueprint build.
 */
async function streamBuildBlob(
  req: IncomingMessage,
  res: ServerResponse,
  blueprintFolder: string,
  movieId: string,
  hash: string
): Promise<void> {
  const blobsDir = path.join(blueprintFolder, "builds", movieId, "blobs");
  const prefix = hash.slice(0, 2);

  // Try different possible file paths (with and without extension)
  const possiblePaths = [
    path.join(blobsDir, prefix, hash),
  ];

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
