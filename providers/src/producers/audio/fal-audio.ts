import type { HandlerFactory } from '../../types.js';
import { createSchemaFirstFalHandler } from '../../sdk/fal/schema-first-handler.js';

const OUTPUT_MIME_TYPE = 'audio/mpeg';

export function createFalAudioHandler(): HandlerFactory {
  return createSchemaFirstFalHandler({
    outputMimeType: OUTPUT_MIME_TYPE,
    logKey: 'audio',
    missingSchemaMessage: 'Missing input schema for fal.ai audio provider.',
    predictionFailedMessage: 'Fal.ai audio generation failed.',
  });
}
