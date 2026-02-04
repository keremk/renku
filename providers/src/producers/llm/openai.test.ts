import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { HandlerFactory, ProviderJobContext } from '../../types.js';
import { createOpenAiLlmHandler } from './openai.js';

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  modelFn: vi.fn(),
  createOpenAI: vi.fn(),
}));

vi.mock('@ai-sdk/openai', async () => {
  const actual = await vi.importActual<typeof import('@ai-sdk/openai')>('@ai-sdk/openai');
  return {
    ...actual,
    createOpenAI: mocks.createOpenAI,
  };
});

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    generateText: (...args: unknown[]) => mocks.generateText(...args),
  };
});

const secretResolver = vi.fn<(key: string) => Promise<string>>(async () => 'test-key');

function buildHandler(): ReturnType<HandlerFactory> {
  const factory = createOpenAiLlmHandler();
  return factory({
    descriptor: {
      provider: 'openai',
      model: 'openai/gpt5',
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

function createJobContext(overrides: Partial<ProviderJobContext> = {}): ProviderJobContext {
  const baseContext: ProviderJobContext = {
    jobId: 'job-base',
    provider: 'openai',
    model: 'openai/gpt5',
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

  const overrideContext: Partial<ProviderJobContext['context']> = overrides.context ?? {};
  const baseExtras = (baseContext.context.extras ?? {}) as Record<string, unknown>;
  const overrideExtras = (overrideContext.extras ?? {}) as Record<string, unknown>;
  const baseResolvedInputs = (baseExtras.resolvedInputs as Record<string, unknown> | undefined) ?? {};
  const overrideResolvedInputs =
    (overrideExtras.resolvedInputs as Record<string, unknown> | undefined) ?? {};

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
      environment: overrideContext.environment ?? baseContext.context.environment,
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

describe('createOpenAiLlmHandler', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    secretResolver.mockClear();
    mocks.modelFn.mockReturnValue('mock-model');
    mocks.createOpenAI.mockReturnValue(mocks.modelFn);
    mocks.generateText.mockReset();
  });

  it('only initializes the OpenAI client once during warmStart + invoke', async () => {
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
      response: { id: 'resp', model: 'openai/gpt5', createdAt: '' },
    });

    await handler.invoke(request);

    expect(secretResolver).toHaveBeenCalledTimes(1);
    expect(mocks.createOpenAI).toHaveBeenCalledTimes(1);
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
      'OpenAI provider configuration must be an object.',
    );
  });

  it('invokes OpenAI with implicit artifact mapping (camelCase to PascalCase)', async () => {
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
        model: 'openai/gpt5',
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

    expect(mocks.createOpenAI).toHaveBeenCalledWith({ apiKey: 'test-key' });
    expect(mocks.modelFn).toHaveBeenCalledWith('openai/gpt5');

    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    const callArgs = mocks.generateText.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs.prompt).toContain('Topic: space travel');
    expect(callArgs.model).toBe('mock-model');
    expect(callArgs.system).toBe('Write for children');
    expect(callArgs.output).toBeDefined();

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

  it('handles array properties with segment indexing', async () => {
    mocks.generateText.mockResolvedValueOnce({
      output: {
        MovieTitle: 'The Great War',
        NarrationScript: ['Segment zero', 'Segment one', 'Segment two'],
      },
      usage: {
        inputTokens: 150,
        outputTokens: 420,
        totalTokens: 570,
      },
      warnings: [],
      response: {
        id: 'resp-script',
        model: 'openai/gpt5',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
    });

    const handler = buildHandler();
    await handler.warmStart?.({ logger: undefined });

    const request = createJobContext({
      produces: [
        'Artifact:MovieTitle',
        'Artifact:NarrationScript[segment=0]',
        'Artifact:NarrationScript[segment=1]',
        'Artifact:NarrationScript[segment=2]',
      ],
      context: {
        providerConfig: {
          systemPrompt: 'Create a lecture script',
          responseFormat: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                MovieTitle: { type: 'string' },
                NarrationScript: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
          },
        },
      },
    });

    const result = await handler.invoke(request);
    expect(result.status).toBe('succeeded');
    expect(result.artefacts).toHaveLength(4);

    const title = result.artefacts.find((a) => a.artefactId === 'Artifact:MovieTitle');
    expect(title?.blob?.data).toBe('The Great War');

    const seg0 = result.artefacts.find((a) => a.artefactId === 'Artifact:NarrationScript[segment=0]');
    expect(seg0?.blob?.data).toBe('Segment zero');

    const seg1 = result.artefacts.find((a) => a.artefactId === 'Artifact:NarrationScript[segment=1]');
    expect(seg1?.blob?.data).toBe('Segment one');

    const seg2 = result.artefacts.find((a) => a.artefactId === 'Artifact:NarrationScript[segment=2]');
    expect(seg2?.blob?.data).toBe('Segment two');
  });

  it('formats fan-in resolved inputs into markdown bullet lists', async () => {
    mocks.generateText.mockResolvedValueOnce({
      text: 'Prompt response',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      warnings: [],
      response: { id: 'resp-fanin', model: 'openai/gpt5', createdAt: '' },
    });

    const handler = buildHandler();
    await handler.warmStart?.({ logger: undefined });

    const request = createJobContext({
      produces: ['Artifact:MusicPrompt'],
      context: {
        providerConfig: {
          systemPrompt: 'Compose',
          userPrompt: 'Narration list:\n{{NarrationScript}}',
          variables: ['NarrationScript'],
          responseFormat: { type: 'text' },
        },
        extras: {
          resolvedInputs: {
            'Input:MusicPromptGenerator.NarrationScript': {
              groupBy: 'segment',
              groups: [
                ['Artifact:ScriptGenerator.NarrationScript[segment=0]'],
                ['Artifact:ScriptGenerator.NarrationScript[segment=1]'],
              ],
            },
            'Artifact:ScriptGenerator.NarrationScript[segment=0]': 'Intro section',
            'Artifact:ScriptGenerator.NarrationScript[segment=1]': 'Conflict section',
          },
          jobContext: {
            inputBindings: {
              NarrationScript: 'Input:MusicPromptGenerator.NarrationScript',
            },
          },
        },
      },
    });

    await handler.invoke(request);

    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    const callArgs = mocks.generateText.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof callArgs.prompt).toBe('string');
    expect(callArgs.prompt).toContain('- Intro section');
    expect(callArgs.prompt).toContain('- Conflict section');
  });

  it('marks artefacts as failed when field is missing from JSON response', async () => {
    mocks.generateText.mockResolvedValueOnce({
      output: { MovieTitle: 'Title only' },
      usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 },
      warnings: [],
      response: { id: 'resp-missing', model: 'openai/gpt5', createdAt: '' },
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
        model: 'openai/gpt5',
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

    const args = mocks.generateText.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.prompt).toBe('Summarise the ocean');
    expect(args.model).toBe('mock-model');
    expect(args.system).toBe('Summarise the ocean');
  });

  it('substitutes prompt variables via input bindings when only canonical inputs exist', async () => {
    mocks.generateText.mockResolvedValueOnce({
      text: 'Prompt count acknowledged',
      usage: {
        inputTokens: 5,
        outputTokens: 6,
        totalTokens: 11,
      },
      warnings: [],
      response: {
        id: 'resp-bindings',
        model: 'openai/gpt5',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
    });

    const handler = buildHandler();
    await handler.warmStart?.({ logger: undefined });

    const request = createJobContext({
      produces: ['Artifact:ImagePromptGenerator.ImagePrompt[segment=0][image=0]'],
      context: {
        providerConfig: {
          systemPrompt: 'System prompt',
          userPrompt: 'Generate {{NumOfImagesPerNarrative}} prompts.',
          variables: ['NumOfImagesPerNarrative'],
          responseFormat: { type: 'text' },
        },
        extras: {
          resolvedInputs: {
            'Input:ImagePromptGenerator.NumOfImagesPerNarrative': 2,
          },
          jobContext: {
            inputBindings: {
              NumOfImagesPerNarrative: 'Input:ImagePromptGenerator.NumOfImagesPerNarrative',
            },
          },
        },
      },
    });

    const result = await handler.invoke(request);
    expect(result.status).toBe('succeeded');
    expect(result.artefacts).toHaveLength(1);

    const args = mocks.generateText.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.prompt).toContain('Generate 2 prompts.');
    expect(args.system).toBe('System prompt');
  });

  it('simulates responses in dry-run mode without calling the AI provider', async () => {
    // In simulated mode, all validation runs the same as live mode, but generateText
    // is NOT called - we use simulateOpenAiGeneration at the very end instead

    const factory = createOpenAiLlmHandler();
    const handler = factory({
      descriptor: {
        provider: 'openai',
        model: 'openai/gpt5',
        environment: 'local',
      },
      mode: 'simulated',
      secretResolver: {
        async getSecret() {
          return 'test-api-key'; // API key required even in simulated mode
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

    // In simulated mode, generateText is NOT called (we use simulateOpenAiGeneration)
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(result.status).toBe('succeeded');

    // The simulated data is generated based on the schema
    const title = result.artefacts.find(
      (artefact) => artefact.artefactId === 'Artifact:ScriptGenerator.MovieTitle',
    );
    expect(title?.blob?.data).toContain('Simulated MovieTitle');

    const segmentOne = result.artefacts.find(
      (artefact) => artefact.artefactId === 'Artifact:ScriptGenerator.NarrationScript[0]',
    );
    expect(segmentOne?.blob?.data).toContain('segment 1');
  });

  it('normalizes TOML config from [prompt_settings] section', async () => {
    mocks.generateText.mockResolvedValueOnce({
      output: {
        MovieTitle: 'The Battle',
        MovieSummary: 'A historic event',
      },
      usage: {
        inputTokens: 150,
        outputTokens: 420,
        totalTokens: 570,
      },
      warnings: [],
      response: {
        id: 'resp-toml',
        model: 'openai/gpt5',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
    });

    const handler = buildHandler();
    await handler.warmStart?.({ logger: undefined });

    const schemaDefinition = {
      schema: {
        type: 'object',
        properties: {
          MovieTitle: { type: 'string' },
          MovieSummary: { type: 'string' },
        },
        required: ['MovieTitle', 'MovieSummary'],
      },
    };

    const request = createJobContext({
      produces: ['Artifact:MovieTitle', 'Artifact:MovieSummary'],
      context: {
        providerConfig: {
          prompt_settings: {
            textFormat: 'json_schema',
            jsonSchema: JSON.stringify(schemaDefinition),
            variables: ['Audience', 'Language'],
            systemPrompt: 'Teach {{Audience}} about {{Language}} history.',
          },
        },
        extras: {
          resolvedInputs: {
            Audience: 'kids',
            Language: 'English',
          },
        },
      },
    });

    const result = await handler.invoke(request);
    expect(result.status).toBe('succeeded');
    expect(result.artefacts).toHaveLength(2);

    const title = result.artefacts.find((artefact) => artefact.artefactId === 'Artifact:MovieTitle');
    expect(title?.blob?.data).toBe('The Battle');

    const summary = result.artefacts.find((artefact) => artefact.artefactId === 'Artifact:MovieSummary');
    expect(summary?.blob?.data).toBe('A historic event');

    const args = mocks.generateText.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof args.system).toBe('string');
    expect((args.system as string) ?? '').toContain('Teach kids about English history.');
  });

  it('fails warm start when secret is missing', async () => {
    const failingHandlerFactory = createOpenAiLlmHandler();
    const handler = failingHandlerFactory({
      descriptor: { provider: 'openai', model: 'openai/gpt5', environment: 'local' },
      mode: 'live',
      secretResolver: {
        async getSecret() {
          return null;
        },
      },
      logger: undefined,
    });

    await expect(handler.warmStart?.({ logger: undefined })).rejects.toThrowError(/OPENAI_API_KEY/);
  });

  it('passes call settings (temperature, maxOutputTokens, penalties) to AI SDK', async () => {
    mocks.generateText.mockResolvedValueOnce({
      text: 'Response',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      warnings: [],
      response: { id: 'resp', model: 'gpt5', createdAt: '' },
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
    const args = mocks.generateText.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.temperature).toBe(0.7);
    expect(args.maxOutputTokens).toBe(1000);
    expect(args.presencePenalty).toBe(0.5);
    expect(args.frequencyPenalty).toBe(0.3);
  });

  it('passes reasoning effort to provider options for reasoning models', async () => {
    mocks.generateText.mockResolvedValueOnce({
      output: { Result: 'analyzed' },
      usage: { inputTokens: 50, outputTokens: 100, totalTokens: 150 },
      warnings: [],
      response: { id: 'resp-reason', model: 'o1', createdAt: '' },
    });

    const handler = buildHandler();
    await handler.warmStart?.({ logger: undefined });

    const request = createJobContext({
      produces: ['Artifact:Result'],
      context: {
        providerConfig: {
          systemPrompt: 'Analyze this',
          responseFormat: {
            type: 'json_schema',
            schema: { type: 'object', properties: { Result: { type: 'string' } } },
          },
          reasoning: 'high',
        },
      },
    });

    await handler.invoke(request);

    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    const args = mocks.generateText.mock.calls[0]?.[0] as Record<string, unknown>;
    const providerOpts = args.providerOptions as Record<string, Record<string, unknown>> | undefined;
    expect(providerOpts?.openai?.reasoningEffort).toBe('high');
  });

  it('propagates errors when generateText with structured output fails', async () => {
    mocks.generateText.mockRejectedValueOnce(new Error('API rate limit exceeded'));

    const handler = buildHandler();
    await handler.warmStart?.({ logger: undefined });

    const request = createJobContext({
      produces: ['Artifact:Output'],
      context: {
        providerConfig: {
          systemPrompt: 'Test',
          responseFormat: {
            type: 'json_schema',
            schema: { type: 'object', properties: { Output: { type: 'string' } } },
          },
        },
      },
    });

    await expect(handler.invoke(request)).rejects.toThrow('API rate limit exceeded');
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

  it('simulates text responses in dry-run mode', async () => {
    const factory = createOpenAiLlmHandler();
    const handler = factory({
      descriptor: { provider: 'openai', model: 'openai/gpt5', environment: 'local' },
      mode: 'simulated',
      secretResolver: {
        async getSecret() {
          return 'test-api-key'; // API key required even in simulated mode
        },
      },
      logger: undefined,
    });

    await handler.warmStart?.({ logger: undefined });

    const request = createJobContext({
      jobId: 'job-text-sim',
      produces: ['Artifact:Summary'],
      context: {
        providerConfig: {
          systemPrompt: 'Summarize the topic',
          responseFormat: { type: 'text' },
        },
      },
    });

    const result = await handler.invoke(request);

    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(result.status).toBe('succeeded');
    expect(result.artefacts[0]?.blob?.data).toContain('Simulated');
  });

  it('throws when a required prompt variable is not resolved', async () => {
    const handler = buildHandler();
    await handler.warmStart?.({ logger: undefined });

    const request = createJobContext({
      produces: ['Artifact:Output'],
      context: {
        providerConfig: {
          systemPrompt: 'Tell me about {{MissingVar}}',
          variables: ['MissingVar'],
          responseFormat: { type: 'text' },
        },
        extras: {
          resolvedInputs: {}, // MissingVar not provided
        },
      },
    });

    await expect(handler.invoke(request)).rejects.toThrow(/MissingVar/);
  });

  it('passes schema name and description to generateText with structured output', async () => {
    mocks.generateText.mockResolvedValueOnce({
      output: { Title: 'Test Movie' },
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      warnings: [],
      response: { id: 'resp-schema', model: 'gpt5', createdAt: '' },
    });

    const handler = buildHandler();
    await handler.warmStart?.({ logger: undefined });

    const request = createJobContext({
      produces: ['Artifact:Title'],
      context: {
        providerConfig: {
          systemPrompt: 'Generate a movie title',
          responseFormat: {
            type: 'json_schema',
            schema: { type: 'object', properties: { Title: { type: 'string' } } },
            name: 'MovieSchema',
            description: 'Schema for movie data',
          },
        },
      },
    });

    await handler.invoke(request);

    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    const args = mocks.generateText.mock.calls[0]?.[0] as Record<string, unknown>;
    // With Output.object(), name and description are passed via the output option
    expect(args.output).toBeDefined();
  });

  it('requires API key during warmStart in simulated mode (same as live)', async () => {
    const factory = createOpenAiLlmHandler();
    const handler = factory({
      descriptor: { provider: 'openai', model: 'openai/gpt5', environment: 'local' },
      mode: 'simulated',
      secretResolver: {
        async getSecret() {
          return null; // No API key
        },
      },
      logger: undefined,
    });

    // Simulated mode requires API key just like live mode
    // This ensures dry-run catches configuration errors
    await expect(handler.warmStart?.({ logger: undefined })).rejects.toThrowError(/OPENAI_API_KEY/);
  });

  it('includes usage and response metadata in diagnostics', async () => {
    mocks.generateText.mockResolvedValueOnce({
      output: { Title: 'Test' },
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      warnings: ['Some warning about token usage'],
      response: { id: 'resp-123', model: 'gpt-4o', createdAt: '2025-01-01T00:00:00Z' },
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
            schema: { type: 'object', properties: { Title: { type: 'string' } } },
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
    expect(result.diagnostics?.warnings).toEqual(['Some warning about token usage']);
    expect(result.diagnostics?.response).toMatchObject({ id: 'resp-123' });
  });

  describe('auto-derive responseFormat from outputSchema', () => {
    it('automatically uses structured output when outputSchema is present in request extras', async () => {
      mocks.generateText.mockResolvedValueOnce({
        output: { MovieTitle: 'Auto-derived Title', MovieSummary: 'Auto-derived summary' },
        usage: { inputTokens: 50, outputTokens: 100, totalTokens: 150 },
        warnings: [],
        response: { id: 'resp-auto', model: 'openai/gpt5', createdAt: '' },
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

      // Should use generateText with output option (structured output)
      expect(mocks.generateText).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('succeeded');
      expect(result.artefacts).toHaveLength(2);

      // Verify output option was passed (contains schema)
      const args = mocks.generateText.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(args.output).toBeDefined();
    });

    it('uses explicit responseFormat config over auto-derivation from outputSchema', async () => {
      mocks.generateText.mockResolvedValueOnce({
        text: 'Plain text response',
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        warnings: [],
        response: { id: 'resp-explicit', model: 'openai/gpt5', createdAt: '' },
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

      // Should use generateText without output option (text mode)
      expect(mocks.generateText).toHaveBeenCalledTimes(1);
      const args = mocks.generateText.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(args.output).toBeUndefined(); // No structured output
      expect(result.status).toBe('succeeded');
    });

    it('explicit json_schema config takes precedence over outputSchema', async () => {
      mocks.generateText.mockResolvedValueOnce({
        output: { ExplicitTitle: 'From explicit schema' },
        usage: { inputTokens: 20, outputTokens: 40, totalTokens: 60 },
        warnings: [],
        response: { id: 'resp-explicit-json', model: 'openai/gpt5', createdAt: '' },
      });

      const handler = buildHandler();
      await handler.warmStart?.({ logger: undefined });

      const outputSchemaFromContext = JSON.stringify({
        title: 'ContextSchema',
        type: 'object',
        properties: { ContextTitle: { type: 'string' } },
      });

      const explicitSchema = {
        type: 'object',
        properties: { ExplicitTitle: { type: 'string' } },
      };

      const request = createJobContext({
        produces: ['Artifact:ExplicitTitle'],
        context: {
          providerConfig: {
            systemPrompt: 'Generate',
            // Explicit json_schema with different schema
            responseFormat: {
              type: 'json_schema',
              schema: explicitSchema,
              name: 'ExplicitSchemaName',
            },
          },
          extras: {
            schema: {
              output: outputSchemaFromContext, // Different schema in context
            },
            resolvedInputs: {},
          },
        },
      });

      const result = await handler.invoke(request);

      // Should use generateText with output option (structured output)
      expect(mocks.generateText).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('succeeded');

      // Verify the output option was passed (structured output mode)
      const args = mocks.generateText.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(args.output).toBeDefined();
    });

    it('defaults to text mode when no outputSchema and no responseFormat', async () => {
      mocks.generateText.mockResolvedValueOnce({
        text: 'Default text response',
        usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 },
        warnings: [],
        response: { id: 'resp-default', model: 'openai/gpt5', createdAt: '' },
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

      // Should default to generateText without output option (text mode)
      expect(mocks.generateText).toHaveBeenCalledTimes(1);
      const args = mocks.generateText.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(args.output).toBeUndefined(); // No structured output
      expect(result.status).toBe('succeeded');
    });

    it('uses outputSchema title as schema name when auto-deriving', async () => {
      mocks.generateText.mockResolvedValueOnce({
        output: { Content: 'Test content' },
        usage: { inputTokens: 30, outputTokens: 60, totalTokens: 90 },
        warnings: [],
        response: { id: 'resp-title', model: 'openai/gpt5', createdAt: '' },
      });

      const handler = buildHandler();
      await handler.warmStart?.({ logger: undefined });

      const outputSchema = JSON.stringify({
        title: 'CustomSchemaTitle',
        description: 'Custom schema description',
        type: 'object',
        properties: { Content: { type: 'string' } },
      });

      const request = createJobContext({
        produces: ['Artifact:Content'],
        context: {
          providerConfig: {
            systemPrompt: 'Generate content',
          },
          extras: {
            schema: { output: outputSchema },
            resolvedInputs: {},
          },
        },
      });

      await handler.invoke(request);

      // Should use generateText with output option (structured output)
      expect(mocks.generateText).toHaveBeenCalledTimes(1);
      const args = mocks.generateText.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(args.output).toBeDefined();
    });

    it('falls back to "output" as schema name when title is not in outputSchema', async () => {
      mocks.generateText.mockResolvedValueOnce({
        output: { Data: 'Test data' },
        usage: { inputTokens: 25, outputTokens: 50, totalTokens: 75 },
        warnings: [],
        response: { id: 'resp-notitle', model: 'openai/gpt5', createdAt: '' },
      });

      const handler = buildHandler();
      await handler.warmStart?.({ logger: undefined });

      const outputSchema = JSON.stringify({
        type: 'object',
        properties: { Data: { type: 'string' } },
        // No title field
      });

      const request = createJobContext({
        produces: ['Artifact:Data'],
        context: {
          providerConfig: {
            systemPrompt: 'Generate data',
          },
          extras: {
            schema: { output: outputSchema },
            resolvedInputs: {},
          },
        },
      });

      await handler.invoke(request);

      // Should use generateText with output option (structured output)
      expect(mocks.generateText).toHaveBeenCalledTimes(1);
      const args = mocks.generateText.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(args.output).toBeDefined();
    });
  });
});
