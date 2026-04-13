import { afterEach, describe, expect, it, vi } from 'vitest';
import { falAdapter } from '../fal/adapter.js';
import { replicateAdapter } from '../replicate/adapter.js';
import { wavespeedAdapter } from '../wavespeed/adapter.js';
import { createSimulatedProviderClient } from './simulated-client.js';
import { parseSchemaFile } from './schema-file.js';
import type { ProviderInvokeContext } from './provider-adapter.js';
import type { ProviderJobContext } from '../../types.js';

vi.mock('../fal/subscribe.js', async () => {
  const actual = await vi.importActual<typeof import('../fal/subscribe.js')>(
    '../fal/subscribe.js'
  );

  return {
    ...actual,
    falSubscribe: vi.fn(),
  };
});

type FetchMock = ReturnType<typeof vi.fn>;

function createInvokeContext(
  overrides?: Partial<ProviderInvokeContext>
): ProviderInvokeContext {
  const request: ProviderJobContext = {
    jobId: 'job-123',
    provider: 'fal-ai',
    model: 'test-model',
    revision: 'rev-1',
    layerIndex: 0,
    attempt: 1,
    inputs: [],
    produces: ['Artifact:Output[index=0]'],
    context: {
      providerConfig: {},
      extras: {},
    },
  };

  return {
    mode: 'live',
    request,
    schemaFile: parseSchemaFile(
      JSON.stringify({
        input_schema: {
          type: 'object',
          properties: {
            prompt: { type: 'string' },
          },
          required: ['prompt'],
        },
        output_schema: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            words: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                },
              },
            },
          },
        },
      })
    ),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('unified adapter invoke contract', () => {
  it('fal-ai simulated returns unwrapped result plus providerRequestId', async () => {
    const result = await falAdapter.invoke(
      createSimulatedProviderClient('fal-ai'),
      'fal-ai/elevenlabs/speech-to-text',
      { prompt: 'hello' },
      createInvokeContext({
        mode: 'simulated',
        request: {
          ...createInvokeContext().request,
          provider: 'fal-ai',
          model: 'elevenlabs/speech-to-text',
        },
      })
    );

    expect(result.providerRequestId).toBe('simulated-fal-job-123');
    expect(result.result).toEqual({
      text: 'simulated_value',
      words: [
        {
          text: 'simulated_value',
        },
      ],
    });
    expect(result).not.toHaveProperty('data');
    expect(result).not.toHaveProperty('requestId');
  });

  it('fal-ai live unwraps provider output into result and providerRequestId', async () => {
    const subscribeModule = await import('../fal/subscribe.js');
    vi.mocked(subscribeModule.falSubscribe).mockResolvedValue({
      output: {
        text: 'hello',
        words: [],
      },
      requestId: 'fal-req-1',
    });

    const result = await falAdapter.invoke(
      {},
      'fal-ai/elevenlabs/speech-to-text',
      { prompt: 'hello' },
      createInvokeContext()
    );

    expect(result).toEqual({
      result: {
        text: 'hello',
        words: [],
      },
      providerRequestId: 'fal-req-1',
    });
  });

  it('replicate simulated returns the shared unified result shape', async () => {
    const result = await replicateAdapter.invoke(
      createSimulatedProviderClient('replicate'),
      'owner/model',
      { prompt: 'hello' },
      createInvokeContext({
        mode: 'simulated',
        request: {
          ...createInvokeContext().request,
          provider: 'replicate',
          model: 'owner/model',
        },
      })
    );

    expect(result).toEqual({
      result: {
        text: 'simulated_value',
        words: [
          {
            text: 'simulated_value',
          },
        ],
      },
    });
  });

  it('replicate live wraps provider output as result', async () => {
    const run = vi.fn().mockResolvedValue(['https://replicate.example.com/out.png']);

    const result = await replicateAdapter.invoke(
      { run },
      'owner/model',
      { prompt: 'hello' },
      createInvokeContext()
    );

    expect(run).toHaveBeenCalledWith('owner/model', {
      input: { prompt: 'hello' },
    });
    expect(result).toEqual({
      result: ['https://replicate.example.com/out.png'],
    });
  });

  it('wavespeed-ai simulated returns the shared unified result shape', async () => {
    const result = await wavespeedAdapter.invoke(
      createSimulatedProviderClient('wavespeed-ai'),
      'wan/video',
      { prompt: 'hello' },
      createInvokeContext({
        mode: 'simulated',
        request: {
          ...createInvokeContext().request,
          provider: 'wavespeed-ai',
          model: 'wan/video',
        },
      })
    );

    expect(result).toEqual({
      result: {
        text: 'simulated_value',
        words: [
          {
            text: 'simulated_value',
          },
        ],
      },
    });
  });

  it('wavespeed-ai live returns result plus providerRequestId separately', async () => {
    const fetchMock: FetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: 'wave-req-1' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: 'wave-req-1',
            status: 'completed',
            outputs: ['https://wavespeed.example.com/out.mp4'],
          },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await wavespeedAdapter.invoke(
      {
        apiKey: 'wavespeed-key',
      },
      'wan/video',
      { prompt: 'hello' },
      createInvokeContext()
    );

    expect(result).toEqual({
      result: {
        data: {
          id: 'wave-req-1',
          status: 'completed',
          outputs: ['https://wavespeed.example.com/out.mp4'],
        },
      },
      providerRequestId: 'wave-req-1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
