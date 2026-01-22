import { resolve as resolvePath } from 'node:path';
import {
  createEventLog,
  createManifestService,
  createStorageContext,
  initializeMovieStorage,
  loadCloudStorageEnv,
  createCloudStorageContext,
  resolveBlobRefsToInputs,
  injectAllSystemInputs,
  executePlanWithConcurrency,
  type ExecutionPlan,
  type Manifest,
  type RunResult,
  type RunConfig,
  type Logger,
  type StorageContext,
} from '@gorenku/core';
import {
  createProviderRegistry,
  createProviderProduce,
  prepareProviderHandlers,
  type LoadedModelCatalog,
} from '@gorenku/providers';
import type { CliConfig } from './cli-config.js';
import { normalizeConcurrency } from './cli-config.js';
import type { ProducerOptionsMap } from '@gorenku/core';
import chalk from 'chalk';

export interface ExecuteBuildOptions {
  cliConfig: CliConfig;
  movieId: string;
  plan: ExecutionPlan;
  manifest: Manifest;
  manifestHash: string | null;
  providerOptions: ProducerOptionsMap;
  resolvedInputs: Record<string, unknown>;
  /** Pre-loaded model catalog for provider registry. */
  catalog?: LoadedModelCatalog;
  /** Path to the catalog models directory. Required for schema loading in delegation. */
  catalogModelsDir?: string;
  concurrency?: number;
  /** Layer to stop at (only used when dryRun=false). */
  upToLayer?: number;
  /** Re-run from specific layer (skips earlier layers). */
  reRunFrom?: number;
  /** Target artifact IDs for surgical regeneration (canonical format). */
  targetArtifactIds?: string[];
  /** Enable dry-run mode: simulated providers, no S3 uploads. */
  dryRun?: boolean;
  logger?: Logger;
  notifications?: import('@gorenku/core').NotificationBus;
}

export interface JobSummary {
  jobId: string;
  producer: string;
  status: 'succeeded' | 'failed' | 'skipped';
  layerIndex: number;
  errorMessage?: string;
}

export interface BuildSummary {
  status: RunResult['status'];
  jobCount: number;
  counts: {
    succeeded: number;
    failed: number;
    skipped: number;
  };
  /** Number of layers in the execution plan */
  layers: number;
  /** Job-level details for display (optional) */
  jobs?: JobSummary[];
  manifestRevision: string;
  manifestPath: string;
}

export interface ExecuteBuildResult {
  run: RunResult;
  manifest: Manifest;
  manifestPath: string;
  manifestHash: string;
  summary: BuildSummary;
  /** True if this was a dry-run (simulated execution). */
  dryRun: boolean;
}

export async function executeBuild(options: ExecuteBuildOptions): Promise<ExecuteBuildResult> {
  const { dryRun = false } = options;
  const logger = options.logger ?? globalThis.console;
  const notifications = options.notifications;
  const storage = createStorageContext({
    kind: 'local',
    rootDir: options.cliConfig.storage.root,
    basePath: options.cliConfig.storage.basePath,
  });
  const concurrency = normalizeConcurrency(options.concurrency);

  await initializeMovieStorage(storage, options.movieId);

  const eventLog = createEventLog(storage);
  const manifestService = createManifestService(storage);

  // Cloud storage: Real for live, stubbed for dry-run (no S3 uploads)
  const cloudStorageEnv = loadCloudStorageEnv();
  const cloudStorage = dryRun
    ? createDryRunCloudStorage(
        options.cliConfig.storage.root,
        options.cliConfig.storage.basePath,
        options.movieId,
      )
    : cloudStorageEnv.isConfigured
      ? createCloudStorageContext(cloudStorageEnv.config!)
      : undefined;

  // Provider registry: mode differs based on dryRun flag
  const registry = createProviderRegistry({
    mode: dryRun ? 'simulated' : 'live',
    logger,
    notifications,
    cloudStorage,
    catalog: options.catalog,
    catalogModelsDir: options.catalogModelsDir,
  });
  const preResolved = prepareProviderHandlers(registry, options.plan, options.providerOptions);
  await registry.warmStart?.(preResolved);

  // Resolve BlobRef objects to BlobInput format for provider execution
  // BlobRefs are stored in inputs.log for efficiency, but providers need actual blob data
  const resolvedInputsWithBlobs = (await resolveBlobRefsToInputs(
    storage,
    options.movieId,
    options.resolvedInputs,
  )) as Record<string, unknown>;

  // Inject all system inputs (base and derived)
  const resolvedInputsWithSystem = injectAllSystemInputs(
    resolvedInputsWithBlobs,
    options.movieId,
    options.cliConfig.storage.root,
    options.cliConfig.storage.basePath,
  );

  const produce = createProviderProduce(
    registry,
    options.providerOptions,
    resolvedInputsWithSystem,
    preResolved,
    logger,
    notifications,
  );

  const run = await executePlanWithConcurrency(
    options.plan,
    {
      movieId: options.movieId,
      manifest: options.manifest,
      storage,
      eventLog,
      manifestService,
      produce,
      logger,
      notifications,
    },
    {
      concurrency,
      upToLayer: options.upToLayer,
      reRunFrom: options.reRunFrom,
      onProgress: (event) => {
        // Log progress events with chalk formatting
        if (event.type === 'layer-empty') {
          logger.info?.(`${chalk.dim(`--- ${event.message} ---`)}\n`);
        } else if (event.type === 'layer-skipped') {
          logger.info?.(`${chalk.yellow(`--- ${event.message} ---`)}\n`);
        } else if (event.type === 'layer-start') {
          logger.info?.(`${chalk.blue(`--- ${event.message} ---`)}\n`);
        } else if (event.type === 'layer-complete') {
          logger.info?.(`\n${chalk.blue(`--- ${event.message} ---`)}\n`);
        }
      },
    },
  );

  // Always save the manifest after execution completes, even if some jobs failed.
  // This enables retry functionality via --movie-id or --last.
  // The manifest will contain all successfully produced artifacts up to the point of failure.
  const manifest = await run.buildManifest();

  // Record run configuration in the manifest for observability
  const runConfig: RunConfig = {};
  if (options.upToLayer !== undefined) {
    runConfig.upToLayer = options.upToLayer;
  }
  if (options.reRunFrom !== undefined) {
    runConfig.reRunFrom = options.reRunFrom;
  }
  if (options.targetArtifactIds && options.targetArtifactIds.length > 0) {
    runConfig.targetArtifactIds = options.targetArtifactIds;
  }
  if (dryRun) {
    runConfig.dryRun = true;
  }
  if (concurrency !== undefined) {
    runConfig.concurrency = concurrency;
  }
  if (Object.keys(runConfig).length > 0) {
    manifest.runConfig = runConfig;
  }

  const { hash } = await manifestService.saveManifest(manifest, {
    movieId: options.movieId,
    previousHash: options.manifestHash,
    clock: { now: () => new Date().toISOString() },
  });

  const relativeManifestPath = storage.resolve(
    options.movieId,
    'manifests',
    `${manifest.revision}.json`,
  );
  const manifestPath = resolvePath(options.cliConfig.storage.root, relativeManifestPath);

  // Log warning if build had failures
  if (run.status === 'failed') {
    const failedJobs = run.jobs.filter((j) => j.status === 'failed');
    logger.warn?.(
      `Build completed with ${failedJobs.length} failed job(s). ` +
        `Manifest saved - you can retry with: renku generate --movie-id=${options.movieId.replace('movie-', '')} --in=<inputs.yaml>`,
    );
  }

  return {
    run,
    manifest,
    manifestPath,
    manifestHash: hash,
    summary: summarizeRun(run, manifestPath, options.plan),
    dryRun,
  };
}

function summarizeRun(run: RunResult, manifestPath: string, plan: ExecutionPlan): BuildSummary {
  const counts = {
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };

  const jobs: JobSummary[] = [];

  for (const job of run.jobs) {
    if (job.status === 'failed') {
      counts.failed += 1;
    } else if (job.status === 'skipped') {
      counts.skipped += 1;
    } else {
      counts.succeeded += 1;
    }

    jobs.push({
      jobId: job.jobId,
      producer: job.producer,
      status: job.status,
      layerIndex: job.layerIndex,
      errorMessage: job.error?.message,
    });
  }

  return {
    status: run.status,
    jobCount: run.jobs.length,
    counts,
    layers: plan.layers.length,
    jobs,
    manifestRevision: run.revision,
    manifestPath,
  };
}

/**
 * Creates a stubbed cloud storage context for dry-run mode.
 * Uses local storage for blob writes but returns fake URLs instead of uploading to S3.
 * This validates the code path (blob key generation) without actual S3 uploads.
 *
 * IMPORTANT: The uploadBlobAndGetUrl() function in providers/src/sdk/runtime.ts
 * writes directly to `cloudStorage.storage.write(key)` with a path like "blobs/ab/hash.ext".
 * This bypasses the StorageContext.resolve() method entirely, writing relative to the
 * storage adapter's rootDir. To ensure blobs land inside the movie directory, we must
 * configure the storage adapter with rootDir pointing to the movie folder itself.
 *
 * @param rootDir - The root directory for storage (e.g., "/home/user/movies")
 * @param basePath - The base path within root (e.g., "builds")
 * @param movieId - The movie ID to scope blob writes to (e.g., "movie-abc123")
 */
function createDryRunCloudStorage(
  rootDir: string,
  basePath: string,
  movieId: string,
): StorageContext {
  // Create storage with rootDir pointing directly to the movie folder.
  // This is necessary because uploadBlobAndGetUrl() writes directly to storage.write()
  // with paths like "blobs/ab/hash.ext", bypassing resolve().
  // By setting rootDir to the movie folder, these writes land in the correct location.
  const movieRootDir = `${rootDir}/${basePath}/${movieId}`;
  const movieScopedStorage = createStorageContext({
    kind: 'local',
    rootDir: movieRootDir,
    basePath: '', // No additional basePath needed since rootDir is already scoped
  });

  return {
    ...movieScopedStorage,
    temporaryUrl: async (path: string) => {
      // Validate path format to catch bugs in blob key generation
      if (!path.startsWith('blobs/')) {
        throw new Error(`Invalid blob path for dry-run: ${path}`);
      }
      return `https://dry-run.invalid/${path}`;
    },
  };
}
