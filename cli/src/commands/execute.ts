import { resolve } from 'node:path';
import { getDefaultCliConfigPath, readCliConfig } from '../lib/cli-config.js';
import { generatePlan, type PendingArtefactDraft } from '../lib/planner.js';
import { executeDryRun, type DryRunSummary } from '../lib/dry-run.js';
import { executeBuild, type BuildSummary } from '../lib/build.js';
import { expandPath } from '../lib/path.js';
import { confirmPlanExecution } from '../lib/interactive-confirm.js';
import { displayPlanAndCosts } from '../lib/plan-display.js';
import { readMovieMetadata } from '../lib/movie-metadata.js';
import { resolveBlueprintSpecifier } from '../lib/config-assets.js';
import { resolveAndPersistConcurrency } from '../lib/concurrency.js';
import { cleanupPartialRunDirectory } from '../lib/cleanup.js';
import type { Logger } from '@renku/core';

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

  /** Logger instance */
  logger: Logger;
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

  /** Dry-run summary (if dryRun was true) */
  dryRun?: DryRunSummary;

  /** Build summary (if dryRun was false) */
  build?: BuildSummary;

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
  const cliConfig = await readCliConfig(configPath);
  if (!cliConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }

  const { concurrency } = await resolveAndPersistConcurrency(cliConfig, {
    override: options.concurrency,
    configPath,
  });

  const { storageMovieId, isNew, logger } = options;
  const storageRoot = cliConfig.storage.root;
  const basePath = cliConfig.storage.basePath;
  const movieDir = resolve(storageRoot, basePath, storageMovieId);
  const upToLayer = options.upToLayer;

  if (options.dryRun && upToLayer !== undefined) {
    logger.info('--upToLayer applies only to live runs; dry runs will simulate all layers.');
  }

  // Resolve inputs path - required for both new and edit (no fallback)
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

  // Execute dry-run or build
  const dryRunResult = options.dryRun
    ? await executeDryRun({
        movieId: storageMovieId,
        plan: planResult.plan,
        manifest: planResult.manifest,
        manifestHash: planResult.manifestHash,
        providerOptions: planResult.providerOptions,
        resolvedInputs: planResult.resolvedInputs,
        catalog: planResult.modelCatalog,
        concurrency,
        storage: { rootDir: storageRoot, basePath },
        logger,
      })
    : undefined;

  let buildResult: Awaited<ReturnType<typeof executeBuild>> | undefined;
  if (!options.dryRun) {
    buildResult = await executeBuild({
      cliConfig,
      movieId: storageMovieId,
      plan: planResult.plan,
      manifest: planResult.manifest,
      manifestHash: planResult.manifestHash,
      providerOptions: planResult.providerOptions,
      resolvedInputs: planResult.resolvedInputs,
      catalog: planResult.modelCatalog,
      logger,
      concurrency,
      upToLayer,
    });
  }

  return {
    movieId: options.movieId ?? normalizePublicId(storageMovieId),
    storageMovieId,
    planPath: planResult.planPath,
    targetRevision: planResult.targetRevision,
    dryRun: dryRunResult,
    build: buildResult?.summary,
    manifestPath: buildResult?.manifestPath,
    storagePath: movieDir,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Resolve inputs path - no fallback, always required.
 */
function resolveInputsPath(explicitPath: string | undefined): string {
  if (!explicitPath) {
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
    dryRun: undefined,
    build: undefined,
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
    dryRun: undefined,
    build: undefined,
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
