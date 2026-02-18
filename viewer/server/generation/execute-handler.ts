/**
 * Handler for POST /viewer-api/generate/execute
 * Executes a prepared plan. Returns immediately with job ID.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
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
  isRenkuError,
  createLogger,
  createNotificationBus,
  type StorageContext,
  type ExecutionPlan,
  type Manifest,
  type RunConfig,
  type Logger,
  type NotificationBus,
} from '@gorenku/core';
import {
  createProviderRegistry,
  createProviderProduce,
  prepareProviderHandlers,
  loadModelCatalog,
} from '@gorenku/providers';

import type {
  ExecuteRequest,
  ExecuteResponse,
  BuildSummaryInfo,
  JobDetailInfo,
  SSEEvent,
} from './types.js';
import {
  requireCliConfig,
  normalizeConcurrency,
  type CliConfig,
} from './config.js';
import { getJobManager } from './job-manager.js';
import { parseJsonBody, sendJson, sendError } from './http-utils.js';

/**
 * Handles POST /viewer-api/generate/execute
 */
export async function handleExecuteRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  try {
    // Parse request body
    const body = await parseJsonBody<ExecuteRequest>(req);
    if (!body.planId) {
      sendError(res, 400, 'Missing required field: planId');
      return true;
    }

    // Load CLI config
    const cliConfig = await requireCliConfig();

    // Get cached plan
    const jobManager = getJobManager();
    const cachedPlan = jobManager.getPlan(body.planId);

    // Check if there's already a running job for this movie
    const existingJobs = jobManager.listJobs();
    const runningJob = existingJobs.find(
      (j) =>
        j.movieId === cachedPlan.movieId &&
        (j.status === 'pending' ||
          j.status === 'running' ||
          j.status === 'planning' ||
          (j.status === 'cancelled' && !j.completedAt))
    );
    if (runningJob) {
      sendError(
        res,
        409,
        `Job already running for movie ${cachedPlan.movieId}: ${runningJob.jobId}`,
        'R113'
      );
      return true;
    }

    // Create execution job
    const job = jobManager.createJob(
      cachedPlan.movieId,
      cachedPlan.planId,
      cachedPlan.plan.layers.length
    );

    // Start execution asynchronously
    executeJobAsync(job.jobId, cachedPlan, cliConfig, {
      concurrency: body.concurrency,
      reRunFrom: body.reRunFrom,
      upToLayer: body.upToLayer,
      dryRun: body.dryRun,
    }).catch((error) => {
      console.error(`[execute-handler] Job ${job.jobId} failed:`, error);
    });

    // Return immediately with job info
    const response: ExecuteResponse = {
      jobId: job.jobId,
      movieId: cachedPlan.movieId,
      status: 'planning',
      streamUrl: `/viewer-api/generate/jobs/${job.jobId}/stream`,
      startedAt: job.startedAt.toISOString(),
    };

    sendJson(res, response, 202);
    return true;
  } catch (error) {
    if (isRenkuError(error)) {
      sendError(res, 400, error.message, error.code);
    } else if (error instanceof Error) {
      sendError(res, 500, error.message);
    } else {
      sendError(res, 500, 'Unknown error occurred');
    }
    return true;
  }
}

/**
 * Execute options passed to executeJobAsync.
 */
interface ExecuteOptions {
  concurrency?: number;
  reRunFrom?: number;
  upToLayer?: number;
  dryRun?: boolean;
}

/**
 * Executes a job asynchronously.
 * Updates job status and broadcasts SSE events during execution.
 */
async function executeJobAsync(
  jobId: string,
  cachedPlan: {
    planId: string;
    movieId: string;
    plan: ExecutionPlan;
    manifest: Manifest;
    manifestHash: string | null;
    resolvedInputs: Record<string, unknown>;
    providerOptions: Map<string, unknown>;
    blueprintPath: string;
    basePath: string;
    catalogModelsDir?: string;
    persist: () => Promise<void>;
  },
  cliConfig: CliConfig,
  options: ExecuteOptions
): Promise<void> {
  const jobManager = getJobManager();
  const { dryRun = false } = options;

  // Create logger and notifications for provider execution
  const logger: Logger = createLogger({
    level: 'info',
    prefix: '[viewer-execution]',
  });

  const notifications: NotificationBus = createNotificationBus();
  const unsubscribeNotifications = notifications.subscribe((notification) => {
    if (jobManager.isJobCancelled(jobId)) {
      return;
    }

    broadcastEvent(jobId, {
      type: 'job-progress',
      timestamp: notification.timestamp,
      level: notification.type,
      message: notification.message,
    });
  });

  try {
    // Update status to planning
    jobManager.updateJobStatus(jobId, 'planning');
    broadcastEvent(jobId, {
      type: 'plan-ready',
      timestamp: new Date().toISOString(),
      planId: cachedPlan.planId,
      totalLayers: cachedPlan.plan.layers.length,
      totalJobs: cachedPlan.plan.layers.reduce(
        (sum, layer) => sum + layer.length,
        0
      ),
    });

    // Check if cancelled
    if (jobManager.isJobCancelled(jobId)) {
      jobManager.finalizeCancelledJob(jobId);
      return;
    }

    // Persist the plan to disk (this was deferred during planning)
    await cachedPlan.persist();

    // Remove plan from cache (it's been used)
    jobManager.removePlan(cachedPlan.planId);

    if (jobManager.isJobCancelled(jobId)) {
      jobManager.finalizeCancelledJob(jobId);
      return;
    }

    // Update status to running
    jobManager.updateJobStatus(jobId, 'running');

    // Create storage context using the blueprint-relative basePath
    const storage = createStorageContext({
      kind: 'local',
      rootDir: cliConfig.storage.root,
      basePath: cachedPlan.basePath,
    });

    await initializeMovieStorage(storage, cachedPlan.movieId);

    const eventLog = createEventLog(storage);
    const manifestService = createManifestService(storage);

    // Cloud storage: Real for live, stubbed for dry-run
    const cloudStorageEnv = loadCloudStorageEnv();
    const cloudStorage = dryRun
      ? createDryRunCloudStorage(
          cliConfig.storage.root,
          cachedPlan.basePath,
          cachedPlan.movieId
        )
      : cloudStorageEnv.isConfigured
        ? createCloudStorageContext(cloudStorageEnv.config!)
        : undefined;

    // Load model catalog if available
    const modelCatalog = cachedPlan.catalogModelsDir
      ? await loadModelCatalog(cachedPlan.catalogModelsDir)
      : undefined;

    // Provider registry
    const registry = createProviderRegistry({
      mode: dryRun ? 'simulated' : 'live',
      logger,
      notifications,
      cloudStorage,
      catalog: modelCatalog,
      catalogModelsDir: cachedPlan.catalogModelsDir,
    });

    // Cast to ProducerOptionsMap for type compatibility
    const providerOpts =
      cachedPlan.providerOptions as unknown as import('@gorenku/core').ProducerOptionsMap;
    const preResolved = prepareProviderHandlers(
      registry,
      cachedPlan.plan,
      providerOpts
    );
    await registry.warmStart?.(preResolved);

    // Resolve BlobRef objects to BlobInput format
    const resolvedInputsWithBlobs = (await resolveBlobRefsToInputs(
      storage,
      cachedPlan.movieId,
      cachedPlan.resolvedInputs
    )) as Record<string, unknown>;

    // Inject all system inputs
    const resolvedInputsWithSystem = injectAllSystemInputs(
      resolvedInputsWithBlobs,
      cachedPlan.movieId,
      cliConfig.storage.root,
      cachedPlan.basePath
    );

    const produce = createProviderProduce(
      registry,
      providerOpts,
      resolvedInputsWithSystem,
      preResolved,
      logger,
      notifications
    );

    const concurrency = normalizeConcurrency(
      options.concurrency ?? cliConfig.concurrency
    );

    // Track layer results for summary
    const layerStats: Map<
      number,
      { succeeded: number; failed: number; skipped: number }
    > = new Map();

    const abortSignal = jobManager.getJob(jobId).abortController.signal;

    // Execute plan with progress tracking
    const run = await executePlanWithConcurrency(
      cachedPlan.plan,
      {
        movieId: cachedPlan.movieId,
        manifest: cachedPlan.manifest,
        storage,
        eventLog,
        manifestService,
        produce,
      },
      {
        concurrency,
        reRunFrom: options.reRunFrom,
        upToLayer: options.upToLayer,
        signal: abortSignal,
        onProgress: (event) => {
          // Check if cancelled
          if (jobManager.isJobCancelled(jobId)) {
            return;
          }

          const layerIndex = event.layerIndex ?? 0;
          const producerName =
            typeof event.producer === 'string' ? event.producer : 'unknown';

          if (event.type === 'layer-start') {
            layerStats.set(layerIndex, { succeeded: 0, failed: 0, skipped: 0 });
            jobManager.updateJobProgress(
              jobId,
              Math.round((layerIndex / cachedPlan.plan.layers.length) * 100),
              layerIndex
            );
            broadcastEvent(jobId, {
              type: 'layer-start',
              timestamp: new Date().toISOString(),
              layerIndex,
              jobCount: event.progress?.total ?? 0,
            });
          } else if (event.type === 'layer-complete') {
            const stats = layerStats.get(layerIndex) ?? {
              succeeded: 0,
              failed: 0,
              skipped: 0,
            };
            broadcastEvent(jobId, {
              type: 'layer-complete',
              timestamp: new Date().toISOString(),
              layerIndex,
              succeeded: stats.succeeded,
              failed: stats.failed,
              skipped: stats.skipped,
            });
          } else if (event.type === 'layer-skipped') {
            // Layer skipped due to reRunFrom - broadcast to UI
            broadcastEvent(jobId, {
              type: 'layer-skipped',
              timestamp: new Date().toISOString(),
              layerIndex,
              reason: event.message ?? 'Re-running from a later layer',
            });
          } else if (event.type === 'job-start') {
            const detail: JobDetailInfo = {
              jobId: event.jobId ?? 'unknown',
              producer: producerName,
              status: 'running',
              layerIndex,
            };
            jobManager.updateJobDetail(jobId, detail);
            broadcastEvent(jobId, {
              type: 'job-start',
              timestamp: new Date().toISOString(),
              jobId: event.jobId ?? 'unknown',
              producer: producerName,
              layerIndex,
            });
          } else if (event.type === 'job-complete') {
            const jobStatus = event.status as
              | 'succeeded'
              | 'failed'
              | 'skipped'
              | undefined;
            const errorMessage = event.error?.message;

            // Update layer stats
            const stats = layerStats.get(layerIndex);
            if (stats && jobStatus) {
              if (jobStatus === 'succeeded') stats.succeeded++;
              else if (jobStatus === 'failed') stats.failed++;
              else if (jobStatus === 'skipped') stats.skipped++;
            }

            const detail: JobDetailInfo = {
              jobId: event.jobId ?? 'unknown',
              producer: producerName,
              status: jobStatus ?? 'succeeded',
              layerIndex,
              errorMessage,
            };
            jobManager.updateJobDetail(jobId, detail);
            broadcastEvent(jobId, {
              type: 'job-complete',
              timestamp: new Date().toISOString(),
              jobId: event.jobId ?? 'unknown',
              producer: producerName,
              status: jobStatus ?? 'succeeded',
              errorMessage,
            });
          }
        },
      }
    );

    // Build manifest and save
    const manifest = await run.buildManifest();

    // Record run configuration
    const runConfig: RunConfig = {};
    if (options.upToLayer !== undefined) {
      runConfig.upToLayer = options.upToLayer;
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

    await manifestService.saveManifest(manifest, {
      movieId: cachedPlan.movieId,
      previousHash: cachedPlan.manifestHash,
      clock: { now: () => new Date().toISOString() },
    });

    if (jobManager.isJobCancelled(jobId)) {
      jobManager.finalizeCancelledJob(jobId);
      return;
    }

    const relativeManifestPath = storage.resolve(
      cachedPlan.movieId,
      'manifests',
      `${manifest.revision}.json`
    );
    const manifestPath = resolvePath(
      cliConfig.storage.root,
      relativeManifestPath
    );

    // Build summary
    const summary = summarizeRun(run, manifestPath);
    jobManager.setJobSummary(jobId, summary);
    jobManager.updateJobProgress(jobId, 100, cachedPlan.plan.layers.length);
    jobManager.updateJobStatus(
      jobId,
      run.status === 'failed' ? 'failed' : 'completed'
    );

    broadcastEvent(jobId, {
      type: 'execution-complete',
      timestamp: new Date().toISOString(),
      status: run.status,
      summary,
    });
  } catch (error) {
    if (jobManager.isJobCancelled(jobId)) {
      jobManager.finalizeCancelledJob(jobId);
      return;
    }

    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    jobManager.setJobError(jobId, errorMessage);
    jobManager.updateJobStatus(jobId, 'failed');

    broadcastEvent(jobId, {
      type: 'error',
      timestamp: new Date().toISOString(),
      message: errorMessage,
      code: isRenkuError(error) ? error.code : undefined,
    });
  } finally {
    unsubscribeNotifications();
    notifications.complete();
  }
}

/**
 * Helper to broadcast SSE event.
 */
function broadcastEvent(jobId: string, event: SSEEvent): void {
  const jobManager = getJobManager();
  jobManager.broadcastEvent(jobId, event);
}

/**
 * Summarizes a run result.
 */
function summarizeRun(
  run: { status: string; revision: string; jobs: Array<{ status: string }> },
  manifestPath: string
): BuildSummaryInfo {
  const counts = {
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };

  for (const job of run.jobs) {
    if (job.status === 'failed') {
      counts.failed += 1;
    } else if (job.status === 'skipped') {
      counts.skipped += 1;
    } else {
      counts.succeeded += 1;
    }
  }

  return {
    status: run.status as 'succeeded' | 'failed' | 'partial',
    jobCount: run.jobs.length,
    counts,
    manifestRevision: run.revision,
    manifestPath,
  };
}

/**
 * Creates a stubbed cloud storage context for dry-run mode.
 */
function createDryRunCloudStorage(
  rootDir: string,
  basePath: string,
  movieId: string
): StorageContext {
  const movieRootDir = `${rootDir}/${basePath}/${movieId}`;
  const movieScopedStorage = createStorageContext({
    kind: 'local',
    rootDir: movieRootDir,
    basePath: '',
  });

  return {
    ...movieScopedStorage,
    temporaryUrl: async (path: string) => {
      if (!path.startsWith('blobs/')) {
        throw new Error(`Invalid blob path for dry-run: ${path}`);
      }
      return `https://dry-run.invalid/${path}`;
    },
  };
}
