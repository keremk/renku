import { Buffer } from 'node:buffer';
import {
  resolveArtifactsFromEventLog,
  readBlob,
  resolveArtifactBlobPaths,
  findFailedArtifacts,
} from './artifact-resolver.js';
import {
  formatCanonicalArtifactId,
  isCanonicalArtifactId,
} from './canonical-ids.js';
import type { EventLog } from './event-log.js';
import { hashInputContents } from './hashing.js';
import {
  applyArtifactEventsToExecutionState,
  createExecutionState,
} from './execution-state.js';
import { buildRunResultBuildStateSnapshot } from './run-result-build-state.js';
import type { StorageContext } from './storage.js';
import { persistBlobToStorage } from './blob-utils.js';
import { requireArtifactOwnership } from './artifact-ownership.js';
import {
  isBlobRef,
  type EdgeConditionClause,
  type EdgeConditionDefinition,
  type EdgeConditionGroup,
} from './types.js';
import {
  evaluateInputConditions,
  type ConditionEvaluationContext,
} from './condition-evaluator.js';
import { createRuntimeError, RuntimeErrorCode } from './errors/index.js';
import {
  type ArtifactEvent,
  type ArtifactEventStatus,
  type BlobRef,
  type Clock,
  type BuildState,
  type ExecutionPlan,
  type ExecutionState,
  type InputEvent,
  type JobDescriptor,
  type JobResult,
  type ProduceFn,
  type ProduceRequest,
  type ProduceResult,
  type ProducedArtifact,
  type RunResult,
  type SerializedError,
  type RevisionId,
  type ProducerJobContext,
  type ProducerJobContextExtras,
  type FanInDescriptor,
} from './types.js';
import type { Logger } from './logger.js';
import type { NotificationBus } from './notifications.js';

export interface RunnerOptions {
  clock?: Clock;
  logger?: Partial<Logger>;
  produce?: ProduceFn;
  notifications?: NotificationBus;
}

export interface RunnerExecutionContext {
  movieId: string;
  buildState: BuildState;
  executionState?: ExecutionState;
  storage: StorageContext;
  eventLog: EventLog;
  produce?: ProduceFn;
  logger?: Partial<Logger>;
  clock?: Clock;
  notifications?: NotificationBus;
  signal?: AbortSignal;
}

type SingleJobExecutionContext = RunnerExecutionContext & {
  revision: RevisionId;
  layerIndex?: number;
  attempt?: number;
};

interface RunnerJobContext extends RunnerExecutionContext {
  layerIndex: number;
  attempt: number;
  revision: RevisionId;
  produce: ProduceFn;
  logger: Partial<Logger>;
  clock: Clock;
  notifications?: NotificationBus;
  signal?: AbortSignal;
}

const defaultClock: Clock = {
  now: () => new Date().toISOString(),
};

const noopLogger: Partial<Logger> = {};

export function createRunner(options: RunnerOptions = {}) {
  const baseClock = options.clock ?? defaultClock;
  const baseLogger = options.logger ?? noopLogger;
  const baseProduce = options.produce ?? createStubProduce();
  const baseNotifications = options.notifications;

  return {
    async execute(
      plan: ExecutionPlan,
      context: RunnerExecutionContext
    ): Promise<RunResult> {
      const clock = context.clock ?? baseClock;
      const logger = context.logger ?? baseLogger;
      const produce = context.produce ?? baseProduce;
      const eventLog = context.eventLog;
      const notifications = context.notifications ?? baseNotifications;
      const buildState = normalizeBuildState(context);

      const startedAt = clock.now();
      const jobs: JobResult[] = [];
      const baselineHash = plan.baselineHash ?? '';

      let executionState =
        context.executionState ??
        (await hydrateExecutionState({
          movieId: context.movieId,
          buildState,
          eventLog,
        }));

      for (
        let layerIndex = 0;
        layerIndex < plan.layers.length;
        layerIndex += 1
      ) {
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
        notifications?.publish({
          type: 'progress',
          message: `Layer ${layerIndex} starting (${layer.length} job${layer.length === 1 ? '' : 's'}).`,
          timestamp: clock.now(),
        });

        for (const job of layer) {
          const jobResult = await executeJob(job, {
            ...context,
            buildState,
            executionState,
            layerIndex,
            attempt: 1,
            revision: plan.revision,
            produce,
            logger,
            clock,
            notifications,
          });
          jobs.push(jobResult);

          executionState = applyArtifactEventsToExecutionState(
            executionState,
            jobResult.artifacts
          );
        }

        logger.info?.('runner.layer.end', {
          movieId: context.movieId,
          revision: plan.revision,
          layerIndex,
        });
        notifications?.publish({
          type: 'success',
          message: `Layer ${layerIndex} finished.`,
          timestamp: clock.now(),
        });
      }

      const completedAt = clock.now();
      const status: RunResult['status'] = jobs.some(
        (job) => job.status === 'failed'
      )
        ? 'failed'
        : 'succeeded';
      const buildStateSnapshot = async (): Promise<BuildState> =>
        buildRunResultBuildStateSnapshot({
          movieId: context.movieId,
          eventLog,
          buildState,
          revision: plan.revision,
          completedAt,
        });

      return {
        status,
        revision: plan.revision,
        baselineHash,
        jobs,
        startedAt,
        completedAt,
        buildStateSnapshot,
      };
    },

    async executeJob(
      job: JobDescriptor,
      ctx: SingleJobExecutionContext
    ): Promise<JobResult> {
      const clock = ctx.clock ?? baseClock;
      const logger = ctx.logger ?? baseLogger;
      const produce = ctx.produce ?? baseProduce;
      const eventLog = ctx.eventLog;
      const buildState = normalizeBuildState(ctx);
      return executeJob(job, {
        ...ctx,
        buildState,
        executionState:
          ctx.executionState ??
          (await hydrateExecutionState({
            movieId: ctx.movieId,
            buildState,
            eventLog,
          })),
        layerIndex: ctx.layerIndex ?? 0,
        attempt: ctx.attempt ?? 1,
        revision: ctx.revision,
        produce,
        logger,
        clock,
        notifications: ctx.notifications ?? baseNotifications,
      });
    },
  };
}

function normalizeBuildState(context: RunnerExecutionContext): BuildState {
  return context.buildState;
}

export async function hydrateExecutionState(args: {
  movieId: string;
  buildState: BuildState;
  eventLog: EventLog;
}): Promise<ExecutionState> {
  const latestInputs = new Map<string, InputEvent>();
  for await (const event of args.eventLog.streamInputs(args.movieId)) {
    latestInputs.set(event.id, event);
  }

  return createExecutionState({
    buildState: args.buildState,
    inputEvents: Array.from(latestInputs.values()),
  });
}

function createStubProduce(): ProduceFn {
  return async (request: ProduceRequest): Promise<ProduceResult> => ({
    jobId: request.job.jobId,
    status: 'skipped',
    artifacts: [],
    diagnostics: {
      reason: 'stubbed',
    },
  });
}

async function executeJob(
  job: JobDescriptor,
  context: RunnerJobContext
): Promise<JobResult> {
  const {
    movieId,
    layerIndex,
    attempt,
    revision,
    produce,
    logger,
    clock,
    storage,
    eventLog,
    signal,
  } = context;
  const notifications = context.notifications;
  const startedAt = clock.now();
  const inputsHash = hashInputContents(job.inputs, context.executionState);
  const expectedArtifacts = job.produces.filter((id) =>
    isCanonicalArtifactId(id)
  );
  let conditionFilteringDiagnostics: Record<string, unknown> | undefined;

  try {
    // Collect all required artifact IDs for this job
    const requiredArtifactIds = collectResolvedArtifactIds(job);

    // Check if any required upstream artifacts have failed
    const failedUpstream = await findFailedArtifacts({
      artifactIds: requiredArtifactIds,
      eventLog,
      movieId,
    });

    if (failedUpstream.length > 0) {
      const completedAt = clock.now();
      logger.info?.('runner.job.blocked', {
        movieId,
        revision,
        jobId: job.jobId,
        producer: job.producer,
        layerIndex,
        reason: 'upstream_failure',
        failedArtifacts: failedUpstream,
      });
      notifications?.publish({
        type: 'error',
        message: `Job ${job.jobId} [${job.producer}] blocked: upstream artifacts failed.`,
        timestamp: completedAt,
      });

      // Record failed artifacts for this job due to upstream failure
      for (const artifactId of expectedArtifacts) {
        const ownership = requireArtifactOwnership({
          artifactId,
          producerJobId: job.jobId,
          producerId: job.context?.producerId,
          context: `runner upstream_failure job=${job.jobId}`,
        });
        const event: ArtifactEvent = {
          artifactId,
          revision,
          inputsHash,
          output: {},
          status: 'failed',
          producerJobId: ownership.producerJobId,
          producerId: ownership.producerId,
          diagnostics: {
            reason: 'upstream_failure',
            failedUpstreamArtifacts: failedUpstream,
          },
          createdAt: clock.now(),
          lastRevisionBy: 'producer',
        };
        await eventLog.appendArtifact(movieId, event);
      }

      return {
        jobId: job.jobId,
        producer: job.producer,
        status: 'failed',
        artifacts: [],
        diagnostics: {
          reason: 'upstream_failure',
          failedUpstreamArtifacts: failedUpstream,
        },
        layerIndex,
        attempt,
        startedAt,
        completedAt,
      };
    }

    // Resolve artifacts from event log
    const resolvedArtifacts = await resolveArtifactsFromEventLog({
      artifactIds: requiredArtifactIds,
      eventLog,
      storage,
      movieId,
    });

    // Evaluate input conditions if present
    const inputConditions = job.context?.inputConditions;
    const hasInputConditions =
      inputConditions && Object.keys(inputConditions).length > 0;
    const hasConditionalInputBindings =
      job.context?.conditionalInputBindings &&
      Object.keys(job.context.conditionalInputBindings).length > 0;
    if (hasInputConditions || hasConditionalInputBindings) {
      const resolvedInputs =
        (job.context?.extras?.resolvedInputs as Record<string, unknown> | undefined) ??
        {};
      const conditionContext: ConditionEvaluationContext = {
        resolvedArtifacts,
        resolvedInputs,
      };
      const conditionalBindingConditions = collectConditionalBindingConditions(job);
      const conditionResults = evaluateInputConditions(
        {
          ...conditionalBindingConditions,
          ...inputConditions,
        },
        conditionContext
      );
      conditionFilteringDiagnostics = {
        plannedInputs: [...job.inputs],
        conditionalInputs: Object.keys(inputConditions ?? {}),
        conditionResults: Object.fromEntries(
          Array.from(conditionResults.entries()).map(([inputId, result]) => [
            inputId,
            result,
          ])
        ),
      };

      // Determine which inputs are conditional
      const conditionalInputIds = new Set(Object.keys(inputConditions ?? {}));
      const filteringConditionalInputIds = new Set([
        ...conditionalInputIds,
        ...Object.keys(conditionalBindingConditions),
      ]);

      const anySatisfied = Array.from(conditionalInputIds).some(
        (inputId) => conditionResults.get(inputId)?.satisfied === true
      );
      const anyCandidateSatisfied =
        conditionalInputIds.size === 0 &&
        Object.keys(conditionalBindingConditions).some(
          (inputId) => conditionResults.get(inputId)?.satisfied === true
        );

      // Check if there are unconditional artifact inputs that would provide data
      // This includes direct artifact inputs and fanIn members without conditions
      const hasUnconditionalArtifactInputs = job.inputs.some((inputId) => {
        if (filteringConditionalInputIds.has(inputId)) {
          return false; // This input is conditional
        }
        return isCanonicalArtifactId(inputId);
      });

      // Check if any fanIn has unconditional members
      const fanIn = job.context?.fanIn;
      const hasUnconditionalFanInMembers =
        fanIn &&
        Object.values(fanIn).some((spec) =>
          spec.members.some((member) => !filteringConditionalInputIds.has(member.id))
        );

      // If there are conditional inputs but none are satisfied, skip the job
      // UNLESS there are unconditional artifact inputs or fanIn members that provide data
      if (
        !anySatisfied &&
        !anyCandidateSatisfied &&
        !hasUnconditionalArtifactInputs &&
        !hasUnconditionalFanInMembers
      ) {
        const completedAt = clock.now();
        logger.info?.('runner.job.skipped', {
          movieId,
          revision,
          jobId: job.jobId,
          producer: job.producer,
          layerIndex,
          reason: 'all conditional inputs unsatisfied',
        });
        notifications?.publish({
          type: 'warning',
          message: `Job ${job.jobId} [${job.producer}] skipped (conditions not met).`,
          timestamp: completedAt,
        });

        // Return skipped result without producing artifacts
        return {
          jobId: job.jobId,
          producer: job.producer,
          status: 'skipped',
          artifacts: [],
          diagnostics: {
            reason: 'conditions_not_met',
            conditionFiltering: conditionFilteringDiagnostics,
          },
          layerIndex,
          attempt,
          startedAt,
          completedAt,
        };
      }

      const satisfiedConditionalIds = new Set<string>();
      for (const [inputId, result] of conditionResults.entries()) {
        if (result.satisfied) {
          satisfiedConditionalIds.add(inputId);
        }
      }

      job = applyConditionalInputFiltering(
        job,
        filteringConditionalInputIds,
        satisfiedConditionalIds
      );
      conditionFilteringDiagnostics = {
        ...conditionFilteringDiagnostics,
        executedInputs: [...job.inputs],
        filteredInputs: Object.keys(inputConditions ?? {}).filter(
          (inputId) => !satisfiedConditionalIds.has(inputId)
        ),
      };
    }

    // Merge resolved artifacts into job context
    const enrichedJob = mergeResolvedArtifacts(job, resolvedArtifacts);

    // Extract asset IDs from resolved artifacts (e.g., from Timeline)
    // and resolve their blob paths from the event log.
    // This ensures exporters get fresh paths even when persisted build state is stale.
    const assetIds = extractAssetIdsFromResolved(resolvedArtifacts);
    const assetBlobPaths =
      assetIds.length > 0
        ? await resolveArtifactBlobPaths({
            artifactIds: assetIds,
            eventLog,
            storage,
            movieId,
          })
        : {};

    // Merge asset blob paths into job context
    const jobWithAssetPaths = mergeAssetBlobPaths(enrichedJob, assetBlobPaths);

    // Resolve BlobRef objects back to BlobInput for provider execution
    const jobWithResolvedBlobs = await resolveBlobRefsInJobContext(
      jobWithAssetPaths,
      storage,
      movieId
    );

    const result = await produce({
      movieId,
      job: jobWithResolvedBlobs,
      layerIndex,
      attempt,
      revision,
      signal,
    });

    const artifacts = await materializeArtifacts(result.artifacts, {
      movieId,
      job,
      revision,
      inputsHash,
      storage,
      eventLog,
      clock,
    });

    const completedAt = clock.now();
    const status = deriveJobStatus(normalizeStatus(result.status), artifacts);

    // logger.info?.(`The ${chalk.blue(job.producer)} successfully completed in ${attempt} attempt, produced ${artifacts.length} artifacts\n`)
    logger.debug?.('runner.job.completed', {
      movieId,
      revision,
      jobId: job.jobId,
      producer: job.producer,
      status,
      layerIndex,
      attempt,
      artifacts: artifacts.length,
    });
    notifications?.publish({
      type:
        status === 'failed'
          ? 'error'
          : status === 'skipped'
            ? 'warning'
            : 'success',
      message: `Job ${job.jobId} [${job.producer}] ${status}.`,
      timestamp: completedAt,
    });

    return {
      jobId: job.jobId,
      producer: job.producer,
      status,
      artifacts,
      diagnostics: conditionFilteringDiagnostics
        ? {
            ...result.diagnostics,
            conditionFiltering: conditionFilteringDiagnostics,
          }
        : result.diagnostics,
      layerIndex,
      attempt,
      startedAt,
      completedAt,
    };
  } catch (error) {
    const completedAt = clock.now();
    const serialized = serializeError(error);
    const failureDiagnostics = {
      ...buildFailureDiagnostics(error, serialized),
      ...(conditionFilteringDiagnostics
        ? { conditionFiltering: conditionFilteringDiagnostics }
        : {}),
    };

    // Record failed artifacts for observability even when produce throws.
    try {
      for (const artifactId of expectedArtifacts) {
        const ownership = requireArtifactOwnership({
          artifactId,
          producerJobId: job.jobId,
          producerId: job.context?.producerId,
          context: `runner thrown_error job=${job.jobId}`,
        });
        const event: ArtifactEvent = {
          artifactId,
          revision,
          inputsHash,
          output: {},
          status: 'failed',
          producerJobId: ownership.producerJobId,
          producerId: ownership.producerId,
          diagnostics: failureDiagnostics,
          createdAt: clock.now(),
          lastRevisionBy: 'producer',
        };
        await eventLog.appendArtifact(movieId, event);
      }
    } catch (logError) {
      logger.error?.('runner.job.failed.log', {
        movieId,
        revision,
        jobId: job.jobId,
        producer: job.producer,
        layerIndex,
        attempt,
        error: serializeError(logError),
      });
      throw createRuntimeError(
        RuntimeErrorCode.ARTIFACT_RESOLUTION_FAILED,
        `Failed to record artifact failure for job ${job.jobId}: ${serializeError(logError).message}`,
        { context: `job ${job.jobId}` }
      );
    }

    logger.error?.('runner.job.failed', {
      movieId,
      revision,
      jobId: job.jobId,
      producer: job.producer,
      layerIndex,
      attempt,
      error: serialized,
    });
    notifications?.publish({
      type: 'error',
      message: `Job ${job.jobId} [${job.producer}] failed.`,
      timestamp: completedAt,
    });

    return {
      jobId: job.jobId,
      producer: job.producer,
      status: 'failed',
      artifacts: [],
      layerIndex,
      attempt,
      startedAt,
      completedAt,
      error: serialized,
      diagnostics: failureDiagnostics,
    };
  }
}

async function materializeArtifacts(
  artifacts: ProducedArtifact[],
  context: {
    movieId: string;
    job: JobDescriptor;
    revision: RevisionId;
    inputsHash: string;
    storage: StorageContext;
    eventLog: EventLog;
    clock: Clock;
  }
): Promise<ArtifactEvent[]> {
  const events: ArtifactEvent[] = [];
  for (const artifact of artifacts) {
    const status = normalizeStatus(artifact.status);
    const output: { blob?: BlobRef } = {};

    const blobPayload = artifact.blob;

    if (status === 'succeeded' && !blobPayload) {
      throw createRuntimeError(
        RuntimeErrorCode.MISSING_BLOB_PAYLOAD,
        `Expected blob payload for artifact ${artifact.artifactId}.`,
        { context: `artifact ${artifact.artifactId}` }
      );
    }
    if (blobPayload && status === 'succeeded') {
      output.blob = await persistBlobToStorage(
        context.storage,
        context.movieId,
        blobPayload
      );
    }

    const ownership = requireArtifactOwnership({
      artifactId: artifact.artifactId,
      producerJobId: context.job.jobId,
      producerId: context.job.context?.producerId,
      context: `runner materialize job=${context.job.jobId}`,
    });

    const event: ArtifactEvent = {
      artifactId: artifact.artifactId,
      revision: context.revision,
      inputsHash: context.inputsHash,
      output,
      status,
      producerJobId: ownership.producerJobId,
      producerId: ownership.producerId,
      diagnostics: artifact.diagnostics,
      createdAt: context.clock.now(),
      lastRevisionBy: 'producer',
    };

    await context.eventLog.appendArtifact(context.movieId, event);
    events.push(event);
  }
  return events;
}

function normalizeStatus(
  status: ArtifactEventStatus | undefined
): ArtifactEventStatus {
  if (status === 'succeeded' || status === 'failed' || status === 'skipped') {
    return status;
  }
  return 'succeeded';
}

function deriveJobStatus(
  baseStatus: ArtifactEventStatus,
  artifacts: ArtifactEvent[]
): ArtifactEventStatus {
  if (artifacts.some((event) => event.status === 'failed')) {
    return 'failed';
  }
  if (baseStatus === 'failed') {
    return 'failed';
  }
  if (artifacts.length === 0) {
    return baseStatus;
  }
  if (artifacts.every((event) => event.status === 'skipped')) {
    return baseStatus === 'succeeded' ? 'skipped' : baseStatus;
  }
  return 'succeeded';
}

/**
 * Backwards-compatible helper for callers that still update execution state
 * incrementally outside the runner.
 */
export function accumulateArtifacts(
  executionState: ExecutionState,
  artifacts: ArtifactEvent[]
): ExecutionState {
  return applyArtifactEventsToExecutionState(executionState, artifacts);
}

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    name: 'Error',
    message: typeof error === 'string' ? error : JSON.stringify(error),
  };
}

function buildFailureDiagnostics(
  error: unknown,
  serialized: SerializedError
): Record<string, unknown> {
  const diagnostics: Record<string, unknown> = { error: serialized };
  if (!_isRecord(error)) {
    return diagnostics;
  }

  const metadata = _isRecord(error.metadata) ? error.metadata : undefined;
  const providerRequestId =
    readStringValue(error, 'providerRequestId') ??
    readStringValue(error, 'falRequestId') ??
    readStringValue(error, 'requestId') ??
    readStringValue(metadata, 'providerRequestId');
  if (providerRequestId) {
    diagnostics.providerRequestId = providerRequestId;
  }

  const recoverable =
    readBooleanValue(error, 'recoverable') ??
    readBooleanValue(metadata, 'recoverable');
  if (typeof recoverable === 'boolean') {
    diagnostics.recoverable = recoverable;
  }

  const provider =
    readStringValue(error, 'provider') ?? readStringValue(metadata, 'provider');
  if (provider) {
    diagnostics.provider = provider;
  }

  const model =
    readStringValue(error, 'model') ?? readStringValue(metadata, 'model');
  if (model) {
    diagnostics.model = model;
  }

  const reason =
    readStringValue(error, 'reason') ?? readStringValue(metadata, 'reason');
  if (reason) {
    diagnostics.reason = reason;
  }

  return diagnostics;
}

function readStringValue(
  source: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  if (!source) {
    return undefined;
  }
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

function readBooleanValue(
  source: Record<string, unknown> | undefined,
  key: string
): boolean | undefined {
  if (!source) {
    return undefined;
  }
  const value = source[key];
  return typeof value === 'boolean' ? value : undefined;
}

function _isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readResolvedValue(
  canonicalId: string,
  resolved: Record<string, unknown>
): unknown {
  return resolved[canonicalId];
}

interface FanInResolvedValue {
  groupBy: string;
  orderBy?: string;
  groups: string[][];
}

function materializeFanInValue(
  descriptor: FanInDescriptor
): FanInResolvedValue {
  const groups = new Map<number, Array<{ id: string; order?: number }>>();
  for (const member of descriptor.members) {
    const list = groups.get(member.group) ?? [];
    list.push({ id: member.id, order: member.order });
    groups.set(member.group, list);
  }
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => a - b);
  const maxGroup = sortedKeys.length ? Math.max(...sortedKeys) : -1;
  const collection: string[][] = Array.from({ length: maxGroup + 1 }, () => []);
  for (const key of sortedKeys) {
    const entries = groups.get(key)!;
    entries.sort((a, b) => {
      const orderA = a.order ?? 0;
      const orderB = b.order ?? 0;
      return orderA - orderB;
    });
    collection[key] = entries.map((entry) => entry.id);
  }
  return {
    groupBy: descriptor.groupBy,
    orderBy: descriptor.orderBy,
    groups: collection,
  };
}

function applyConditionalInputFiltering(
  job: JobDescriptor,
  conditionalInputIds: Set<string>,
  satisfiedConditionalIds: Set<string>
): JobDescriptor {
  const filteredInputs = job.inputs.filter((inputId) => {
    if (!conditionalInputIds.has(inputId)) {
      return true;
    }
    return satisfiedConditionalIds.has(inputId);
  });

  const baseJob: JobDescriptor = {
    ...job,
    inputs: filteredInputs,
  };

  if (!job.context) {
    return baseJob;
  }

  const filteredBindings = job.context.inputBindings
    ? Object.fromEntries(
        Object.entries(job.context.inputBindings).filter(([, canonicalId]) => {
          if (!conditionalInputIds.has(canonicalId)) {
            return true;
          }
          return satisfiedConditionalIds.has(canonicalId);
        })
      )
    : undefined;
  const selectedConditionalBindings: Record<string, string> = {};
  if (job.context.conditionalInputBindings) {
    for (const [alias, candidates] of Object.entries(
      job.context.conditionalInputBindings
    )) {
      const satisfied = candidates.filter((candidate) =>
        satisfiedConditionalIds.has(candidate.sourceId)
      );
      if (satisfied.length > 1) {
        throw createRuntimeError(
          RuntimeErrorCode.INVALID_INPUT_BINDING,
          `Conditional input binding "${alias}" for job ${job.jobId} matched ${satisfied.length} sources. Scalar producer inputs must resolve to exactly one source.`
        );
      }
      const selected = satisfied[0];
      if (selected) {
        selectedConditionalBindings[alias] = selected.sourceId;
      }
    }
  }
  const nextInputBindings = {
    ...(filteredBindings ?? {}),
    ...selectedConditionalBindings,
  };

  const filteredFanIn = job.context.fanIn
    ? Object.fromEntries(
        Object.entries(job.context.fanIn).map(([inputId, descriptor]) => [
          inputId,
          {
            ...descriptor,
            members: descriptor.members.filter((member) => {
              if (!conditionalInputIds.has(member.id)) {
                return true;
              }
              return satisfiedConditionalIds.has(member.id);
            }),
          },
        ])
      )
    : undefined;

  const filteredConditions = job.context.inputConditions
    ? Object.fromEntries(
        Object.entries(job.context.inputConditions).filter(([inputId]) => {
          if (!conditionalInputIds.has(inputId)) {
            return true;
          }
          return satisfiedConditionalIds.has(inputId);
        })
      )
    : undefined;

  return {
    ...baseJob,
    context: {
      ...job.context,
      inputs: filteredInputs,
      inputBindings:
        Object.keys(nextInputBindings).length > 0
          ? nextInputBindings
          : undefined,
      conditionalInputBindings: undefined,
      fanIn:
        filteredFanIn && Object.keys(filteredFanIn).length > 0
          ? filteredFanIn
          : undefined,
      inputConditions:
        filteredConditions && Object.keys(filteredConditions).length > 0
          ? filteredConditions
          : undefined,
    },
  };
}

function collectConditionalBindingConditions(
  job: JobDescriptor
): NonNullable<ProducerJobContext['inputConditions']> {
  const conditions: NonNullable<ProducerJobContext['inputConditions']> = {};
  for (const candidates of Object.values(
    job.context?.conditionalInputBindings ?? {}
  )) {
    for (const candidate of candidates) {
      conditions[candidate.sourceId] = {
        condition: candidate.condition,
        indices: candidate.indices,
      };
    }
  }
  return conditions;
}

/**
 * Merges resolved artifact data into the job context.
 * Preserves existing resolvedInputs and adds newly resolved artifacts.
 */
function mergeResolvedArtifacts(
  job: JobDescriptor,
  resolvedArtifacts: Record<string, unknown>
): JobDescriptor {
  const hasResolvedArtifacts = Object.keys(resolvedArtifacts).length > 0;
  if (!job.context) {
    throw createRuntimeError(
      RuntimeErrorCode.ARTIFACT_RESOLUTION_FAILED,
      `Job ${job.jobId} is missing producer context.`,
      {
        context: `jobId=${job.jobId}`,
        suggestion:
          'Ensure the producer graph includes canonical job context for every scheduled job.',
      }
    );
  }
  const jobContext: ProducerJobContext = job.context;
  const hasFanIn = Boolean(
    jobContext.fanIn && Object.keys(jobContext.fanIn).length > 0
  );

  if (!hasResolvedArtifacts && !hasFanIn) {
    return job;
  }

  const existingExtras: ProducerJobContextExtras = jobContext.extras ?? {};
  const existingResolvedInputs = (existingExtras.resolvedInputs ??
    {}) as Record<string, unknown>;

  const mergedResolvedInputs: Record<string, unknown> = {
    ...existingResolvedInputs,
  };

  if (hasResolvedArtifacts) {
    for (const [resolvedKey, value] of Object.entries(resolvedArtifacts)) {
      mergedResolvedInputs[resolvedKey] = value;
    }
  }

  if (hasResolvedArtifacts && jobContext.inputBindings) {
    for (const [_alias, canonicalId] of Object.entries(
      jobContext.inputBindings
    )) {
      const resolvedValue = readResolvedValue(canonicalId, resolvedArtifacts);
      if (resolvedValue !== undefined) {
        mergedResolvedInputs[canonicalId] = resolvedValue;
      }
    }
  }

  if (jobContext.fanIn) {
    for (const [inputId, descriptor] of Object.entries(jobContext.fanIn)) {
      const fanInValue = materializeFanInValue(descriptor);
      mergedResolvedInputs[inputId] = fanInValue;
    }
  }

  // Merge resolved artifacts with existing resolvedInputs
  return {
    ...job,
    context: {
      ...jobContext,
      extras: {
        ...existingExtras,
        resolvedInputs: mergedResolvedInputs,
      },
    },
  };
}

/**
 * Merges asset blob paths into the job context.
 * These paths allow handlers (like ffmpeg-exporter) to resolve asset references
 * from the event log instead of persisted build state, ensuring fresh paths during execution.
 */
function mergeAssetBlobPaths(
  job: JobDescriptor,
  assetBlobPaths: Record<string, string>
): JobDescriptor {
  if (Object.keys(assetBlobPaths).length === 0) {
    return job;
  }

  if (!job.context) {
    throw createRuntimeError(
      RuntimeErrorCode.ARTIFACT_RESOLUTION_FAILED,
      `Job ${job.jobId} is missing producer context.`,
      {
        context: `jobId=${job.jobId}`,
        suggestion:
          'Ensure the producer graph includes canonical job context for every scheduled job.',
      }
    );
  }
  const jobContext: ProducerJobContext = job.context;
  const existingExtras: ProducerJobContextExtras = jobContext.extras ?? {};

  return {
    ...job,
    context: {
      ...jobContext,
      extras: {
        ...existingExtras,
        assetBlobPaths,
      },
    },
  };
}

function collectResolvedArtifactIds(job: JobDescriptor): string[] {
  const ids = new Set<string>();
  for (const inputId of job.inputs) {
    if (typeof inputId === 'string' && isCanonicalArtifactId(inputId)) {
      ids.add(inputId);
    }
  }
  const fanIn = job.context?.fanIn;
  if (fanIn) {
    for (const descriptor of Object.values(fanIn)) {
      for (const member of descriptor.members) {
        if (isCanonicalArtifactId(member.id)) {
          ids.add(member.id);
        }
      }
    }
  }
  // Also collect artifacts needed for condition evaluation
  // Both base (nested) and decomposed artifact IDs are requested
  const inputConditions = job.context?.inputConditions;
  if (inputConditions) {
    for (const conditionInfo of Object.values(inputConditions)) {
      const artifactIds = extractConditionArtifactIds(
        conditionInfo.condition,
        conditionInfo.indices
      );
      for (const id of artifactIds) {
        ids.add(id);
      }
    }
  }
  return Array.from(ids);
}

/**
 * Extracts artifact IDs from a condition definition.
 * Returns both base (nested) and decomposed artifact IDs.
 *
 * For condition path "Producer.ArtifactName.Field[dimension].SubField" with indices { dimension: 0 }:
 * - Base: "Artifact:Producer.ArtifactName" (for nested artifacts)
 * - Decomposed: "Artifact:Producer.ArtifactName.Field[0].SubField" (for decomposed artifacts)
 *
 * The resolver will request both; whichever exists in the event log will be found.
 */
function extractConditionArtifactIds(
  condition: EdgeConditionDefinition,
  indices: Record<string, number>
): string[] {
  const ids: string[] = [];

  // Handle array of conditions
  if (Array.isArray(condition)) {
    for (const item of condition) {
      ids.push(...extractConditionArtifactIdsFromItem(item, indices));
    }
    return ids;
  }
  return extractConditionArtifactIdsFromItem(condition, indices);
}

function extractConditionArtifactIdsFromItem(
  item: EdgeConditionClause | EdgeConditionGroup,
  indices: Record<string, number>
): string[] {
  const ids: string[] = [];

  // Handle groups (all/any)
  if ('all' in item && item.all) {
    for (const clause of item.all) {
      ids.push(...extractConditionArtifactIdsFromClause(clause, indices));
    }
  }
  if ('any' in item && item.any) {
    for (const clause of item.any) {
      ids.push(...extractConditionArtifactIdsFromClause(clause, indices));
    }
  }
  // Handle single clause
  if ('when' in item) {
    ids.push(
      ...extractConditionArtifactIdsFromClause(
        item as EdgeConditionClause,
        indices
      )
    );
  }
  return ids;
}

function extractConditionArtifactIdsFromClause(
  clause: EdgeConditionClause,
  indices: Record<string, number>
): string[] {
  const whenPath = clause.when;
  if (!whenPath) {
    return [];
  }

  if (whenPath.startsWith('Input:')) {
    return [];
  }
  if (!isCanonicalArtifactId(whenPath)) {
    throw createRuntimeError(
      RuntimeErrorCode.CONDITION_EVALUATION_ERROR,
      `Condition path must be canonical Artifact ID (Artifact:...), received "${whenPath}".`
    );
  }

  const ids: string[] = [];
  const normalizedPath = whenPath.slice('Artifact:'.length);

  // Split by '.' and take first two segments for base artifact ID
  const segments = normalizedPath.split('.');
  if (segments.length < 2) {
    return [];
  }

  // Base artifact ID (first two segments)
  const artifactPath = segments.slice(0, 2).join('.');
  ids.push(formatCanonicalArtifactId([], artifactPath));

  // For decomposed artifacts, substitute indices and build full path
  if (segments.length > 2) {
    let fullPath = normalizedPath;

    // Replace dimension placeholders with indices
    // Iterate in reverse order so that target node indices (added last in merge) win
    // when the same dimension label appears in both source and target nodes.
    const indexEntries = Object.entries(indices).reverse();
    for (const [symbol, index] of indexEntries) {
      // Extract the dimension label from the full symbol (e.g., "loop:segment" -> "segment")
      const parts = symbol.split(':');
      const label =
        parts.length > 0 ? (parts[parts.length - 1] ?? symbol) : symbol;

      // Replace [label] with [index]
      fullPath = fullPath.replace(
        new RegExp(`\\[${escapeRegexChars(label)}\\]`, 'g'),
        `[${index}]`
      );
    }

    ids.push(formatCanonicalArtifactId([], fullPath));
  }

  return ids;
}

/**
 * Escapes special regex characters.
 */
function escapeRegexChars(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Recursively resolve BlobRef objects to BlobInput format for provider execution.
 * This allows the Provider SDK to access blob data and upload it to S3.
 */
async function resolveBlobRefsToInputs(
  value: unknown,
  storage: StorageContext,
  movieId: string
): Promise<unknown> {
  if (isBlobRef(value)) {
    // Read blob from storage and return as BlobInput
    const data = await readBlob(storage, movieId, value);
    return {
      data,
      mimeType: value.mimeType,
    };
  }
  if (Array.isArray(value)) {
    return Promise.all(
      value.map((v) => resolveBlobRefsToInputs(v, storage, movieId))
    );
  }
  // Skip binary data types - don't treat them as plain objects
  if (value instanceof Uint8Array || value instanceof Buffer) {
    return value;
  }
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = await resolveBlobRefsToInputs(v, storage, movieId);
    }
    return result;
  }
  return value;
}

/**
 * Resolve BlobRef objects in a job's context for provider execution.
 */
async function resolveBlobRefsInJobContext(
  job: JobDescriptor,
  storage: StorageContext,
  movieId: string
): Promise<JobDescriptor> {
  if (
    !job.context ||
    !job.context.extras ||
    !job.context.extras.resolvedInputs
  ) {
    return job;
  }

  const resolvedInputs = job.context.extras.resolvedInputs as Record<
    string,
    unknown
  >;
  const resolvedBlobs = await Promise.all(
    Object.entries(resolvedInputs).map(async ([key, value]) => [
      key,
      await resolveBlobRefsToInputs(value, storage, movieId),
    ])
  );

  const newJob: JobDescriptor = {
    ...job,
    context: {
      ...job.context,
      extras: {
        ...job.context.extras,
        resolvedInputs: Object.fromEntries(resolvedBlobs),
      },
    },
  };

  return newJob;
}

/**
 * Extracts asset IDs from resolved artifacts.
 * Looks for Timeline-like structures that contain asset references in clips.
 */
function extractAssetIdsFromResolved(
  resolved: Record<string, unknown>
): string[] {
  const assetIds = new Set<string>();

  for (const value of Object.values(resolved)) {
    extractAssetIdsFromValue(value, assetIds);
  }

  return Array.from(assetIds);
}

/**
 * Recursively extracts asset IDs from a value that might be a Timeline or contain Timelines.
 * Timeline structure: { tracks: [{ clips: [{ properties: { assetId: "Artifact:..." } }] }] }
 */
function extractAssetIdsFromValue(value: unknown, assetIds: Set<string>): void {
  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      extractAssetIdsFromValue(item, assetIds);
    }
    return;
  }

  if (typeof value !== 'object') {
    return;
  }

  const obj = value as Record<string, unknown>;

  // Check if this is an assetId field
  if (typeof obj.assetId === 'string' && obj.assetId.startsWith('Artifact:')) {
    assetIds.add(obj.assetId);
  }

  // Recurse into object properties
  for (const prop of Object.values(obj)) {
    extractAssetIdsFromValue(prop, assetIds);
  }
}
