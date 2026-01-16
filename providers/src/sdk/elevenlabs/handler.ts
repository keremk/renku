import type { ProducedArtefact } from '@gorenku/core';
import { createProducerHandlerFactory } from '../handler-factory.js';
import { createProviderError, SdkErrorCode } from '../errors.js';
import type { HandlerFactory, ProviderJobContext } from '../../types.js';
import { extractPlannerContext } from '../unified/utils.js';
import { validatePayload } from '../schema-validator.js';
import type { ProviderClient } from '../unified/provider-adapter.js';
import { parseSchemaFile, resolveSchemaRefs, type SchemaFile } from '../unified/schema-file.js';
import { generateWavWithDuration } from '../unified/wav-generator.js';
import { elevenlabsAdapter } from './adapter.js';
import {
  collectStreamToBuffer,
  isElevenlabsStreamResponse,
  estimateTTSDuration,
  extractMusicDuration,
} from './output.js';
import { runWithRetries } from './retry.js';

export interface ElevenlabsHandlerOptions {
  outputMimeType: string;
  logKey?: string;
}

/**
 * Creates a handler for ElevenLabs that handles binary audio streams.
 *
 * Unlike other providers that return URLs, ElevenLabs returns binary
 * audio streams directly. This handler:
 * 1. Calls the ElevenLabs API via the adapter
 * 2. Collects the ReadableStream into a Buffer
 * 3. Returns the buffer directly as artifact blob data
 * 4. In simulated mode, generates mock WAV files with appropriate duration
 */
export function createElevenlabsHandler(options: ElevenlabsHandlerOptions): HandlerFactory {
  const { outputMimeType, logKey = 'audio' } = options;

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
          client = await elevenlabsAdapter.createClient({
            secretResolver,
            logger,
            mode: init.mode,
            schemaRegistry,
          });
        } catch (error) {
          logger?.error?.(`providers.elevenlabs.${logKey}.warmStart.error`, {
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
          client = await elevenlabsAdapter.createClient({
            secretResolver,
            logger,
            mode: init.mode,
            schemaRegistry,
          });
        }

        const plannerContext = extractPlannerContext(request);

        // Read and parse the schema file
        const schemaFile = readSchemaFile(request);
        const inputSchemaString = schemaFile
          ? JSON.stringify(resolveSchemaRefs(schemaFile.inputSchema, schemaFile.definitions))
          : readInputSchema(request);

        if (!inputSchemaString) {
          throw createProviderError(
            SdkErrorCode.MISSING_INPUT_SCHEMA,
            'Missing input schema for ElevenLabs provider.',
            { kind: 'unknown' },
          );
        }

        const sdkPayload = await runtime.sdk.buildPayload(undefined, inputSchemaString);
        validatePayload(inputSchemaString, sdkPayload, 'input');
        const input = { ...sdkPayload };

        logger?.debug?.(`providers.elevenlabs.${logKey}.invoke.start`, {
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

        let audioBuffer: Buffer;

        if (isSimulated) {
          // SIMULATED MODE: Generate mock WAV with appropriate duration
          const duration = estimateDuration(request.model, input);
          audioBuffer = generateWavWithDuration(duration);

          logger?.debug?.(`providers.elevenlabs.${logKey}.simulate`, {
            provider: descriptor.provider,
            model: request.model,
            jobId: request.jobId,
            mockDurationSeconds: duration,
          });
        } else {
          // LIVE MODE: Call ElevenLabs API with retry logic
          try {
            audioBuffer = await runWithRetries(
              async () => {
                const response = await elevenlabsAdapter.invoke(client!, request.model, input);

                if (!isElevenlabsStreamResponse(response)) {
                  throw createProviderError(
                    SdkErrorCode.PROVIDER_PREDICTION_FAILED,
                    'ElevenLabs returned unexpected response format.',
                    { kind: 'unknown' },
                  );
                }

                return collectStreamToBuffer(response.audioStream);
              },
              {
                logger,
                jobId: request.jobId,
                model: request.model,
                plannerContext,
                maxAttempts: 3,
                defaultRetryMs: 10_000,
              },
            );
          } catch (error) {
            const rawMessage = error instanceof Error ? error.message : String(error);
            logger?.error?.(`providers.elevenlabs.${logKey}.invoke.error`, {
              provider: descriptor.provider,
              model: request.model,
              jobId: request.jobId,
              error: rawMessage,
              errorCode: (error as any)?.code,
            });
            notify?.publish({
              type: 'error',
              message: `Provider ${notificationLabel} failed for job ${request.jobId}: ${rawMessage}`,
              timestamp: new Date().toISOString(),
            });
            // Re-throw the error - it's already a structured ProviderError from retry module
            throw error;
          }
        }

        // Build artifacts directly from the buffer
        const artefacts = buildArtefactsFromBuffer({
          produces: request.produces,
          buffer: audioBuffer,
          mimeType: outputMimeType,
        });

        const status = artefacts.some((a) => a.status === 'failed') ? 'failed' : 'succeeded';

        logger?.debug?.(`providers.elevenlabs.${logKey}.invoke.end`, {
          provider: descriptor.provider,
          model: request.model,
          jobId: request.jobId,
          status,
          artefactCount: artefacts.length,
          simulated: isSimulated,
          bufferSize: audioBuffer.length,
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
            provider: 'elevenlabs',
            model: request.model,
            input,
            plannerContext,
            simulated: isSimulated,
            outputType: 'binary',
            bufferSize: audioBuffer.length,
          },
        };
      },
    })(init);
  };
}

/**
 * Estimate duration for mock audio generation based on model and input.
 */
function estimateDuration(model: string, input: Record<string, unknown>): number {
  if (model === 'music_v1') {
    return extractMusicDuration(input);
  }
  // TTS models: estimate from text
  const text = input.text;
  if (typeof text === 'string') {
    return estimateTTSDuration(text);
  }
  // Default to 5 seconds
  return 5;
}

/**
 * Build artifacts from a binary buffer.
 */
function buildArtefactsFromBuffer(options: {
  produces: string[];
  buffer: Buffer;
  mimeType: string;
}): ProducedArtefact[] {
  const { produces, buffer, mimeType } = options;

  // All produces share the same buffer data
  return produces.map((providedId, index) => {
    const artefactId = providedId && providedId.length > 0 ? providedId : `Artifact:Output#${index}`;

    return {
      artefactId,
      status: 'succeeded' as const,
      blob: {
        data: buffer,
        mimeType,
      },
      diagnostics: {
        outputType: 'binary',
        bufferSize: buffer.length,
      },
    };
  });
}

/**
 * Read the raw input schema string from request context.
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

  const raw = (schema as Record<string, unknown>).raw;
  if (typeof raw === 'string') {
    try {
      return parseSchemaFile(raw);
    } catch {
      // Fall back to input-only if parsing fails
    }
  }

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
