/**
 * Fal.ai Video Integration Test (single model)
 *
 * Set exactly one of:
 * - RUN_FAL_VIDEO_VEO31=1 (veo3.1)
 *
 * FAL_KEY=xxx RUN_FAL_VIDEO_VEO31=1 pnpm test:integration
 */

import { describe, expect, it } from 'vitest';
import { createFalVideoHandler } from '../../src/producers/video/fal-video.js';
import type { ProviderJobContext } from '../../src/types.js';
import { saveTestArtifact } from './test-utils.js';
import {
  buildFalVideoExtras,
  getFalVideoMapping,
  loadFalVideoSchema,
  type FalVideoModel,
} from './schema-helpers.js';

const describeIfToken = process.env.FAL_KEY ? describe : describe.skip;

function selectModel(): FalVideoModel | null {
  const enabled: Array<{ flag: string; model: FalVideoModel }> = [];
  if (process.env.RUN_FAL_VIDEO_VEO31) {
    enabled.push({ flag: 'RUN_FAL_VIDEO_VEO31', model: 'veo3.1' });
  }
  if (process.env.RUN_ALL_FAL_VIDEO_TESTS) {
    enabled.push({ flag: 'RUN_ALL_FAL_VIDEO_TESTS', model: 'veo3.1' });
  }

  const uniqueModels = new Set(enabled.map((entry) => entry.model));
  if (uniqueModels.size > 1) {
    throw new Error('Select exactly one fal.ai video model env flag; multiple models enabled.');
  }
  return enabled[0]?.model ?? null;
}

function resolveInputsFromSchema(model: FalVideoModel): Record<string, unknown> {
  const schemaText = loadFalVideoSchema(model);
  const schema = JSON.parse(schemaText) as {
    properties?: Record<string, { default?: unknown; minimum?: number }>;
  };
  const properties = schema.properties ?? {};
  const mapping = getFalVideoMapping(model);
  const inputs: Record<string, unknown> = {
    'Input:Prompt': `Integration video prompt for fal.ai ${model}: A serene mountain landscape at sunset with gentle clouds.`,
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

describeIfToken('Fal.ai video integration (single model)', () => {
  const model = selectModel();
  const describeBlock = model ? describe : describe.skip;

  describeBlock(model ?? 'no-model', () => {
    it('text-to-video uses schema defaults and mapping', async () => {
      if (!model) {
        throw new Error('No model selected for integration test.');
      }

      const handler = createFalVideoHandler()({
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
        jobId: `integration-fal-${model}-video`,
        provider: 'fal-ai',
        model,
        revision: 'rev-test',
        layerIndex: 0,
        attempt: 1,
        inputs: Object.keys(resolvedInputs),
        produces: ['Artifact:SegmentVideo[0]'],
        context: {
          providerConfig: {},
          extras: buildFalVideoExtras(model, resolvedInputs),
        },
      };

      await handler.warmStart?.({ logger: undefined });
      const result = await handler.invoke(request);

      expect(result.status).toBe('succeeded');
      expect(result.artefacts).toHaveLength(1);
      expect(result.artefacts[0]?.artefactId).toBe('Artifact:SegmentVideo[0]');
      expect(result.artefacts[0]?.blob?.mimeType).toBe('video/mp4');
      expect(result.artefacts[0]?.blob?.data).toBeInstanceOf(Uint8Array);

      if (result.artefacts[0]?.blob?.data) {
        saveTestArtifact(`test-fal-video-${model.replace(/\//g, '-')}.mp4`, result.artefacts[0].blob.data);
      }
    }, 300000);
  });
});
