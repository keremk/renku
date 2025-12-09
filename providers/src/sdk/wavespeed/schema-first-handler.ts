import { createProducerHandlerFactory } from '../handler-factory.js';
import { createProviderError } from '../errors.js';
import type { HandlerFactory, ProviderJobContext } from '../../types.js';
import { buildArtefactsFromUrls } from '../replicate/artefacts.js';
import { extractPlannerContext } from '../replicate/utils.js';
import { validatePayload } from '../schema-validator.js';
import { createWavespeedClientManager } from './client.js';
import { normalizeWavespeedOutput } from './output.js';
import { pollForCompletion } from './polling.js';

type SchemaFirstWavespeedHandlerOptions = {
  outputMimeType: string;
  logKey: string;
  missingSchemaMessage: string;
  predictionFailedMessage: string;
  includeErrorMessage?: boolean;
};

export function createSchemaFirstWavespeedHandler(options: SchemaFirstWavespeedHandlerOptions): HandlerFactory {
  return (init) => {
    const { descriptor, secretResolver, logger, schemaRegistry } = init;
    const clientManager = createWavespeedClientManager(secretResolver, logger, init.mode, schemaRegistry);
    const notify = init.notifications;
    const notificationLabel = `${descriptor.provider}/${descriptor.model}`;

    return createProducerHandlerFactory({
      domain: 'media',
      notificationKey: notificationLabel,
      warmStart: async () => {
        // No warm start needed for HTTP-based client
      },
      invoke: async ({ request, runtime }) => {
        const plannerContext = extractPlannerContext(request);
        const inputSchema = readInputSchema(request);
        if (!inputSchema) {
          throw createProviderError(options.missingSchemaMessage, {
            code: 'missing_input_schema',
            kind: 'unknown',
          });
        }

        const sdkPayload = runtime.sdk.buildPayload();
        validatePayload(inputSchema, sdkPayload, 'input');
        const input = { ...sdkPayload };

        logger?.debug?.(`providers.wavespeed.${options.logKey}.invoke.start`, {
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

        let result;
        try {
          // Submit task
          const requestId = await clientManager.submitTask(request.model, input);

          logger?.debug?.(`providers.wavespeed.${options.logKey}.invoke.submitted`, {
            provider: descriptor.provider,
            model: request.model,
            jobId: request.jobId,
            requestId,
          });

          // Poll for completion
          result = await pollForCompletion(clientManager, requestId, {
            logger,
            jobId: request.jobId,
          });
        } catch (error) {
          const rawMessage = error instanceof Error ? error.message : String(error);
          logger?.error?.(`providers.wavespeed.${options.logKey}.invoke.error`, {
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
          const message = options.includeErrorMessage
            ? `${options.predictionFailedMessage}: ${rawMessage}`
            : options.predictionFailedMessage;
          throw createProviderError(message, {
            code: 'wavespeed_prediction_failed',
            kind: 'transient',
            retryable: true,
            raw: error,
          });
        }

        const outputUrls = normalizeWavespeedOutput(result);
        const artefacts = await buildArtefactsFromUrls({
          produces: request.produces,
          urls: outputUrls,
          mimeType: options.outputMimeType,
          mode: init.mode,
        });

        const status = artefacts.some((a) => a.status === 'failed') ? 'failed' : 'succeeded';

        logger?.debug?.(`providers.wavespeed.${options.logKey}.invoke.end`, {
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
            provider: 'wavespeed-ai',
            model: request.model,
            input,
            outputUrls,
            plannerContext,
            ...(outputUrls.length === 0 && { rawOutput: result }),
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
