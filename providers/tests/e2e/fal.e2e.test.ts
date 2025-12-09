/**
 * Fal.ai Provider Integration Test
 *
 * Run with: RUN_FAL_TEST=1 pnpm test:integration
 * Requires: FAL_KEY env var
 *
 * To save output for visual inspection:
 * RUN_FAL_TEST=1 SAVE_TEST_ARTIFACTS=1 pnpm test:integration
 */

import { describe, it, expect } from 'vitest';
import { createProviderRegistry } from '../../src/registry.js';
import type { ProviderJobContext } from '../../src/types.js';
import { buildFalImageExtras, type FalImageModel } from './schema-helpers.js';
import { saveTestArtifact } from './test-utils.js';

const RUN_TEST = process.env.RUN_FAL_TEST;
const API_KEY = process.env.FAL_KEY;

const describeIf = RUN_TEST && API_KEY ? describe : describe.skip;

describeIf('Fal.ai provider integration', () => {
  it('generates image via registry lookup (end-to-end)', async () => {
    const provider = 'fal-ai';
    const model: FalImageModel = 'bytedance/seedream/v4.5/text-to-image';

    // Full end-to-end: use registry like CLI does
    const registry = createProviderRegistry({
      mode: 'live',
      secretResolver: {
        async getSecret(key) {
          return process.env[key] ?? null;
        },
      },
    });

    const handler = registry.resolve({ provider, model, environment: 'local' });

    // Build request with schema and extras (like planner would)
    const resolvedInputs: Record<string, unknown> = {
      'Input:Prompt': 'A serene mountain landscape at sunset, photorealistic',
    };

    const request: ProviderJobContext = {
      jobId: `integration-${provider}`,
      provider,
      model,
      revision: 'rev-test',
      layerIndex: 0,
      attempt: 1,
      inputs: Object.keys(resolvedInputs),
      produces: ['Artifact:Output[index=0]'],
      context: {
        providerConfig: {},
        extras: buildFalImageExtras(model, resolvedInputs),
      },
    };

    await handler.warmStart?.({ logger: undefined });
    const result = await handler.invoke(request);

    expect(result.status).toBe('succeeded');
    expect(result.artefacts).toHaveLength(1);
    expect(result.artefacts[0]?.blob?.mimeType).toBe('image/png');
    expect(result.artefacts[0]?.blob?.data).toBeInstanceOf(Uint8Array);

    if (result.artefacts[0]?.blob?.data) {
      saveTestArtifact('fal-output.png', result.artefacts[0].blob.data);
    }
  }, 180000);
});
