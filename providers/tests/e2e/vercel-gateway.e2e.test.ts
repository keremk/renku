/**
 * Vercel AI Gateway Integration Tests (Text Response)
 *
 * These tests call real AI provider APIs through the Vercel AI Gateway and incur costs.
 * By default, all tests are SKIPPED even if gateway credentials are available.
 *
 * Enable specific test types via environment variables:
 * - RUN_VERCEL_TEXT=1          (text response test)
 * - RUN_ALL_VERCEL_TESTS=1     (runs all Vercel gateway tests)
 *
 * Required environment variables:
 * - AI_GATEWAY_API_KEY         (Vercel AI Gateway API key)
 *
 * Examples:
 *
 * # Run text response test
 * RUN_VERCEL_TEXT=1 pnpm test:integration
 *
 * # Run all Vercel gateway tests
 * RUN_ALL_VERCEL_TESTS=1 pnpm test:integration
 */

import { describe, expect, it } from 'vitest';
import { createVercelAiGatewayHandler } from '../../src/producers/llm/vercel-ai-gateway.js';
import type { ProviderJobContext } from '../../src/types.js';

const hasGatewayCredentials = Boolean(process.env.AI_GATEWAY_API_KEY);

const describeIfCredentials = hasGatewayCredentials ? describe : describe.skip;
const describeIfText =
  process.env.RUN_VERCEL_TEXT || process.env.RUN_ALL_VERCEL_TESTS ? describe : describe.skip;

describeIfCredentials('Vercel AI Gateway integration', () => {
  describeIfText('text response', () => {
    it('executes live generation and returns artefacts using google/gemini-3-flash', async () => {
      const handler = createVercelAiGatewayHandler()({
        descriptor: {
          provider: 'vercel',
          model: 'google/gemini-3-flash',
          environment: 'local',
        },
        mode: 'live',
        secretResolver: {
          async getSecret(key) {
            if (key === 'AI_GATEWAY_API_KEY') {
              return process.env.AI_GATEWAY_API_KEY ?? null;
            }
            return null;
          },
        },
        logger: undefined,
      });

      await handler.warmStart?.({ logger: undefined });

      const request: ProviderJobContext = {
        jobId: 'job-int-vercel-text',
        provider: 'vercel',
        model: 'google/gemini-3-flash',
        revision: 'rev-int',
        layerIndex: 0,
        attempt: 1,
        inputs: [],
        produces: ['Artifact:NarrationScript'],
        context: {
          providerConfig: {
            systemPrompt: 'You are a concise assistant. Summarize the topic provided by the user.',
            userPrompt: 'Topic: {{topic}}',
            variables: {
              topic: 'topic',
            },
            responseFormat: { type: 'text' },
            artefactMapping: [
              {
                artefactId: 'Artifact:NarrationScript',
                output: 'blob',
              },
            ],
          },
          rawAttachments: [],
          environment: 'local',
          observability: undefined,
          extras: {
            resolvedInputs: {
              topic: 'the Northern Lights in winter',
            },
          },
        },
      };

      const result = await handler.invoke(request);
      console.log('Vercel Gateway text response test result:', JSON.stringify(result));
      expect(result.status).toBe('succeeded');
      const artefact = result.artefacts[0];
      expect(artefact).toBeDefined();
      expect(typeof artefact?.blob?.data === 'string' ? artefact.blob.data.length : 0).toBeGreaterThan(0);
    });
  });
});
