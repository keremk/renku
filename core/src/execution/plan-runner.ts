import pLimit from 'p-limit';
import { createRunner, accumulateArtifacts } from '../runner.js';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';
import type {
  ExecutionPlan,
  JobResult,
  Manifest,
  RunResult,
} from '../types.js';
import type {
  PlanExecutionContext,
  ExecutePlanWithConcurrencyOptions,
} from './types.js';

/**
 * Executes an execution plan with concurrency control.
 *
 * This function runs jobs layer by layer, with concurrent execution within each layer.
 * It supports:
 * - Concurrency limiting via p-limit
 * - Layer limiting (upToLayer)
 * - Re-running from a specific layer (reRunFrom)
 * - Cancellation via AbortSignal
 * - Progress reporting via callbacks
 *
 * @param plan - The execution plan to run
 * @param context - Execution context with storage, event log, produce function, etc.
 * @param options - Execution options including concurrency, layer limits, etc.
 * @returns The run result with job results and manifest builder
 */
export async function executePlanWithConcurrency(
  plan: ExecutionPlan,
  context: PlanExecutionContext,
  options: ExecutePlanWithConcurrencyOptions
): Promise<RunResult> {
  validateOptions(options, plan);

  const {
    concurrency,
    upToLayer: layerLimit,
    reRunFrom,
    signal,
    onProgress,
  } = options;
  const runner = createRunner();
  const limit = pLimit(concurrency);
  const logger = context.logger ?? {};
  const clock = context.clock ?? { now: () => new Date().toISOString() };
  const startedAt = clock.now();
  const jobs: JobResult[] = [];

  // Log layer limit info
  if (layerLimit !== undefined) {
    const message = `Run will be up to and including layer ${layerLimit}`;
    logger.info?.(message);
    logger.debug?.('runner.layer.limit', {
      movieId: context.movieId,
      revision: plan.revision,
      upToLayer: layerLimit,
    });
    onProgress?.({
      type: 'plan-ready',
      timestamp: clock.now(),
      message,
      totalLayers: plan.layers.length,
    });
  }

  // Log reRunFrom info
  if (reRunFrom !== undefined && reRunFrom > 0) {
    const jobsFromLayer = plan.layers
      .slice(reRunFrom)
      .reduce((sum, layer) => sum + layer.length, 0);
    const layersWithJobs = plan.layers
      .slice(reRunFrom)
      .map((layer, i) => ({ index: reRunFrom + i, count: layer.length }))
      .filter((l) => l.count > 0);

    let message = `Re-running from layer ${reRunFrom}. Layers 0-${reRunFrom - 1} will use existing artifacts.`;
    if (jobsFromLayer === 0) {
      message += ` Note: No jobs found at layer ${reRunFrom} or above. The plan may be empty.`;
    } else if (
      layersWithJobs.length > 0 &&
      layersWithJobs[0]?.index !== reRunFrom
    ) {
      const firstLayerWithJobs = layersWithJobs[0]?.index;
      message += ` Note: Layer ${reRunFrom} is empty. First layer with jobs is layer ${firstLayerWithJobs}.`;
    }

    logger.info?.(message);
    logger.debug?.('runner.layer.reRunFrom', {
      movieId: context.movieId,
      revision: plan.revision,
      reRunFrom,
    });
    onProgress?.({
      type: 'plan-ready',
      timestamp: clock.now(),
      message,
      totalLayers: plan.layers.length,
    });
  }

  // Track a running manifest that accumulates artifacts produced in earlier layers.
  // This ensures hashInputContents in later layers resolves correct upstream hashes.
  let runningManifest: Manifest = context.manifest;

  for (let layerIndex = 0; layerIndex < plan.layers.length; layerIndex += 1) {
    // Check for cancellation
    if (signal?.aborted) {
      logger.info?.('Execution cancelled by user');
      break;
    }

    if (layerLimit !== undefined && layerIndex > layerLimit) {
      break;
    }

    const layer = plan.layers[layerIndex] ?? [];
    if (layer.length === 0) {
      const message = `Layer ${layerIndex} is empty, skipping`;
      logger.info?.(message);
      logger.debug?.('runner.layer.empty', {
        movieId: context.movieId,
        revision: plan.revision,
        layerIndex,
      });
      onProgress?.({
        type: 'layer-empty',
        timestamp: clock.now(),
        layerIndex,
        totalLayers: plan.layers.length,
        message,
      });
      continue;
    }

    // Skip layers before reRunFrom - use existing artifacts
    if (reRunFrom !== undefined && layerIndex < reRunFrom) {
      const message = `Layer ${layerIndex} skipped (re-running from layer ${reRunFrom})`;
      logger.info?.(message);
      logger.debug?.('runner.layer.skipped', {
        movieId: context.movieId,
        revision: plan.revision,
        layerIndex,
        reason: 'reRunFrom',
      });
      onProgress?.({
        type: 'layer-skipped',
        timestamp: clock.now(),
        layerIndex,
        totalLayers: plan.layers.length,
        message,
      });

      const skippedResults: JobResult[] = layer.map((job) => ({
        jobId: job.jobId,
        producer: job.producer,
        status: 'skipped' as const,
        artefacts: [],
        diagnostics: { reason: 'reRunFrom' },
        layerIndex,
        attempt: 0,
        startedAt: clock.now(),
        completedAt: clock.now(),
      }));
      jobs.push(...skippedResults);
      continue;
    }

    const message = `Layer ${layerIndex}, will run ${layer.length} jobs`;
    logger.info?.(message);
    logger.debug?.('runner.layer.start', {
      movieId: context.movieId,
      revision: plan.revision,
      layerIndex,
      jobs: layer.length,
    });
    onProgress?.({
      type: 'layer-start',
      timestamp: clock.now(),
      layerIndex,
      totalLayers: plan.layers.length,
      progress: { completed: 0, total: layer.length },
      message,
    });

    const layerResults = await Promise.all(
      layer.map((job) =>
        limit(async () => {
          // Check for cancellation before starting each job
          if (signal?.aborted) {
            return {
              jobId: job.jobId,
              producer: job.producer,
              status: 'skipped' as const,
              artefacts: [],
              diagnostics: { reason: 'cancelled' },
              layerIndex,
              attempt: 0,
              startedAt: clock.now(),
              completedAt: clock.now(),
            } satisfies JobResult;
          }

          onProgress?.({
            type: 'job-start',
            timestamp: clock.now(),
            layerIndex,
            totalLayers: plan.layers.length,
            jobId: job.jobId,
            producer: job.producer,
            status: 'running',
          });

          const result = await runner.executeJob(job, {
            ...context,
            manifest: runningManifest,
            layerIndex,
            attempt: 1,
            revision: plan.revision,
            signal,
          });

          onProgress?.({
            type: 'job-complete',
            timestamp: clock.now(),
            layerIndex,
            totalLayers: plan.layers.length,
            jobId: job.jobId,
            producer: job.producer,
            status: result.status,
            error: result.error
              ? { message: result.error.message, code: undefined }
              : undefined,
          });

          return result;
        })
      )
    );
    jobs.push(...layerResults);

    // Update running manifest with produced artifacts so later layers see correct hashes
    for (const result of layerResults) {
      runningManifest = accumulateArtifacts(runningManifest, result.artefacts);
    }

    const layerCompleteMessage = `Layer ${layerIndex} finished running`;
    logger.info?.(layerCompleteMessage);
    logger.debug?.('runner.layer.end', {
      movieId: context.movieId,
      revision: plan.revision,
      layerIndex,
    });
    onProgress?.({
      type: 'layer-complete',
      timestamp: clock.now(),
      layerIndex,
      totalLayers: plan.layers.length,
      progress: { completed: layer.length, total: layer.length },
      message: layerCompleteMessage,
    });
  }

  const completedAt = clock.now();
  const status: RunResult['status'] = signal?.aborted
    ? 'failed'
    : jobs.some((job) => job.status === 'failed')
      ? 'failed'
      : 'succeeded';

  onProgress?.({
    type: 'execution-complete',
    timestamp: completedAt,
    status: status === 'succeeded' ? 'succeeded' : 'failed',
    message: `Execution ${status}`,
  });

  return {
    status,
    revision: plan.revision,
    manifestBaseHash: plan.manifestBaseHash,
    jobs,
    startedAt,
    completedAt,
    async buildManifest() {
      return context.manifestService.buildFromEvents({
        movieId: context.movieId,
        targetRevision: plan.revision,
        baseRevision: context.manifest.revision,
        eventLog: context.eventLog,
        clock,
      });
    },
  };
}

function validateOptions(
  options: ExecutePlanWithConcurrencyOptions,
  plan: ExecutionPlan
): void {
  const { concurrency, upToLayer: layerLimit, reRunFrom } = options;

  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_CONCURRENCY_VALUE,
      'Concurrency must be a positive integer.',
      { suggestion: 'Provide a concurrency value of 1 or greater.' }
    );
  }

  if (
    layerLimit !== undefined &&
    (!Number.isInteger(layerLimit) || layerLimit < 0)
  ) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_UPTO_LAYER_VALUE,
      'upToLayer must be a non-negative integer.',
      { suggestion: 'Provide a layer index starting from 0.' }
    );
  }

  if (
    reRunFrom !== undefined &&
    (!Number.isInteger(reRunFrom) || reRunFrom < 0)
  ) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_RERUN_FROM_VALUE,
      `reRunFrom must be a non-negative integer, got ${reRunFrom}.`,
      { suggestion: 'Provide a layer index starting from 0.' }
    );
  }

  if (
    reRunFrom !== undefined &&
    layerLimit !== undefined &&
    reRunFrom > layerLimit
  ) {
    throw createRuntimeError(
      RuntimeErrorCode.RERUN_FROM_GREATER_THAN_UPTO,
      `reRunFrom (${reRunFrom}) cannot be greater than upToLayer (${layerLimit}).`,
      {
        suggestion:
          'Use --re-run-from with a value less than or equal to --up-to-layer.',
      }
    );
  }

  if (reRunFrom !== undefined && reRunFrom >= plan.layers.length) {
    throw createRuntimeError(
      RuntimeErrorCode.RERUN_FROM_EXCEEDS_LAYERS,
      `reRunFrom (${reRunFrom}) exceeds total layers (${plan.layers.length}). Valid range is 0-${plan.layers.length - 1}.`,
      {
        suggestion: `Use a layer index between 0 and ${plan.layers.length - 1}.`,
      }
    );
  }
}
