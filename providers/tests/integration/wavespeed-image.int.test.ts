/**
 * Wavespeed-ai Image Integration Test (single model)
 *
 * Set exactly one of:
 * - RUN_WAVESPEED_IMAGE_SEEDREAM=1 (bytedance/seedream-v4.5)
 *
 * WAVESPEED_API_KEY=xxx RUN_WAVESPEED_IMAGE_SEEDREAM=1 pnpm test:integration
 */

import { describe, expect, it } from 'vitest';
import { createWavespeedImageHandler } from '../../src/producers/image/wavespeed-image.js';
import type { ProviderJobContext } from '../../src/types.js';
import { saveTestArtifact } from './test-utils.js';
import {
  buildWavespeedImageExtras,
  getWavespeedImageMapping,
  loadWavespeedImageSchema,
  type WavespeedImageModel,
} from './schema-helpers.js';

const describeIfToken = process.env.WAVESPEED_API_KEY ? describe : describe.skip;

function selectModel(): WavespeedImageModel | null {
  const enabled: Array<{ flag: string; model: WavespeedImageModel }> = [];
  if (process.env.RUN_WAVESPEED_IMAGE_SEEDREAM) {
    enabled.push({ flag: 'RUN_WAVESPEED_IMAGE_SEEDREAM', model: 'bytedance/seedream-v4.5' });
  }
  if (process.env.RUN_ALL_WAVESPEED_IMAGE_TESTS) {
    enabled.push({
      flag: 'RUN_ALL_WAVESPEED_IMAGE_TESTS',
      model: 'bytedance/seedream-v4.5',
    });
  }

  const uniqueModels = new Set(enabled.map((entry) => entry.model));
  if (uniqueModels.size > 1) {
    throw new Error('Select exactly one wavespeed-ai image model env flag; multiple models enabled.');
  }
  return enabled[0]?.model ?? null;
}

function resolveInputsFromSchema(model: WavespeedImageModel): Record<string, unknown> {
  const schemaText = loadWavespeedImageSchema(model);
  const schema = JSON.parse(schemaText) as {
    properties?: Record<string, { default?: unknown; minimum?: number; type?: string }>;
  };
  const properties = schema.properties ?? {};
  const mapping = getWavespeedImageMapping(model);
  const inputs: Record<string, unknown> = {
    'Input:Prompt': `Integration image prompt for wavespeed-ai ${model}`,
  };

  for (const [alias, spec] of Object.entries(mapping)) {
    if (alias === 'Prompt') continue;
    const property = properties[spec.field] ?? {};
    // For size field, use minimum dimensions to reduce cost
    if (spec.field === 'size' && typeof property.minimum === 'number') {
      inputs[`Input:${alias}`] = `2048*2048`;
      continue;
    }
    if (property.default !== undefined) {
      inputs[`Input:${alias}`] = property.default;
      continue;
    }
    if (typeof property.minimum === 'number') {
      inputs[`Input:${alias}`] = property.minimum;
      continue;
    }
  }

  return inputs;
}

describeIfToken('Wavespeed-ai image integration (single model)', () => {
  const model = selectModel();
  const describeBlock = model ? describe : describe.skip;

  describeBlock(model ?? 'no-model', () => {
    it('text-to-image uses schema defaults and mapping', async () => {
      if (!model) {
        throw new Error('No model selected for integration test.');
      }

      const handler = createWavespeedImageHandler()({
        descriptor: {
          provider: 'wavespeed-ai',
          model,
          environment: 'local',
        },
        mode: 'live',
        secretResolver: {
          async getSecret(key) {
            if (key === 'WAVESPEED_API_KEY') {
              return process.env.WAVESPEED_API_KEY ?? null;
            }
            return null;
          },
        },
      });

      const resolvedInputs = resolveInputsFromSchema(model);

      const request: ProviderJobContext = {
        jobId: `integration-wavespeed-${model}-image`,
        provider: 'wavespeed-ai',
        model,
        revision: 'rev-test',
        layerIndex: 0,
        attempt: 1,
        inputs: Object.keys(resolvedInputs),
        produces: ['Artifact:SegmentImage[segment=0][image=0]'],
        context: {
          providerConfig: {},
          extras: buildWavespeedImageExtras(model, resolvedInputs),
        },
      };

      await handler.warmStart?.({ logger: undefined });
      const result = await handler.invoke(request);

      expect(result.status).toBe('succeeded');
      expect(result.artefacts).toHaveLength(1);
      expect(result.artefacts[0]?.artefactId).toBe('Artifact:SegmentImage[segment=0][image=0]');
      expect(result.artefacts[0]?.blob?.mimeType).toBe('image/jpeg');
      expect(result.artefacts[0]?.blob?.data).toBeInstanceOf(Uint8Array);

      if (result.artefacts[0]?.blob?.data) {
        saveTestArtifact(
          `test-wavespeed-image-${model.replace(/\//g, '-')}.jpeg`,
          result.artefacts[0].blob.data,
        );
      }
    }, 180000);
  });
});
