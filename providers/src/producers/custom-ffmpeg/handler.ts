import { createProducerHandlerFactory } from '../../sdk/handler-factory.js';
import { createProviderError, SdkErrorCode } from '../../sdk/errors.js';
import { validatePayload } from '../../sdk/schema-validator.js';
import {
  parseSchemaFile,
  resolveSchemaRefs,
} from '../../sdk/unified/schema-file.js';
import type { HandlerFactory, HandlerFactoryInit } from '../../types.js';
import { videoStitchOperation } from './operations/video-stitch.js';
import type { CustomFfmpegOperation } from './types.js';

const OPERATIONS = new Map<string, CustomFfmpegOperation>([
  ['ffmpeg/video-stitch', videoStitchOperation],
]);

export function createCustomFfmpegHandler(): HandlerFactory {
  return (init: HandlerFactoryInit) => {
    const { descriptor, getModelSchema } = init;

    return createProducerHandlerFactory({
      domain: 'media',
      invoke: async (args) => {
        const operation = OPERATIONS.get(descriptor.model);
        if (!operation) {
          throw createProviderError(
            SdkErrorCode.INVALID_CONFIG,
            `No custom FFmpeg operation is registered for "${descriptor.model}".`,
            {
              kind: 'user_input',
              causedByUser: true,
              metadata: {
                model: descriptor.model,
              },
            }
          );
        }

        const schemaRaw = await getModelSchema?.('renku', descriptor.model);
        const rawConfig = args.runtime.config.raw ?? {};
        if (schemaRaw) {
          const schemaFile = parseSchemaFile(schemaRaw);
          const resolvedSchema = resolveSchemaRefs(
            schemaFile.inputSchema,
            schemaFile.definitions
          );
          validatePayload(
            JSON.stringify(resolvedSchema),
            rawConfig,
            `Custom FFmpeg config for ${descriptor.model}`
          );
        }

        return operation.invoke(args);
      },
    })(init);
  };
}
