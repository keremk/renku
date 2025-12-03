import { resolve as resolvePath } from 'node:path';
import {
  createEventLog,
  createManifestService,
  prepareJobContext,
  createStorageContext,
  initializeMovieStorage,
  type ExecutionPlan,
  type Manifest,
  type ProduceFn,
  type ProduceResult,
  type RunResult,
  type ProducerJobContext,
  type Logger,
} from '@renku/core';
import {
  createProviderRegistry,
  type ProviderContextPayload,
  type ProviderEnvironment,
  type ProducerHandler,
  type ResolvedProviderHandler,
  type ProviderDescriptor,
} from '@renku/providers';
import type { CliConfig } from './cli-config.js';
import { normalizeConcurrency } from './cli-config.js';
import type { ProducerOptionsMap, LoadedProducerOption } from './producer-options.js';
import { executePlanWithConcurrency } from './plan-runner.js';

export interface ExecuteBuildOptions {
  cliConfig: CliConfig;
  movieId: string;
  plan: ExecutionPlan;
  manifest: Manifest;
  manifestHash: string | null;
  providerOptions: ProducerOptionsMap;
  resolvedInputs: Record<string, unknown>;
  concurrency?: number;
  upToLayer?: number;
  logger?: Logger;
  notifications?: import('@renku/core').NotificationBus;
}

export interface BuildSummary {
  status: RunResult['status'];
  jobCount: number;
  counts: {
    succeeded: number;
    failed: number;
    skipped: number;
  };
  manifestRevision: string;
  manifestPath: string;
}

export interface ExecuteBuildResult {
  run: RunResult;
  manifest: Manifest;
  manifestPath: string;
  manifestHash: string;
  summary: BuildSummary;
}

export async function executeBuild(options: ExecuteBuildOptions): Promise<ExecuteBuildResult> {
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
  const registry = createProviderRegistry({ mode: 'live', logger, notifications });
  const preResolved = prepareProviderHandlers(registry, options.plan, options.providerOptions);
  await registry.warmStart?.(preResolved);
  const resolvedInputsWithSystem = {
    ...options.resolvedInputs,
    ...(options.resolvedInputs['Input:MovieId'] === undefined ? { 'Input:MovieId': options.movieId } : {}),
    ...(options.resolvedInputs['Input:StorageRoot'] === undefined ? { 'Input:StorageRoot': options.cliConfig.storage.root } : {}),
    ...(options.resolvedInputs['Input:StorageBasePath'] === undefined
      ? { 'Input:StorageBasePath': options.cliConfig.storage.basePath }
      : {}),
  };
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
    { concurrency, upToLayer: options.upToLayer },
  );

  const manifest = await run.buildManifest();
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

  return {
    run,
    manifest,
    manifestPath,
    manifestHash: hash,
    summary: summarizeRun(run, manifestPath),
  };
}

function summarizeRun(run: RunResult, manifestPath: string): BuildSummary {
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
    status: run.status,
    jobCount: run.jobs.length,
    counts,
    manifestRevision: run.revision,
    manifestPath,
  };
}

export function createProviderProduce(
  registry: ReturnType<typeof createProviderRegistry>,
  providerOptions: ProducerOptionsMap,
  resolvedInputs: Record<string, unknown>,
  preResolved: ResolvedProviderHandler[] = [],
  logger: Logger = globalThis.console,
  notifications?: import('@renku/core').NotificationBus,
): ProduceFn {
  const handlerCache = new Map<string, ProducerHandler>();

  for (const binding of preResolved) {
    const cacheKey = makeDescriptorKey(registry.mode, binding.descriptor.provider, binding.descriptor.model, binding.descriptor.environment);
    handlerCache.set(cacheKey, binding.handler);
  }

  return async (request) => {
    const producerName = request.job.producer;
    if (typeof producerName !== 'string') {
      return {
        jobId: request.job.jobId,
        status: 'skipped',
        artefacts: [],
      } satisfies ProduceResult;
    }

    const providerOption = resolveProviderOption(
      providerOptions,
      producerName,
      request.job.provider,
      request.job.providerModel,
    );

    const descriptor = toDescriptor(providerOption);
    const descriptorKey = makeDescriptorKey(
      registry.mode,
      descriptor.provider,
      descriptor.model,
      descriptor.environment,
    );

    let handler = handlerCache.get(descriptorKey);
    if (!handler) {
      handler = registry.resolve(descriptor);
      handlerCache.set(descriptorKey, handler);
    }

    const prepared = prepareJobContext(request.job, resolvedInputs);
    const context = buildProviderContext(providerOption, prepared.context, prepared.resolvedInputs);
    const log = formatResolvedInputs(prepared.resolvedInputs);
    logger.debug('provider.invoke.inputs', {
      producer: producerName,
      values: log,
    });
    validateResolvedInputs(producerName, providerOption, prepared.resolvedInputs, logger);
    logger.info(
      `provider.invoke.start ${providerOption.provider}/${providerOption.model} [${providerOption.environment}] -> ${request.job.produces.join(', ')}`,
    );
    notifications?.publish({
      type: 'progress',
      message: `Invoking ${providerOption.provider}/${providerOption.model} for ${producerName}.`,
      timestamp: new Date().toISOString(),
    });

    let response;
    try {
      response = await handler.invoke({
        jobId: request.job.jobId,
        provider: descriptor.provider,
        model: descriptor.model,
        revision: request.revision,
        layerIndex: request.layerIndex,
        attempt: request.attempt,
        inputs: request.job.inputs,
        produces: request.job.produces,
        context,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('provider.invoke.failed', {
        provider: providerOption.provider,
        model: providerOption.model,
        environment: providerOption.environment,
        error: errorMessage,
      });
      notifications?.publish({
        type: 'error',
        message: `Provider ${providerOption.provider}/${providerOption.model} failed for ${producerName}: ${errorMessage}`,
        timestamp: new Date().toISOString(),
      });
      throw error;
    }

    logger.info(
      `provider.invoke.end ${providerOption.provider}/${providerOption.model} [${providerOption.environment}]`,
    );
    notifications?.publish({
      type: 'success',
      message: `Finished ${providerOption.provider}/${providerOption.model} for ${producerName}.`,
      timestamp: new Date().toISOString(),
    });

    const diagnostics = {
      ...response.diagnostics,
      provider: {
        ...(response.diagnostics?.provider as Record<string, unknown> | undefined),
        producer: producerName,
        provider: providerOption.provider,
        model: providerOption.model,
        environment: providerOption.environment,
        mode: handler.mode,
      },
    } satisfies Record<string, unknown>;

    return {
      jobId: request.job.jobId,
      status: response.status ?? 'succeeded',
      artefacts: response.artefacts,
      diagnostics,
    } satisfies ProduceResult;
  };
}

export function prepareProviderHandlers(
  registry: ReturnType<typeof createProviderRegistry>,
  plan: ExecutionPlan,
  providerOptions: ProducerOptionsMap,
): ResolvedProviderHandler[] {
  const descriptorMap = new Map<string, ProviderDescriptor>();
  for (const layer of plan.layers) {
    for (const job of layer) {
      if (typeof job.producer !== 'string') {
        continue;
      }
      const option = resolveProviderOption(providerOptions, job.producer, job.provider, job.providerModel);
      const descriptor = toDescriptor(option);
      const key = makeDescriptorKey(registry.mode, descriptor.provider, descriptor.model, descriptor.environment);
      if (!descriptorMap.has(key)) {
        descriptorMap.set(key, descriptor);
      }
    }
  }
  return registry.resolveMany(Array.from(descriptorMap.values()));
}

function resolveProviderOption(
  providerOptions: ProducerOptionsMap,
  producer: string,
  provider: string,
  model: string,
): LoadedProducerOption {
  const options = providerOptions.get(producer);
  if (!options || options.length === 0) {
    throw new Error(`No provider configuration defined for producer "${producer}".`);
  }
  const match = options.find((option) => option.provider === provider && option.model === model);
  if (!match) {
    throw new Error(`No provider configuration matches ${producer} -> ${provider}/${model}.`);
  }
  return match;
}

function buildProviderContext(
  option: LoadedProducerOption,
  jobContext: ProducerJobContext | undefined,
  resolvedInputs: Record<string, unknown>,
): ProviderContextPayload {
  const baseConfig = normalizeProviderConfig(option);
  const rawAttachments = option.attachments.length > 0 ? option.attachments : undefined;
  const extras = buildContextExtras(jobContext, resolvedInputs);

  return {
    providerConfig: baseConfig,
    rawAttachments,
    environment: option.environment,
    observability: undefined,
    extras,
  } satisfies ProviderContextPayload;
}

function normalizeProviderConfig(option: LoadedProducerOption): unknown {
  const config = option.config ? { ...(option.config as Record<string, unknown>) } : undefined;
  return option.customAttributes
    ? { customAttributes: option.customAttributes, config }
    : config;
}

function buildContextExtras(
  jobContext: ProducerJobContext | undefined,
  resolvedInputs: Record<string, unknown>,
): Record<string, unknown> {
  const plannerContext = jobContext
    ? {
        index: jobContext.indices,
        namespacePath: jobContext.namespacePath,
        qualifiedName: jobContext.qualifiedName,
      }
    : undefined;

  const extras: Record<string, unknown> = {
    resolvedInputs,
    plannerContext,
  };
  if (jobContext?.extras) {
    for (const [key, value] of Object.entries(jobContext.extras)) {
      if (key === 'resolvedInputs') {
        continue;
      }
      extras[key] = value;
    }
  }
  if (jobContext) {
    extras.jobContext = jobContext;
  }
  return extras;
}

function toDescriptor(option: LoadedProducerOption): ProviderDescriptor {
  return {
    provider: option.provider as ProviderDescriptor['provider'],
    model: option.model,
    environment: option.environment,
  };
}

function makeDescriptorKey(
  mode: string,
  provider: string,
  model: string,
  environment: ProviderEnvironment,
): string {
  return [mode, provider, model, environment].join('|');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatResolvedInputs(inputs: Record<string, unknown>): string {
  return Object.entries(inputs)
    .map(([key, value]) => `${key}=${summarizeValue(value)}`)
    .join(', ');
}

function summarizeValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.length > 80 ? `${value.slice(0, 77)}… (${value.length} chars)` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[array(${value.length})]`;
  }
  if (value instanceof Uint8Array) {
    return `[uint8(${value.byteLength})]`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    const preview = keys.slice(0, 5).join(',');
    const suffix = keys.length > 5 ? `,+${keys.length - 5}` : '';
    return `[object keys=${preview}${suffix ? suffix : ''}]`;
  }
  return String(value);
}

function validateResolvedInputs(
  producerName: string,
  option: LoadedProducerOption,
  inputs: Record<string, unknown>,
  logger: Logger,
): void {
  const keys = Object.keys(inputs);
  if (keys.length === 0) {
    throw new Error(`Aborting ${producerName}: resolved inputs map is empty.`);
  }
  const config = option.config as Record<string, unknown> | undefined;
  const required = Array.isArray(config?.variables) ? (config?.variables as string[]) : [];
  const missing = required.filter((key) => {
    if (key.startsWith('Input:') || key.startsWith('Artifact:')) {
      return inputs[key] === undefined;
    }
    return false;
  });
  if (missing.length > 0) {
    logger.warn(
      `[provider.invoke.inputs] ${producerName} missing resolved input(s): ${missing.join(', ')}.`,
    );
  }
}
