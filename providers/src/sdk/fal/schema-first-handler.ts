import { createProducerHandlerFactory } from '../handler-factory.js';
import { createProviderError } from '../errors.js';
import type { HandlerFactory, ProviderJobContext } from '../../types.js';
import { buildArtefactsFromUrls } from '../replicate/artefacts.js';
import { extractPlannerContext } from '../replicate/utils.js';
import { validatePayload } from '../schema-validator.js';
import { createFalClientManager } from './client.js';
import { normalizeFalOutput } from './output.js';
import { runFalWithRetries } from './retry.js';

type SchemaFirstFalHandlerOptions = {
  outputMimeType: string;
  logKey: string;
  missingSchemaMessage: string;
  predictionFailedMessage: string;
  includeErrorMessage?: boolean;
};

export function createSchemaFirstFalHandler(options: SchemaFirstFalHandlerOptions): HandlerFactory {
  return (init) => {
    const { descriptor, secretResolver, logger, schemaRegistry } = init;
    const clientManager = createFalClientManager(secretResolver, logger, init.mode, schemaRegistry);
    const notify = init.notifications;
    const notificationLabel = `${descriptor.provider}/${descriptor.model}`;

    return createProducerHandlerFactory({
      domain: 'media',
      notificationKey: notificationLabel,
      warmStart: async () => {
        try {
          await clientManager.ensure();
        } catch (error) {
          logger?.error?.(`providers.fal.${options.logKey}.warmStart.error`, {
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
        const fal = await clientManager.ensure();
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

        let predictionOutput: unknown;
        // fal.ai model identifier format: fal-ai/{model}
        const modelIdentifier = `fal-ai/${request.model}`;

        logger?.debug?.(`providers.fal.${options.logKey}.invoke.start`, {
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

        try {
          predictionOutput = await runFalWithRetries({
            fal: {
              run: (id, opts) => fal.run(id, opts),
            },
            modelIdentifier,
            input,
            logger: init.logger,
            jobId: request.jobId,
            model: request.model,
            plannerContext,
          });
        } catch (error) {
          const rawMessage = error instanceof Error ? error.message : String(error);
          logger?.error?.(`providers.fal.${options.logKey}.invoke.error`, {
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
            code: 'fal_prediction_failed',
            kind: 'transient',
            retryable: true,
            raw: error,
          });
        }

        const outputUrls = normalizeFalOutput(predictionOutput);
        const artefacts = await buildArtefactsFromUrls({
          produces: request.produces,
          urls: outputUrls,
          mimeType: options.outputMimeType,
          mode: init.mode,
        });

        const status = artefacts.some((a) => a.status === 'failed') ? 'failed' : 'succeeded';

        logger?.debug?.(`providers.fal.${options.logKey}.invoke.end`, {
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
            provider: 'fal-ai',
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
