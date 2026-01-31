/**
 * CLI command for exporting timelines to DaVinci Resolve (OTIO format).
 *
 * This is a thin wrapper around the core exportTimelineToOTIO function.
 * It handles CLI-specific concerns like resolving paths, loading configs,
 * and writing the output file.
 */

import { resolve, dirname } from 'node:path';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import {
  createEventLog,
  createStorageContext,
  exportTimelineToOTIO,
  resolveArtifactBlobPaths,
  readBlob,
  createRuntimeError,
  RuntimeErrorCode,
} from '@gorenku/core';
import type { TimelineDocument } from '@gorenku/compositions';
import { getDefaultCliConfigPath, getProjectLocalStorage, readCliConfig } from '../lib/cli-config.js';
import { resolveTargetMovieId } from '../lib/movie-id-utils.js';
import { loadCurrentManifest } from '../lib/artifacts-view.js';

const DEFAULT_FPS = 30;
const OUTPUT_FILENAME = 'DaVinciProject.otio';
const TIMELINE_ARTEFACT_ID = 'Artifact:TimelineComposer.Timeline';

export interface ExportDavinciOptions {
  movieId?: string;
  useLast?: boolean;
  fps?: number;
}

export interface ExportDavinciResult {
  movieId: string;
  outputPath: string;
  artifactsPath: string;
  fps: number;
  stats: {
    trackCount: number;
    clipCount: number;
    duration: number;
    videoTrackCount: number;
    audioTrackCount: number;
  };
}

/**
 * Exports a movie timeline to OpenTimelineIO (OTIO) format for DaVinci Resolve.
 *
 * The export creates an OTIO file that can be imported into DaVinci Resolve,
 * Premiere Pro, and other professional NLE applications that support OTIO.
 *
 * @param options - Export options
 * @returns Export result with output paths and statistics
 */
export async function runExportDavinci(options: ExportDavinciOptions): Promise<ExportDavinciResult> {
  // Load CLI config
  const configPath = getDefaultCliConfigPath();
  const globalConfig = await readCliConfig(configPath);
  if (!globalConfig) {
    throw createRuntimeError(
      RuntimeErrorCode.VIEWER_CONFIG_MISSING,
      'Renku CLI is not initialized. Run "renku init" first.',
    );
  }

  // Use project-local storage
  const projectStorage = getProjectLocalStorage();
  const effectiveConfig = { ...globalConfig, storage: projectStorage };

  // Resolve movie ID
  const storageMovieId = await resolveTargetMovieId({
    explicitMovieId: options.movieId,
    useLast: Boolean(options.useLast),
    cliConfig: effectiveConfig,
  });

  // Load manifest
  const { manifest } = await loadCurrentManifest(effectiveConfig, storageMovieId);

  // Resolve asset blob paths - create storage context first as we need it for loading timeline
  const storage = createStorageContext({
    kind: 'local',
    rootDir: projectStorage.root,
    basePath: projectStorage.basePath,
  });

  const eventLog = createEventLog(storage);

  // Validate timeline artifact exists
  const timelineArtifact = manifest.artefacts[TIMELINE_ARTEFACT_ID];
  if (!timelineArtifact) {
    throw createRuntimeError(
      RuntimeErrorCode.ARTIFACT_NOT_IN_MANIFEST,
      `No timeline found (${TIMELINE_ARTEFACT_ID}). Please run the generation first to create a timeline.`,
    );
  }

  // Get timeline data from artifact blob
  if (!timelineArtifact.blob) {
    throw createRuntimeError(
      RuntimeErrorCode.ARTIFACT_NOT_IN_MANIFEST,
      'Timeline artifact has no blob data. The manifest may be corrupted.',
    );
  }

  // Load the timeline JSON from the blob
  const timelineData = await readBlob(storage, storageMovieId, timelineArtifact.blob);
  const timeline = timelineData as TimelineDocument;

  if (!timeline || !Array.isArray(timeline.tracks)) {
    throw createRuntimeError(
      RuntimeErrorCode.ARTIFACT_NOT_IN_MANIFEST,
      'Invalid timeline data structure. Expected a TimelineDocument with tracks array.',
    );
  }

  // Collect all asset IDs from the timeline
  const assetIds = collectAssetIds(timeline);

  // Resolve asset paths from the event log (returns relative paths)
  const relativeAssetPaths = await resolveArtifactBlobPaths({
    artifactIds: assetIds,
    eventLog,
    storage,
    movieId: storageMovieId,
  });

  // Convert to absolute paths for OTIO (DaVinci Resolve needs absolute paths)
  const assetPaths: Record<string, string> = {};
  for (const [assetId, relativePath] of Object.entries(relativeAssetPaths)) {
    assetPaths[assetId] = resolve(projectStorage.root, relativePath);
  }

  // Export to OTIO
  const fps = options.fps ?? DEFAULT_FPS;
  const result = exportTimelineToOTIO({
    timeline,
    assetPaths,
    options: {
      fps,
      movieName: timeline.movieTitle ?? timeline.name ?? storageMovieId,
    },
  });

  // Write OTIO file to movie build directory
  const outputPath = resolve(
    projectStorage.root,
    projectStorage.basePath,
    storageMovieId,
    OUTPUT_FILENAME,
  );
  await writeFile(outputPath, result.otioJson, 'utf8');

  // Create symlink in artifacts folder
  const artifactsRoot = resolve(projectStorage.root, 'artifacts', storageMovieId);
  const artifactsPath = resolve(artifactsRoot, OUTPUT_FILENAME);
  await mkdir(dirname(artifactsPath), { recursive: true });
  try {
    await rm(artifactsPath, { force: true });
  } catch {
    // File may not exist
  }
  await symlink(outputPath, artifactsPath);

  return {
    movieId: storageMovieId,
    outputPath,
    artifactsPath,
    fps,
    stats: result.stats,
  };
}

/**
 * Collects all asset IDs referenced in the timeline.
 * These are used to resolve blob paths for the OTIO export.
 */
function collectAssetIds(timeline: TimelineDocument): string[] {
  const assetIds = new Set<string>();

  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const props = clip.properties as Record<string, unknown>;

      // Direct assetId property
      if (typeof props.assetId === 'string') {
        assetIds.add(props.assetId);
      }

      // Ken Burns effects (for image tracks)
      if (Array.isArray(props.effects)) {
        for (const effect of props.effects) {
          if (typeof effect === 'object' && effect !== null && 'assetId' in effect) {
            const effectAssetId = (effect as Record<string, unknown>).assetId;
            if (typeof effectAssetId === 'string') {
              assetIds.add(effectAssetId);
            }
          }
        }
      }
    }
  }

  return Array.from(assetIds);
}
