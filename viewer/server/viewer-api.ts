import { createReadStream, existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Connect } from "vite";
import {
  loadYamlBlueprintTree,
  type BlueprintTreeNode,
  type BlueprintInputDefinition,
  type BlueprintArtefactDefinition,
} from "@gorenku/core";

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
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return true;
  }

  const action = segments[0];

  const catalogRoot = url.searchParams.get("catalog") ?? undefined;

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
    default:
      return respondNotFound(res);
  }
}

async function parseBlueprintToGraph(blueprintPath: string, catalogRoot?: string): Promise<BlueprintGraphData> {
  const { root } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });
  return convertTreeToGraph(root);
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

        // Try to parse as JSON or leave as string
        if (value === "true") value = true;
        else if (value === "false") value = false;
        else if (value !== "" && !isNaN(Number(value))) value = Number(value);

        inputs.push({ name, value });
      }
    }

    return { inputs };
  } catch {
    return { inputs: [] };
  }
}
