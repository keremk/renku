import {
  prepareJobContext,
  isCanonicalArtifactId,
  isCanonicalInputId,
  isBlobInput,
  type ExecutionPlan,
  type ProduceFn,
  type ProduceResult,
  type ProducerJobContext,
  type BlobInput,
  type Logger,
  type NotificationBus,
  type LlmInvocationSettings,
} from '@gorenku/core';
import type { ProducerOptionsMap, LoadedProducerOption } from '@gorenku/core';
import type {
  ProviderRegistry,
  ProviderContextPayload,
  ProviderDescriptor,
  ProviderEnvironment,
  ProducerHandler,
  ResolvedProviderHandler,
  ConditionHints,
} from '../types.js';

/**
 * Creates a ProduceFn that uses the provider registry to invoke handlers.
 *
 * This function is the bridge between the core execution system and the
 * providers package. It:
 * - Resolves the appropriate handler from the registry
 * - Prepares job context with resolved inputs
 * - Invokes the handler and returns results
 *
 * @param registry - The provider registry to resolve handlers from
 * @param providerOptions - Map of producer name to provider options
 * @param resolvedInputs - Map of canonical input IDs to their values
 * @param preResolved - Pre-resolved handlers for warm start optimization
 * @param logger - Logger for debug output
 * @param notifications - Optional notification bus for progress updates
 * @param conditionHints - Optional condition hints for dry-run simulation
 * @returns A ProduceFn that can be passed to ExecutionService
 */
export function createProviderProduce(
  registry: ProviderRegistry,
  providerOptions: ProducerOptionsMap,
  resolvedInputs: Record<string, unknown>,
  preResolved: ResolvedProviderHandler[] = [],
  logger: Logger = globalThis.console,
  notifications?: NotificationBus,
  conditionHints?: ConditionHints,
  llmInvocationSettings?: LlmInvocationSettings
): ProduceFn {
  const handlerCache = new Map<string, ProducerHandler>();

  for (const binding of preResolved) {
    const cacheKey = makeDescriptorKey(
      registry.mode,
      binding.descriptor.provider,
      binding.descriptor.model,
      binding.descriptor.environment
    );
    handlerCache.set(cacheKey, binding.handler);
  }

  return async (request) => {
    const producerName = request.job.producer;
    if (typeof producerName !== 'string') {
      return {
        jobId: request.job.jobId,
        status: 'skipped',
        artifacts: [],
      } satisfies ProduceResult;
    }

    const providerOption = resolveProviderOption(
      providerOptions,
      producerName,
      request.job.provider,
      request.job.providerModel
    );

    const descriptor = toDescriptor(providerOption);
    const descriptorKey = makeDescriptorKey(
      registry.mode,
      descriptor.provider,
      descriptor.model,
      descriptor.environment
    );

    let handler = handlerCache.get(descriptorKey);
    if (!handler) {
      handler = registry.resolve(descriptor);
      handlerCache.set(descriptorKey, handler);
    }

    const prepared = prepareJobContext(request.job, resolvedInputs);
    const runtimeLlmInvocationSettings =
      normalizeRuntimeLlmInvocationSettings(llmInvocationSettings);

    const context = buildProviderContext(
      providerOption,
      prepared.context,
      prepared.resolvedInputs,
      conditionHints,
      runtimeLlmInvocationSettings
    );
    const log = formatResolvedInputs(prepared.resolvedInputs);
    logger.debug?.('provider.invoke.inputs', {
      producer: producerName,
      values: log,
    });
    validateResolvedInputs(
      producerName,
      providerOption,
      prepared.resolvedInputs,
      logger
    );

    const produces = request.job.produces.map((id) => `   • ${id}`).join('\n');
    const attemptSummary = formatAttemptSummary(request.attempt);
    const executionControlsSummary = formatExecutionControlsSummary(
      runtimeLlmInvocationSettings
    );
    const executionContextSummary = [attemptSummary, executionControlsSummary]
      .filter((segment) => segment.length > 0)
      .join(', ');
    const executionControlsSuffix =
      executionContextSummary.length > 0
        ? `\n  Controls: ${executionContextSummary}`
        : '';
    logger.info?.(
      `- ${providerOption.provider}/${providerOption.model} is starting. It will produce:\n${produces}${executionControlsSuffix}`
    );
    logger.debug?.(
      `provider.invoke.start ${providerOption.provider}/${providerOption.model} [${providerOption.environment}] -> ${request.job.produces.join(', ')}`
    );
    notifications?.publish({
      type: 'progress',
      message:
        `Invoking ${providerOption.provider}/${providerOption.model} for ${producerName}.` +
        (executionContextSummary.length > 0
          ? ` Controls: ${executionContextSummary}.`
          : ''),
      timestamp: new Date().toISOString(),
    });

    let response: Awaited<ReturnType<ProducerHandler['invoke']>>;
    const heartbeatStartedAt = Date.now();
    const heartbeatIntervalMs = 15000;
    const heartbeat = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - heartbeatStartedAt) / 1000);
      logger.info?.(
        `[provider-execution] ${providerOption.provider}/${providerOption.model} is still running for "${producerName}" (${elapsedSeconds}s elapsed)` +
          (executionContextSummary.length > 0
            ? ` [controls: ${executionContextSummary}]`
            : '')
      );
      notifications?.publish({
        type: 'progress',
        message:
          `Still waiting on ${providerOption.provider}/${providerOption.model} for ${producerName} (${elapsedSeconds}s).` +
          (executionContextSummary.length > 0
            ? ` Controls: ${executionContextSummary}.`
            : ''),
        timestamp: new Date().toISOString(),
      });
    }, heartbeatIntervalMs);
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
        signal: request.signal,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const timeoutMsFromError = extractTimeoutMsFromError(error);
      if (timeoutMsFromError !== undefined) {
        const timeoutSummary = formatTimeoutSummary(
          request.attempt,
          timeoutMsFromError,
          runtimeLlmInvocationSettings
        );
        logger.warn?.(
          `[provider-execution] ${providerOption.provider}/${providerOption.model} hit configured request timeout for "${producerName}" (${timeoutSummary})`
        );
        notifications?.publish({
          type: 'warning',
          message:
            `Configured request timeout reached for ${providerOption.provider}/${providerOption.model} on ${producerName} (${timeoutSummary}).`,
          timestamp: new Date().toISOString(),
        });
      }
      logger.error?.('provider.invoke.failed', {
        provider: providerOption.provider,
        model: providerOption.model,
        environment: providerOption.environment,
        error: errorMessage,
        attempt: request.attempt,
        requestTimeoutMs: runtimeLlmInvocationSettings?.requestTimeoutMs,
        maxRetries: runtimeLlmInvocationSettings?.maxRetries,
        timeoutMsFromError,
      });
      notifications?.publish({
        type: 'error',
        message:
          `Provider ${providerOption.provider}/${providerOption.model} failed for ${producerName}: ${errorMessage}` +
          (executionContextSummary.length > 0
            ? ` Controls: ${executionContextSummary}.`
            : ''),
        timestamp: new Date().toISOString(),
      });
      throw error;
    } finally {
      clearInterval(heartbeat);
    }

    logger.info?.(
      `- ${providerOption.provider}/${providerOption.model} finished with success`
    );
    logger.debug?.(
      `provider.invoke.end ${providerOption.provider}/${providerOption.model} [${providerOption.environment}]`
    );
    notifications?.publish({
      type: 'success',
      message:
        `Finished ${providerOption.provider}/${providerOption.model} for ${producerName}.` +
        (executionContextSummary.length > 0
          ? ` Controls: ${executionContextSummary}.`
          : ''),
      timestamp: new Date().toISOString(),
    });

    const diagnostics = {
      ...response.diagnostics,
      provider: {
        ...(response.diagnostics?.provider as
          | Record<string, unknown>
          | undefined),
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
      artifacts: response.artifacts,
      diagnostics,
    } satisfies ProduceResult;
  };
}

/**
 * Pre-resolves provider handlers for all jobs in a plan.
 *
 * This enables warm start optimization by resolving all handlers upfront
 * before execution begins. The registry can then initialize connections,
 * authenticate, etc. in parallel.
 *
 * @param registry - The provider registry to resolve handlers from
 * @param plan - The execution plan containing all jobs
 * @param providerOptions - Map of producer name to provider options
 * @returns Array of resolved handlers for warm start
 */
export function prepareProviderHandlers(
  registry: ProviderRegistry,
  plan: ExecutionPlan,
  providerOptions: ProducerOptionsMap
): ResolvedProviderHandler[] {
  const descriptorMap = new Map<string, ProviderDescriptor>();
  for (const layer of plan.layers) {
    for (const job of layer) {
      if (typeof job.producer !== 'string') {
        continue;
      }
      const option = resolveProviderOption(
        providerOptions,
        job.producer,
        job.provider,
        job.providerModel
      );
      const descriptor = toDescriptor(option);
      const key = makeDescriptorKey(
        registry.mode,
        descriptor.provider,
        descriptor.model,
        descriptor.environment
      );
      if (!descriptorMap.has(key)) {
        descriptorMap.set(key, descriptor);
      }
    }
  }
  return registry.resolveMany(Array.from(descriptorMap.values()));
}

/**
 * Resolves provider option for a producer.
 *
 * @param providerOptions - Map of producer name to provider options
 * @param producer - The producer name
 * @param provider - The provider name from the job
 * @param model - The model name from the job
 * @returns The matching LoadedProducerOption
 * @throws Error if no matching configuration found
 */
export function resolveProviderOption(
  providerOptions: ProducerOptionsMap,
  producer: string,
  provider: string,
  model: string
): LoadedProducerOption {
  const options = providerOptions.get(producer);
  if (!options || options.length === 0) {
    throw new Error(
      `No provider configuration defined for producer "${producer}".`
    );
  }
  const match = options.find(
    (option) => option.provider === provider && option.model === model
  );
  if (!match) {
    throw new Error(
      `No provider configuration matches ${producer} -> ${provider}/${model}.`
    );
  }
  return match;
}

/**
 * Builds the provider context payload for a handler invocation.
 *
 * @param option - The loaded producer option
 * @param jobContext - The job context from prepareJobContext
 * @param resolvedInputs - The resolved inputs map
 * @param conditionHints - Optional condition hints for dry-run simulation
 * @returns The provider context payload
 */
export function buildProviderContext(
  option: LoadedProducerOption,
  jobContext: ProducerJobContext | undefined,
  resolvedInputs: Record<string, unknown>,
  conditionHints?: ConditionHints,
  runtimeLlmInvocationSettings?: RuntimeLlmInvocationSettings
): ProviderContextPayload {
  const baseConfig = normalizeProviderConfig(option);
  const rawAttachments =
    option.attachments.length > 0 ? option.attachments : undefined;
  const extras = buildContextExtras(
    jobContext,
    resolvedInputs,
    conditionHints,
    runtimeLlmInvocationSettings
  );

  return {
    providerConfig: baseConfig,
    rawAttachments,
    environment: option.environment,
    observability: undefined,
    extras,
  } satisfies ProviderContextPayload;
}

function normalizeProviderConfig(option: LoadedProducerOption): unknown {
  const config = option.config
    ? { ...(option.config as Record<string, unknown>) }
    : undefined;
  return option.customAttributes
    ? { customAttributes: option.customAttributes, config }
    : config;
}

function buildContextExtras(
  jobContext: ProducerJobContext | undefined,
  resolvedInputs: Record<string, unknown>,
  conditionHints?: ConditionHints,
  runtimeLlmInvocationSettings?: RuntimeLlmInvocationSettings
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
  // Add condition hints for dry-run simulation
  if (conditionHints) {
    extras.conditionHints = conditionHints;
  }
  if (runtimeLlmInvocationSettings) {
    extras.runtimeLlmInvocationSettings = runtimeLlmInvocationSettings;
  }
  return extras;
}

function toDescriptor(option: LoadedProducerOption): ProviderDescriptor {
  return {
    provider: option.provider,
    model: option.model,
    environment: option.environment,
  };
}

function makeDescriptorKey(
  mode: string,
  provider: string,
  model: string,
  environment: ProviderEnvironment
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
    return value.length > 80
      ? `${value.slice(0, 77)}… (${value.length} chars)`
      : value;
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null ||
    value === undefined
  ) {
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
  logger: Logger
): void {
  const keys = Object.keys(inputs);
  if (keys.length === 0) {
    throw new Error(`Aborting ${producerName}: resolved inputs map is empty.`);
  }
  const config = option.config as Record<string, unknown> | undefined;
  const required = Array.isArray(config?.variables)
    ? (config?.variables as string[])
    : [];
  const missing = required.filter((key) => {
    if (isCanonicalInputId(key) || isCanonicalArtifactId(key)) {
      return inputs[key] === undefined;
    }
    return false;
  });
  if (missing.length > 0) {
    logger.warn?.(
      `[provider.invoke.inputs] ${producerName} missing resolved input(s): ${missing.join(', ')}.`
    );
  }
}

interface RuntimeLlmInvocationSettings {
  requestTimeoutMs?: number;
  maxRetries?: number;
}

function normalizeRuntimeLlmInvocationSettings(
  settings: LlmInvocationSettings | undefined
): RuntimeLlmInvocationSettings | undefined {
  if (!settings) {
    return undefined;
  }

  const normalized: RuntimeLlmInvocationSettings = {};
  if (settings.requestTimeoutMs !== null) {
    normalized.requestTimeoutMs = settings.requestTimeoutMs;
  }
  if (settings.maxRetries !== null) {
    normalized.maxRetries = settings.maxRetries;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function formatExecutionControlsSummary(
  settings: RuntimeLlmInvocationSettings | undefined
): string {
  if (!settings) {
    return '';
  }

  const segments: string[] = [];
  if (settings.requestTimeoutMs !== undefined) {
    segments.push(`timeout=${formatTimeoutDuration(settings.requestTimeoutMs)}`);
  }
  if (settings.maxRetries !== undefined) {
    segments.push(`maxRetries=${settings.maxRetries}`);
  }
  return segments.join(', ');
}

function formatAttemptSummary(attempt: number): string {
  return `attempt=${attempt}`;
}

function formatTimeoutSummary(
  attempt: number,
  timeoutMs: number,
  settings: RuntimeLlmInvocationSettings | undefined
): string {
  const segments = [
    `attempt=${attempt}`,
    `timeout=${formatTimeoutDuration(timeoutMs)}`,
  ];
  if (settings?.maxRetries !== undefined) {
    segments.push(`maxRetries=${settings.maxRetries}`);
  }
  return segments.join(', ');
}

function formatTimeoutDuration(timeoutMs: number): string {
  if (timeoutMs % 1000 === 0) {
    return `${timeoutMs / 1000}s`;
  }
  return `${timeoutMs}ms`;
}

function extractTimeoutMsFromError(error: unknown): number | undefined {
  const queue: unknown[] = [error];
  const visited = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || current === null || visited.has(current)) {
      continue;
    }
    visited.add(current);

    if (current instanceof Error) {
      const timeoutMs = parseTimeoutMs(current.message);
      if (timeoutMs !== undefined) {
        return timeoutMs;
      }
      const cause = (current as Error & { cause?: unknown }).cause;
      if (cause !== undefined) {
        queue.push(cause);
      }
      continue;
    }

    if (isRecord(current)) {
      const message =
        typeof current.message === 'string' ? current.message : undefined;
      const timeoutMs = message ? parseTimeoutMs(message) : undefined;
      if (timeoutMs !== undefined) {
        return timeoutMs;
      }
      const cause = current.cause;
      if (cause !== undefined) {
        queue.push(cause);
      }
      const raw = current.raw;
      if (raw !== undefined) {
        queue.push(raw);
      }
    }
  }

  return undefined;
}

function parseTimeoutMs(message: string): number | undefined {
  const match = message.match(/Provider request timed out after (\d+)ms\./);
  if (!match?.[1]) {
    return undefined;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) ? parsed : undefined;
}
