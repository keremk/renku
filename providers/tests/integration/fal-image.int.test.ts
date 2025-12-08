/**
 * Fal.ai Image Integration Test (single model)
 *
 * Set exactly one of:
 * - RUN_FAL_IMAGE_SEEDREAM=1 (bytedance/seedream/v4.5/text-to-image)
 *
 * FAL_KEY=xxx RUN_FAL_IMAGE_SEEDREAM=1 pnpm test:integration
 */

import { describe, expect, it } from 'vitest';
import { createFalImageHandler } from '../../src/producers/image/fal-image.js';
import type { ProviderJobContext } from '../../src/types.js';
import { saveTestArtifact } from './test-utils.js';
import {
  buildFalImageExtras,
  getFalImageMapping,
  loadFalImageSchema,
  type FalImageModel,
} from './schema-helpers.js';

const describeIfToken = process.env.FAL_KEY ? describe : describe.skip;

function selectModel(): FalImageModel | null {
  const enabled: Array<{ flag: string; model: FalImageModel }> = [];
  if (process.env.RUN_FAL_IMAGE_SEEDREAM) {
    enabled.push({ flag: 'RUN_FAL_IMAGE_SEEDREAM', model: 'bytedance/seedream/v4.5/text-to-image' });
  }
  if (process.env.RUN_ALL_FAL_IMAGE_TESTS) {
    enabled.push({
      flag: 'RUN_ALL_FAL_IMAGE_TESTS',
      model: 'bytedance/seedream/v4.5/text-to-image',
    });
  }

  const uniqueModels = new Set(enabled.map((entry) => entry.model));
  if (uniqueModels.size > 1) {
    throw new Error('Select exactly one fal.ai image model env flag; multiple models enabled.');
  }
  return enabled[0]?.model ?? null;
}

function resolveInputsFromSchema(model: FalImageModel): Record<string, unknown> {
  const schemaText = loadFalImageSchema(model);
  const schema = JSON.parse(schemaText) as {
    properties?: Record<string, { default?: unknown; minimum?: number }>;
  };
  const properties = schema.properties ?? {};
  const mapping = getFalImageMapping(model);
  const inputs: Record<string, unknown> = {
    'Input:Prompt': `Integration image prompt for fal.ai ${model}`,
  };

  for (const [alias, spec] of Object.entries(mapping)) {
    if (alias === 'Prompt') continue;
    const property = properties[spec.field] ?? {};
    if (typeof property.minimum === 'number') {
      inputs[`Input:${alias}`] = property.minimum;
      continue;
    }
    if (property.default !== undefined) {
      inputs[`Input:${alias}`] = property.default;
      continue;
    }
  }

  return inputs;
}

describeIfToken('Fal.ai image integration (single model)', () => {
  const model = selectModel();
  const describeBlock = model ? describe : describe.skip;

  describeBlock(model ?? 'no-model', () => {
    it('text-to-image uses schema defaults and mapping', async () => {
      if (!model) {
        throw new Error('No model selected for integration test.');
      }

      const handler = createFalImageHandler()({
        descriptor: {
          provider: 'fal-ai',
          model,
          environment: 'local',
        },
        mode: 'live',
        secretResolver: {
          async getSecret(key) {
            if (key === 'FAL_KEY') {
              return process.env.FAL_KEY ?? null;
            }
            return null;
          },
        },
      });

      const resolvedInputs = resolveInputsFromSchema(model);

      const request: ProviderJobContext = {
        jobId: `integration-fal-${model}-image`,
        provider: 'fal-ai',
        model,
        revision: 'rev-test',
        layerIndex: 0,
        attempt: 1,
        inputs: Object.keys(resolvedInputs),
        produces: ['Artifact:SegmentImage[segment=0][image=0]'],
        context: {
          providerConfig: {},
          extras: buildFalImageExtras(model, resolvedInputs),
        },
      };

      await handler.warmStart?.({ logger: undefined });
      const result = await handler.invoke(request);
      
      expect(result.status).toBe('succeeded');
      expect(result.artefacts).toHaveLength(1);
      expect(result.artefacts[0]?.artefactId).toBe('Artifact:SegmentImage[segment=0][image=0]');
      expect(result.artefacts[0]?.blob?.mimeType).toBe('image/png');
      expect(result.artefacts[0]?.blob?.data).toBeInstanceOf(Uint8Array);

      if (result.artefacts[0]?.blob?.data) {
        saveTestArtifact(
          `test-fal-image-${model.replace(/\//g, '-')}.png`,
          result.artefacts[0].blob.data,
        );
      }
    }, 180000);
  });
});
