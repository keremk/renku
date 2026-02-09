import { Buffer } from 'node:buffer';
import { resolveArtifactsFromEventLog, readBlob, resolveArtifactBlobPaths, findFailedArtifacts } from './artifact-resolver.js';
import { formatCanonicalArtifactId, isCanonicalArtifactId } from './canonical-ids.js';
import type { EventLog } from './event-log.js';
import { hashInputContents } from './hashing.js';
import { createManifestService, type ManifestService } from './manifest.js';
import type { StorageContext } from './storage.js';
import { persistBlobToStorage } from './blob-utils.js';
import { isBlobRef, type EdgeConditionClause, type EdgeConditionDefinition, type EdgeConditionGroup } from './types.js';
import { evaluateInputConditions, type ConditionEvaluationContext } from './condition-evaluator.js';
import { createRuntimeError, RuntimeErrorCode } from './errors/index.js';
import {
  type ArtefactEvent,
  type ArtefactEventStatus,
  type BlobRef,
  type Clock,
  type ExecutionPlan,
  type JobDescriptor,
  type JobResult,
  type Manifest,
  type ProduceFn,
  type ProduceRequest,
  type ProduceResult,
  type ProducedArtefact,
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
  manifest: Manifest;
  storage: StorageContext;
  eventLog: EventLog;
  manifestService?: ManifestService;
  produce?: ProduceFn;
  logger?: Partial<Logger>;
  clock?: Clock;
  notifications?: NotificationBus;
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
  manifestService: ManifestService;
  notifications?: NotificationBus;
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
    async execute(plan: ExecutionPlan, context: RunnerExecutionContext): Promise<RunResult> {
      const clock = context.clock ?? baseClock;
      const logger = context.logger ?? baseLogger;
      const produce = context.produce ?? baseProduce;
      const storage = context.storage;
      const eventLog = context.eventLog;
      const notifications = context.notifications ?? baseNotifications;

      const manifestService = context.manifestService ?? createManifestService(storage);

      const startedAt = clock.now();
      const jobs: JobResult[] = [];

      // Track a running manifest that accumulates artifacts produced in earlier layers.
      // This ensures hashInputContents in later layers resolves correct upstream hashes.
      let runningManifest = context.manifest;

      for (let layerIndex = 0; layerIndex < plan.layers.length; layerIndex += 1) {
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
            manifest: runningManifest,
            layerIndex,
            attempt: 1,
            revision: plan.revision,
            produce,
            logger,
            clock,
            manifestService,
            notifications,
          });
          jobs.push(jobResult);

          // Update running manifest with produced artifacts so later layers see correct hashes
          runningManifest = accumulateArtifacts(runningManifest, jobResult.artefacts);
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
        async buildManifest(): Promise<Manifest> {
          return manifestService.buildFromEvents({
            movieId: context.movieId,
            targetRevision: plan.revision,
            baseRevision: context.manifest.revision,
            eventLog,
            clock,
          });
        },
      };
    },

    async executeJob(job: JobDescriptor, ctx: SingleJobExecutionContext): Promise<JobResult> {
      const clock = ctx.clock ?? baseClock;
      const logger = ctx.logger ?? baseLogger;
      const produce = ctx.produce ?? baseProduce;
      const storage = ctx.storage;
      const _eventLog = ctx.eventLog;
      const manifestService = ctx.manifestService ?? createManifestService(storage);

      return executeJob(job, {
        ...ctx,
        layerIndex: ctx.layerIndex ?? 0,
        attempt: ctx.attempt ?? 1,
        revision: ctx.revision,
        produce,
        logger,
        clock,
        manifestService,
        notifications: ctx.notifications ?? baseNotifications,
      });
    },
  };
}

function createStubProduce(): ProduceFn {
  return async (request: ProduceRequest): Promise<ProduceResult> => ({
    jobId: request.job.jobId,
    status: 'skipped',
    artefacts: [],
    diagnostics: {
      reason: 'stubbed',
    },
  });
}

async function executeJob(
  job: JobDescriptor,
  context: RunnerJobContext,
): Promise<JobResult> {
  const { movieId, layerIndex, attempt, revision, produce, logger, clock, storage, eventLog } = context;
  const notifications = context.notifications;
  const startedAt = clock.now();
  const inputsHash = hashInputContents(job.inputs, context.manifest);
  const expectedArtefacts = job.produces.filter((id) => isCanonicalArtifactId(id));

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
      for (const artefactId of expectedArtefacts) {
        const event: ArtefactEvent = {
          artefactId,
          revision,
          inputsHash,
          output: {},
          status: 'failed',
          producedBy: job.jobId,
          diagnostics: {
            reason: 'upstream_failure',
            failedUpstreamArtifacts: failedUpstream,
          },
          createdAt: clock.now(),
        };
        await eventLog.appendArtefact(movieId, event);
      }

      return {
        jobId: job.jobId,
        producer: job.producer,
        status: 'failed',
        artefacts: [],
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
    if (inputConditions && Object.keys(inputConditions).length > 0) {
      const conditionContext: ConditionEvaluationContext = {
        resolvedArtifacts,
      };
      const conditionResults = evaluateInputConditions(inputConditions, conditionContext);

      // Determine which inputs are conditional
      const conditionalInputIds = new Set(Object.keys(inputConditions));

      // Check if any conditional inputs are satisfied
      let anySatisfied = false;
      for (const [, result] of conditionResults) {
        if (result.satisfied) {
          anySatisfied = true;
          break;
        }
      }

      // Check if there are unconditional artifact inputs that would provide data
      // This includes direct artifact inputs and fanIn members without conditions
      const hasUnconditionalArtifactInputs = job.inputs.some((inputId) => {
        if (conditionalInputIds.has(inputId)) {
          return false; // This input is conditional
        }
        return isCanonicalArtifactId(inputId);
      });

      // Check if any fanIn has unconditional members
      const fanIn = job.context?.fanIn;
      const hasUnconditionalFanInMembers = fanIn && Object.values(fanIn).some((spec) =>
        spec.members.some((member) => !conditionalInputIds.has(member.id)),
      );

      // If there are conditional inputs but none are satisfied, skip the job
      // UNLESS there are unconditional artifact inputs or fanIn members that provide data
      if (!anySatisfied && !hasUnconditionalArtifactInputs && !hasUnconditionalFanInMembers) {
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
          artefacts: [],
          diagnostics: { reason: 'conditions_not_met' },
          layerIndex,
          attempt,
          startedAt,
          completedAt,
        };
      }

      // Filter out unsatisfied conditional inputs from the job
      const satisfiedInputs = job.inputs.filter((inputId) => {
        if (!conditionalInputIds.has(inputId)) {
          return true; // Unconditional inputs always included
        }
        const result = conditionResults.get(inputId);
        return result?.satisfied ?? false;
      });

      // Update job with filtered inputs
      job = {
        ...job,
        inputs: satisfiedInputs,
      };
    }

    // Merge resolved artifacts into job context
    const enrichedJob = mergeResolvedArtifacts(job, resolvedArtifacts);

    // Extract asset IDs from resolved artifacts (e.g., from Timeline)
    // and resolve their blob paths from the event log.
    // This ensures exporters get fresh paths even when manifest is stale.
    const assetIds = extractAssetIdsFromResolved(resolvedArtifacts);
    const assetBlobPaths = assetIds.length > 0
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
      movieId,
    );

    const result = await produce({
      movieId,
      job: jobWithResolvedBlobs,
      layerIndex,
      attempt,
      revision,
    });

    const artefacts = await materializeArtefacts(result.artefacts, {
      movieId,
      job,
      revision,
      inputsHash,
      storage,
      eventLog,
      clock,
    });

    const completedAt = clock.now();
    const status = deriveJobStatus(normalizeStatus(result.status), artefacts);

    // logger.info?.(`The ${chalk.blue(job.producer)} successfully completed in ${attempt} attempt, produced ${artefacts.length} artifacts\n`)
    logger.debug?.('runner.job.completed', {
      movieId,
      revision,
      jobId: job.jobId,
      producer: job.producer,
      status,
      layerIndex,
      attempt,
      artefacts: artefacts.length,
    });
    notifications?.publish({
      type: status === 'failed' ? 'error' : status === 'skipped' ? 'warning' : 'success',
      message: `Job ${job.jobId} [${job.producer}] ${status}.`,
      timestamp: completedAt,
    });

    return {
      jobId: job.jobId,
      producer: job.producer,
      status,
      artefacts,
      diagnostics: result.diagnostics,
      layerIndex,
      attempt,
      startedAt,
      completedAt,
    };
  } catch (error) {
    const completedAt = clock.now();
    const serialized = serializeError(error);

    // Record failed artefacts for observability even when produce throws.
    try {
      for (const artefactId of expectedArtefacts) {
        const event: ArtefactEvent = {
          artefactId,
          revision,
          inputsHash,
          output: {},
          status: 'failed',
          producedBy: job.jobId,
          diagnostics: { error: serialized },
          createdAt: clock.now(),
        };
        await eventLog.appendArtefact(movieId, event);
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
        { context: `job ${job.jobId}` },
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
      artefacts: [],
      layerIndex,
      attempt,
      startedAt,
      completedAt,
      error: serialized,
    };
  }
}

async function materializeArtefacts(
  artefacts: ProducedArtefact[],
  context: {
    movieId: string;
    job: JobDescriptor;
    revision: RevisionId;
    inputsHash: string;
    storage: StorageContext;
    eventLog: EventLog;
    clock: Clock;
  },
): Promise<ArtefactEvent[]> {
  const events: ArtefactEvent[] = [];
  for (const artefact of artefacts) {
    const status = normalizeStatus(artefact.status);
    const output: { blob?: BlobRef } = {};

    const blobPayload = artefact.blob;

    if (status === 'succeeded' && !blobPayload) {
      throw createRuntimeError(
        RuntimeErrorCode.MISSING_BLOB_PAYLOAD,
        `Expected blob payload for artefact ${artefact.artefactId}.`,
        { context: `artefact ${artefact.artefactId}` },
      );
    }
    if (blobPayload && status === 'succeeded') {
      output.blob = await persistBlobToStorage(context.storage, context.movieId, blobPayload);
    }

    const event: ArtefactEvent = {
      artefactId: artefact.artefactId,
      revision: context.revision,
      inputsHash: context.inputsHash,
      output,
      status,
      producedBy: context.job.jobId,
      diagnostics: artefact.diagnostics,
      createdAt: context.clock.now(),
    };

    await context.eventLog.appendArtefact(context.movieId, event);
    events.push(event);
  }
  return events;
}


function normalizeStatus(status: ArtefactEventStatus | undefined): ArtefactEventStatus {
  if (status === 'succeeded' || status === 'failed' || status === 'skipped') {
    return status;
  }
  return 'succeeded';
}

function deriveJobStatus(
  baseStatus: ArtefactEventStatus,
  artefacts: ArtefactEvent[],
): ArtefactEventStatus {
  if (artefacts.some((event) => event.status === 'failed')) {
    return 'failed';
  }
  if (baseStatus === 'failed') {
    return 'failed';
  }
  if (artefacts.length === 0) {
    return baseStatus;
  }
  if (artefacts.every((event) => event.status === 'skipped')) {
    return baseStatus === 'succeeded' ? 'skipped' : baseStatus;
  }
  return 'succeeded';
}

/**
 * Accumulate newly produced artifacts into the manifest's artefacts map.
 * This ensures that later-layer jobs see correct upstream artifact hashes
 * when computing content-aware inputsHash.
 */
export function accumulateArtifacts(manifest: Manifest, artefacts: ArtefactEvent[]): Manifest {
  if (artefacts.length === 0) {
    return manifest;
  }
  const updatedArtefacts = { ...manifest.artefacts };
  for (const event of artefacts) {
    if (event.status === 'succeeded' && event.output.blob) {
      updatedArtefacts[event.artefactId] = {
        hash: event.output.blob.hash,
        blob: event.output.blob,
        producedBy: event.producedBy,
        status: event.status,
        diagnostics: event.diagnostics,
        createdAt: event.createdAt,
        inputsHash: event.inputsHash,
      };
    }
  }
  return { ...manifest, artefacts: updatedArtefacts };
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

function _isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readResolvedValue(
  canonicalId: string,
  resolved: Record<string, unknown>,
): unknown {
  if (canonicalId in resolved) {
    return resolved[canonicalId];
  }
  const withoutPrefix = trimIdPrefix(canonicalId);
  if (withoutPrefix in resolved) {
    return resolved[withoutPrefix];
  }
  const withoutDimensions = withoutPrefix.replace(/\[.*?\]/g, '');
  if (withoutDimensions in resolved) {
    return resolved[withoutDimensions];
  }
  return undefined;
}

function trimIdPrefix(id: string): string {
  return id.replace(/^(Artifact|Input):/, '');
}

interface FanInResolvedValue {
  groupBy: string;
  orderBy?: string;
  groups: string[][];
}

function materializeFanInValue(descriptor: FanInDescriptor): FanInResolvedValue {
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

/**
 * Merges resolved artifact data into the job context.
 * Preserves existing resolvedInputs and adds newly resolved artifacts.
 */
function mergeResolvedArtifacts(
  job: JobDescriptor,
  resolvedArtifacts: Record<string, unknown>,
): JobDescriptor {
  const hasResolvedArtifacts = Object.keys(resolvedArtifacts).length > 0;
  const jobContext: ProducerJobContext = job.context ?? {
    namespacePath: [],
    indices: {},
    producerAlias: typeof job.producer === 'string' ? job.producer : job.jobId,
    inputs: job.inputs,
    produces: job.produces,
  };
  const hasFanIn = Boolean(jobContext.fanIn && Object.keys(jobContext.fanIn).length > 0);

  if (!hasResolvedArtifacts && !hasFanIn) {
    return job;
  }

  const existingExtras: ProducerJobContextExtras = jobContext.extras ?? {};
  const existingResolvedInputs = (existingExtras.resolvedInputs ?? {}) as Record<string, unknown>;

  const mergedResolvedInputs: Record<string, unknown> = { ...existingResolvedInputs };

  if (hasResolvedArtifacts) {
    for (const [resolvedKey, value] of Object.entries(resolvedArtifacts)) {
      mergedResolvedInputs[resolvedKey] = value;
    }
  }

  if (hasResolvedArtifacts && jobContext.inputBindings) {
    for (const [_alias, canonicalId] of Object.entries(jobContext.inputBindings)) {
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
 * from the event log instead of the manifest, ensuring fresh paths during execution.
 */
function mergeAssetBlobPaths(
  job: JobDescriptor,
  assetBlobPaths: Record<string, string>,
): JobDescriptor {
  if (Object.keys(assetBlobPaths).length === 0) {
    return job;
  }

  const jobContext: ProducerJobContext = job.context ?? {
    namespacePath: [],
    indices: {},
    producerAlias: typeof job.producer === 'string' ? job.producer : job.jobId,
    inputs: job.inputs,
    produces: job.produces,
  };
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
  // Also collect base artifacts needed for condition evaluation
  const inputConditions = job.context?.inputConditions;
  if (inputConditions) {
    for (const conditionInfo of Object.values(inputConditions)) {
      const artifactId = extractConditionArtifactId(conditionInfo.condition);
      if (artifactId) {
        ids.add(artifactId);
      }
    }
  }
  return Array.from(ids);
}

/**
 * Extracts the base artifact ID from a condition definition.
 * The condition path format is "Producer.ArtifactName.FieldPath..."
 * Returns "Artifact:Producer.ArtifactName"
 */
function extractConditionArtifactId(
  condition: EdgeConditionDefinition,
): string | null {
  // Handle array of conditions
  if (Array.isArray(condition)) {
    for (const item of condition) {
      const result = extractConditionArtifactIdFromItem(item);
      if (result) {
        return result;
      }
    }
    return null;
  }
  return extractConditionArtifactIdFromItem(condition);
}

function extractConditionArtifactIdFromItem(
  item: EdgeConditionClause | EdgeConditionGroup,
): string | null {
  // Handle groups (all/any)
  if ('all' in item && item.all) {
    for (const clause of item.all) {
      const result = extractConditionArtifactIdFromClause(clause);
      if (result) {
        return result;
      }
    }
  }
  if ('any' in item && item.any) {
    for (const clause of item.any) {
      const result = extractConditionArtifactIdFromClause(clause);
      if (result) {
        return result;
      }
    }
  }
  // Handle single clause
  if ('when' in item) {
    return extractConditionArtifactIdFromClause(item as EdgeConditionClause);
  }
  return null;
}

function extractConditionArtifactIdFromClause(
  clause: EdgeConditionClause,
): string | null {
  const whenPath = clause.when;
  if (!whenPath) {
    return null;
  }

  // Split by '.' and take first two segments (Producer.ArtifactName)
  const segments = whenPath.split('.');
  if (segments.length < 2) {
    return null;
  }

  const artifactPath = segments.slice(0, 2).join('.');
  return formatCanonicalArtifactId([], artifactPath);
}

/**
 * Recursively resolve BlobRef objects to BlobInput format for provider execution.
 * This allows the Provider SDK to access blob data and upload it to S3.
 */
async function resolveBlobRefsToInputs(
  value: unknown,
  storage: StorageContext,
  movieId: string,
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
    return Promise.all(value.map(v => resolveBlobRefsToInputs(v, storage, movieId)));
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
  movieId: string,
): Promise<JobDescriptor> {
  if (!job.context || !job.context.extras || !job.context.extras.resolvedInputs) {
    return job;
  }

  const resolvedInputs = job.context.extras.resolvedInputs as Record<string, unknown>;
  const resolvedBlobs = await Promise.all(
    Object.entries(resolvedInputs).map(async ([key, value]) => [
      key,
      await resolveBlobRefsToInputs(value, storage, movieId),
    ]),
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
function extractAssetIdsFromResolved(resolved: Record<string, unknown>): string[] {
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
