import type { HandlerFactory } from '../../types.js';
import { createSchemaFirstWavespeedHandler } from '../../sdk/wavespeed/schema-first-handler.js';

const OUTPUT_MIME_TYPE = 'image/jpeg';

export function createWavespeedImageHandler(): HandlerFactory {
  return createSchemaFirstWavespeedHandler({
    outputMimeType: OUTPUT_MIME_TYPE,
    logKey: 'image',
    missingSchemaMessage: 'Missing input schema for wavespeed-ai image provider.',
    predictionFailedMessage: 'Wavespeed-ai image generation failed.',
    includeErrorMessage: true,
  });
}
