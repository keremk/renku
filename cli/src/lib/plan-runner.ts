import pLimit from 'p-limit';
import type {
  Clock,
  ExecutionPlan,
  JobResult,
  Logger,
  ManifestService,
  ProduceFn,
  RunResult,
  RunnerExecutionContext,
} from '@gorenku/core';
import { createRunner, createRuntimeError, RuntimeErrorCode } from '@gorenku/core';
import chalk from 'chalk';

interface PlanExecutionContext extends RunnerExecutionContext {
  manifestService: ManifestService;
  produce: ProduceFn;
  logger?: Partial<Logger>;
  clock?: Clock;
  notifications?: import('@gorenku/core').NotificationBus;
}

export async function executePlanWithConcurrency(
  plan: ExecutionPlan,
  context: PlanExecutionContext,
  options: { concurrency: number; upToLayer?: number; reRunFrom?: number },
): Promise<RunResult> {
  if (!Number.isInteger(options.concurrency) || options.concurrency <= 0) {
    throw new Error('Concurrency must be a positive integer.');
  }
  const layerLimit = options.upToLayer;
  if (layerLimit !== undefined && (!Number.isInteger(layerLimit) || layerLimit < 0)) {
    throw new Error('upToLayer must be a non-negative integer.');
  }
  const reRunFrom = options.reRunFrom;
  if (reRunFrom !== undefined && (!Number.isInteger(reRunFrom) || reRunFrom < 0)) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_RERUN_FROM_VALUE,
      `reRunFrom must be a non-negative integer, got ${reRunFrom}.`,
      { suggestion: 'Provide a layer index starting from 0.' },
    );
  }
  if (reRunFrom !== undefined && layerLimit !== undefined && reRunFrom > layerLimit) {
    throw createRuntimeError(
      RuntimeErrorCode.RERUN_FROM_GREATER_THAN_UPTO,
      `reRunFrom (${reRunFrom}) cannot be greater than upToLayer (${layerLimit}).`,
      { suggestion: 'Use --re-run-from with a value less than or equal to --up-to-layer.' },
    );
  }
  if (reRunFrom !== undefined && reRunFrom >= plan.layers.length) {
    throw createRuntimeError(
      RuntimeErrorCode.RERUN_FROM_EXCEEDS_LAYERS,
      `reRunFrom (${reRunFrom}) exceeds total layers (${plan.layers.length}). Valid range is 0-${plan.layers.length - 1}.`,
      { suggestion: `Use a layer index between 0 and ${plan.layers.length - 1}.` },
    );
  }
  const runner = createRunner();
  const limit = pLimit(options.concurrency);
  const logger = context.logger ?? {};
  const clock = context.clock ?? { now: () => new Date().toISOString() };
  const startedAt = clock.now();
  const jobs: JobResult[] = [];

  if (layerLimit !== undefined) {
    logger.info?.(`\nThe run will be up to and including layer ${layerLimit}\n`);
    logger.debug?.('runner.layer.limit', {
      movieId: context.movieId,
      revision: plan.revision,
      upToLayer: layerLimit,
    });
  }

  if (reRunFrom !== undefined && reRunFrom > 0) {
    // Count jobs at reRunFrom layer and above to help user understand what will run
    const jobsFromLayer = plan.layers
      .slice(reRunFrom)
      .reduce((sum, layer) => sum + layer.length, 0);
    const layersWithJobs = plan.layers
      .slice(reRunFrom)
      .map((layer, i) => ({ index: reRunFrom + i, count: layer.length }))
      .filter((l) => l.count > 0);

    logger.info?.(`\nRe-running from layer ${reRunFrom}. Layers 0-${reRunFrom - 1} will use existing artifacts.`);
    if (jobsFromLayer === 0) {
      logger.info?.(`Note: No jobs found at layer ${reRunFrom} or above. The plan may be empty.\n`);
    } else if (layersWithJobs.length > 0 && layersWithJobs[0]?.index !== reRunFrom) {
      const firstLayerWithJobs = layersWithJobs[0]?.index;
      logger.info?.(`Note: Layer ${reRunFrom} is empty. First layer with jobs is layer ${firstLayerWithJobs}.\n`);
    } else {
      logger.info?.(`\n`);
    }
    logger.debug?.('runner.layer.reRunFrom', {
      movieId: context.movieId,
      revision: plan.revision,
      reRunFrom,
    });
  }

  for (let layerIndex = 0; layerIndex < plan.layers.length; layerIndex += 1) {
    if (layerLimit !== undefined && layerIndex > layerLimit) {
      break;
    }
    const layer = plan.layers[layerIndex] ?? [];
    if (layer.length === 0) {
      logger.info?.(`${chalk.dim(`--- Layer ${layerIndex} is empty, skipping ---`)}\n`);
      logger.debug?.('runner.layer.empty', {
        movieId: context.movieId,
        revision: plan.revision,
        layerIndex,
      });
      continue;
    }

    // Skip layers before reRunFrom - use existing artifacts
    if (reRunFrom !== undefined && layerIndex < reRunFrom) {
      logger.info?.(`${chalk.yellow(`--- Layer ${layerIndex} skipped (re-running from layer ${reRunFrom}) ---`)}\n`);
      logger.debug?.('runner.layer.skipped', {
        movieId: context.movieId,
        revision: plan.revision,
        layerIndex,
        reason: 'reRunFrom',
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

    logger.info?.(`${chalk.blue(`--- Layer ${layerIndex}, will run ${layer.length} jobs. ---`)}\n`);
    logger.debug?.('runner.layer.start', {
      movieId: context.movieId,
      revision: plan.revision,
      layerIndex,
      jobs: layer.length,
    });

    const layerResults = await Promise.all(
      layer.map((job) =>
        limit(() =>
          runner.executeJob(job, {
            ...context,
            layerIndex,
            attempt: 1,
            revision: plan.revision,
          }),
        ),
      ),
    );
    jobs.push(...layerResults);

    logger.info?.(`\n${chalk.blue(`--- Layer ${layerIndex} finished running. ---`)}\n`);
    logger.debug?.('runner.layer.end', {
      movieId: context.movieId,
      revision: plan.revision,
      layerIndex,
    });
  }

  const completedAt = clock.now();
  const status: RunResult['status'] = jobs.some((job) => job.status === 'failed')
    ? 'failed'
    : 'succeeded';

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
