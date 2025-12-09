/**
 * OpenAI Integration Tests (Text Response)
 *
 * These tests call real OpenAI APIs and incur costs.
 * By default, all tests are SKIPPED even if OPENAI_API_KEY is available.
 *
 * Enable specific test types via environment variables:
 * - RUN_OPENAI_TEXT=1          (text response test)
 * - RUN_ALL_OPENAI_TESTS=1     (runs all OpenAI tests)
 *
 * Examples:
 *
 * # Run text response test
 * RUN_OPENAI_TEXT=1 pnpm test:integration
 *
 * # Run all OpenAI tests
 * RUN_ALL_OPENAI_TESTS=1 pnpm test:integration
 */

import { describe, expect, it } from 'vitest';
import { createOpenAiLlmHandler } from '../../src/producers/llm/openai.js';
import type { ProviderJobContext } from '../../src/types.js';

const describeIfKey = process.env.OPENAI_API_KEY ? describe : describe.skip;
const describeIfText =
  process.env.RUN_OPENAI_TEXT || process.env.RUN_ALL_OPENAI_TESTS ? describe : describe.skip;

describeIfKey('OpenAI integration', () => {
  describeIfText('text response', () => {
    it('executes live Responses API and returns artefacts', async () => {
    const handler = createOpenAiLlmHandler()({
      descriptor: {
        provider: 'openai',
        model: 'gpt-4.1-mini',
        environment: 'local',
      },
      mode: 'live',
      secretResolver: {
        async getSecret(key) {
          return key === 'OPENAI_API_KEY' ? process.env.OPENAI_API_KEY ?? null : null;
        },
      },
      logger: undefined,
    });

    await handler.warmStart?.({ logger: undefined });

    const request: ProviderJobContext = {
      jobId: 'job-int-openai',
      provider: 'openai',
      model: 'gpt-4.1-mini',
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
    console.log('OpenAI integration test result:', JSON.stringify(result));
    expect(result.status).toBe('succeeded');
    const artefact = result.artefacts[0];
    expect(artefact).toBeDefined();
    expect(typeof artefact?.blob?.data === 'string' ? artefact.blob.data : '').toContain('Northern');
    });
  });
});
