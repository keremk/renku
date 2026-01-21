import { resolve as resolvePath } from 'node:path';
import {
  createEventLog,
  createManifestService,
  isCanonicalArtifactId,
  isCanonicalInputId,
  prepareJobContext,
  createStorageContext,
  initializeMovieStorage,
  loadCloudStorageEnv,
  createCloudStorageContext,
  isBlobInput,
  resolveBlobRefsToInputs,
  type ExecutionPlan,
  type Manifest,
  type ProduceFn,
  type ProduceResult,
  type RunResult,
  type RunConfig,
  type ProducerJobContext,
  type Logger,
  type BlobInput,
  type StorageContext,
} from '@gorenku/core';
import {
  createProviderRegistry,
  type ProviderContextPayload,
  type ProviderEnvironment,
  type ProducerHandler,
  type ResolvedProviderHandler,
  type ProviderDescriptor,
  type LoadedModelCatalog,
} from '@gorenku/providers';
import type { CliConfig } from './cli-config.js';
import { normalizeConcurrency } from './cli-config.js';
import type { ProducerOptionsMap, LoadedProducerOption } from '@gorenku/core';
import { executePlanWithConcurrency } from './plan-runner.js';
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
  /** Target artifact ID for surgical regeneration (canonical format). */
  targetArtifactId?: string;
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
  const resolvedInputsWithBlobs = await resolveBlobRefsToInputs(
    storage,
    options.movieId,
    options.resolvedInputs,
  ) as Record<string, unknown>;

  const resolvedInputsWithSystem = {
    ...resolvedInputsWithBlobs,
    ...(resolvedInputsWithBlobs['Input:MovieId'] === undefined ? { 'Input:MovieId': options.movieId } : {}),
    ...(resolvedInputsWithBlobs['Input:StorageRoot'] === undefined ? { 'Input:StorageRoot': options.cliConfig.storage.root } : {}),
    ...(resolvedInputsWithBlobs['Input:StorageBasePath'] === undefined
      ? { 'Input:StorageBasePath': options.cliConfig.storage.basePath }
      : {}),
  };
  const resolvedInputsWithDerived = injectDerivedSystemInputs(resolvedInputsWithSystem);
  const produce = createProviderProduce(
    registry,
    options.providerOptions,
    resolvedInputsWithDerived,
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
    { concurrency, upToLayer: options.upToLayer, reRunFrom: options.reRunFrom },
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
  if (options.targetArtifactId) {
    runConfig.targetArtifactId = options.targetArtifactId;
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

export function createProviderProduce(
  registry: ReturnType<typeof createProviderRegistry>,
  providerOptions: ProducerOptionsMap,
  resolvedInputs: Record<string, unknown>,
  preResolved: ResolvedProviderHandler[] = [],
  logger: Logger = globalThis.console,
  notifications?: import('@gorenku/core').NotificationBus,
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
    const producesFormatted = request.job.produces.map((id) => chalk.blue(`   • ${id}`)).join('\n');
    logger.info(`- ${providerOption.provider}/${providerOption.model} is starting. It will produce:\n${producesFormatted}`);
    logger.debug(
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

    logger.info(`- ${providerOption.provider}/${providerOption.model} finished with ${chalk.green('success')}`);
    logger.debug(
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
        producerAlias: jobContext.producerAlias,
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
    // Check if array contains blob inputs
    const blobCount = value.filter((item) => isBlobInput(item)).length;
    if (blobCount > 0) {
      return `[array(${value.length}) with ${blobCount} blob(s)]`;
    }
    return `[array(${value.length})]`;
  }
  if (value instanceof Uint8Array) {
    return `[uint8(${value.byteLength})]`;
  }
  // Check for BlobInput before generic object handling
  if (isBlobInput(value)) {
    const blob = value as BlobInput;
    return `[blob: ${blob.mimeType}, ${blob.data.byteLength} bytes]`;
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
    if (isCanonicalInputId(key) || isCanonicalArtifactId(key)) {
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

/**
 * Injects derived system inputs into the resolved inputs map.
 * Auto-computes SegmentDuration from Duration and NumOfSegments.
 *
 * @param inputs - The resolved inputs map with canonical IDs
 * @returns A new inputs map with derived system inputs added
 */
export function injectDerivedSystemInputs(
  inputs: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...inputs };

  // Auto-compute SegmentDuration if Duration and NumOfSegments are present
  const duration = inputs['Input:Duration'];
  const numSegments = inputs['Input:NumOfSegments'];

  if (
    typeof duration === 'number' &&
    typeof numSegments === 'number' &&
    numSegments > 0 &&
    result['Input:SegmentDuration'] === undefined
  ) {
    result['Input:SegmentDuration'] = duration / numSegments;
  }

  return result;
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
