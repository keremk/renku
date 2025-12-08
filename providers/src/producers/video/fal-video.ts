import type { HandlerFactory } from '../../types.js';
import { createSchemaFirstFalHandler } from '../../sdk/fal/schema-first-handler.js';

const OUTPUT_MIME_TYPE = 'video/mp4';

export function createFalVideoHandler(): HandlerFactory {
  return createSchemaFirstFalHandler({
    outputMimeType: OUTPUT_MIME_TYPE,
    logKey: 'video',
    missingSchemaMessage: 'Missing input schema for fal.ai video provider.',
    predictionFailedMessage: 'Fal.ai video generation failed.',
  });
}
