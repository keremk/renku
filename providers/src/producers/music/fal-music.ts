import type { HandlerFactory } from '../../types.js';
import { createSchemaFirstFalHandler } from '../../sdk/fal/schema-first-handler.js';

const OUTPUT_MIME_TYPE = 'audio/mpeg';

export function createFalMusicHandler(): HandlerFactory {
  return createSchemaFirstFalHandler({
    outputMimeType: OUTPUT_MIME_TYPE,
    logKey: 'music',
    missingSchemaMessage: 'Missing input schema for fal.ai music provider.',
    predictionFailedMessage: 'Fal.ai music generation failed.',
  });
}
