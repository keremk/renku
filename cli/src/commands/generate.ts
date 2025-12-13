import { getDefaultCliConfigPath, persistLastMovieId, readCliConfig, type CliConfig } from '../lib/cli-config.js';
import { runQuery, type QueryResult, formatMovieId } from './query.js';
import { runEdit, type EditResult } from './edit.js';
import { resolveAndPersistConcurrency } from '../lib/concurrency.js';
import { buildFriendlyView, loadCurrentManifest, prepareFriendlyPreflight } from '../lib/friendly-view.js';
import crypto from 'node:crypto';
import { resolve } from 'node:path';
import type { LogLevel } from '@renku/core';
import { createCliLogger } from '../lib/logger.js';

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
  logLevel: LogLevel;
}

export interface GenerateResult {
  movieId: string;
  storageMovieId: string;
  planPath: string;
  targetRevision: string;
  dryRun?: QueryResult['dryRun'] | EditResult['dryRun'];
  build?: QueryResult['build'] | EditResult['build'];
  manifestPath?: string;
  storagePath: string;
  friendlyRoot?: string;
  isNew: boolean;
  cleanedUp?: boolean;
}

export async function runGenerate(options: GenerateOptions): Promise<GenerateResult> {
  const configPath = getDefaultCliConfigPath();
  const cliConfig = await readCliConfig(configPath);
  if (!cliConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }

  const { concurrency, cliConfig: resolvedCliConfig } = await resolveAndPersistConcurrency(cliConfig, {
    override: options.concurrency,
    configPath,
  });
  const activeConfig = resolvedCliConfig;

  const usingLast = Boolean(options.useLast);
  if (usingLast && options.movieId) {
    throw new Error('Use either --last or --movie-id/--id, not both.');
  }

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

    const preflight = await prepareFriendlyPreflight({
      cliConfig: activeConfig,
      movieId: storageMovieId,
      manifest,
      allowShardedBlobs: true,
    });

    const editResult = await runEdit({
      movieId: storageMovieId,
      inputsPath: options.inputsPath,
      dryRun: options.dryRun,
      nonInteractive: options.nonInteractive,
      costsOnly: options.costsOnly,
      usingBlueprint: options.blueprint,
      pendingArtefacts: preflight.pendingArtefacts,
      concurrency,
      upToLayer,
      logger,
    });

    let friendlyRoot: string | undefined;
    if (!options.dryRun && editResult.build) {
      const { manifest: nextManifest } = await loadCurrentManifest(activeConfig, storageMovieId);
      const friendly = await buildFriendlyView({
        cliConfig: activeConfig,
        movieId: storageMovieId,
        manifest: nextManifest,
      });
      friendlyRoot = friendly.friendlyRoot;
    }

    if (editResult.build || editResult.dryRun) {
      await persistLastMovieId(storageMovieId, configPath);
    }

    return {
      movieId: normalizePublicId(storageMovieId),
      storageMovieId,
      planPath: editResult.planPath,
      targetRevision: editResult.targetRevision,
      dryRun: editResult.dryRun,
      build: editResult.build,
      manifestPath: editResult.manifestPath,
      storagePath: editResult.storagePath,
      friendlyRoot,
      isNew: false,
      cleanedUp: editResult.cleanedUp,
    };
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

  if (!options.inputsPath) {
    throw new Error('Input YAML path is required for a new generation. Provide --inputs=/path/to/inputs.yaml');
  }
  if (!options.blueprint) {
    throw new Error('Blueprint path is required for a new generation. Provide --blueprint=/path/to/blueprint.yaml');
  }

  const queryResult = await runQuery({
    movieId: newMovieId,
    storageMovieId,
    inputsPath: options.inputsPath,
    dryRun: options.dryRun,
    nonInteractive: options.nonInteractive,
    costsOnly: options.costsOnly,
    usingBlueprint: options.blueprint,
    concurrency,
    upToLayer,
    logger,
  });

  let friendlyRoot: string | undefined;
  if (!options.dryRun && queryResult.build) {
    const { manifest } = await loadCurrentManifest(activeConfig, queryResult.storageMovieId);
    const friendly = await buildFriendlyView({
      cliConfig: activeConfig,
      movieId: queryResult.storageMovieId,
      manifest,
    });
    friendlyRoot = friendly.friendlyRoot;
  }

  if (queryResult.build || queryResult.dryRun) {
    await persistLastMovieId(queryResult.storageMovieId, configPath);
  }

  return {
    movieId: queryResult.movieId,
    storageMovieId: queryResult.storageMovieId,
    planPath: queryResult.planPath,
    targetRevision: queryResult.targetRevision,
    dryRun: queryResult.dryRun,
    build: queryResult.build,
    manifestPath: queryResult.manifestPath,
    storagePath: queryResult.storagePath,
    friendlyRoot,
    isNew: true,
    cleanedUp: queryResult.cleanedUp,
  };
}

async function resolveTargetMovieId(args: {
  explicitMovieId?: string;
  useLast: boolean;
  cliConfig: CliConfig;
}): Promise<string> {
  if (args.explicitMovieId) {
    return formatMovieId(args.explicitMovieId);
  }

  if (!args.useLast) {
    throw new Error('Movie ID resolution failed: neither explicit movie ID nor --last provided.');
  }

  if (!args.cliConfig.lastMovieId) {
    throw new Error('No previous movie found. Run a new generation first or provide --movie-id.');
  }

  return formatMovieId(args.cliConfig.lastMovieId);
}

function normalizePublicId(storageMovieId: string): string {
  return storageMovieId.startsWith('movie-') ? storageMovieId.slice('movie-'.length) : storageMovieId;
}

function generateMovieId(): string {
  return crypto.randomUUID().slice(0, 8);
}
