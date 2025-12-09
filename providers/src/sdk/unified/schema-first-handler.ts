import { createProducerHandlerFactory } from '../handler-factory.js';
import { createProviderError } from '../errors.js';
import type { HandlerFactory, ProviderJobContext } from '../../types.js';
import { buildArtefactsFromUrls } from './artefacts.js';
import { extractPlannerContext } from './utils.js';
import { validatePayload } from '../schema-validator.js';
import type { ProviderAdapter, ProviderClient } from './provider-adapter.js';

export type UnifiedHandlerOptions = {
  adapter: ProviderAdapter;
  outputMimeType: string;
  logKey?: string;
};

/**
 * Creates a unified handler for any provider that implements ProviderAdapter.
 * This eliminates the need for separate handler implementations per provider/media-type.
 */
export function createUnifiedHandler(options: UnifiedHandlerOptions): HandlerFactory {
  const { adapter, outputMimeType, logKey = 'media' } = options;

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
        // Ensure client is initialized
        if (!client) {
          client = await adapter.createClient({
            secretResolver,
            logger,
            mode: init.mode,
            schemaRegistry,
          });
        }

        const plannerContext = extractPlannerContext(request);
        const inputSchema = readInputSchema(request);
        if (!inputSchema) {
          throw createProviderError(`Missing input schema for ${adapter.name} provider.`, {
            code: 'missing_input_schema',
            kind: 'unknown',
          });
        }

        const sdkPayload = runtime.sdk.buildPayload();
        validatePayload(inputSchema, sdkPayload, 'input');
        const input = { ...sdkPayload };

        const modelIdentifier = adapter.formatModelIdentifier(request.model);

        logger?.debug?.(`providers.${adapter.name}.${logKey}.invoke.start`, {
          provider: descriptor.provider,
          model: request.model,
          jobId: request.jobId,
          inputKeys: Object.keys(input),
          plannerContext,
        });
        notify?.publish({
          type: 'progress',
          message: `Invoking ${notificationLabel} for job ${request.jobId}`,
          timestamp: new Date().toISOString(),
        });

        // Use adapter's retry wrapper if provided, otherwise call directly
        const retryWrapper = adapter.createRetryWrapper?.({
          logger,
          jobId: request.jobId,
          model: request.model,
          plannerContext,
        });

        let predictionOutput: unknown;
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
          throw createProviderError(`${adapter.name} prediction failed: ${rawMessage}`, {
            code: `${adapter.name}_prediction_failed`,
            kind: 'transient',
            retryable: true,
            raw: error,
          });
        }

        const outputUrls = adapter.normalizeOutput(predictionOutput);
        const artefacts = await buildArtefactsFromUrls({
          produces: request.produces,
          urls: outputUrls,
          mimeType: outputMimeType,
          mode: init.mode,
        });

        const status = artefacts.some((a) => a.status === 'failed') ? 'failed' : 'succeeded';

        logger?.debug?.(`providers.${adapter.name}.${logKey}.invoke.end`, {
          provider: descriptor.provider,
          model: request.model,
          jobId: request.jobId,
          status,
          artefactCount: artefacts.length,
        });
        notify?.publish({
          type: status === 'succeeded' ? 'success' : 'error',
          message: `${notificationLabel} completed for job ${request.jobId} (${status}).`,
          timestamp: new Date().toISOString(),
        });

        return {
          status,
          artefacts,
          diagnostics: {
            provider: adapter.name,
            model: request.model,
            input,
            outputUrls,
            plannerContext,
            ...(outputUrls.length === 0 && { rawOutput: predictionOutput }),
          },
        };
      },
    })(init);
  };
}

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
