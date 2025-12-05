import { createProducerHandlerFactory } from '../handler-factory.js';
import { createProviderError } from '../errors.js';
import type { HandlerFactory, ProviderJobContext } from '../../types.js';
import {
  buildArtefactsFromUrls,
  createReplicateClientManager,
  extractPlannerContext,
  normalizeReplicateOutput,
  runReplicateWithRetries,
} from './index.js';
import { validatePayload } from '../schema-validator.js';

type SchemaFirstHandlerOptions = {
  outputMimeType: string;
  logKey: string;
  missingSchemaMessage: string;
  predictionFailedMessage: string;
  includeErrorMessage?: boolean;
};

export function createSchemaFirstReplicateHandler(options: SchemaFirstHandlerOptions): HandlerFactory {
  return (init) => {
    const { descriptor, secretResolver, logger, schemaRegistry } = init;
    const clientManager = createReplicateClientManager(secretResolver, logger, init.mode, schemaRegistry);
    const notify = init.notifications;
    const notificationLabel = `${descriptor.provider}/${descriptor.model}`;

    return createProducerHandlerFactory({
      domain: 'media',
      notificationKey: notificationLabel,
      warmStart: async () => {
        try {
          await clientManager.ensure();
        } catch (error) {
          logger?.error?.(`providers.replicate.${options.logKey}.warmStart.error`, {
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
        const replicate = await clientManager.ensure();
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
        const modelIdentifier = request.model as `${string}/${string}` | `${string}/${string}:${string}`;

        // logger?.info?.(`${descriptor.provider} provider for ${request.model} is starting to generate ${request.jobId}`);
        logger?.debug?.(`providers.replicate.${options.logKey}.invoke.start`, {
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
          predictionOutput = await runReplicateWithRetries({
            replicate: {
              run: (id, opts) => replicate.run(id as `${string}/${string}` | `${string}/${string}:${string}`, opts),
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
          logger?.error?.(`providers.replicate.${options.logKey}.invoke.error`, {
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
            code: 'replicate_prediction_failed',
            kind: 'transient',
            retryable: true,
            raw: error,
          });
        }

        const outputUrls = normalizeReplicateOutput(predictionOutput);
        const artefacts = await buildArtefactsFromUrls({
          produces: request.produces,
          urls: outputUrls,
          mimeType: options.outputMimeType,
          mode: init.mode,
        });

        const status = artefacts.some((a) => a.status === 'failed') ? 'failed' : 'succeeded';
        // const statusColor = status === 'failed' ? '\x1b[31m' : '\x1b[32m'; // red : green
        // const reset = '\x1b[0m';

        // logger?.info?.(`${descriptor.provider} provider for ${request.model} is finished the call for ${request.jobId}`)
        logger?.debug?.(`providers.replicate.${options.logKey}.invoke.end`, {
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
            provider: 'replicate',
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
