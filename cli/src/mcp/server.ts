import { Buffer } from 'node:buffer';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { URL } from 'node:url';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Variables } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';
import type { ReadResourceResult, ListResourcesResult, Resource } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { stringify as stringifyYaml } from 'yaml';
import type { Manifest } from '@renku/core';
import { runGenerate, type GenerateResult } from '../commands/generate.js';
import { runViewerView } from '../commands/viewer.js';
import { readCliConfig } from '../lib/cli-config.js';
import { INPUT_FILE_NAME } from '../lib/input-files.js';
import { expandPath } from '../lib/path.js';

const console = globalThis.console;

const TIMELINE_ARTEFACT_ID = 'Artifact:TimelineComposer.Timeline';

const generateStorySchema = z.object({
  inquiryPrompt: z.string().min(1, 'Inquiry prompt is required.'),
  durationSeconds: z.coerce.number().int().min(1, 'Duration must be a positive number.'),
  numSegments: z.coerce.number().int().min(1, 'NumOfSegments must be a positive integer.'),
  style: z.string().min(1, 'Image style is required.'),
  voiceId: z.string().min(1, 'Voice ID is required.'),
  numImagesPerNarrative: z.coerce.number().int().min(1).optional(),
  size: z.string().optional(),
  aspectRatio: z.string().optional(),
  audience: z.string().optional(),
  emotion: z.string().optional(),
  blueprint: z.string().optional(),
  openViewer: z.boolean().optional(),
});

export interface CreateMcpServerOptions {
  storageRoot: string;
  storageBasePath: string;
  blueprintDir: string;
  defaultBlueprintPath: string;
  openViewerDefault: boolean;
  packageInfo: {
    name: string;
    version: string;
  };
  cliConfigPath: string;
}

export interface McpServerDeps {
  runGenerate?: typeof runGenerate;
  runViewerView?: typeof runViewerView;
  readCliConfig?: typeof readCliConfig;
}

export function createMcpServer(
  options: CreateMcpServerOptions,
  deps: McpServerDeps = {},
): McpServer {
  const runGenerateImpl = deps.runGenerate ?? runGenerate;
  const runViewerImpl = deps.runViewerView ?? runViewerView;
  const readCliConfigImpl = deps.readCliConfig ?? readCliConfig;

  const movieStore = new MovieStorage(options.storageRoot, options.storageBasePath);
  const instructions = buildInstructions(options);

  const server = new McpServer(
    {
      name: `${options.packageInfo.name}-mcp`,
      version: options.packageInfo.version,
    },
    {
      instructions,
    },
  );

  const voices = [
    { 
      voice: "English_CaptivatingStoryteller", 
      description: "A male voice great for narrating history, in English."
    },
    {
      voice: "English_Wiselady",
      description: "A female voice great for telling stories, in English."
    },
    {
      voice: "English_WiseScholar",
      description: "A male voice, good for telling stories in English."
    }
  ]

  const generateStoryDescription = `
Creates a Renku movie using the configured blueprint. Provide duration, segments, image style, and narration voice.
Always default the duration to 30 seconds, and each segment is 10 seconds. Using 2 images per segment gives a more engaging experience, so use that as default.
If the user says something along the lines of a detailed, extended narration, then the duration can be longer. 
Using long duration will increase generation time and also the costs. For longer than 30 seconds, always ask the user if they are ok with the generation time and costs before proceeding.
The voices available are given below. Choose based on historical narrations versus more contemporary, pop-culture type narrations.
${voices.map(v => `- ${v.voice}: ${v.description}`).join('\n')}
Before you start the generation, always provide a summary for what you are generating including duration, number of segments, and images per segment, the narration voice and the image style
`;

  registerBlueprintResources(server, options.blueprintDir);
  registerMovieResources(server, movieStore);

  server.registerTool(
    'generate_story',
    {
      title: 'Generate an educational movie timeline',
      description: generateStoryDescription,
      inputSchema: generateStorySchema,
    },
    async (args: z.infer<typeof generateStorySchema>) => {
      const resolvedBlueprint = await resolveBlueprintPath(
        args.blueprint,
        options.defaultBlueprintPath,
        options.blueprintDir,
      );
      const inputsPath = await writeInputsFile(args);
      const shouldOpenViewer = args.openViewer ?? options.openViewerDefault;
      await server.sendLoggingMessage({
        level: 'info',
        data: { message: `generate_story invoked (blueprint=${pathLabel(resolvedBlueprint, options.blueprintDir)})` },
      });

      let result: GenerateResult | undefined;
      try {
        result = await runGenerateImpl({
          inputsPath,
          blueprint: resolvedBlueprint,
          nonInteractive: true,
          mode: 'log',
          logLevel: 'info',
        });
      } finally {
        await cleanupTempInputs(inputsPath);
      }

      const manifestPath = result.manifestPath;
      if (!manifestPath) {
        throw new Error('Build manifest not produced. Ensure the blueprint executes without dry-run.');
      }

      let viewerUrl: string | undefined;
      if (shouldOpenViewer) {
        try {
          await runViewerImpl({ movieId: result.storageMovieId });
          const cfg = await readCliConfigImpl(options.cliConfigPath);
          if (cfg?.viewer?.host && cfg.viewer?.port) {
            viewerUrl = `http://${cfg.viewer.host}:${cfg.viewer.port}/movies/${encodeURIComponent(result.storageMovieId)}`;
          }
        } catch (error) {
          console.warn('Viewer launch failed:', error instanceof Error ? error.message : String(error));
        }
      }

      const artefactUris = await buildArtefactUris(manifestPath, result.storageMovieId);
      const timelineUri = buildTimelineUri(result.storageMovieId);
      const inputsUri = buildInputsUri(result.storageMovieId);

      await server.sendResourceListChanged();
      await server.sendLoggingMessage({
        level: 'info',
        data: { message: `Movie ${result.movieId} created`, movieId: result.movieId },
      });

      const summaryLines = [
        `Movie ${result.movieId} created.`,
        viewerUrl
          ? `Open viewer: ${viewerUrl}`
          : `Viewer not launched automatically. Run "renku viewer:view --movieId=${result.storageMovieId}" or start the viewer and open /movies/${result.storageMovieId}.`,
        `Timeline resource: ${timelineUri}`,
        `Inputs resource: ${inputsUri}`,
      ];

      return {
        content: [
          {
            type: 'text',
            text: summaryLines.join('\n'),
          },
        ],
        _meta: {
          movieId: result.movieId,
          storageMovieId: result.storageMovieId,
          planPath: result.planPath,
          manifestPath,
          timelineUri,
          inputsUri,
          artefactUris,
          viewerUrl,
        },
      };
    },
  );

  return server;
}

function buildInstructions(options: CreateMcpServerOptions): string {
  return [
    'Renku MCP server exposes a single tool, `generate_story`, which orchestrates the Renku CLI pipeline.',
    `Default blueprint: ${pathLabel(options.defaultBlueprintPath, options.blueprintDir)}`,
    'Resources:',
    '- renku://blueprints/... for blueprint YAML files',
    '- renku://movies/{movieId}/inputs for the inputs.yaml captured per movie',
    '- renku://movies/{movieId}/timeline for the generated timeline JSON',
    '- renku://movies/{movieId}/artefacts/{canonicalId} for any artefact stored in the manifest',
  ].join('\n');
}

function registerBlueprintResources(server: McpServer, blueprintDir: string): void {
  const template = new ResourceTemplate('renku://blueprints/{+path}', {
    list: async (): Promise<ListResourcesResult> => {
      const files = await listBlueprintFiles(blueprintDir);
      return {
        resources: files.map((entry): Resource => ({
          name: entry.slug,
          uri: buildBlueprintUri(entry.slug),
          description: `Blueprint file at ${entry.absolutePath}`,
          mimeType: 'text/yaml',
        })),
      };
    },
  });

  server.registerResource(
    'blueprints',
    template,
    {
      title: 'Renku Blueprints',
      description: 'YAML blueprints available under catalog/blueprints.',
      mimeType: 'text/yaml',
    },
    async (uri: URL) => {
      const targetPath = decodeBlueprintUri(uri, blueprintDir);
      const contents = await readFile(targetPath, 'utf8');
      return wrapTextResource(uri.toString(), contents, 'text/yaml');
    },
  );
}

function registerMovieResources(server: McpServer, movieStore: MovieStorage): void {
  const inputsTemplate = new ResourceTemplate('renku://movies/{movieId}/inputs', {
    list: async (): Promise<ListResourcesResult> => movieStore.listInputs(),
  });

  server.registerResource(
    'movie-inputs',
    inputsTemplate,
    {
      title: 'Movie Inputs',
      description: 'Inputs YAML captured for each movie.',
      mimeType: 'text/yaml',
    },
    async (uri: URL, variables) => {
      const movieId = readTemplateVar(variables, 'movieId');
      return movieStore.readInputs(movieId, uri.toString());
    },
  );

  const timelineTemplate = new ResourceTemplate('renku://movies/{movieId}/timeline', {
    list: async (): Promise<ListResourcesResult> => movieStore.listTimelines(),
  });

  server.registerResource(
    'movie-timeline',
    timelineTemplate,
    {
      title: 'Movie Timeline',
      description: 'Rendered timeline JSON from the manifest timeline artefact.',
      mimeType: 'application/json',
    },
    async (_uri: URL, variables) => {
      return movieStore.readTimeline(readTemplateVar(variables, 'movieId'));
    },
  );

  const artefactTemplate = new ResourceTemplate('renku://movies/{movieId}/artefacts/{+artefactId}', {
    list: async (): Promise<ListResourcesResult> => movieStore.listArtefacts(),
  });

  server.registerResource(
    'movie-artefacts',
    artefactTemplate,
    {
      title: 'Movie Artefacts',
      description: 'Manifest artefacts keyed by canonical node IDs.',
    },
    async (_uri: URL, variables) => {
      const movieId = readTemplateVar(variables, 'movieId');
      const artefactId = readTemplateVar(variables, 'artefactId');
      return movieStore.readArtefact(movieId, artefactId);
    },
  );
}

async function resolveBlueprintPath(
  requested: string | undefined,
  defaultBlueprint: string,
  blueprintDir: string,
): Promise<string> {
  if (!requested) {
    return defaultBlueprint;
  }
  if (requested.startsWith('~/') || isAbsolute(requested)) {
    const expanded = expandPath(requested);
    if (!(await pathExists(expanded))) {
      throw new Error(`Blueprint "${requested}" not found.`);
    }
    return expanded;
  }
  const joined = resolve(blueprintDir, requested);
  if (!(await pathExists(joined))) {
    throw new Error(`Blueprint "${requested}" not found under ${blueprintDir}.`);
  }
  return joined;
}

async function writeInputsFile(args: z.infer<typeof generateStorySchema>): Promise<string> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'renku-mcp-'));
  const target = join(tmpDir, INPUT_FILE_NAME);
  const doc: Record<string, unknown> = {
    InquiryPrompt: args.inquiryPrompt,
    Duration: args.durationSeconds,
    NumOfSegments: args.numSegments,
    Style: args.style,
    VoiceId: args.voiceId,
  };
  if (args.numImagesPerNarrative !== undefined) {
    doc.NumOfImagesPerNarrative = args.numImagesPerNarrative;
  }
  if (args.size !== undefined) {
    doc.Size = args.size;
  }
  if (args.aspectRatio !== undefined) {
    doc.AspectRatio = args.aspectRatio;
  }
  if (args.audience !== undefined) {
    doc.Audience = args.audience;
  }
  if (args.emotion !== undefined) {
    doc.Emotion = args.emotion;
  }
  const payload = stringifyYaml({ inputs: doc });
  await writeFile(target, payload, 'utf8');
  return target;
}

async function cleanupTempInputs(inputsPath: string): Promise<void> {
  try {
    await rm(dirname(inputsPath), { recursive: true, force: true });
  } catch {
    // ignore
  }
}

async function buildArtefactUris(manifestPath: string, storageMovieId: string): Promise<string[]> {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
  return Object.keys(manifest.artefacts ?? {}).map((id) => buildArtefactUri(storageMovieId, id));
}

export class MovieStorage {
  private readonly root: string;
  private readonly basePath: string;

  constructor(root: string, basePath: string) {
    this.root = root;
    this.basePath = basePath;
  }

  private resolveMovieDir(movieId: string): string {
    return resolve(this.root, this.basePath, movieId);
  }

  async listInputs(): Promise<ListResourcesResult> {
    const movieIds = await this.listMovieIds();
    return {
      resources: movieIds.map((movieId): Resource => ({
        name: `${movieId}/inputs`,
        uri: buildInputsUri(movieId),
        mimeType: 'text/yaml',
      })),
    };
  }

  async listTimelines(): Promise<ListResourcesResult> {
    const manifests = await this.listMoviesWithManifests();
    return {
      resources: manifests.map((movieId) => ({
        name: `${movieId}/timeline`,
        uri: buildTimelineUri(movieId),
        mimeType: 'application/json',
      })),
    };
  }

  async listArtefacts(): Promise<ListResourcesResult> {
    const movieIds = await this.listMovieIds();
    const resources: Resource[] = [];
    for (const movieId of movieIds) {
      const manifest = await this.tryLoadManifest(movieId);
      if (!manifest) {
        continue;
      }
      for (const artefactId of Object.keys(manifest.artefacts ?? {})) {
        resources.push({
          name: `${movieId}:${artefactId}`,
          uri: buildArtefactUri(movieId, artefactId),
        });
      }
    }
    return { resources };
  }

  async readInputs(movieId: string, uri: string): Promise<ReadResourceResult> {
    const movieDir = this.resolveMovieDir(movieId);
    const inputsPath = join(movieDir, INPUT_FILE_NAME);
    const contents = await readFile(inputsPath, 'utf8');
    return wrapTextResource(uri, contents, 'text/yaml');
  }

  async readTimeline(movieId: string): Promise<ReadResourceResult> {
    const manifest = await this.loadManifest(movieId);
    const artefact = manifest.artefacts[TIMELINE_ARTEFACT_ID];
    if (!artefact) {
      throw new Error(`Timeline artefact missing for movie ${movieId}`);
    }
    if (artefact.blob?.hash) {
      const payload = await this.readBlob(movieId, artefact.blob.hash, artefact.blob.mimeType);
      const asText = toMaybeText(payload, artefact.blob.mimeType);
      if (asText !== undefined) {
        return wrapTextResource(buildTimelineUri(movieId), asText, artefact.blob.mimeType ?? 'application/json');
      }
      return wrapBlobResource(buildTimelineUri(movieId), payload, artefact.blob.mimeType ?? 'application/json');
    }
    throw new Error('Timeline artefact has no blob payload.');
  }

  async readArtefact(movieId: string, encodedArtefactId: string): Promise<ReadResourceResult> {
    const artefactId = decodeURIComponent(encodedArtefactId);
    const manifest = await this.loadManifest(movieId);
    const record = manifest.artefacts[artefactId];
    if (!record) {
      throw new Error(`Artefact "${artefactId}" not found for movie ${movieId}.`);
    }
    const uri = buildArtefactUri(movieId, artefactId);
    if (record.blob) {
      const data = await this.readBlob(movieId, record.blob.hash, record.blob.mimeType);
      const asText = toMaybeText(data, record.blob.mimeType);
      if (asText !== undefined) {
        return wrapTextResource(uri, asText, record.blob.mimeType ?? 'text/plain');
      }
      return wrapBlobResource(uri, data, record.blob.mimeType ?? 'application/octet-stream');
    }
    throw new Error(`Artefact "${artefactId}" has no blob payload.`);
  }

  private async listMovieIds(): Promise<string[]> {
    const buildsRoot = resolve(this.root, this.basePath);
    try {
      const entries = await readdir(buildsRoot, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    } catch {
      return [];
    }
  }

  private async listMoviesWithManifests(): Promise<string[]> {
    const movieIds = await this.listMovieIds();
    const result: string[] = [];
    for (const movieId of movieIds) {
      const pointerPath = join(this.resolveMovieDir(movieId), 'current.json');
      if (await pathExists(pointerPath)) {
        result.push(movieId);
      }
    }
    return result;
  }

  private async loadManifest(movieId: string): Promise<Manifest> {
    const manifest = await this.tryLoadManifest(movieId);
    if (!manifest) {
      throw new Error(`Manifest not found for movie ${movieId}`);
    }
    return manifest;
  }

  private async tryLoadManifest(movieId: string): Promise<Manifest | null> {
    const movieDir = this.resolveMovieDir(movieId);
    const pointerPath = join(movieDir, 'current.json');
    if (!(await pathExists(pointerPath))) {
      return null;
    }
    const pointer = JSON.parse(await readFile(pointerPath, 'utf8')) as { manifestPath?: string | null };
    if (!pointer.manifestPath) {
      return null;
    }
    const manifestFile = resolve(movieDir, pointer.manifestPath);
    if (!(await pathExists(manifestFile))) {
      return null;
    }
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as Manifest;
    return manifest;
  }

  private async readBlob(movieId: string, hash: string, mimeType?: string | null): Promise<Buffer> {
    const prefix = hash.slice(0, 2);
    const fileName = formatBlobFileName(hash, mimeType ?? undefined);
    const primary = join(this.resolveMovieDir(movieId), 'blobs', prefix, fileName);
    if (await pathExists(primary)) {
      const buf = await readFile(primary);
      return Buffer.from(buf);
    }
    const legacy = join(this.resolveMovieDir(movieId), 'blobs', prefix, hash);
    const buf = await readFile(legacy);
    return Buffer.from(buf);
  }
}

function toMaybeText(buffer: Buffer, mimeType?: string): string | undefined {
  const type = (mimeType ?? '').toLowerCase();
  if (type.startsWith('text/') || type === 'application/json') {
    return type === 'application/json'
      ? formatJson(buffer.toString('utf8'))
      : buffer.toString('utf8');
  }
  return undefined;
}

function wrapBlobResource(uri: string, buffer: Buffer, mimeType: string): ReadResourceResult {
  return {
    contents: [
      {
        uri,
        blob: buffer.toString('base64'),
        mimeType,
      },
    ],
  };
}

async function listBlueprintFiles(rootDir: string): Promise<{ slug: string; absolutePath: string }[]> {
  const results: { slug: string; absolutePath: string }[] = [];
  async function walk(current: string) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.yaml')) {
        const rel = relative(rootDir, fullPath);
        const slug = rel ? rel.split('\\').join('/') : entry.name;
        results.push({ slug, absolutePath: fullPath });
      }
    }
  }
  await walk(rootDir);
  results.sort((a, b) => a.slug.localeCompare(b.slug));
  return results;
}

function buildBlueprintUri(slug: string): string {
  const normalized = slug.split('\\').join('/');
  return `renku://blueprints/${normalized}`;
}

function decodeBlueprintUri(uri: URL, blueprintDir: string): string {
  const slug = uri.pathname.replace(/^\/+/, '');
  if (!slug) {
    throw new Error('Blueprint URI missing path.');
  }
  return resolve(blueprintDir, slug);
}

function buildInputsUri(movieId: string): string {
  return `renku://movies/${encodeURIComponent(movieId)}/inputs`;
}

function buildTimelineUri(movieId: string): string {
  return `renku://movies/${encodeURIComponent(movieId)}/timeline`;
}

function buildArtefactUri(movieId: string, artefactId: string): string {
  return `renku://movies/${encodeURIComponent(movieId)}/artefacts/${encodeURIComponent(artefactId)}`;
}

function readTemplateVar(variables: Variables, key: string): string {
  const raw = variables[key];
  if (raw === undefined) {
    throw new Error(`Missing template variable: ${key}`);
  }
  return Array.isArray(raw) ? raw[0] ?? '' : raw;
}

function wrapTextResource(uri: string, text: string, mimeType: string): ReadResourceResult {
  return {
    contents: [
      {
        uri,
        text,
        mimeType,
      },
    ],
  };
}

function formatJson(raw: string): string {
  try {
    const data = JSON.parse(raw);
    return JSON.stringify(data, null, 2);
  } catch {
    return raw;
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

function formatBlobFileName(hash: string, mimeType?: string): string {
  const extension = inferBlobExtension(mimeType);
  if (!extension) {
    return hash;
  }
  if (hash.endsWith(`.${extension}`)) {
    return hash;
  }
  return `${hash}.${extension}`;
}

function inferBlobExtension(mimeType?: string): string | null {
  if (!mimeType) {
    return null;
  }
  const normalized = mimeType.toLowerCase();
  const map: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/flac': 'flac',
    'audio/aac': 'aac',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/x-matroska': 'mkv',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  if (map[normalized]) {
    return map[normalized];
  }
  if (normalized.startsWith('audio/')) {
    return normalized.slice('audio/'.length);
  }
  if (normalized.startsWith('video/')) {
    return normalized.slice('video/'.length);
  }
  if (normalized.startsWith('image/')) {
    return normalized.slice('image/'.length);
  }
  return null;
}

function pathLabel(absolutePath: string, blueprintDir: string): string {
  const rel = relative(blueprintDir, absolutePath);
  if (rel && !rel.startsWith('..')) {
    return rel.split('\\').join('/');
  }
  return absolutePath;
}
