import { createProducerHandlerFactory } from '../handler-factory.js';
import { createProviderError, SdkErrorCode } from '../errors.js';
import type { HandlerFactory, ProviderJobContext } from '../../types.js';
import { buildArtefactsFromUrls, buildArtefactsFromJson } from './artefacts.js';
import { extractPlannerContext } from './utils.js';
import { validatePayload } from '../schema-validator.js';
import type { ProviderAdapter, ProviderClient, ModelContext } from './provider-adapter.js';
import { parseSchemaFile, resolveSchemaRefs, type SchemaFile } from './schema-file.js';
import { validateOutputWithLogging } from './output-validator.js';
import { generateOutputFromSchema } from './output-generator.js';

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
export function createUnifiedHandler(options: UnifiedHandlerOptions): HandlerFactory {
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
          logger?.error?.(`providers.${adapter.name}.${logKey}.warmStart.error`, {
            provider: descriptor.provider,
            model: descriptor.model,
            error: error instanceof Error ? error.message : String(error),
          });
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

        // In live mode, ensure client is initialized
        if (!isSimulated && !client) {
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
          ? JSON.stringify(resolveSchemaRefs(schemaFile.inputSchema, schemaFile.definitions))
          : readInputSchema(request);

        if (!inputSchemaString) {
          throw createProviderError(
            SdkErrorCode.MISSING_INPUT_SCHEMA,
            `Missing input schema for ${adapter.name} provider.`,
            { kind: 'unknown' },
          );
        }

        const sdkPayload = await runtime.sdk.buildPayload(undefined, inputSchemaString);
        validatePayload(inputSchemaString, sdkPayload, 'input');
        const input = { ...sdkPayload };

        const modelIdentifier = adapter.formatModelIdentifier(request.model, modelContext);

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

        let predictionOutput: unknown;

        if (isSimulated) {
          // SIMULATED MODE: Generate output from schema instead of calling provider
          predictionOutput = generateOutputFromSchema(schemaFile, {
            provider: adapter.name,
            model: request.model,
            producesCount: request.produces.length,
          });

          logger?.debug?.(`providers.${adapter.name}.${logKey}.simulate`, {
            provider: descriptor.provider,
            model: request.model,
            jobId: request.jobId,
            hasOutputSchema: !!schemaFile?.outputSchema,
          });
        } else {
          // LIVE MODE: Call the actual provider API
          const retryWrapper = adapter.createRetryWrapper?.({
            logger,
            jobId: request.jobId,
            model: request.model,
            plannerContext,
          });

          try {
            if (retryWrapper) {
              predictionOutput = await retryWrapper.execute(() =>
                adapter.invoke(client!, modelIdentifier, input)
              );
            } else {
              predictionOutput = await adapter.invoke(client!, modelIdentifier, input);
            }
          } catch (error) {
            const rawMessage = error instanceof Error ? error.message : String(error);
            logger?.error?.(`providers.${adapter.name}.${logKey}.invoke.error`, {
              provider: descriptor.provider,
              model: request.model,
              jobId: request.jobId,
              error: rawMessage,
            });
            notify?.publish({
              type: 'error',
              message: `Provider ${notificationLabel} failed for job ${request.jobId}: ${rawMessage}`,
              timestamp: new Date().toISOString(),
            });
            throw createProviderError(
              SdkErrorCode.PROVIDER_PREDICTION_FAILED,
              `${adapter.name} prediction failed: ${rawMessage}`,
              { kind: 'transient', retryable: true, raw: error },
            );
          }
        }

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
        const extras = request.context?.extras as Record<string, unknown> | undefined;

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
            urls: outputUrls,
            mimeType: outputMimeType,
            mode: init.mode,
            resolvedInputs: extras?.resolvedInputs as Record<string, unknown> | undefined,
          });
        }

        const status = artefacts.some((a) => a.status === 'failed') ? 'failed' : 'succeeded';

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
            ...(isJsonOutput && { rawOutput: predictionOutput }),
          },
        };
      },
    })(init);
  };
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
