import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { HandlerFactory, ProviderJobContext } from '../../types.js';
import { createVercelAiGatewayHandler } from './vercel-ai-gateway.js';

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  modelFn: vi.fn(),
  createGateway: vi.fn(),
}));

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    createGateway: mocks.createGateway,
    generateText: (...args: unknown[]) => mocks.generateText(...args),
  };
});

const secretResolver = vi.fn<(key: string) => Promise<string | null>>(
  async (key: string) => {
    if (key === 'AI_GATEWAY_API_KEY') {
      return 'test-key';
    }
    return null;
  }
);

function buildHandler(): ReturnType<HandlerFactory> {
  const factory = createVercelAiGatewayHandler();
  return factory({
    descriptor: {
      provider: 'vercel',
      model: 'anthropic/claude-sonnet-4-20250514',
      environment: 'local',
    },
    mode: 'live',
    secretResolver: {
      async getSecret(key: string) {
        return secretResolver(key);
      },
    },
    logger: undefined,
  });
}

function createJobContext(
  overrides: Partial<ProviderJobContext> = {}
): ProviderJobContext {
  const baseContext: ProviderJobContext = {
    jobId: 'job-base',
    provider: 'vercel',
    model: 'anthropic/claude-sonnet-4-20250514',
    revision: 'rev-base',
    layerIndex: 0,
    attempt: 1,
    inputs: [],
    produces: ['Artifact:Default'],
    context: {
      providerConfig: {
        systemPrompt: 'System prompt',
        responseFormat: { type: 'text' as const },
      },
      rawAttachments: [],
      observability: undefined,
      environment: 'local',
      extras: {
        resolvedInputs: {},
      },
    },
  };

  const overrideContext: Partial<ProviderJobContext['context']> =
    overrides.context ?? {};
  const baseExtras = (baseContext.context.extras ?? {}) as Record<
    string,
    unknown
  >;
  const overrideExtras = (overrideContext.extras ?? {}) as Record<
    string,
    unknown
  >;
  const baseResolvedInputs =
    (baseExtras.resolvedInputs as Record<string, unknown> | undefined) ?? {};
  const overrideResolvedInputs =
    (overrideExtras.resolvedInputs as Record<string, unknown> | undefined) ??
    {};

  return {
    ...baseContext,
    ...overrides,
    context: {
      ...baseContext.context,
      ...overrideContext,
      providerConfig:
        overrideContext.providerConfig !== undefined
          ? overrideContext.providerConfig
          : baseContext.context.providerConfig,
      rawAttachments:
        overrideContext.rawAttachments ?? baseContext.context.rawAttachments,
      observability:
        overrideContext.observability ?? baseContext.context.observability,
      environment:
        overrideContext.environment ?? baseContext.context.environment,
      extras: {
        ...baseExtras,
        ...overrideExtras,
        resolvedInputs: {
          ...baseResolvedInputs,
          ...overrideResolvedInputs,
        },
      },
    },
  };
}

describe('createVercelAiGatewayHandler', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    secretResolver.mockClear();
    secretResolver.mockImplementation(async (key: string) => {
      if (key === 'AI_GATEWAY_API_KEY') {
        return 'test-key';
      }
      return null;
    });
    mocks.modelFn.mockReturnValue('mock-model');
    mocks.createGateway.mockReturnValue({
      languageModel: mocks.modelFn,
    });
    mocks.generateText.mockReset();
  });

  it('only initializes the client once during warmStart + invoke', async () => {
    const handler = buildHandler();
    await handler.warmStart?.({ logger: undefined });
    await handler.warmStart?.({ logger: undefined });

    const request = createJobContext({
      produces: ['Artifact:MovieSummary'],
      context: {
        providerConfig: {
          systemPrompt: 'Summarize',
          responseFormat: { type: 'text' },
        },
      },
    });

    mocks.generateText.mockResolvedValueOnce({
      text: 'Placeholder text',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      warnings: [],
      response: { id: 'resp', model: 'claude-sonnet-4', createdAt: '' },
    });

    await handler.invoke(request);

    expect(mocks.createGateway).toHaveBeenCalledTimes(1);
  });

  it('configures client with API key', async () => {
    const handler = buildHandler();
    await handler.warmStart?.({ logger: undefined });

    expect(mocks.createGateway).toHaveBeenCalledWith({
      apiKey: 'test-key',
    });
  });

  it('throws when AI_GATEWAY_API_KEY is missing', async () => {
    secretResolver.mockImplementation(async () => null);

    const handler = buildHandler();

    await expect(handler.warmStart?.({ logger: undefined })).rejects.toThrow(
      /AI_GATEWAY_API_KEY.*not found/
    );
  });

  it('throws when provider configuration is not an object', async () => {
    const handler = buildHandler();
    await handler.warmStart?.({ logger: undefined });

    const request = createJobContext({
      context: {
        providerConfig: null,
      },
    });

    await expect(handler.invoke(request)).rejects.toThrow(
      'OpenAI provider configuration must be an object.'
    );
  });

  it('invokes provider with JSON schema response format', async () => {
    mocks.generateText.mockResolvedValue({
      output: {
        MovieTitle: 'Journey to Mars',
        MovieSummary: 'A thrilling space adventure',
      },
      usage: {
        inputTokens: 120,
        outputTokens: 350,
        totalTokens: 470,
      },
      warnings: [],
      response: {
        id: 'resp-123',
        model: 'claude-sonnet-4',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
    });

    const handler = buildHandler();
    await handler.warmStart?.({ logger: undefined });

    const request = createJobContext({
      jobId: 'job-1',
      revision: 'rev-001',
      produces: ['Artifact:MovieTitle', 'Artifact:MovieSummary'],
      context: {
        providerConfig: {
          systemPrompt: 'Write for {{Audience}}',
          userPrompt: 'Topic: {{InquiryPrompt}}',
          variables: ['Audience', 'InquiryPrompt'],
          responseFormat: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                MovieTitle: { type: 'string' },
                MovieSummary: { type: 'string' },
              },
            },
          },
        },
        extras: {
          resolvedInputs: {
            Audience: 'children',
            InquiryPrompt: 'space travel',
          },
        },
      },
    });

    const result = await handler.invoke(request);

    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    const callArgs = mocks.generateText.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(callArgs.prompt).toContain('Topic: space travel');
    expect(callArgs.model).toBe('mock-model');
    expect(callArgs.system).toBe('Write for children');

    expect(result.status).toBe('succeeded');
    expect(result.artefacts).toHaveLength(2);
    expect(result.artefacts[0]).toMatchObject({
      artefactId: 'Artifact:MovieTitle',
      blob: { data: 'Journey to Mars', mimeType: 'text/plain' },
      status: 'succeeded',
    });
    expect(result.artefacts[1]).toMatchObject({
      artefactId: 'Artifact:MovieSummary',
      blob: { data: 'A thrilling space adventure', mimeType: 'text/plain' },
      status: 'succeeded',
    });
  });

  it('produces text blobs for text responses', async () => {
    mocks.generateText.mockResolvedValueOnce({
      text: 'Plain response text',
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      },
      warnings: [],
      response: {
        id: 'resp-text',
        model: 'claude-sonnet-4',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
    });

    const handler = buildHandler();
    await handler.warmStart?.({ logger: undefined });

    const request = createJobContext({
      jobId: 'job-text',
      revision: 'rev-003',
      produces: ['Artifact:MovieSummary'],
      context: {
        providerConfig: {
          systemPrompt: 'Summarise {{InquiryPrompt}}',
          variables: ['InquiryPrompt'],
          responseFormat: { type: 'text' },
        },
        extras: {
          resolvedInputs: {
            InquiryPrompt: 'the ocean',
          },
        },
      },
    });

    const result = await handler.invoke(request);
    expect(result.status).toBe('succeeded');
    expect(result.artefacts[0]?.blob?.data).toBe('Plain response text');

    const args = mocks.generateText.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(args.prompt).toBe('Summarise the ocean');
    expect(args.model).toBe('mock-model');
    expect(args.system).toBe('Summarise the ocean');
  });

  it('simulates responses in dry-run mode without calling the AI provider', async () => {
    const factory = createVercelAiGatewayHandler();
    const handler = factory({
      descriptor: {
        provider: 'vercel',
        model: 'anthropic/claude-sonnet-4-20250514',
        environment: 'local',
      },
      mode: 'simulated',
      secretResolver: {
        async getSecret(key: string) {
          if (key === 'AI_GATEWAY_API_KEY') {
            return 'test-api-key';
          }
          return null;
        },
      },
      logger: undefined,
    });

    await handler.warmStart?.({ logger: undefined });

    const request = createJobContext({
      jobId: 'job-sim',
      produces: [
        'Artifact:ScriptGenerator.MovieTitle',
        'Artifact:ScriptGenerator.NarrationScript[0]',
        'Artifact:ScriptGenerator.NarrationScript[1]',
      ],
      context: {
        providerConfig: {
          systemPrompt: 'Summarise {{InquiryPrompt}}',
          responseFormat: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                MovieTitle: { type: 'string' },
                NarrationScript: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          variables: ['InquiryPrompt'],
        },
        extras: {
          resolvedInputs: {
            InquiryPrompt: 'The Silk Road',
          },
        },
      },
    });

    const result = await handler.invoke(request);

    // In simulated mode, generateText should not be called
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(result.status).toBe('succeeded');

    const title = result.artefacts.find(
      (artefact) =>
        artefact.artefactId === 'Artifact:ScriptGenerator.MovieTitle'
    );
    expect(title?.blob?.data).toContain('Simulated MovieTitle');
  });

  it('passes call settings (temperature, maxOutputTokens, penalties) to AI SDK', async () => {
    mocks.generateText.mockResolvedValueOnce({
      text: 'Response',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      warnings: [],
      response: { id: 'resp', model: 'claude-sonnet-4', createdAt: '' },
    });

    const handler = buildHandler();
    await handler.warmStart?.({ logger: undefined });

    const request = createJobContext({
      produces: ['Artifact:Output'],
      context: {
        providerConfig: {
          systemPrompt: 'Test prompt',
          responseFormat: { type: 'text' },
          temperature: 0.7,
          maxOutputTokens: 1000,
          presencePenalty: 0.5,
          frequencyPenalty: 0.3,
        },
      },
    });

    await handler.invoke(request);

    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    const args = mocks.generateText.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(args.temperature).toBe(0.7);
    expect(args.maxOutputTokens).toBe(1000);
    expect(args.presencePenalty).toBe(0.5);
    expect(args.frequencyPenalty).toBe(0.3);
  });

  it('marks artefacts as failed when field is missing from JSON response', async () => {
    mocks.generateText.mockResolvedValueOnce({
      output: { MovieTitle: 'Title only' },
      usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 },
      warnings: [],
      response: { id: 'resp-missing', model: 'claude-sonnet-4', createdAt: '' },
    });

    const handler = buildHandler();
    await handler.warmStart?.({ logger: undefined });

    const request = createJobContext({
      jobId: 'job-2',
      revision: 'rev-002',
      produces: ['Artifact:MovieTitle', 'Artifact:MissingField'],
      context: {
        providerConfig: {
          systemPrompt: 'Hello',
          responseFormat: { type: 'json_schema', schema: {} },
        },
      },
    });

    const result = await handler.invoke(request);
    expect(result.status).toBe('failed');
    expect(result.artefacts[0]?.status).toBe('succeeded');
    expect(result.artefacts[1]?.status).toBe('failed');
    expect(result.artefacts[1]?.diagnostics?.reason).toBe('missing_field');
  });

  it('propagates errors when generateText (structured output) fails', async () => {
    mocks.generateText.mockRejectedValueOnce(
      new Error('API rate limit exceeded')
    );

    const handler = buildHandler();
    await handler.warmStart?.({ logger: undefined });

    const request = createJobContext({
      produces: ['Artifact:Output'],
      context: {
        providerConfig: {
          systemPrompt: 'Test',
          responseFormat: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: { Output: { type: 'string' } },
            },
          },
        },
      },
    });

    await expect(handler.invoke(request)).rejects.toThrow(
      'API rate limit exceeded'
    );
  });

  it('propagates errors when generateText fails', async () => {
    mocks.generateText.mockRejectedValueOnce(new Error('Network error'));

    const handler = buildHandler();
    await handler.warmStart?.({ logger: undefined });

    const request = createJobContext({
      produces: ['Artifact:Output'],
      context: {
        providerConfig: {
          systemPrompt: 'Test',
          responseFormat: { type: 'text' },
        },
      },
    });

    await expect(handler.invoke(request)).rejects.toThrow('Network error');
  });

  it('includes usage and response metadata in diagnostics', async () => {
    mocks.generateText.mockResolvedValueOnce({
      output: { Title: 'Test' },
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      warnings: ['Some warning about token usage'],
      response: {
        id: 'resp-123',
        model: 'claude-sonnet-4',
        createdAt: '2025-01-01T00:00:00Z',
      },
    });

    const handler = buildHandler();
    await handler.warmStart?.({ logger: undefined });

    const request = createJobContext({
      produces: ['Artifact:Title'],
      context: {
        providerConfig: {
          systemPrompt: 'Generate',
          responseFormat: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: { Title: { type: 'string' } },
            },
          },
        },
      },
    });

    const result = await handler.invoke(request);

    expect(result.diagnostics?.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
    expect(result.diagnostics?.warnings).toEqual([
      'Some warning about token usage',
    ]);
    expect(result.diagnostics?.response).toMatchObject({ id: 'resp-123' });
    expect(result.diagnostics?.provider).toBe('vercel');
  });

  it('passes full model name to getModel', async () => {
    mocks.generateText.mockResolvedValueOnce({
      text: 'Response',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      warnings: [],
      response: { id: 'resp', model: 'claude-sonnet-4', createdAt: '' },
    });

    const handler = buildHandler();
    await handler.warmStart?.({ logger: undefined });

    const request = createJobContext({
      produces: ['Artifact:Output'],
      context: {
        providerConfig: {
          systemPrompt: 'Test',
          responseFormat: { type: 'text' },
        },
      },
    });

    await handler.invoke(request);

    // The modelFn should be called with the full model name
    expect(mocks.modelFn).toHaveBeenCalledWith(
      'anthropic/claude-sonnet-4-20250514'
    );
  });

  describe('auto-derive responseFormat from outputSchema', () => {
    it('automatically uses structured output when outputSchema is present in request extras', async () => {
      mocks.generateText.mockResolvedValueOnce({
        output: { MovieTitle: 'Auto-derived Title', MovieSummary: 'Auto-derived summary' },
        usage: { inputTokens: 50, outputTokens: 100, totalTokens: 150 },
        warnings: [],
        response: { id: 'resp-auto', model: 'claude-sonnet-4', createdAt: '' },
      });

      const handler = buildHandler();
      await handler.warmStart?.({ logger: undefined });

      const outputSchema = JSON.stringify({
        title: 'MovieOutput',
        description: 'Movie generation output',
        type: 'object',
        properties: {
          MovieTitle: { type: 'string' },
          MovieSummary: { type: 'string' },
        },
        required: ['MovieTitle', 'MovieSummary'],
      });

      const request = createJobContext({
        produces: ['Artifact:MovieTitle', 'Artifact:MovieSummary'],
        context: {
          providerConfig: {
            systemPrompt: 'Generate a movie',
            // No responseFormat specified - should auto-derive from outputSchema
          },
          extras: {
            schema: {
              output: outputSchema,
            },
            resolvedInputs: {},
          },
        },
      });

      const result = await handler.invoke(request);

      // Should use structured output (generateText is called once)
      expect(mocks.generateText).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('succeeded');
      expect(result.artefacts).toHaveLength(2);

      // Verify the call includes the output option for structured output
      const args = mocks.generateText.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(args.output).toBeDefined();
    });

    it('uses explicit responseFormat config over auto-derivation from outputSchema', async () => {
      mocks.generateText.mockResolvedValueOnce({
        text: 'Plain text response',
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        warnings: [],
        response: { id: 'resp-explicit', model: 'claude-sonnet-4', createdAt: '' },
      });

      const handler = buildHandler();
      await handler.warmStart?.({ logger: undefined });

      const outputSchema = JSON.stringify({
        type: 'object',
        properties: { Title: { type: 'string' } },
      });

      const request = createJobContext({
        produces: ['Artifact:Output'],
        context: {
          providerConfig: {
            systemPrompt: 'Generate text',
            // Explicit text responseFormat should override outputSchema
            responseFormat: { type: 'text' },
          },
          extras: {
            schema: {
              output: outputSchema, // Has outputSchema but explicit config says text
            },
            resolvedInputs: {},
          },
        },
      });

      const result = await handler.invoke(request);

      // Should use plain text because explicit config says text
      expect(mocks.generateText).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('succeeded');

      // Verify the call does NOT include the output option
      const args = mocks.generateText.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(args.output).toBeUndefined();
    });

    it('defaults to plain text when no outputSchema and no responseFormat', async () => {
      mocks.generateText.mockResolvedValueOnce({
        text: 'Default text response',
        usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 },
        warnings: [],
        response: { id: 'resp-default', model: 'claude-sonnet-4', createdAt: '' },
      });

      const handler = buildHandler();
      await handler.warmStart?.({ logger: undefined });

      const request = createJobContext({
        produces: ['Artifact:Output'],
        context: {
          providerConfig: {
            systemPrompt: 'Generate something',
            // No responseFormat, no outputSchema in extras
          },
          extras: {
            resolvedInputs: {},
            // No schema.output
          },
        },
      });

      const result = await handler.invoke(request);

      // Should default to plain text
      expect(mocks.generateText).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('succeeded');

      // Verify the call does NOT include the output option
      const args = mocks.generateText.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(args.output).toBeUndefined();
    });
  });
});
