import { resolve } from 'node:path';
import { getDefaultCliConfigPath, readCliConfig, type CliConfig } from '../lib/cli-config.js';
import { generatePlan, type PendingArtefactDraft } from '../lib/planner.js';
import { executeBuild, type BuildSummary } from '../lib/build.js';
import { expandPath } from '../lib/path.js';
import { confirmPlanExecution } from '../lib/interactive-confirm.js';
import { displayPlanAndCosts } from '../lib/plan-display.js';
import { readMovieMetadata } from '../lib/movie-metadata.js';
import { resolveBlueprintSpecifier } from '../lib/config-assets.js';
import { resolveAndPersistConcurrency } from '../lib/concurrency.js';
import { cleanupPartialRunDirectory } from '../lib/cleanup.js';
import type { Logger } from '@gorenku/core';

/**
 * Unified execution options supporting both new and existing movies.
 */
export interface ExecuteOptions {
  /** Storage movie ID (e.g., "movie-abc123") */
  storageMovieId: string;

  /** Public movie ID for new movies (e.g., "abc123") */
  movieId?: string;

  /** Whether this is a new movie (true) or edit of existing (false) */
  isNew: boolean;

  /** Path to inputs YAML file (required for both new and edit) */
  inputsPath?: string;

  /** Blueprint specifier - used only for new movies, ignored for edits */
  blueprintSpecifier?: string;

  /** Pending artefacts for partial re-rendering (edit only) */
  pendingArtefacts?: PendingArtefactDraft[];

  /** Run in dry-run mode (simulate without executing) */
  dryRun?: boolean;

  /** Skip interactive confirmation */
  nonInteractive?: boolean;

  /** Show costs and exit without executing */
  costsOnly?: boolean;

  /** Number of concurrent jobs */
  concurrency?: number;

  /** Limit execution to specific layer */
  upToLayer?: number;

  /** Re-run from specific layer (skips earlier layers) */
  reRunFrom?: number;

  /** Target artifact IDs for surgical regeneration (canonical format, e.g., "Artifact:AudioProducer.GeneratedAudio[0]") */
  targetArtifactIds?: string[];

  /** Logger instance */
  logger: Logger;

  /**
   * CLI config to use for storage paths.
   * If provided, uses this config instead of reading from global config file.
   * This allows generate.ts to pass project-local storage configuration.
   */
  cliConfig?: CliConfig;
}

/**
 * Unified execution result.
 */
export interface ExecuteResult {
  /** Public movie ID (without "movie-" prefix) */
  movieId: string;

  /** Storage movie ID (with "movie-" prefix) */
  storageMovieId: string;

  /** Path to saved plan JSON */
  planPath: string;

  /** Plan revision string */
  targetRevision: string;

  /** Build summary (available for both dry-run and live execution) */
  build?: BuildSummary;

  /** Whether this was a dry-run execution */
  isDryRun?: boolean;

  /** Path to manifest file (if build succeeded) */
  manifestPath?: string;

  /** Path to movie storage directory */
  storagePath: string;

  /** Whether cleanup was performed on cancel/costs-only */
  cleanedUp?: boolean;
}

/**
 * Unified execution function that handles both new movies and edits.
 *
 * Consolidates the shared logic from runEdit() and runQuery() into a single
 * parametric function. The `isNew` flag controls blueprint resolution and cleanup behavior.
 */
export async function runExecute(options: ExecuteOptions): Promise<ExecuteResult> {
  const configPath = getDefaultCliConfigPath();

  // Use provided config if available, otherwise read from global config file
  let cliConfig: CliConfig;
  let concurrency: number;

  if (options.cliConfig) {
    // Config was provided by caller (e.g., generate.ts), which already resolved concurrency
    // Don't call resolveAndPersistConcurrency again to avoid overwriting lastMovieId
    cliConfig = options.cliConfig;
    concurrency = options.concurrency ?? cliConfig.concurrency ?? 1;
  } else {
    const globalConfig = await readCliConfig(configPath);
    if (!globalConfig) {
      throw new Error('Renku CLI is not initialized. Run "renku init" first.');
    }
    const resolved = await resolveAndPersistConcurrency(globalConfig, {
      override: options.concurrency,
      configPath,
    });
    cliConfig = resolved.cliConfig;
    concurrency = resolved.concurrency;
  }

  const { storageMovieId, isNew, logger } = options;
  const storageRoot = cliConfig.storage.root;
  const basePath = cliConfig.storage.basePath;
  const movieDir = resolve(storageRoot, basePath, storageMovieId);
  const upToLayer = options.upToLayer;

  if (options.dryRun && upToLayer !== undefined) {
    logger.info('--upToLayer applies only to live runs; dry runs will simulate all layers.');
  }

  // Resolve inputs path - always required (contains model selections)
  const inputsPath = resolveInputsPath(options.inputsPath);

  // Resolve blueprint path
  const blueprintPath = await resolveBlueprintPath({
    specifier: options.blueprintSpecifier,
    movieDir,
    cliRoot: cliConfig.storage.root,
    isNew,
  });

  // Generate plan
  const planResult = await generatePlan({
    cliConfig,
    movieId: storageMovieId,
    isNew,
    inputsPath,
    usingBlueprint: blueprintPath,
    pendingArtefacts: options.pendingArtefacts,
    logger,
    reRunFrom: options.reRunFrom,
    targetArtifactIds: options.targetArtifactIds,
  });

  if (options.dryRun) {
    logger.debug?.('execute.dryrun.plan.debug', {
      pendingInputs: planResult.inputEvents.length,
      layers: planResult.plan.layers.map((layer) => layer.length),
    });
  }

  const hasJobs = planResult.plan.layers.some((layer) => layer.length > 0);
  const nonInteractive = Boolean(options.nonInteractive);

  // Handle --costs-only: display plan summary and costs, then return early
  if (options.costsOnly) {
    return handleCostsOnly({
      planResult,
      storageMovieId,
      movieDir,
      storageRoot,
      basePath,
      isNew,
      logger,
      movieId: options.movieId,
    });
  }

  // Determine if we should persist now or after confirmation
  // For edits with no jobs, skip confirmation entirely
  const skipConfirmation = options.dryRun || nonInteractive || (!isNew && !hasJobs);

  if (skipConfirmation) {
    await planResult.persist();
  }

  // Interactive confirmation
  if (!skipConfirmation) {
    const confirmed = await confirmPlanExecution(planResult.plan, {
      inputs: planResult.inputEvents,
      concurrency,
      upToLayer,
      logger,
      costSummary: planResult.costSummary,
      surgicalMode: planResult.surgicalInfo,
    });

    if (!confirmed) {
      return handleCancellation({
        planResult,
        storageMovieId,
        movieDir,
        storageRoot,
        basePath,
        isNew,
        logger,
        movieId: options.movieId,
      });
    }

    // User confirmed - persist now before execution
    await planResult.persist();
  }

  // Execute build (with dryRun parameter to control mode)
  const buildResult = await executeBuild({
    cliConfig,
    movieId: storageMovieId,
    plan: planResult.plan,
    manifest: planResult.manifest,
    manifestHash: planResult.manifestHash,
    providerOptions: planResult.providerOptions,
    resolvedInputs: planResult.resolvedInputs,
    catalog: planResult.modelCatalog,
    catalogModelsDir: planResult.catalogModelsDir,
    logger,
    concurrency,
    upToLayer: options.dryRun ? undefined : upToLayer,
    reRunFrom: options.dryRun ? undefined : options.reRunFrom,
    targetArtifactIds: options.targetArtifactIds,
    dryRun: options.dryRun,
  });

  return {
    movieId: options.movieId ?? normalizePublicId(storageMovieId),
    storageMovieId,
    planPath: planResult.planPath,
    targetRevision: planResult.targetRevision,
    build: buildResult.summary,
    isDryRun: buildResult.dryRun,
    manifestPath: buildResult.manifestPath,
    storagePath: movieDir,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Resolve inputs path - always required (contains model selections).
 * @param explicitPath - The explicit path provided by the user
 */
function resolveInputsPath(explicitPath: string | undefined): string {
  if (!explicitPath) {
    // Note: This should be caught earlier in generate.ts validation,
    // but we keep this check as a safety net
    throw new Error('Input YAML path is required. Provide --inputs=/path/to/inputs.yaml');
  }
  return expandPath(explicitPath);
}

/**
 * Resolve blueprint path.
 * - For new movies: use the specifier (required)
 * - For edits: always use the blueprint from movie metadata (ignore specifier)
 */
async function resolveBlueprintPath(args: {
  specifier?: string;
  movieDir: string;
  cliRoot: string;
  isNew: boolean;
}): Promise<string> {
  let blueprintInput: string | undefined;

  if (args.isNew) {
    // For new movies, use the provided specifier
    blueprintInput = args.specifier;
  } else {
    // For edits, always use the blueprint from movie metadata (ignore specifier)
    const metadata = await readMovieMetadata(args.movieDir);
    blueprintInput = metadata?.blueprintPath;
  }

  if (!blueprintInput || blueprintInput.trim().length === 0) {
    throw new Error('Blueprint path is required. Provide --blueprint=/path/to/blueprint.yaml');
  }

  return resolveBlueprintSpecifier(blueprintInput, { cliRoot: args.cliRoot });
}

/**
 * Normalize storage movie ID to public ID (remove "movie-" prefix).
 */
function normalizePublicId(storageMovieId: string): string {
  return storageMovieId.startsWith('movie-') ? storageMovieId.slice('movie-'.length) : storageMovieId;
}

/**
 * Handle --costs-only: display plan and costs, cleanup, return early.
 */
async function handleCostsOnly(args: {
  planResult: Awaited<ReturnType<typeof generatePlan>>;
  storageMovieId: string;
  movieDir: string;
  storageRoot: string;
  basePath: string;
  isNew: boolean;
  logger: Logger;
  movieId?: string;
}): Promise<ExecuteResult> {
  const { planResult, storageMovieId, movieDir, storageRoot, basePath, isNew, logger } = args;

  displayPlanAndCosts({
    plan: planResult.plan,
    inputs: planResult.inputEvents,
    costSummary: planResult.costSummary,
    logger,
  });

  const cleanedUp = await cleanupPartialRunDirectory({
    storageRoot,
    basePath,
    movieId: storageMovieId,
    isNew,
  });

  return {
    movieId: args.movieId ?? normalizePublicId(storageMovieId),
    storageMovieId,
    planPath: planResult.planPath,
    targetRevision: planResult.targetRevision,
    build: undefined,
    isDryRun: undefined,
    manifestPath: undefined,
    storagePath: movieDir,
    cleanedUp,
  };
}

/**
 * Handle user cancellation: log message, cleanup, return early.
 */
async function handleCancellation(args: {
  planResult: Awaited<ReturnType<typeof generatePlan>>;
  storageMovieId: string;
  movieDir: string;
  storageRoot: string;
  basePath: string;
  isNew: boolean;
  logger: Logger;
  movieId?: string;
}): Promise<ExecuteResult> {
  const { planResult, storageMovieId, movieDir, storageRoot, basePath, isNew, logger } = args;

  logger.info('\nExecution cancelled.');
  logger.info('Tip: Run with --dry-run to see what would happen without executing.');

  const cleanedUp = await cleanupPartialRunDirectory({
    storageRoot,
    basePath,
    movieId: storageMovieId,
    isNew,
  });

  return {
    movieId: args.movieId ?? normalizePublicId(storageMovieId),
    storageMovieId,
    planPath: planResult.planPath,
    targetRevision: planResult.targetRevision,
    build: undefined,
    isDryRun: undefined,
    manifestPath: undefined,
    storagePath: movieDir,
    cleanedUp,
  };
}

/**
 * Format a movie ID with the "movie-" prefix if not present.
 */
export function formatMovieId(publicId: string): string {
  return publicId.startsWith('movie-') ? publicId : `movie-${publicId}`;
}
