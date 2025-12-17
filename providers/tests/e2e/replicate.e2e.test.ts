/**
 * Replicate Provider Integration Test
 *
 * Run with: RUN_REPLICATE_TEST=1 pnpm test:integration
 * Requires: REPLICATE_API_TOKEN env var
 *
 * To save output for visual inspection:
 * RUN_REPLICATE_TEST=1 SAVE_TEST_ARTIFACTS=1 pnpm test:integration
 */

import { describe, it, expect } from 'vitest';
import { createProviderRegistry } from '../../src/registry.js';
import type { ProviderJobContext } from '../../src/types.js';
import { buildImageExtras, type ImageModel } from './schema-helpers.js';
import { saveTestArtifact } from './test-utils.js';

const RUN_TEST = process.env.RUN_REPLICATE_TEST;
const API_TOKEN = process.env.REPLICATE_API_TOKEN;

const describeIf = RUN_TEST && API_TOKEN ? describe : describe.skip;

describeIf('Replicate provider integration', () => {
  it('generates image via registry lookup (end-to-end)', async () => {
    const provider = 'replicate';
    const model: ImageModel = 'bytedance/seedream-4';

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
        extras: await buildImageExtras(model, resolvedInputs),
      },
    };

    await handler.warmStart?.({ logger: undefined });
    const result = await handler.invoke(request);

    expect(result.status).toBe('succeeded');
    expect(result.artefacts).toHaveLength(1);
    expect(result.artefacts[0]?.blob?.mimeType).toBe('image/png');
    expect(result.artefacts[0]?.blob?.data).toBeInstanceOf(Uint8Array);

    if (result.artefacts[0]?.blob?.data) {
      saveTestArtifact('replicate-output.png', result.artefacts[0].blob.data);
    }
  }, 180000);
});
