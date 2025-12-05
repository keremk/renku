import { resolve } from 'node:path';
import { getDefaultCliConfigPath, readCliConfig } from '../lib/cli-config.js';
import { generatePlan } from '../lib/planner.js';
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
import { confirmPlanWithInk } from '../lib/plan-confirmation.js';
import { cleanupPlanFiles } from '../lib/plan-cleanup.js';
import { resolveBlueprintSpecifier } from '../lib/config-assets.js';
import { resolveAndPersistConcurrency } from '../lib/concurrency.js';
import type { Logger, NotificationBus } from '@renku/core';
import type { CliLoggerMode } from '../lib/logger.js';

export interface QueryOptions {
  movieId: string;
  storageMovieId: string;
  inputsPath?: string;
  dryRun?: boolean;
  nonInteractive?: boolean;
  usingBlueprint: string;
  concurrency?: number;
  upToLayer?: number;
  mode: CliLoggerMode;
  notifications?: NotificationBus;
  onExecutionStart?: () => void;
  logger: Logger;
}

export interface QueryResult {
  movieId: string;
  storageMovieId: string;
  planPath: string;
  targetRevision: string;
  dryRun?: DryRunSummary;
  build?: BuildSummary;
  manifestPath?: string;
  storagePath: string;
}

export async function runQuery(options: QueryOptions): Promise<QueryResult> {
  const inputsPath = options.inputsPath ? expandPath(options.inputsPath) : undefined;
  if (!inputsPath) {
    throw new Error('Input YAML path is required. Provide --inputs=/path/to/inputs.yaml');
  }

  if (!options.usingBlueprint || options.usingBlueprint.trim().length === 0) {
    throw new Error('Blueprint path is required. Provide --blueprint=/path/to/blueprint.yaml');
  }

  const configPath = getDefaultCliConfigPath();
  const cliConfig = await readCliConfig(configPath);
  if (!cliConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }
  const logger = options.logger;
  const { movieId, storageMovieId } = options;
  const { concurrency } = await resolveAndPersistConcurrency(cliConfig, {
    override: options.concurrency,
    configPath,
  });
  const storageRoot = cliConfig.storage.root;
  const storageBasePath = cliConfig.storage.basePath;
  const upToLayer = options.upToLayer;
  if (options.dryRun && upToLayer !== undefined) {
    logger.info('--upToLayer applies only to live runs; dry runs will simulate all layers.');
  }

  const blueprintPath = await resolveBlueprintSpecifier(options.usingBlueprint, {
    cliRoot: cliConfig.storage.root,
  });

  const planResult = await generatePlan({
    cliConfig,
    movieId: options.storageMovieId,
    isNew: true,
    inputsPath,
    usingBlueprint: blueprintPath,
    logger,
    notifications: options.notifications,
  });

  const movieDir = resolve(storageRoot, storageBasePath, storageMovieId);
  const nonInteractive = options.mode === 'log' ? Boolean(options.nonInteractive) : false;
  if (options.nonInteractive && options.mode === 'tui') {
    throw new Error('--non-interactive is only supported in log mode.');
  }

  // Interactive confirmation (skip if dry-run or non-interactive)
  if (!options.dryRun && !nonInteractive) {
    const confirmed =
      options.mode === 'tui'
        ? await confirmPlanWithInk({
            plan: planResult.plan,
            concurrency,
            upToLayer,
          })
        : await confirmPlanExecution(planResult.plan, {
            inputs: planResult.inputEvents,
            concurrency,
            upToLayer,
            logger,
          });
    if (!confirmed) {
      await cleanupPlanFiles(movieDir);
      logger.info('\nExecution cancelled.');
      logger.info('Tip: Run with --dry-run to see what would happen without executing.');
      options.notifications?.publish({
        type: 'warning',
        message: 'Execution cancelled.',
        timestamp: new Date().toISOString(),
      });
      return {
        movieId: options.movieId,
        storageMovieId: options.storageMovieId,
        planPath: planResult.planPath,
        targetRevision: planResult.targetRevision,
        dryRun: undefined,
        build: undefined,
        manifestPath: undefined,
        storagePath: movieDir,
      };
    }
  }

  if (options.dryRun) {
    options.onExecutionStart?.();
    options.notifications?.publish({
      type: 'progress',
      message: 'Starting dry run...',
      timestamp: new Date().toISOString(),
    });
  }
  const dryRun = options.dryRun
    ? await executeDryRun({
        movieId: storageMovieId,
        plan: planResult.plan,
        manifest: planResult.manifest,
        manifestHash: planResult.manifestHash,
        providerOptions: planResult.providerOptions,
        resolvedInputs: planResult.resolvedInputs,
        concurrency,
        storage: { rootDir: storageRoot, basePath: storageBasePath },
        logger,
        notifications: options.notifications,
      })
    : undefined;
  if (options.dryRun && dryRun) {
    options.notifications?.publish({
      type: dryRun.status === 'succeeded' ? 'success' : 'error',
      message: `Dry run ${dryRun.status}.`,
      timestamp: new Date().toISOString(),
    });
  }

  let buildResult: Awaited<ReturnType<typeof executeBuild>> | undefined;
  if (!options.dryRun) {
    options.onExecutionStart?.();
    options.notifications?.publish({
      type: 'progress',
      message: 'Starting live run...',
      timestamp: new Date().toISOString(),
    });
    buildResult = await executeBuild({
      cliConfig,
      movieId: storageMovieId,
      plan: planResult.plan,
      manifest: planResult.manifest,
      manifestHash: planResult.manifestHash,
      providerOptions: planResult.providerOptions,
      resolvedInputs: planResult.resolvedInputs,
      logger,
      concurrency,
      upToLayer,
      notifications: options.notifications,
    });
    options.notifications?.publish({
      type: buildResult.summary.status === 'succeeded' ? 'success' : 'error',
      message: `Run ${buildResult.summary.status}.`,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    movieId,
    storageMovieId,
    planPath: planResult.planPath,
    targetRevision: planResult.targetRevision,
    dryRun,
    build: buildResult?.summary,
    manifestPath: buildResult?.manifestPath,
    storagePath: resolve(storageRoot, storageBasePath, storageMovieId),
  };
}

export function formatMovieId(publicId: string): string {
  return publicId.startsWith('movie-') ? publicId : `movie-${publicId}`;
}
