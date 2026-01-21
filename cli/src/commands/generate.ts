import { getDefaultCliConfigPath, getProjectLocalStorage, persistLastMovieId, readCliConfig, type CliConfig } from '../lib/cli-config.js';
import { runExecute, formatMovieId, type ExecuteResult } from './execute.js';
import { resolveTargetMovieId } from '../lib/movie-id-utils.js';
import { resolveAndPersistConcurrency } from '../lib/concurrency.js';
import { buildArtifactsView, loadCurrentManifest, prepareArtifactsPreflight } from '../lib/artifacts-view.js';
import crypto from 'node:crypto';
import { resolve } from 'node:path';
import type { LogLevel } from '@gorenku/core';
import { createCliLogger } from '../lib/logger.js';

/**
 * Creates an effective config for generation that uses project-local storage (cwd)
 * while preserving catalog configuration from the global config.
 * @param globalConfig - The global CLI config
 * @param storageOverride - Optional storage override (used in tests)
 */
function createEffectiveConfig(
  globalConfig: CliConfig,
  storageOverride?: { root: string; basePath: string },
): CliConfig {
  const projectStorage = storageOverride ?? getProjectLocalStorage();
  return {
    ...globalConfig,
    storage: projectStorage,
  };
}

export interface GenerateOptions {
  movieId?: string;
  useLast?: boolean;
  inputsPath?: string;
  blueprint?: string;
  dryRun?: boolean;
  nonInteractive?: boolean;
  costsOnly?: boolean;
  concurrency?: number;
  upToLayer?: number;
  reRunFrom?: number;
  logLevel: LogLevel;
  /** Override storage root (used in tests). If not provided, uses cwd. */
  storageOverride?: { root: string; basePath: string };
  /** Target artifact ID for surgical regeneration (short format, e.g., "AudioProducer.GeneratedAudio[0]") */
  artifactId?: string;
}

export interface GenerateResult {
  movieId: string;
  storageMovieId: string;
  planPath: string;
  targetRevision: string;
  /** Build summary (available for both dry-run and live execution) */
  build?: ExecuteResult['build'];
  /** Whether this was a dry-run execution */
  isDryRun?: boolean;
  manifestPath?: string;
  storagePath: string;
  /** Path to artifacts folder (symlinks to build outputs) */
  artifactsRoot?: string;
  /** Path to final video/audio output (if available) */
  finalOutputPath?: string;
  isNew: boolean;
  cleanedUp?: boolean;
}

export async function runGenerate(options: GenerateOptions): Promise<GenerateResult> {
  const configPath = getDefaultCliConfigPath();
  const globalConfig = await readCliConfig(configPath);
  if (!globalConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }

  const { concurrency, cliConfig: resolvedCliConfig } = await resolveAndPersistConcurrency(globalConfig, {
    override: options.concurrency,
    configPath,
  });
  // Use project-local storage (cwd) while preserving catalog from global config
  // Allow override for testing purposes
  const activeConfig = createEffectiveConfig(resolvedCliConfig, options.storageOverride);

  const usingLast = Boolean(options.useLast);
  if (usingLast && options.movieId) {
    throw new Error('Use either --last or --movie-id/--id, not both.');
  }

  // Validate --artifact-id requirements
  const targetingExisting = Boolean(usingLast || options.movieId);
  if (options.artifactId) {
    if (!targetingExisting) {
      throw new Error('--artifact-id requires --last or --movie-id/--id to target an existing movie.');
    }
    if (options.reRunFrom !== undefined) {
      throw new Error('--artifact-id and --re-run-from/--from are mutually exclusive.');
    }
    // Note: --up-to-layer IS allowed with --artifact-id to limit downstream regeneration
  }

  // Input validation - always required (contains model selections)
  if (!options.inputsPath) {
    const { createRuntimeError, RuntimeErrorCode } = await import('@gorenku/core');
    throw createRuntimeError(
      RuntimeErrorCode.MISSING_REQUIRED_INPUT,
      'Input YAML path is required.',
      { suggestion: 'Provide --inputs=/path/to/inputs.yaml. Inputs are needed for model selections, even when using --re-run-from.' }
    );
  }

  // Convert short artifact ID format to canonical format
  const targetArtifactId = options.artifactId
    ? `Artifact:${options.artifactId}`
    : undefined;

  const upToLayer = options.upToLayer;

  if (options.movieId || usingLast) {
    const storageMovieId = await resolveTargetMovieId({
      explicitMovieId: options.movieId,
      useLast: usingLast,
      cliConfig: activeConfig,
    });
    const logFilePath = resolve(
      activeConfig.storage.root,
      activeConfig.storage.basePath,
      storageMovieId,
      'logs',
      `${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`,
    );
    const logger = createCliLogger({
      level: options.logLevel,
      logFilePath,
    });

    const { manifest } = await loadCurrentManifest(activeConfig, storageMovieId).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to load manifest for ${storageMovieId}. ${message}`);
    });

    const preflight = await prepareArtifactsPreflight({
      cliConfig: activeConfig,
      movieId: storageMovieId,
      manifest,
      allowShardedBlobs: true,
    });

    const editResult = await runExecute({
      storageMovieId,
      isNew: false,
      inputsPath: options.inputsPath,
      blueprintSpecifier: options.blueprint, // Ignored for edits - uses metadata
      pendingArtefacts: preflight.pendingArtefacts,
      dryRun: options.dryRun,
      nonInteractive: options.nonInteractive,
      costsOnly: options.costsOnly,
      concurrency,
      upToLayer,
      reRunFrom: options.reRunFrom,
      targetArtifactId,
      logger,
      cliConfig: activeConfig,
    });

    let artifactsRoot: string | undefined;
    let finalOutputPath: string | undefined;
    if (!options.dryRun && editResult.build) {
      const { manifest: nextManifest } = await loadCurrentManifest(activeConfig, storageMovieId);
      const artifacts = await buildArtifactsView({
        cliConfig: activeConfig,
        movieId: storageMovieId,
        manifest: nextManifest,
      });
      artifactsRoot = artifacts.artifactsRoot;
      finalOutputPath = findFinalOutput(artifacts.artefacts);
    }

    if (editResult.build) {
      await persistLastMovieId(storageMovieId, configPath);
    }

    return {
      movieId: normalizePublicId(storageMovieId),
      storageMovieId,
      planPath: editResult.planPath,
      targetRevision: editResult.targetRevision,
      build: editResult.build,
      isDryRun: editResult.isDryRun,
      manifestPath: editResult.manifestPath,
      storagePath: editResult.storagePath,
      artifactsRoot,
      finalOutputPath,
      isNew: false,
      cleanedUp: editResult.cleanedUp,
    };
  }

  // Blueprint validation - required for new movies only
  if (!options.blueprint) {
    throw new Error('Blueprint path is required for a new generation. Provide --blueprint=/path/to/blueprint.yaml');
  }

  const newMovieId = generateMovieId();
  const storageMovieId = formatMovieId(newMovieId);
  const logFilePath = resolve(
    activeConfig.storage.root,
    activeConfig.storage.basePath,
    storageMovieId,
    'logs',
    `${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`,
  );
  const logger = createCliLogger({
    level: options.logLevel,
    logFilePath,
  });

  // Persist lastMovieId immediately so --last works even if build fails
  // This allows users to retry failed builds with --last or --movie-id
  await persistLastMovieId(storageMovieId, configPath);

  const queryResult = await runExecute({
    storageMovieId,
    movieId: newMovieId,
    isNew: true,
    inputsPath: options.inputsPath,
    blueprintSpecifier: options.blueprint,
    dryRun: options.dryRun,
    nonInteractive: options.nonInteractive,
    costsOnly: options.costsOnly,
    concurrency,
    upToLayer,
    logger,
    cliConfig: activeConfig,
  });

  let artifactsRoot: string | undefined;
  let finalOutputPath: string | undefined;
  if (!options.dryRun && queryResult.build) {
    // Try to load manifest and build artifacts view, but don't fail if manifest doesn't exist
    // (can happen if build failed before manifest was saved)
    try {
      const { manifest } = await loadCurrentManifest(activeConfig, queryResult.storageMovieId);
      const artifacts = await buildArtifactsView({
        cliConfig: activeConfig,
        movieId: queryResult.storageMovieId,
        manifest,
      });
      artifactsRoot = artifacts.artifactsRoot;
      finalOutputPath = findFinalOutput(artifacts.artefacts);
    } catch {
      // Manifest may not exist if build failed - continue without artifacts view
      logger.debug?.('Could not load manifest for artifacts view - build may have failed');
    }
  }

  return {
    movieId: queryResult.movieId,
    storageMovieId: queryResult.storageMovieId,
    planPath: queryResult.planPath,
    targetRevision: queryResult.targetRevision,
    build: queryResult.build,
    isDryRun: queryResult.isDryRun,
    manifestPath: queryResult.manifestPath,
    storagePath: queryResult.storagePath,
    artifactsRoot,
    finalOutputPath,
    isNew: true,
    cleanedUp: queryResult.cleanedUp,
  };
}


function normalizePublicId(storageMovieId: string): string {
  return storageMovieId.startsWith('movie-') ? storageMovieId.slice('movie-'.length) : storageMovieId;
}

function generateMovieId(): string {
  return crypto.randomUUID().slice(0, 8);
}

interface ArtifactInfo {
  artefactId: string;
  artifactPath: string;
  mimeType?: string;
}

/**
 * Find the final video or audio output from the artifacts list.
 * Returns the path to the final output, or undefined if not found.
 */
function findFinalOutput(artefacts: ArtifactInfo[]): string | undefined {
  // Look for video output first (FinalVideo)
  const videoArtifact = artefacts.find(
    (a) => a.mimeType?.startsWith('video/') && a.artefactId.includes('FinalVideo')
  );
  if (videoArtifact) {
    return videoArtifact.artifactPath;
  }

  // Fall back to audio output (FinalAudio)
  const audioArtifact = artefacts.find(
    (a) => a.mimeType?.startsWith('audio/') && a.artefactId.includes('FinalAudio')
  );
  if (audioArtifact) {
    return audioArtifact.artifactPath;
  }

  return undefined;
}
