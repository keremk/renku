import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { resolveArtifactsFromEventLog } from './artifact-resolver.js';
import type { EventLog } from './event-log.js';
import { hashInputs } from './event-log.js';
import { createManifestService, type ManifestService } from './manifest.js';
import type { StorageContext } from './storage.js';
import { formatBlobFileName } from './blob-utils.js';
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

/* eslint-disable no-unused-vars */
export interface RunnerLogger extends Partial<Logger> {}

export interface RunnerOptions {
  clock?: Clock;
  logger?: RunnerLogger;
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
  logger?: RunnerLogger;
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
  logger: RunnerLogger;
  clock: Clock;
  manifestService: ManifestService;
  notifications?: NotificationBus;
}

const defaultClock: Clock = {
  now: () => new Date().toISOString(),
};

const noopLogger: RunnerLogger = {};

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
      const eventLog = ctx.eventLog;
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
  const inputsHash = hashInputs(job.inputs);
  const expectedArtefacts = job.produces.filter((id) => id.startsWith('Artifact:'));

  try {
    // Resolve artifacts from event log
    const resolvedArtifacts = await resolveArtifactsFromEventLog({
      artifactIds: collectResolvedArtifactIds(job),
      eventLog,
      storage,
      movieId,
    });

    // Merge resolved artifacts into job context
    const enrichedJob = mergeResolvedArtifacts(job, resolvedArtifacts);

    const result = await produce({
      movieId,
      job: enrichedJob,
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
      throw new Error(`Expected blob payload for artefact ${artefact.artefactId}.`);
    }
    if (blobPayload && status === 'succeeded') {
      output.blob = await persistBlob(context.storage, context.movieId, blobPayload);
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

async function persistBlob(
  storage: StorageContext,
  movieId: string,
  blob: ProducedArtefact['blob'],
): Promise<BlobRef> {
  if (!blob) {
    throw new Error('Expected blob payload to persist.');
  }
  const buffer = toBuffer(blob.data);
  const hash = createHash('sha256').update(buffer).digest('hex');
  const prefix = hash.slice(0, 2);
  const fileName = formatBlobFileName(hash, blob.mimeType);
  const relativePath = storage.resolve(movieId, 'blobs', prefix, fileName);

  if (!(await storage.storage.fileExists(relativePath))) {
    await ensureDirectories(storage, relativePath);
    const tmpPath = `${relativePath}.tmp-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
    await storage.storage.write(tmpPath, buffer, { mimeType: blob.mimeType });
    await storage.storage.moveFile(tmpPath, relativePath);
  }

  return {
    hash,
    size: buffer.byteLength,
    mimeType: blob.mimeType,
  };
}

async function ensureDirectories(storage: StorageContext, fullPath: string): Promise<void> {
  const segments = fullPath.split('/').slice(0, -1);
  if (!segments.length) {
    return;
  }
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    if (!(await storage.storage.directoryExists(current))) {
      await storage.storage.createDirectory(current, {});
    }
  }
}

function toBuffer(data: Uint8Array | string): Buffer {
  return typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
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

function isRecord(value: unknown): value is Record<string, unknown> {
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
    qualifiedName: typeof job.producer === 'string' ? job.producer : job.jobId,
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
    for (const [alias, canonicalId] of Object.entries(jobContext.inputBindings)) {
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

function collectResolvedArtifactIds(job: JobDescriptor): string[] {
  const ids = new Set<string>();
  for (const inputId of job.inputs) {
    if (typeof inputId === 'string' && inputId.startsWith('Artifact:')) {
      ids.add(inputId);
    }
  }
  const fanIn = job.context?.fanIn;
  if (fanIn) {
    for (const descriptor of Object.values(fanIn)) {
      for (const member of descriptor.members) {
        if (member.id.startsWith('Artifact:')) {
          ids.add(member.id);
        }
      }
    }
  }
  return Array.from(ids);
}
