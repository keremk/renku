import { resolve, dirname, extname } from 'node:path';
import { mkdir, rm, symlink, readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { getDefaultCliConfigPath, getProjectLocalStorage, readCliConfig } from '../lib/cli-config.js';
import { resolveTargetMovieId } from '../lib/movie-id-utils.js';
import { loadCurrentManifest } from '../lib/artifacts-view.js';
import { loadBlueprintBundle } from '../lib/blueprint-loader/index.js';
import { createStorageContext, createMovieMetadataService } from '@gorenku/core';
import { createProviderRegistry, loadModelCatalog, createProviderError, SdkErrorCode } from '@gorenku/providers';

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const DEFAULT_FPS = 30;
const OUTPUT_FILENAME = 'FinalVideo.mp4';
const TIMELINE_ARTEFACT_ID = 'Artifact:TimelineComposer.Timeline';
const TRANSCRIPTION_ARTEFACT_ID = 'Artifact:TranscriptionProducer.Transcription';

export type ExporterType = 'remotion' | 'ffmpeg';

export interface ExportOptions {
  movieId?: string;
  useLast?: boolean;
  width?: number;
  height?: number;
  fps?: number;
  exporter?: ExporterType;
  inputsPath?: string;
}

/**
 * Configuration file schema for export settings.
 * Loaded from YAML file specified via --in/--inputs flag.
 */
export interface ExportConfigFile {
  width?: number;
  height?: number;
  fps?: number;
  exporter?: ExporterType;
  // FFmpeg-specific settings
  preset?: string;
  crf?: number;
  audioBitrate?: string;
  // Subtitle settings (nested)
  subtitles?: {
    font?: string;
    fontSize?: number;
    fontBaseColor?: string;
    fontHighlightColor?: string;
    backgroundColor?: string;
    backgroundOpacity?: number;
    bottomMarginPercent?: number;
    maxWordsPerLine?: number;
    highlightEffect?: boolean;
  };
}

export interface ExportResult {
  movieId: string;
  outputPath: string;
  artifactsPath: string;
  width: number;
  height: number;
  fps: number;
  exporter: ExporterType;
}

interface SubtitleConfig {
  font?: string;
  fontSize?: number;
  fontBaseColor?: string;
  fontHighlightColor?: string;
  backgroundColor?: string;
  backgroundOpacity?: number;
  bottomMarginPercent?: number;
  maxWordsPerLine?: number;
  highlightEffect?: boolean;
}

/**
 * Extracts subtitle configuration from manifest inputs.
 * The manifest stores VideoExporter config as flattened inputs like:
 * - Input:VideoExporter.subtitles.font
 * - Input:VideoExporter.subtitles.fontSize
 * etc.
 */
function extractSubtitleConfig(
  manifest: { inputs: Record<string, { payloadDigest: string }> }
): SubtitleConfig | undefined {
  const prefix = 'Input:VideoExporter.subtitles.';
  const subtitleInputs = Object.entries(manifest.inputs).filter(([key]) =>
    key.startsWith(prefix)
  );

  if (subtitleInputs.length === 0) {
    return undefined;
  }

  const config: SubtitleConfig = {};

  for (const [key, entry] of subtitleInputs) {
    const fieldName = key.slice(prefix.length);
    // payloadDigest is JSON-stringified, so we parse it to get the actual value
    const value = JSON.parse(entry.payloadDigest);

    switch (fieldName) {
      case 'font':
        if (typeof value === 'string') {
          config.font = value;
        }
        break;
      case 'fontSize':
        if (typeof value === 'number') {
          config.fontSize = value;
        }
        break;
      case 'fontBaseColor':
        if (typeof value === 'string') {
          config.fontBaseColor = value;
        }
        break;
      case 'fontHighlightColor':
        if (typeof value === 'string') {
          config.fontHighlightColor = value;
        }
        break;
      case 'backgroundColor':
        if (typeof value === 'string') {
          config.backgroundColor = value;
        }
        break;
      case 'backgroundOpacity':
        if (typeof value === 'number') {
          config.backgroundOpacity = value;
        }
        break;
      case 'bottomMarginPercent':
        if (typeof value === 'number') {
          config.bottomMarginPercent = value;
        }
        break;
      case 'maxWordsPerLine':
        if (typeof value === 'number') {
          config.maxWordsPerLine = value;
        }
        break;
      case 'highlightEffect':
        if (typeof value === 'boolean') {
          config.highlightEffect = value;
        }
        break;
    }
  }

  return Object.keys(config).length > 0 ? config : undefined;
}

/** Known keys in the export config file */
const KNOWN_EXPORT_CONFIG_KEYS = new Set([
  'width',
  'height',
  'fps',
  'exporter',
  'preset',
  'crf',
  'audioBitrate',
  'subtitles',
]);

/** Known keys within the subtitles object */
const KNOWN_SUBTITLE_KEYS = new Set([
  'font',
  'fontSize',
  'fontBaseColor',
  'fontHighlightColor',
  'backgroundColor',
  'backgroundOpacity',
  'bottomMarginPercent',
  'maxWordsPerLine',
  'highlightEffect',
]);

/**
 * Loads and validates export configuration from a YAML file.
 * Throws on unknown keys to catch configuration errors early.
 */
export async function loadExportConfig(filePath: string): Promise<ExportConfigFile> {
  const extension = extname(filePath).toLowerCase();
  if (extension !== '.yaml' && extension !== '.yml') {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      `Export config file must be YAML (*.yaml or *.yml). Received: ${filePath}`,
      { kind: 'user_input', causedByUser: true }
    );
  }

  const contents = await readFile(filePath, 'utf8');
  const parsed = parseYaml(contents) as Record<string, unknown>;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      `Export config file must contain a YAML object. File: ${filePath}`,
      { kind: 'user_input', causedByUser: true }
    );
  }

  // Check for unknown keys at top level
  const unknownKeys: string[] = [];
  for (const key of Object.keys(parsed)) {
    if (!KNOWN_EXPORT_CONFIG_KEYS.has(key)) {
      unknownKeys.push(key);
    }
  }

  // Check for unknown keys in subtitles
  if (parsed.subtitles && typeof parsed.subtitles === 'object') {
    const subtitles = parsed.subtitles as Record<string, unknown>;
    for (const key of Object.keys(subtitles)) {
      if (!KNOWN_SUBTITLE_KEYS.has(key)) {
        unknownKeys.push(`subtitles.${key}`);
      }
    }
  }

  if (unknownKeys.length > 0) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      `Unknown keys in export config: [${unknownKeys.join(', ')}]\n` +
      `Valid keys are: ${[...KNOWN_EXPORT_CONFIG_KEYS].join(', ')}\n` +
      `Valid subtitles keys are: ${[...KNOWN_SUBTITLE_KEYS].join(', ')}`,
      { kind: 'user_input', causedByUser: true }
    );
  }

  // Validate and extract known fields
  const config: ExportConfigFile = {};

  if (parsed.width !== undefined) {
    if (typeof parsed.width !== 'number') {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Export config: 'width' must be a number, got ${typeof parsed.width}`,
        { kind: 'user_input', causedByUser: true }
      );
    }
    config.width = parsed.width;
  }

  if (parsed.height !== undefined) {
    if (typeof parsed.height !== 'number') {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Export config: 'height' must be a number, got ${typeof parsed.height}`,
        { kind: 'user_input', causedByUser: true }
      );
    }
    config.height = parsed.height;
  }

  if (parsed.fps !== undefined) {
    if (typeof parsed.fps !== 'number') {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Export config: 'fps' must be a number, got ${typeof parsed.fps}`,
        { kind: 'user_input', causedByUser: true }
      );
    }
    config.fps = parsed.fps;
  }

  if (parsed.exporter !== undefined) {
    if (parsed.exporter !== 'remotion' && parsed.exporter !== 'ffmpeg') {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Export config: 'exporter' must be "remotion" or "ffmpeg", got "${parsed.exporter}"`,
        { kind: 'user_input', causedByUser: true }
      );
    }
    config.exporter = parsed.exporter;
  }

  if (parsed.preset !== undefined) {
    if (typeof parsed.preset !== 'string') {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Export config: 'preset' must be a string, got ${typeof parsed.preset}`,
        { kind: 'user_input', causedByUser: true }
      );
    }
    config.preset = parsed.preset;
  }

  if (parsed.crf !== undefined) {
    if (typeof parsed.crf !== 'number') {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Export config: 'crf' must be a number, got ${typeof parsed.crf}`,
        { kind: 'user_input', causedByUser: true }
      );
    }
    config.crf = parsed.crf;
  }

  if (parsed.audioBitrate !== undefined) {
    if (typeof parsed.audioBitrate !== 'string') {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Export config: 'audioBitrate' must be a string, got ${typeof parsed.audioBitrate}`,
        { kind: 'user_input', causedByUser: true }
      );
    }
    config.audioBitrate = parsed.audioBitrate;
  }

  if (parsed.subtitles !== undefined) {
    if (typeof parsed.subtitles !== 'object' || parsed.subtitles === null) {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Export config: 'subtitles' must be an object, got ${typeof parsed.subtitles}`,
        { kind: 'user_input', causedByUser: true }
      );
    }
    config.subtitles = validateSubtitleConfig(parsed.subtitles as Record<string, unknown>);
  }

  return config;
}

function validateSubtitleConfig(raw: Record<string, unknown>): SubtitleConfig {
  const config: SubtitleConfig = {};

  if (raw.font !== undefined) {
    if (typeof raw.font !== 'string') {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Export config: 'subtitles.font' must be a string, got ${typeof raw.font}`,
        { kind: 'user_input', causedByUser: true }
      );
    }
    config.font = raw.font;
  }

  if (raw.fontSize !== undefined) {
    if (typeof raw.fontSize !== 'number') {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Export config: 'subtitles.fontSize' must be a number, got ${typeof raw.fontSize}`,
        { kind: 'user_input', causedByUser: true }
      );
    }
    config.fontSize = raw.fontSize;
  }

  if (raw.fontBaseColor !== undefined) {
    if (typeof raw.fontBaseColor !== 'string') {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Export config: 'subtitles.fontBaseColor' must be a string, got ${typeof raw.fontBaseColor}`,
        { kind: 'user_input', causedByUser: true }
      );
    }
    config.fontBaseColor = raw.fontBaseColor;
  }

  if (raw.fontHighlightColor !== undefined) {
    if (typeof raw.fontHighlightColor !== 'string') {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Export config: 'subtitles.fontHighlightColor' must be a string, got ${typeof raw.fontHighlightColor}`,
        { kind: 'user_input', causedByUser: true }
      );
    }
    config.fontHighlightColor = raw.fontHighlightColor;
  }

  if (raw.backgroundColor !== undefined) {
    if (typeof raw.backgroundColor !== 'string') {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Export config: 'subtitles.backgroundColor' must be a string, got ${typeof raw.backgroundColor}`,
        { kind: 'user_input', causedByUser: true }
      );
    }
    config.backgroundColor = raw.backgroundColor;
  }

  if (raw.backgroundOpacity !== undefined) {
    if (typeof raw.backgroundOpacity !== 'number') {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Export config: 'subtitles.backgroundOpacity' must be a number, got ${typeof raw.backgroundOpacity}`,
        { kind: 'user_input', causedByUser: true }
      );
    }
    config.backgroundOpacity = raw.backgroundOpacity;
  }

  if (raw.bottomMarginPercent !== undefined) {
    if (typeof raw.bottomMarginPercent !== 'number') {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Export config: 'subtitles.bottomMarginPercent' must be a number, got ${typeof raw.bottomMarginPercent}`,
        { kind: 'user_input', causedByUser: true }
      );
    }
    config.bottomMarginPercent = raw.bottomMarginPercent;
  }

  if (raw.maxWordsPerLine !== undefined) {
    if (typeof raw.maxWordsPerLine !== 'number') {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Export config: 'subtitles.maxWordsPerLine' must be a number, got ${typeof raw.maxWordsPerLine}`,
        { kind: 'user_input', causedByUser: true }
      );
    }
    config.maxWordsPerLine = raw.maxWordsPerLine;
  }

  if (raw.highlightEffect !== undefined) {
    if (typeof raw.highlightEffect !== 'boolean') {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Export config: 'subtitles.highlightEffect' must be a boolean, got ${typeof raw.highlightEffect}`,
        { kind: 'user_input', causedByUser: true }
      );
    }
    config.highlightEffect = raw.highlightEffect;
  }

  return config;
}

/**
 * Merges subtitle configs with config file taking priority over manifest.
 * Returns undefined if both are undefined.
 */
function mergeSubtitleConfigs(
  manifestConfig: SubtitleConfig | undefined,
  fileConfig: SubtitleConfig | undefined,
): SubtitleConfig | undefined {
  if (!manifestConfig && !fileConfig) {
    return undefined;
  }

  // Config file values take priority over manifest values
  return {
    ...manifestConfig,
    ...fileConfig,
  };
}

export async function runExport(options: ExportOptions): Promise<ExportResult> {
  const configPath = getDefaultCliConfigPath();
  const globalConfig = await readCliConfig(configPath);
  if (!globalConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }

  // Use project-local storage (cwd)
  const projectStorage = getProjectLocalStorage();
  const effectiveConfig = { ...globalConfig, storage: projectStorage };

  const storageMovieId = await resolveTargetMovieId({
    explicitMovieId: options.movieId,
    useLast: Boolean(options.useLast),
    cliConfig: effectiveConfig,
  });

  // Load movie metadata to get the blueprint path
  const storageContext = createStorageContext({
    kind: 'local',
    rootDir: projectStorage.root,
    basePath: projectStorage.basePath,
  });
  const metadataService = createMovieMetadataService(storageContext);
  const metadata = await metadataService.read(storageMovieId);
  if (!metadata?.blueprintPath) {
    throw new Error(`Unable to find movie metadata for ${storageMovieId}.`);
  }

  // Load and validate the blueprint has a TimelineComposer
  await validateBlueprintHasTimelineComposer(metadata.blueprintPath);

  // Load manifest and validate Timeline artifact exists
  const { manifest } = await loadCurrentManifest(effectiveConfig, storageMovieId);
  validateTimelineArtifactExists(manifest);

  // Load export config from file if provided
  const fileConfig = options.inputsPath
    ? await loadExportConfig(options.inputsPath)
    : undefined;

  // Determine output settings with priority: CLI flags > config file > manifest > defaults
  // CLI flags take highest priority (explicit user override)
  const width = options.width ?? fileConfig?.width ?? DEFAULT_WIDTH;
  const height = options.height ?? fileConfig?.height ?? DEFAULT_HEIGHT;
  const fps = options.fps ?? fileConfig?.fps ?? DEFAULT_FPS;
  const exporter: ExporterType = options.exporter ?? fileConfig?.exporter ?? 'remotion';
  const outputPath = resolve(
    projectStorage.root,
    projectStorage.basePath,
    storageMovieId,
    OUTPUT_FILENAME,
  );

  // Load model catalog and create provider registry
  const catalogModelsDir = globalConfig.catalog?.root
    ? resolve(globalConfig.catalog.root, 'models')
    : undefined;
  const catalog = catalogModelsDir
    ? await loadModelCatalog(catalogModelsDir)
    : undefined;
  const registry = createProviderRegistry({
    mode: 'live',
    catalog,
    catalogModelsDir, // Required for getModelSchema to enable config validation
  });

  // Resolve exporter handler based on type
  const exporterModel = exporter === 'ffmpeg' ? 'ffmpeg/native-render' : 'remotion/docker-render';
  const handler = registry.resolve({
    provider: 'renku',
    model: exporterModel,
    environment: 'local',
  });

  // Get the timeline artifact entry for the job context
  const timelineEntry = manifest.artefacts[TIMELINE_ARTEFACT_ID];

  // Get the transcription artifact entry if it exists (optional, for subtitles)
  const transcriptionEntry = manifest.artefacts[TRANSCRIPTION_ARTEFACT_ID];

  // Extract subtitle configuration from manifest inputs (if present in blueprint)
  const manifestSubtitleConfig = extractSubtitleConfig(manifest);

  // Merge subtitle configs: config file > manifest (for each field)
  const subtitleConfig = mergeSubtitleConfigs(manifestSubtitleConfig, fileConfig?.subtitles);

  // Build provider config with all settings
  const providerConfig: Record<string, unknown> = { width, height, fps };

  // Add FFmpeg-specific settings from config file
  if (fileConfig?.preset !== undefined) {
    providerConfig.preset = fileConfig.preset;
  }
  if (fileConfig?.crf !== undefined) {
    providerConfig.crf = fileConfig.crf;
  }
  if (fileConfig?.audioBitrate !== undefined) {
    providerConfig.audioBitrate = fileConfig.audioBitrate;
  }

  // Add merged subtitle config
  if (subtitleConfig) {
    providerConfig.subtitles = subtitleConfig;
  }

  // Build resolved inputs with timeline and optional transcription
  const resolvedInputs: Record<string, unknown> = {
    'Input:MovieId': storageMovieId,
    'Input:StorageRoot': projectStorage.root,
    'Input:StorageBasePath': projectStorage.basePath,
    [TIMELINE_ARTEFACT_ID]: timelineEntry,
  };

  // Add transcription artifact if it exists (enables subtitles)
  if (transcriptionEntry) {
    resolvedInputs[TRANSCRIPTION_ARTEFACT_ID] = transcriptionEntry;
  }

  // Invoke the handler through the proper interface
  const response = await handler.invoke({
    jobId: `export-${Date.now()}`,
    provider: 'renku',
    model: exporterModel,
    revision: manifest.revision,
    layerIndex: 0,
    attempt: 1,
    inputs: [],
    produces: ['Artifact:VideoExporter.FinalVideo'],
    context: {
      providerConfig,
      environment: 'local',
      extras: {
        resolvedInputs,
      },
    },
  });

  if (response.status === 'failed') {
    throw new Error('Export failed: ' + JSON.stringify(response.diagnostics));
  }

  // Create symlink in the artifacts/ folder
  const artifactsRoot = resolve(projectStorage.root, 'artifacts', storageMovieId);
  const artifactsPath = resolve(artifactsRoot, OUTPUT_FILENAME);
  await mkdir(dirname(artifactsPath), { recursive: true });
  try {
    await rm(artifactsPath, { force: true });
  } catch {
    // noop - file may not exist
  }
  await symlink(outputPath, artifactsPath);

  return {
    movieId: storageMovieId,
    outputPath,
    artifactsPath,
    width,
    height,
    fps,
    exporter,
  };
}


async function validateBlueprintHasTimelineComposer(blueprintPath: string): Promise<void> {
  const cliConfig = await readCliConfig(getDefaultCliConfigPath());
  const catalogRoot = cliConfig?.catalog?.root ?? undefined;
  let bundle;
  try {
    bundle = await loadBlueprintBundle(blueprintPath, { catalogRoot });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Blueprint not found: ${blueprintPath}. ${message}`);
  }

  const hasTimelineComposer = bundle.root.document.producerImports.some(
    (producer) => producer.name === 'TimelineComposer',
  );
  if (!hasTimelineComposer) {
    throw new Error('A TimelineComposer producer is required in the blueprint to export video.');
  }
}

function validateTimelineArtifactExists(manifest: { artefacts: Record<string, unknown> }): void {
  const hasTimeline = TIMELINE_ARTEFACT_ID in manifest.artefacts;
  if (!hasTimeline) {
    throw new Error('No timeline found. Please run the generation first to create a timeline.');
  }
}
