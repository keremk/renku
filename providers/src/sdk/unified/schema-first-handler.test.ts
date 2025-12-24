import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUnifiedHandler } from './schema-first-handler.js';
import type { ProviderAdapter, ClientOptions, ProviderClient } from './provider-adapter.js';
import type { HandlerInitContext, ProviderJobContext } from '../../types.js';

// Type for extras to avoid repetitive casting
type TestExtras = {
  resolvedInputs: Record<string, unknown>;
  jobContext: {
    inputBindings: Record<string, string>;
    sdkMapping: Record<string, { field: string; required?: boolean }>;
  };
  plannerContext: Record<string, unknown>;
  schema: { input: string };
};

// Mock adapter for testing
function createMockAdapter(options?: {
  invokeResult?: unknown;
  normalizedUrls?: string[];
  shouldThrow?: boolean;
}): ProviderAdapter {
  const { invokeResult = {}, normalizedUrls = ['https://mock.example.com/output.png'], shouldThrow = false } = options ?? {};

  return {
    name: 'mock-provider',
    secretKey: 'MOCK_API_KEY',

    async createClient(_options: ClientOptions): Promise<ProviderClient> {
      return { configured: true };
    },

    formatModelIdentifier(model: string): string {
      return `mock/${model}`;
    },

    async invoke(_client: ProviderClient, _model: string, _input: Record<string, unknown>): Promise<unknown> {
      if (shouldThrow) {
        throw new Error('Mock API error');
      }
      return invokeResult;
    },

    normalizeOutput(_response: unknown): string[] {
      return normalizedUrls;
    },
  };
}

// Mock adapter with invoke spy for verifying input payloads
function createMockAdapterWithSpy(invokeSpy: ReturnType<typeof vi.fn>): ProviderAdapter {
  return {
    name: 'mock-provider',
    secretKey: 'MOCK_API_KEY',
    async createClient(): Promise<ProviderClient> {
      return { configured: true };
    },
    formatModelIdentifier: (m) => `mock/${m}`,
    invoke: invokeSpy,
    normalizeOutput: () => ['https://mock.example.com/output.png'],
  };
}

function createMockInitContext(overrides?: Partial<HandlerInitContext>): HandlerInitContext {
  return {
    descriptor: {
      provider: 'mock-provider',
      model: 'test-model',
      environment: 'local',
    },
    mode: 'simulated',
    secretResolver: {
      async getSecret(_key: string) {
        return 'mock-secret';
      },
    },
    ...overrides,
  };
}

function createMockRequest(overrides?: Partial<ProviderJobContext>): ProviderJobContext {
  const schema = JSON.stringify({
    type: 'object',
    properties: {
      prompt: { type: 'string' },
    },
    required: ['prompt'],
  });

  return {
    jobId: 'test-job-1',
    provider: 'mock-provider',
    model: 'test-model',
    revision: 'rev-1',
    layerIndex: 0,
    attempt: 1,
    inputs: ['Input:Prompt'],
    produces: ['Artifact:Output[index=0]'],
    context: {
      providerConfig: {},
      extras: {
        resolvedInputs: {
          'Input:Prompt': 'test prompt',
        },
        jobContext: {
          inputBindings: {
            Prompt: 'Input:Prompt',
          },
          sdkMapping: {
            Prompt: { field: 'prompt', required: true },
          },
        },
        plannerContext: { index: { segment: 0 } },
        schema: { input: schema },
      },
    },
    ...overrides,
  };
}

describe('createUnifiedHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a handler factory', () => {
    const adapter = createMockAdapter();
    const factory = createUnifiedHandler({ adapter, outputMimeType: 'image/png' });
    expect(typeof factory).toBe('function');
  });

  it('handler invoke returns succeeded status with artefacts', async () => {
    const adapter = createMockAdapter({
      normalizedUrls: ['https://mock.example.com/output.png'],
    });
    const factory = createUnifiedHandler({ adapter, outputMimeType: 'image/png' });
    const handler = factory(createMockInitContext());

    const result = await handler.invoke(createMockRequest());

    expect(result.status).toBe('succeeded');
    expect(result.artefacts).toHaveLength(1);
    expect(result.artefacts[0]?.artefactId).toBe('Artifact:Output[index=0]');
  });

  it('handler invoke calls adapter methods in correct order (live mode)', async () => {
    const createClientSpy = vi.fn().mockResolvedValue({ configured: true });
    const invokeSpy = vi.fn().mockResolvedValue({});
    const normalizeOutputSpy = vi.fn().mockReturnValue(['https://example.com/out.png']);

    const adapter: ProviderAdapter = {
      name: 'spy-provider',
      secretKey: 'SPY_KEY',
      createClient: createClientSpy,
      formatModelIdentifier: (m) => `spy/${m}`,
      invoke: invokeSpy,
      normalizeOutput: normalizeOutputSpy,
    };

    const factory = createUnifiedHandler({ adapter, outputMimeType: 'image/png' });
    // Use live mode to test actual adapter invocation
    const handler = factory(createMockInitContext({ mode: 'live' }));

    await handler.invoke(createMockRequest());

    expect(createClientSpy).toHaveBeenCalled();
    expect(invokeSpy).toHaveBeenCalled();
    expect(normalizeOutputSpy).toHaveBeenCalled();
  });

  it('handler invoke generates output from schema in simulated mode', async () => {
    const createClientSpy = vi.fn().mockResolvedValue({ configured: true });
    const invokeSpy = vi.fn().mockResolvedValue({});
    const normalizeOutputSpy = vi.fn().mockReturnValue(['https://example.com/out.png']);

    const adapter: ProviderAdapter = {
      name: 'spy-provider',
      secretKey: 'SPY_KEY',
      createClient: createClientSpy,
      formatModelIdentifier: (m) => `spy/${m}`,
      invoke: invokeSpy,
      normalizeOutput: normalizeOutputSpy,
    };

    const factory = createUnifiedHandler({ adapter, outputMimeType: 'image/png' });
    // Use simulated mode - should NOT call adapter.invoke()
    const handler = factory(createMockInitContext({ mode: 'simulated' }));

    const result = await handler.invoke(createMockRequest());

    // In simulated mode, client is not created and invoke is not called
    expect(createClientSpy).not.toHaveBeenCalled();
    expect(invokeSpy).not.toHaveBeenCalled();
    // But normalizeOutput IS called on the generated output
    expect(normalizeOutputSpy).toHaveBeenCalled();
    expect(result.status).toBe('succeeded');
    expect(result.diagnostics?.simulated).toBe(true);
  });

  it('throws error when input schema is missing', async () => {
    const adapter = createMockAdapter();
    const factory = createUnifiedHandler({ adapter, outputMimeType: 'image/png' });
    const handler = factory(createMockInitContext());

    const request = createMockRequest({
      context: {
        providerConfig: {},
        extras: {
          resolvedInputs: { 'Input:Prompt': 'test' },
          jobContext: {
            inputBindings: { Prompt: 'Input:Prompt' },
            sdkMapping: { Prompt: { field: 'prompt', required: true } },
          },
          plannerContext: { index: { segment: 0 } },
          // No schema!
        },
      },
    });

    await expect(handler.invoke(request)).rejects.toThrow(/Missing input schema/);
  });

  it('throws error when adapter invoke fails (live mode)', async () => {
    const adapter = createMockAdapter({ shouldThrow: true });
    const factory = createUnifiedHandler({ adapter, outputMimeType: 'image/png' });
    // Use live mode to test error propagation from adapter
    const handler = factory(createMockInitContext({ mode: 'live' }));

    await expect(handler.invoke(createMockRequest())).rejects.toThrow(/Mock API error/);
  });

  it('returns failed status when no output URLs', async () => {
    const adapter = createMockAdapter({ normalizedUrls: [] });
    const factory = createUnifiedHandler({ adapter, outputMimeType: 'image/png' });
    const handler = factory(createMockInitContext());

    const result = await handler.invoke(createMockRequest());

    expect(result.status).toBe('failed');
    expect(result.artefacts).toHaveLength(1);
    expect(result.artefacts[0]?.status).toBe('failed');
  });

  it('includes diagnostics in result', async () => {
    const adapter = createMockAdapter();
    const factory = createUnifiedHandler({ adapter, outputMimeType: 'image/png' });
    const handler = factory(createMockInitContext());

    const result = await handler.invoke(createMockRequest());

    expect(result.diagnostics).toBeDefined();
    expect(result.diagnostics?.provider).toBe('mock-provider');
    expect(result.diagnostics?.model).toBe('test-model');
  });

  // Coverage restoration tests (from deleted per-media-type tests)

  it('builds input strictly from sdk mapping and schema', async () => {
    const invokeSpy = vi.fn().mockResolvedValue({});
    const adapter = createMockAdapterWithSpy(invokeSpy);
    const handler = createUnifiedHandler({ adapter, outputMimeType: 'image/png' })(
      createMockInitContext({ mode: 'live' }),
    );

    const request = createMockRequest();
    const extras = request.context.extras as TestExtras;
    extras.resolvedInputs['Input:AspectRatio'] = '16:9';
    extras.jobContext.inputBindings.AspectRatio = 'Input:AspectRatio';
    extras.jobContext.sdkMapping.AspectRatio = { field: 'aspect_ratio', required: false };

    // Update schema to include aspect_ratio
    extras.schema.input = JSON.stringify({
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        aspect_ratio: { type: 'string' },
      },
      required: ['prompt'],
    });

    await handler.invoke(request);

    expect(invokeSpy).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      prompt: 'test prompt',
      aspect_ratio: '16:9',
    });
  });

  it('fails fast when required mapped input is absent', async () => {
    const adapter = createMockAdapter();
    const handler = createUnifiedHandler({ adapter, outputMimeType: 'image/png' })(
      createMockInitContext({ mode: 'live' }),
    );

    const request = createMockRequest();
    const extras = request.context.extras as TestExtras;
    delete extras.resolvedInputs['Input:Prompt'];

    await expect(handler.invoke(request)).rejects.toThrow(/Missing required input/);
  });

  it('fails when payload violates the input schema', async () => {
    const adapter = createMockAdapter();
    const handler = createUnifiedHandler({ adapter, outputMimeType: 'image/png' })(
      createMockInitContext({ mode: 'live' }),
    );

    const request = createMockRequest();
    const extras = request.context.extras as TestExtras;
    extras.resolvedInputs['Input:Prompt'] = 12345; // Wrong type - should be string

    await expect(handler.invoke(request)).rejects.toThrow(/Invalid input payload/);
  });

  it('ignores providerConfig defaults and customAttributes', async () => {
    const invokeSpy = vi.fn().mockResolvedValue({});
    const adapter = createMockAdapterWithSpy(invokeSpy);
    const handler = createUnifiedHandler({ adapter, outputMimeType: 'image/png' })(
      createMockInitContext({ mode: 'live' }),
    );

    const request = createMockRequest();
    request.context.providerConfig = {
      defaults: { output_size: '2K' },
      customAttributes: { negative_prompt: 'bad' },
    };

    await handler.invoke(request);

    // Verify providerConfig values are NOT in the input
    expect(invokeSpy).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      prompt: 'test prompt', // Only sdk-mapped values
    });
  });

  it('validates required inputs in simulated mode', async () => {
    const adapter = createMockAdapter();
    const handler = createUnifiedHandler({ adapter, outputMimeType: 'image/png' })(
      createMockInitContext({ mode: 'simulated' }),
    );

    const request = createMockRequest();
    const extras = request.context.extras as TestExtras;
    delete extras.resolvedInputs['Input:Prompt'];

    await expect(handler.invoke(request)).rejects.toThrow(/Missing required input/);
  });
});
