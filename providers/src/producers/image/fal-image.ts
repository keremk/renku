import type { HandlerFactory } from '../../types.js';
import { createSchemaFirstFalHandler } from '../../sdk/fal/schema-first-handler.js';

const OUTPUT_MIME_TYPE = 'image/png';

export function createFalImageHandler(): HandlerFactory {
  return createSchemaFirstFalHandler({
    outputMimeType: OUTPUT_MIME_TYPE,
    logKey: 'image',
    missingSchemaMessage: 'Missing input schema for fal.ai image provider.',
    predictionFailedMessage: 'Fal.ai image generation failed.',
    includeErrorMessage: true,
  });
}
