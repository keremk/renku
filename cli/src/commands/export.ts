import { resolve, dirname } from 'node:path';
import { mkdir, rm, symlink } from 'node:fs/promises';
import { getDefaultCliConfigPath, getProjectLocalStorage, readCliConfig } from '../lib/cli-config.js';
import { resolveTargetMovieId } from '../lib/movie-id-utils.js';
import { loadCurrentManifest } from '../lib/artifacts-view.js';
import { readMovieMetadata } from '../lib/movie-metadata.js';
import { loadBlueprintBundle } from '../lib/blueprint-loader/index.js';
import { createProviderRegistry, loadModelCatalog } from '@gorenku/providers';

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const DEFAULT_FPS = 30;
const OUTPUT_FILENAME = 'FinalVideo.mp4';
const TIMELINE_ARTEFACT_ID = 'Artifact:TimelineComposer.Timeline';

export type ExporterType = 'remotion' | 'ffmpeg';

export interface ExportOptions {
  movieId?: string;
  useLast?: boolean;
  width?: number;
  height?: number;
  fps?: number;
  exporter?: ExporterType;
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
  const movieDir = resolve(projectStorage.root, projectStorage.basePath, storageMovieId);
  const metadata = await readMovieMetadata(movieDir);
  if (!metadata?.blueprintPath) {
    throw new Error(`Unable to find movie metadata for ${storageMovieId}.`);
  }

  // Load and validate the blueprint has a TimelineComposer
  await validateBlueprintHasTimelineComposer(metadata.blueprintPath);

  // Load manifest and validate Timeline artifact exists
  const { manifest } = await loadCurrentManifest(effectiveConfig, storageMovieId);
  validateTimelineArtifactExists(manifest);

  // Determine output path and quality settings
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const fps = options.fps ?? DEFAULT_FPS;
  const exporter: ExporterType = options.exporter ?? 'remotion';
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
  const registry = createProviderRegistry({ mode: 'live', catalog });

  // Resolve exporter handler based on type
  const exporterModel = exporter === 'ffmpeg' ? 'ffmpeg/native-render' : 'remotion/docker-render';
  const handler = registry.resolve({
    provider: 'renku',
    model: exporterModel,
    environment: 'local',
  });

  // Get the timeline artifact entry for the job context
  const timelineEntry = manifest.artefacts[TIMELINE_ARTEFACT_ID];

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
      providerConfig: { width, height, fps },
      environment: 'local',
      extras: {
        resolvedInputs: {
          'Input:MovieId': storageMovieId,
          'Input:StorageRoot': projectStorage.root,
          'Input:StorageBasePath': projectStorage.basePath,
          [TIMELINE_ARTEFACT_ID]: timelineEntry,
        },
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
