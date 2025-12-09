/**
 * OpenAI Integration Tests (Structured Output)
 *
 * These tests call real OpenAI APIs and incur costs.
 * By default, all tests are SKIPPED even if OPENAI_API_KEY is available.
 *
 * Enable specific test types via environment variables:
 * - RUN_OPENAI_STRUCTURED=1    (structured output test)
 * - RUN_ALL_OPENAI_TESTS=1     (runs all OpenAI tests)
 *
 * Examples:
 *
 * # Run structured output test
 * RUN_OPENAI_STRUCTURED=1 pnpm test:integration
 *
 * # Run all OpenAI tests
 * RUN_ALL_OPENAI_TESTS=1 pnpm test:integration
 */

import { describe, expect, it } from 'vitest';
import { createOpenAiLlmHandler } from '../../src/producers/llm/openai.js';
import type { ProviderJobContext } from '../../src/types.js';

const describeIfHasKey = process.env.OPENAI_API_KEY ? describe : describe.skip;
const describeIfStructured =
  process.env.RUN_OPENAI_STRUCTURED || process.env.RUN_ALL_OPENAI_TESTS
    ? describe
    : describe.skip;

describeIfHasKey('OpenAI structured integration', () => {
  describeIfStructured('structured output', () => {
    it('returns artefacts for structured JSON schema outputs', async () => {
    const handler = createOpenAiLlmHandler()({
      descriptor: {
        provider: 'openai',
        model: 'gpt-4.1-mini',
        environment: 'local',
      },
      mode: 'live',
      secretResolver: {
        async getSecret(key) {
          if (key === 'OPENAI_API_KEY') {
            return process.env.OPENAI_API_KEY ?? null;
          }
          return null;
        },
      },
      logger: undefined,
    });

    await handler.warmStart?.({ logger: undefined });

    const request: ProviderJobContext = {
      jobId: 'job-int-structured',
      provider: 'openai',
      model: 'gpt-4.1-mini',
      revision: 'rev-int-structured',
      layerIndex: 0,
      attempt: 1,
      inputs: [],
      produces: ['Artifact:MovieSummary', 'Artifact:MovieTitle'],
      context: {
        providerConfig: {
          systemPrompt: 'Return JSON with "summary" and "title" fields describing the topic.',
          userPrompt: 'Topic: {{topic}}',
          variables: {
            topic: 'topic',
          },
          responseFormat: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                summary: { type: 'string' },
                title: { type: 'string' },
              },
              required: ['summary', 'title'],
            },
          },
          artefactMapping: [
            {
              field: 'summary',
              artefactId: 'Artifact:MovieSummary',
              output: 'blob',
            },
            {
              field: 'title',
              artefactId: 'Artifact:MovieTitle',
              output: 'blob',
            },
          ],
        },
        rawAttachments: [],
        observability: undefined,
        environment: 'local',
        extras: {
          resolvedInputs: {
            topic: 'bioluminescent marine life',
          },
        },
      },
    };

    const result = await handler.invoke(request);
    console.log('OpenAI integration test result:', JSON.stringify(result));

    expect(result.status).toBe('succeeded');
    const ids = result.artefacts.map((a) => a.artefactId).sort();
    expect(ids).toEqual(['Artifact:MovieSummary', 'Artifact:MovieTitle']);

    const summary = result.artefacts.find(
      (a) => a.artefactId === 'Artifact:MovieSummary'
    );
    const title = result.artefacts.find(
      (a) => a.artefactId === 'Artifact:MovieTitle'
    );
    expect(typeof summary?.blob?.data === 'string' && summary.blob.data.length > 0).toBeTruthy();
    expect(typeof title?.blob?.data === 'string' && title.blob.data.length > 0).toBeTruthy();
    });
  });
});
