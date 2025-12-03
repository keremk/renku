import pLimit from 'p-limit';
import type {
  Clock,
  ExecutionPlan,
  JobResult,
  ManifestService,
  ProduceFn,
  RunResult,
  RunnerExecutionContext,
  RunnerLogger,
} from '@renku/core';
import { createRunner } from '@renku/core';

interface PlanExecutionContext extends RunnerExecutionContext {
  manifestService: ManifestService;
  produce: ProduceFn;
  logger?: RunnerLogger;
  clock?: Clock;
  notifications?: import('@renku/core').NotificationBus;
}

export async function executePlanWithConcurrency(
  plan: ExecutionPlan,
  context: PlanExecutionContext,
  options: { concurrency: number; upToLayer?: number },
): Promise<RunResult> {
  if (!Number.isInteger(options.concurrency) || options.concurrency <= 0) {
    throw new Error('Concurrency must be a positive integer.');
  }
  const layerLimit = options.upToLayer;
  if (layerLimit !== undefined && (!Number.isInteger(layerLimit) || layerLimit < 0)) {
    throw new Error('upToLayer must be a non-negative integer.');
  }
  const runner = createRunner();
  const limit = pLimit(options.concurrency);
  const logger = context.logger ?? {};
  const clock = context.clock ?? { now: () => new Date().toISOString() };
  const startedAt = clock.now();
  const jobs: JobResult[] = [];

  if (layerLimit !== undefined) {
    logger.info?.('runner.layer.limit', {
      movieId: context.movieId,
      revision: plan.revision,
      upToLayer: layerLimit,
    });
  }

  for (let layerIndex = 0; layerIndex < plan.layers.length; layerIndex += 1) {
    if (layerLimit !== undefined && layerIndex > layerLimit) {
      break;
    }
    const layer = plan.layers[layerIndex] ?? [];
    if (layer.length === 0) {
      continue;
    }

    logger.info?.('runner.layer.start', {
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

    logger.info?.('runner.layer.end', {
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
