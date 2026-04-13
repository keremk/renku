import process from 'node:process';
import { vi } from 'vitest';

process.env.OPENAI_API_KEY ??= 'test-openai-api-key';
process.env.AI_GATEWAY_API_KEY ??= 'test-ai-gateway-api-key';
process.env.REPLICATE_API_TOKEN ??= 'test-replicate-api-token';
process.env.FAL_KEY ??= 'test-fal-key';
process.env.WAVESPEED_API_KEY ??= 'test-wavespeed-api-key';
process.env.ELEVENLABS_API_KEY ??= 'test-elevenlabs-api-key';

vi.mock('@gorenku/providers', async () => {
  const actual = await vi.importActual<typeof import('@gorenku/providers')>('@gorenku/providers');
  return {
    ...actual,
    createProviderRegistry: (options?: Parameters<typeof actual.createProviderRegistry>[0]) =>
      actual.createProviderRegistry({
        ...(options ?? {}),
        mode: 'simulated',
      }),
  };
});
