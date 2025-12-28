import { resolve, dirname } from 'node:path';
import { mkdir, rm, symlink } from 'node:fs/promises';
import { getDefaultCliConfigPath, readCliConfig } from '../lib/cli-config.js';
import { resolveTargetMovieId } from '../lib/movie-id-utils.js';
import { loadCurrentManifest } from '../lib/friendly-view.js';
import { readMovieMetadata } from '../lib/movie-metadata.js';
import { loadBlueprintBundle } from '../lib/blueprint-loader/index.js';
import { createProviderRegistry, loadModelCatalog } from '@gorenku/providers';

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const DEFAULT_FPS = 30;
const OUTPUT_FILENAME = 'FinalVideo.mp4';
const TIMELINE_ARTEFACT_ID = 'Artifact:TimelineComposer.Timeline';

export interface ExportOptions {
  movieId?: string;
  useLast?: boolean;
  width?: number;
  height?: number;
  fps?: number;
}

export interface ExportResult {
  movieId: string;
  outputPath: string;
  friendlyPath: string;
  width: number;
  height: number;
  fps: number;
}

export async function runExport(options: ExportOptions): Promise<ExportResult> {
  const configPath = getDefaultCliConfigPath();
  const cliConfig = await readCliConfig(configPath);
  if (!cliConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }

  const storageMovieId = await resolveTargetMovieId({
    explicitMovieId: options.movieId,
    useLast: Boolean(options.useLast),
    cliConfig,
  });

  // Load movie metadata to get the blueprint path
  const movieDir = resolve(cliConfig.storage.root, cliConfig.storage.basePath, storageMovieId);
  const metadata = await readMovieMetadata(movieDir);
  if (!metadata?.blueprintPath) {
    throw new Error(`Unable to find movie metadata for ${storageMovieId}.`);
  }

  // Load and validate the blueprint has a TimelineComposer
  await validateBlueprintHasTimelineComposer(metadata.blueprintPath);

  // Load manifest and validate Timeline artifact exists
  const { manifest } = await loadCurrentManifest(cliConfig, storageMovieId);
  validateTimelineArtifactExists(manifest);

  // Determine output path and quality settings
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const fps = options.fps ?? DEFAULT_FPS;
  const outputPath = resolve(
    cliConfig.storage.root,
    cliConfig.storage.basePath,
    storageMovieId,
    OUTPUT_FILENAME,
  );

  // Load model catalog and create provider registry
  const catalogModelsDir = cliConfig.catalog?.root
    ? resolve(cliConfig.catalog.root, 'models')
    : undefined;
  const catalog = catalogModelsDir
    ? await loadModelCatalog(catalogModelsDir)
    : undefined;
  const registry = createProviderRegistry({ mode: 'live', catalog });

  // Resolve MP4 Exporter handler
  const handler = registry.resolve({
    provider: 'renku',
    model: 'Mp4Exporter',
    environment: 'local',
  });

  // Get the timeline artifact entry for the job context
  const timelineEntry = manifest.artefacts[TIMELINE_ARTEFACT_ID];

  // Invoke the handler through the proper interface
  const response = await handler.invoke({
    jobId: `export-${Date.now()}`,
    provider: 'renku',
    model: 'Mp4Exporter',
    revision: manifest.revision,
    layerIndex: 0,
    attempt: 1,
    inputs: [],
    produces: ['Artifact:VideoExporter.FinalVideo'],
    context: {
      providerConfig: { width, height, fps },
      environment: 'local',
      extras: {
        resolvedInputs: {
          'Input:MovieId': storageMovieId,
          'Input:StorageRoot': cliConfig.storage.root,
          'Input:StorageBasePath': cliConfig.storage.basePath,
          [TIMELINE_ARTEFACT_ID]: timelineEntry,
        },
      },
    },
  });

  if (response.status === 'failed') {
    throw new Error('Export failed: ' + JSON.stringify(response.diagnostics));
  }

  // Create symlink in the movies/ folder
  const friendlyRoot = resolve(cliConfig.storage.root, 'movies', storageMovieId);
  const friendlyPath = resolve(friendlyRoot, OUTPUT_FILENAME);
  await mkdir(dirname(friendlyPath), { recursive: true });
  try {
    await rm(friendlyPath, { force: true });
  } catch {
    // noop - file may not exist
  }
  await symlink(outputPath, friendlyPath);

  return {
    movieId: storageMovieId,
    outputPath,
    friendlyPath,
    width,
    height,
    fps,
  };
}


async function validateBlueprintHasTimelineComposer(blueprintPath: string): Promise<void> {
  let bundle;
  try {
    bundle = await loadBlueprintBundle(blueprintPath);
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
