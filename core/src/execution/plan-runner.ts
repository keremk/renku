import pLimit from 'p-limit';
import { createRunner, accumulateArtifacts, hydrateExecutionState } from '../runner.js';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';
import { MAX_CLI_CONCURRENCY, MIN_CLI_CONCURRENCY } from '../concurrency.js';
import { createEmptyBuildState } from '../execution-state.js';
import { buildRunResultBuildStateSnapshot } from '../run-result-build-state.js';
import type {
  ExecutionPlan,
  JobResult,
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
 * - Cancellation via AbortSignal
 * - Progress reporting via callbacks
 *
 * @param plan - The execution plan to run
 * @param context - Execution context with storage, event log, produce function, etc.
 * @param options - Execution options including concurrency, layer limits, etc.
 * @returns The run result with job results and baseline hash
 */
export async function executePlanWithConcurrency(
  plan: ExecutionPlan,
  context: PlanExecutionContext,
  options: ExecutePlanWithConcurrencyOptions
): Promise<RunResult> {
  validateOptions(options);

  const {
    concurrency,
    upToLayer: layerLimit,
    signal,
    onProgress,
  } = options;
  const runner = createRunner();
  const limit = pLimit(concurrency);
  const logger = context.logger ?? {};
  const clock = context.clock ?? { now: () => new Date().toISOString() };
  const startedAt = clock.now();
  const jobs: JobResult[] = [];
  const baselineHash =
    plan.baselineHash ??
    (plan as { manifestBaseHash?: string }).manifestBaseHash ??
    '';
  const buildState =
    context.buildState ??
    ((context as { manifest?: import('../types.js').BuildState }).manifest ??
      createEmptyBuildState());

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

  let executionState =
    context.executionState ??
    (await hydrateExecutionState({
      movieId: context.movieId,
      buildState,
      eventLog: context.eventLog,
    }));

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
              artifacts: [],
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
            buildState,
            executionState,
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

    for (const result of layerResults) {
      executionState = accumulateArtifacts(executionState, result.artifacts);
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
    baselineHash,
    manifestBaseHash: baselineHash,
    jobs,
    startedAt,
    completedAt,
    buildStateSnapshot: async () =>
      buildRunResultBuildStateSnapshot({
        movieId: context.movieId,
        eventLog: context.eventLog,
        buildState,
        revision: plan.revision,
        completedAt,
      }),
  };
}

function validateOptions(options: ExecutePlanWithConcurrencyOptions): void {
  const { concurrency, upToLayer: layerLimit } = options;

  if (
    !Number.isInteger(concurrency) ||
    concurrency < MIN_CLI_CONCURRENCY ||
    concurrency > MAX_CLI_CONCURRENCY
  ) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_CONCURRENCY_VALUE,
      `Concurrency must be an integer between ${MIN_CLI_CONCURRENCY} and ${MAX_CLI_CONCURRENCY}.`,
      {
        suggestion: `Provide a concurrency value between ${MIN_CLI_CONCURRENCY} and ${MAX_CLI_CONCURRENCY}.`,
      }
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
}
