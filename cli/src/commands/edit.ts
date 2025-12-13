import { resolve } from 'node:path';
import { getDefaultCliConfigPath, readCliConfig } from '../lib/cli-config.js';
import { formatMovieId } from './query.js';
import { generatePlan, type PendingArtefactDraft } from '../lib/planner.js';
import {
  executeDryRun,
  type DryRunSummary,
} from '../lib/dry-run.js';
import {
  executeBuild,
  type BuildSummary,
} from '../lib/build.js';
import { expandPath } from '../lib/path.js';
import { confirmPlanExecution } from '../lib/interactive-confirm.js';
import { displayPlanAndCosts } from '../lib/plan-display.js';
import { readMovieMetadata } from '../lib/movie-metadata.js';
import { resolveBlueprintSpecifier } from '../lib/config-assets.js';
import { resolveAndPersistConcurrency } from '../lib/concurrency.js';
import { cleanupPartialRunDirectory } from '../lib/cleanup.js';
import type { Logger } from '@renku/core';

export interface EditOptions {
  movieId: string;
  inputsPath?: string; // optional override for CLI --inputs during edits
  dryRun?: boolean;
  nonInteractive?: boolean;
  costsOnly?: boolean;
  usingBlueprint?: string;
  pendingArtefacts?: PendingArtefactDraft[];
  concurrency?: number;
  upToLayer?: number;
  logger: Logger;
}

export interface EditResult {
  storageMovieId: string;
  planPath: string;
  targetRevision: string;
  dryRun?: DryRunSummary;
  build?: BuildSummary;
  manifestPath?: string;
  storagePath: string;
  cleanedUp?: boolean;
}

export async function runEdit(options: EditOptions): Promise<EditResult> {
  const configPath = getDefaultCliConfigPath();
  const cliConfig = await readCliConfig(configPath);
  if (!cliConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }
  if (!options.movieId) {
    throw new Error('Movie ID is required for edit.');
  }
  const { concurrency } = await resolveAndPersistConcurrency(cliConfig, {
    override: options.concurrency,
    configPath,
  });

  const storageMovieId = formatMovieId(options.movieId);
  const storageRoot = cliConfig.storage.root;
  const basePath = cliConfig.storage.basePath;
  const movieDir = resolve(storageRoot, basePath, storageMovieId);
  const logger = options.logger;
  const upToLayer = options.upToLayer;
  if (options.dryRun && upToLayer !== undefined) {
    logger.info('--upToLayer applies only to live runs; dry runs will simulate all layers.');
  }

  const defaultInputsPath = resolve(movieDir, 'inputs.yaml');
  const inputsPath = expandPath(options.inputsPath ?? defaultInputsPath);

  const metadata = await readMovieMetadata(movieDir);
  const blueprintInput = options.usingBlueprint ?? metadata?.blueprintPath;
  if (!blueprintInput) {
    throw new Error(
      'Blueprint path is required for edit. Provide --blueprint=/path/to/blueprint.yaml or re-run the initial generation to capture blueprint metadata.',
    );
  }
  const blueprintPath = await resolveBlueprintSpecifier(blueprintInput, {
    cliRoot: cliConfig.storage.root,
  });

  const planResult = await generatePlan({
    cliConfig,
    movieId: storageMovieId,
    isNew: false,
    inputsPath,
    usingBlueprint: blueprintPath,
    pendingArtefacts: options.pendingArtefacts,
    logger,
  });

  if (options.dryRun) {
    logger.debug?.('edit.dryrun.plan.debug', {
      pendingInputs: planResult.inputEvents.length,
      layers: planResult.plan.layers.map((layer) => layer.length),
    });
  }

  const hasJobs = planResult.plan.layers.some((layer) => layer.length > 0);
  const nonInteractive = Boolean(options.nonInteractive);

  // Handle --costs-only: display plan summary and costs, then return early
  if (options.costsOnly) {
    displayPlanAndCosts({
      plan: planResult.plan,
      inputs: planResult.inputEvents,
      costSummary: planResult.costSummary,
      logger,
    });
    // For edits, isNew: false means no cleanup happens (preserve existing data)
    const cleanedUp = await cleanupPartialRunDirectory({
      storageRoot,
      basePath,
      movieId: storageMovieId,
      isNew: false,
    });
    return {
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

  // Determine if we should persist now (dry-run/non-interactive/no jobs) or after confirmation
  const shouldPersistBeforeConfirmation = options.dryRun || nonInteractive || !hasJobs;

  // For dry-run, non-interactive, or no jobs: persist immediately
  if (shouldPersistBeforeConfirmation) {
    await planResult.persist();
  }

  // Interactive confirmation (skip if dry-run, non-interactive, or no work to perform)
  if (hasJobs && !options.dryRun && !nonInteractive) {
    const confirmed = await confirmPlanExecution(planResult.plan, {
      inputs: planResult.inputEvents,
      concurrency,
      upToLayer,
      logger,
      costSummary: planResult.costSummary,
    });
    if (!confirmed) {
      logger.info('\nExecution cancelled.');
      logger.info('Tip: Run with --dry-run to see what would happen without executing.');
      // For edits, isNew: false means no cleanup happens (preserve existing data)
      const cleanedUp = await cleanupPartialRunDirectory({
        storageRoot,
        basePath,
        movieId: storageMovieId,
        isNew: false,
      });
      return {
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
    // User confirmed - persist now before execution
    await planResult.persist();
  }

  const dryRun = options.dryRun
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
    storageMovieId,
    planPath: planResult.planPath,
    targetRevision: planResult.targetRevision,
    dryRun,
    build: buildResult?.summary,
    manifestPath: buildResult?.manifestPath,
    storagePath: movieDir,
  };
}
