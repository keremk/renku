import { createProducerHandlerFactory } from '../handler-factory.js';
import {
  createProviderError,
  SdkErrorCode,
  type ProviderError,
} from '../errors.js';
import type { HandlerFactory, ProviderJobContext } from '../../types.js';
import { buildArtefactsFromUrls, buildArtefactsFromJson } from './artefacts.js';
import { extractPlannerContext } from './utils.js';
import { validatePayload } from '../schema-validator.js';
import type {
  ProviderAdapter,
  ProviderClient,
  ModelContext,
  UnifiedInvokeResult,
} from './provider-adapter.js';
import { resolveProviderFileInputs } from './file-input-resolution.js';
import {
  parseSchemaFile,
  resolveSchemaRefs,
  type SchemaFile,
} from './schema-file.js';
import { validateOutputWithLogging } from './output-validator.js';

export type UnifiedHandlerOptions = {
  adapter: ProviderAdapter;
  outputMimeType: string;
  logKey?: string;
  /** Optional model context for provider-specific handling (e.g., subProvider) */
  modelContext?: ModelContext;
};

/**
 * Creates a unified handler for any provider that implements ProviderAdapter.
 * This eliminates the need for separate handler implementations per provider/media-type.
 */
export function createUnifiedHandler(
  options: UnifiedHandlerOptions
): HandlerFactory {
  const { adapter, outputMimeType, logKey = 'media', modelContext } = options;

  return (init) => {
    const { descriptor, secretResolver, logger, schemaRegistry } = init;
    const notify = init.notifications;
    const notificationLabel = `${descriptor.provider}/${descriptor.model}`;

    let client: ProviderClient | null = null;

    return createProducerHandlerFactory({
      domain: 'media',
      notificationKey: notificationLabel,
      warmStart: async () => {
        try {
          client = await adapter.createClient({
            secretResolver,
            logger,
            mode: init.mode,
            schemaRegistry,
          });
        } catch (error) {
          logger?.error?.(
            `providers.${adapter.name}.${logKey}.warmStart.error`,
            {
              provider: descriptor.provider,
              model: descriptor.model,
              error: error instanceof Error ? error.message : String(error),
            }
          );
          notify?.publish({
            type: 'error',
            message: `Warm start failed for ${notificationLabel}: ${error instanceof Error ? error.message : String(error)}`,
            timestamp: new Date().toISOString(),
          });
          throw error;
        }
      },
      invoke: async ({ request, runtime }) => {
        const isSimulated = init.mode === 'simulated';

        if (!client) {
          client = await adapter.createClient({
            secretResolver,
            logger,
            mode: init.mode,
            schemaRegistry,
          });
        }

        const plannerContext = extractPlannerContext(request);

        // Read and parse the full schema file (input + output schemas)
        const schemaFile = readSchemaFile(request);
        // Resolve $ref by merging definitions into the schema for AJV validation
        const inputSchemaString = schemaFile
          ? JSON.stringify(
              resolveSchemaRefs(schemaFile.inputSchema, schemaFile.definitions)
            )
          : readInputSchema(request);

        if (!inputSchemaString) {
          throw createProviderError(
            SdkErrorCode.MISSING_INPUT_SCHEMA,
            `Missing input schema for ${adapter.name} provider.`,
            { kind: 'unknown' }
          );
        }

        const sdkPayload = await runtime.sdk.buildPayload(
          undefined,
          inputSchemaString
        );
        const resolvedPayload = await resolveProviderFileInputs({
          payload: sdkPayload,
          inputSchema: inputSchemaString,
          adapter,
          client,
        });
        validatePayload(inputSchemaString, resolvedPayload, 'input');
        const input = { ...resolvedPayload };

        const modelIdentifier = adapter.formatModelIdentifier(
          request.model,
          modelContext
        );

        logger?.debug?.(`providers.${adapter.name}.${logKey}.invoke.start`, {
          provider: descriptor.provider,
          model: request.model,
          jobId: request.jobId,
          inputKeys: Object.keys(input),
          plannerContext,
          simulated: isSimulated,
        });
        notify?.publish({
          type: 'progress',
          message: `${isSimulated ? '[Simulated] ' : ''}Invoking ${notificationLabel} for job ${request.jobId}`,
          timestamp: new Date().toISOString(),
        });

        let invokeResult: UnifiedInvokeResult | undefined;
        let providerRequestId: string | undefined;
        const runtimeInvocationSettings = readRuntimeInvocationSettings(request);
        const maxAttemptsFromSettings =
          runtimeInvocationSettings?.maxRetries !== undefined
            ? runtimeInvocationSettings.maxRetries + 1
            : undefined;
        const retryWrapper = adapter.createRetryWrapper?.({
          logger,
          jobId: request.jobId,
          model: request.model,
          plannerContext,
          maxAttempts: maxAttemptsFromSettings,
          requestTimeoutMs: runtimeInvocationSettings?.requestTimeoutMs,
        });

        try {
          if (retryWrapper) {
            invokeResult = await retryWrapper.execute(() =>
              adapter.invoke(client!, modelIdentifier, input, {
                mode: init.mode,
                request,
                schemaFile,
              })
            );
          } else {
            invokeResult = await adapter.invoke(
              client!,
              modelIdentifier,
              input,
              {
                mode: init.mode,
                request,
                schemaFile,
              }
            );
          }
          providerRequestId = invokeResult.providerRequestId;
        } catch (error) {
          const rawMessage =
            error instanceof Error ? error.message : String(error);

          const recoveryError = error as {
            falRequestId?: string;
            providerRequestId?: string;
            requestId?: string;
            recoverable?: boolean;
            reason?: string;
            provider?: string;
            model?: string;
          };
          providerRequestId =
            recoveryError.providerRequestId ??
            recoveryError.falRequestId ??
            recoveryError.requestId ??
            providerRequestId;
          const recoverable = recoveryError.recoverable === true;
          const reason =
            typeof recoveryError.reason === 'string'
              ? recoveryError.reason
              : undefined;

          logger?.error?.(`providers.${adapter.name}.${logKey}.invoke.error`, {
            provider: descriptor.provider,
            model: request.model,
            jobId: request.jobId,
            error: rawMessage,
            providerRequestId,
            recoverable,
            reason,
          });
          notify?.publish({
            type: 'error',
            message: `Provider ${notificationLabel} failed for job ${request.jobId}: ${rawMessage}`,
            timestamp: new Date().toISOString(),
          });
          if (isProviderError(error)) {
            throw error;
          }

          // Create provider error with recovery info attached
          const providerError = createProviderError(
            SdkErrorCode.PROVIDER_PREDICTION_FAILED,
            `${adapter.name} prediction failed: ${rawMessage}`,
            {
              kind: 'transient',
              retryable: true,
              raw: error,
              metadata: {
                provider: recoveryError.provider ?? adapter.name,
                model: recoveryError.model ?? request.model,
                ...(providerRequestId && { providerRequestId }),
                ...(recoverable && { recoverable: true }),
                ...(reason && { reason }),
              },
            }
          );

          // Attach recovery info to the error for downstream handling
          if (providerRequestId || recoverable) {
            (
              providerError as unknown as Record<string, unknown>
            ).providerRequestId = providerRequestId;
            (
              providerError as unknown as Record<string, unknown>
            ).recoverable = recoverable;
            (providerError as unknown as Record<string, unknown>).provider =
              recoveryError.provider ?? adapter.name;
            (providerError as unknown as Record<string, unknown>).model =
              recoveryError.model ?? request.model;
            if (reason) {
              (providerError as unknown as Record<string, unknown>).reason =
                reason;
            }
          }

          throw providerError;
        }

        if (!invokeResult) {
          throw createProviderError(
            SdkErrorCode.PROVIDER_PREDICTION_FAILED,
            `${adapter.name} prediction completed without a result.`,
            { kind: 'unknown' }
          );
        }

        const predictionOutput = invokeResult.result;

        // Validate output against schema (logs warning if invalid, doesn't throw)
        if (schemaFile) {
          validateOutputWithLogging(predictionOutput, schemaFile, logger, {
            provider: adapter.name,
            model: request.model,
            jobId: request.jobId,
          });
        }

        // Branch based on output type:
        // - JSON outputs: the response IS the artifact data
        // - Media outputs: extract URLs and download content
        const isJsonOutput = outputMimeType === 'application/json';
        const extras = request.context?.extras as
          | Record<string, unknown>
          | undefined;
        const jobContext = extras?.jobContext as
          | {
              inputBindings?: Record<string, string>;
            }
          | undefined;

        let artefacts: import('@gorenku/core').ProducedArtefact[];

        if (isJsonOutput) {
          // JSON outputs: serialize the response directly as artifact data
          artefacts = buildArtefactsFromJson({
            produces: request.produces,
            jsonOutput: predictionOutput,
            mimeType: outputMimeType,
          });
        } else {
          // Media outputs: extract URLs and download/mock content
          const outputUrls = adapter.normalizeOutput(predictionOutput);
          artefacts = await buildArtefactsFromUrls({
            produces: request.produces,
            durationInputId: jobContext?.inputBindings?.Duration,
            urls: outputUrls,
            mimeType: outputMimeType,
            mode: init.mode,
            resolvedInputs: extras?.resolvedInputs as
              | Record<string, unknown>
              | undefined,
          });
        }

        const status = artefacts.some((a) => a.status === 'failed')
          ? 'failed'
          : 'succeeded';

        logger?.debug?.(`providers.${adapter.name}.${logKey}.invoke.end`, {
          provider: descriptor.provider,
          model: request.model,
          jobId: request.jobId,
          status,
          artefactCount: artefacts.length,
          simulated: isSimulated,
        });
        notify?.publish({
          type: status === 'succeeded' ? 'success' : 'error',
          message: `${isSimulated ? '[Simulated] ' : ''}${notificationLabel} completed for job ${request.jobId} (${status}).`,
          timestamp: new Date().toISOString(),
        });

        return {
          status,
          artefacts,
          diagnostics: {
            provider: adapter.name,
            model: request.model,
            input,
            plannerContext,
            simulated: isSimulated,
            outputType: isJsonOutput ? 'json' : 'media',
            // Include provider request ID for recovery on failed requests
            ...(providerRequestId && {
              providerRequestId,
              recoverable: true,
            }),
          },
        };
      },
    })(init);
  };
}

function isProviderError(error: unknown): error is ProviderError {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as Partial<ProviderError>;
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.kind === 'string' &&
    typeof candidate.retryable === 'boolean'
  );
}

/**
 * Read the raw input schema string from request context.
 * This is the legacy method - prefer readSchemaFile for full schema access.
 */
function readInputSchema(request: ProviderJobContext): string | undefined {
  const extras = request.context.extras;
  if (!extras || typeof extras !== 'object') {
    return undefined;
  }
  const schema = (extras as Record<string, unknown>).schema;
  if (!schema || typeof schema !== 'object') {
    return undefined;
  }
  const input = (schema as Record<string, unknown>).input;
  return typeof input === 'string' ? input : undefined;
}

/**
 * Read and parse the full schema file from request context.
 * Returns the parsed SchemaFile with input schema, output schema, and definitions.
 * Falls back to undefined if the raw schema string is not available.
 */
function readSchemaFile(request: ProviderJobContext): SchemaFile | undefined {
  const extras = request.context.extras;
  if (!extras || typeof extras !== 'object') {
    return undefined;
  }
  const schema = (extras as Record<string, unknown>).schema;
  if (!schema || typeof schema !== 'object') {
    return undefined;
  }

  // Try to read the raw schema file content
  const raw = (schema as Record<string, unknown>).raw;
  if (typeof raw === 'string') {
    try {
      return parseSchemaFile(raw);
    } catch {
      // Fall back to input-only if parsing fails
    }
  }

  // Fall back to constructing from input only (legacy format)
  const input = (schema as Record<string, unknown>).input;
  if (typeof input === 'string') {
    try {
      return parseSchemaFile(input);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

interface RuntimeInvocationSettings {
  requestTimeoutMs?: number;
  maxRetries?: number;
}

function readRuntimeInvocationSettings(
  request: ProviderJobContext
): RuntimeInvocationSettings | undefined {
  const extras = request.context.extras;
  if (!isRecord(extras)) {
    return undefined;
  }

  const rawSettings = extras.runtimeLlmInvocationSettings;
  if (rawSettings === undefined) {
    return undefined;
  }
  if (!isRecord(rawSettings)) {
    throw new Error(
      'runtimeLlmInvocationSettings must be an object when provided in job context extras.'
    );
  }

  const requestTimeoutMs = readOptionalInteger(
    rawSettings.requestTimeoutMs,
    'runtimeLlmInvocationSettings.requestTimeoutMs',
    1
  );
  const maxRetries = readOptionalInteger(
    rawSettings.maxRetries,
    'runtimeLlmInvocationSettings.maxRetries',
    0
  );

  const normalized: RuntimeInvocationSettings = {};
  if (requestTimeoutMs !== undefined) {
    normalized.requestTimeoutMs = requestTimeoutMs;
  }
  if (maxRetries !== undefined) {
    normalized.maxRetries = maxRetries;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function readOptionalInteger(
  value: unknown,
  label: string,
  minValue: number
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer when provided.`);
  }
  if ((value as number) < minValue) {
    throw new Error(`${label} must be greater than or equal to ${minValue}.`);
  }
  return value as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
