import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveVoiceId, VOICE_NAME_MAP } from './client.js';
import {
  collectStreamToBuffer,
  isElevenlabsStreamResponse,
  estimateTTSDuration,
  extractMusicDuration,
} from './output.js';
import type { HandlerFactory, ProviderJobContext } from '../../types.js';
import { createElevenlabsHandler } from './handler.js';

// Mock elevenlabs adapter
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('./adapter.js', async () => {
  const actual = await vi.importActual<typeof import('./adapter.js')>('./adapter.js');
  return {
    ...actual,
    elevenlabsAdapter: {
      ...actual.elevenlabsAdapter,
      createClient: mocks.createClient,
      invoke: mocks.invoke,
    },
  };
});

describe('resolveVoiceId', () => {
  it('returns voice ID as-is for long alphanumeric strings', () => {
    const voiceId = 'EXAVITQu4vr4xnSDxMaL';
    expect(resolveVoiceId(voiceId)).toBe(voiceId);
  });

  it('maps preset voice names to IDs', () => {
    expect(resolveVoiceId('Rachel')).toBe(VOICE_NAME_MAP['Rachel']);
    expect(resolveVoiceId('Aria')).toBe(VOICE_NAME_MAP['Aria']);
    expect(resolveVoiceId('Roger')).toBe(VOICE_NAME_MAP['Roger']);
  });

  it('returns unknown names as-is', () => {
    expect(resolveVoiceId('UnknownVoice')).toBe('UnknownVoice');
  });

  it('returns short strings as-is (might be custom voice)', () => {
    expect(resolveVoiceId('custom123')).toBe('custom123');
  });
});

describe('isElevenlabsStreamResponse', () => {
  it('returns true for valid stream response', () => {
    const response = {
      audioStream: new ReadableStream(),
      model: 'eleven_v3',
    };
    expect(isElevenlabsStreamResponse(response)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isElevenlabsStreamResponse(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isElevenlabsStreamResponse(undefined)).toBe(false);
  });

  it('returns false for object without audioStream', () => {
    expect(isElevenlabsStreamResponse({ model: 'eleven_v3' })).toBe(false);
  });

  it('returns false for object without model', () => {
    expect(isElevenlabsStreamResponse({ audioStream: new ReadableStream() })).toBe(false);
  });
});

describe('collectStreamToBuffer', () => {
  it('collects stream chunks into a buffer', async () => {
    const chunks = [
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
      new Uint8Array([7, 8, 9]),
    ];

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });

    const buffer = await collectStreamToBuffer(stream);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBe(9);
    expect(Array.from(buffer)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('handles empty stream', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });

    const buffer = await collectStreamToBuffer(stream);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBe(0);
  });
});

describe('estimateTTSDuration', () => {
  it('estimates duration based on word count', () => {
    // 150 words per minute = 2.5 words per second
    const tenWords = 'one two three four five six seven eight nine ten';
    const duration = estimateTTSDuration(tenWords);
    // 10 words / 150 wpm = 0.067 minutes = 4 seconds
    expect(duration).toBe(4);
  });

  it('returns minimum 1 second for very short text', () => {
    expect(estimateTTSDuration('Hi')).toBe(1);
  });

  it('caps at 300 seconds maximum', () => {
    // Create text with 10000 words (would be ~4000 seconds)
    const longText = 'word '.repeat(10000);
    expect(estimateTTSDuration(longText)).toBe(300);
  });

  it('handles empty string', () => {
    expect(estimateTTSDuration('')).toBe(1);
  });
});

describe('extractMusicDuration', () => {
  it('extracts duration from music_length_ms', () => {
    expect(extractMusicDuration({ music_length_ms: 30000 })).toBe(30);
    expect(extractMusicDuration({ music_length_ms: 60000 })).toBe(60);
    expect(extractMusicDuration({ music_length_ms: 10500 })).toBe(11); // rounds up
  });

  it('returns default 30 seconds if not provided', () => {
    expect(extractMusicDuration({})).toBe(30);
    expect(extractMusicDuration({ prompt: 'test' })).toBe(30);
  });

  it('returns default for invalid values', () => {
    expect(extractMusicDuration({ music_length_ms: 0 })).toBe(30);
    expect(extractMusicDuration({ music_length_ms: -1000 })).toBe(30);
    expect(extractMusicDuration({ music_length_ms: 'invalid' })).toBe(30);
  });

  it('handles edge case durations', () => {
    // Minimum valid duration (3 seconds = 3000ms)
    expect(extractMusicDuration({ music_length_ms: 3000 })).toBe(3);
    // Maximum duration (600 seconds = 600000ms)
    expect(extractMusicDuration({ music_length_ms: 600000 })).toBe(600);
  });
});

describe('resolveVoiceId edge cases', () => {
  it('handles all preset voice names', () => {
    // Test all voices in VOICE_NAME_MAP
    for (const [name, expectedId] of Object.entries(VOICE_NAME_MAP)) {
      expect(resolveVoiceId(name)).toBe(expectedId);
    }
  });

  it('is case-sensitive for voice names', () => {
    // Voice names are case-sensitive
    expect(resolveVoiceId('rachel')).toBe('rachel'); // lowercase not mapped
    expect(resolveVoiceId('RACHEL')).toBe('RACHEL'); // uppercase not mapped
    expect(resolveVoiceId('Rachel')).toBe(VOICE_NAME_MAP['Rachel']); // exact case matches
  });

  it('handles voice IDs with various lengths', () => {
    // IDs that look like voice IDs (long alphanumeric)
    expect(resolveVoiceId('abcdefghijklmnop123')).toBe('abcdefghijklmnop123');
    // Short strings returned as-is
    expect(resolveVoiceId('abc')).toBe('abc');
  });
});

describe('collectStreamToBuffer edge cases', () => {
  it('handles single large chunk', async () => {
    const largeChunk = new Uint8Array(10000).fill(42);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(largeChunk);
        controller.close();
      },
    });

    const buffer = await collectStreamToBuffer(stream);

    expect(buffer.length).toBe(10000);
    expect(buffer.every((b) => b === 42)).toBe(true);
  });

  it('handles many small chunks', async () => {
    const chunks = Array.from({ length: 100 }, (_, i) => new Uint8Array([i]));

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });

    const buffer = await collectStreamToBuffer(stream);

    expect(buffer.length).toBe(100);
    expect(Array.from(buffer)).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });
});

describe('estimateTTSDuration edge cases', () => {
  it('handles text with multiple spaces', () => {
    const text = 'one   two    three'; // Multiple spaces between words
    const duration = estimateTTSDuration(text);
    expect(duration).toBe(2); // Still counts as ~3 words
  });

  it('handles text with newlines', () => {
    const text = 'one\ntwo\nthree';
    const duration = estimateTTSDuration(text);
    expect(duration).toBe(2); // 3 words
  });

  it('handles punctuation-only text', () => {
    const text = '...!!!???';
    const duration = estimateTTSDuration(text);
    expect(duration).toBe(1); // Minimum duration
  });

  it('handles unicode text', () => {
    const text = 'Hello 你好 世界 Bonjour'; // Mixed language
    const duration = estimateTTSDuration(text);
    expect(duration).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// Simulated Mode Handler Integration Tests
// =============================================================================

function createHandler(mode: 'live' | 'simulated'): ReturnType<HandlerFactory> {
  const factory = createElevenlabsHandler({ outputMimeType: 'audio/mpeg' });
  return factory({
    descriptor: {
      provider: 'elevenlabs',
      model: 'eleven_v3',
      environment: 'local',
    },
    mode,
    secretResolver: {
      async getSecret() {
        return 'test-api-key';
      },
    },
    logger: undefined,
  });
}

function createMusicHandler(mode: 'live' | 'simulated'): ReturnType<HandlerFactory> {
  const factory = createElevenlabsHandler({ outputMimeType: 'audio/mpeg' });
  return factory({
    descriptor: {
      provider: 'elevenlabs',
      model: 'music_v1',
      environment: 'local',
    },
    mode,
    secretResolver: {
      async getSecret() {
        return 'test-api-key';
      },
    },
    logger: undefined,
  });
}

function createJobContext(model: string, overrides: Partial<ProviderJobContext> = {}): ProviderJobContext {
  const inputSchema = model === 'music_v1'
    ? JSON.stringify({
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          music_length_ms: { type: 'integer' },
        },
        required: ['prompt'],
      })
    : JSON.stringify({
        type: 'object',
        properties: {
          text: { type: 'string' },
          voice: { type: 'string' },
        },
        required: ['text'],
      });

  // sdkMapping format: { InputAlias: { field: 'api_field_name' } }
  // inputBindings format: { InputAlias: 'Input:CanonicalId' }
  // resolvedInputs format: { 'Input:CanonicalId': value }
  const sdkMapping = model === 'music_v1'
    ? {
        Prompt: { field: 'prompt' },
        Duration: { field: 'music_length_ms' },
      }
    : {
        TextInput: { field: 'text' },
        VoiceId: { field: 'voice' },
      };

  const inputBindings = model === 'music_v1'
    ? {
        Prompt: 'Input:Prompt',
        Duration: 'Input:Duration',
      }
    : {
        TextInput: 'Input:TextInput',
        VoiceId: 'Input:VoiceId',
      };

  const resolvedInputs = model === 'music_v1'
    ? {
        'Input:Prompt': 'Epic orchestral theme',
        'Input:Duration': 30000,
      }
    : {
        'Input:TextInput': 'Hello world, this is a test.',
        'Input:VoiceId': 'Rachel',
      };

  const baseContext: ProviderJobContext = {
    jobId: 'job-test',
    provider: 'elevenlabs',
    model,
    revision: 'rev-test',
    layerIndex: 0,
    attempt: 1,
    inputs: [],
    produces: ['Artifact:Audio'],
    context: {
      providerConfig: {},
      rawAttachments: [],
      observability: undefined,
      environment: 'local',
      extras: {
        schema: {
          input: inputSchema,
        },
        resolvedInputs,
        jobContext: {
          sdkMapping,
          inputBindings,
        },
      },
    },
  };

  return {
    ...baseContext,
    ...overrides,
    context: {
      ...baseContext.context,
      ...overrides.context,
      extras: {
        ...baseContext.context.extras,
        ...(overrides.context?.extras ?? {}),
      },
    },
  };
}

describe('ElevenLabs Handler - Simulated Mode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.createClient.mockReset();
    mocks.invoke.mockReset();
  });

  describe('TTS handler simulated mode', () => {
    it('does NOT call API in simulated mode', async () => {
      const handler = createHandler('simulated');
      const request = createJobContext('eleven_v3');

      const result = await handler.invoke(request);

      // API should NOT be called
      expect(mocks.invoke).not.toHaveBeenCalled();
      expect(result.status).toBe('succeeded');
    });

    it('generates mock WAV with duration based on text length', async () => {
      const handler = createHandler('simulated');

      // Short text should have shorter duration
      const shortRequest = createJobContext('eleven_v3', {
        context: {
          extras: {
            schema: {
              input: JSON.stringify({
                type: 'object',
                properties: { text: { type: 'string' }, voice: { type: 'string' } },
                required: ['text'],
              }),
            },
            resolvedInputs: { 'Input:TextInput': 'Hi', 'Input:VoiceId': 'Rachel' },
            jobContext: {
              sdkMapping: {
                TextInput: { field: 'text' },
                VoiceId: { field: 'voice' },
              },
              inputBindings: {
                TextInput: 'Input:TextInput',
                VoiceId: 'Input:VoiceId',
              },
            },
          },
        },
      });

      const shortResult = await handler.invoke(shortRequest);

      expect(shortResult.status).toBe('succeeded');
      expect(shortResult.artefacts).toHaveLength(1);
      expect(shortResult.artefacts[0]?.blob).toBeDefined();
      // Should be a small buffer (short WAV)
      const shortBuffer = shortResult.artefacts[0]?.blob?.data as Buffer;
      expect(shortBuffer.length).toBeGreaterThan(44); // WAV header is 44 bytes

      // Long text should have longer duration
      const longText = 'word '.repeat(100); // ~100 words = ~40 seconds
      const longRequest = createJobContext('eleven_v3', {
        context: {
          extras: {
            schema: {
              input: JSON.stringify({
                type: 'object',
                properties: { text: { type: 'string' }, voice: { type: 'string' } },
                required: ['text'],
              }),
            },
            resolvedInputs: { 'Input:TextInput': longText, 'Input:VoiceId': 'Rachel' },
            jobContext: {
              sdkMapping: {
                TextInput: { field: 'text' },
                VoiceId: { field: 'voice' },
              },
              inputBindings: {
                TextInput: 'Input:TextInput',
                VoiceId: 'Input:VoiceId',
              },
            },
          },
        },
      });

      const longResult = await handler.invoke(longRequest);

      expect(longResult.status).toBe('succeeded');
      const longBuffer = longResult.artefacts[0]?.blob?.data as Buffer;
      // Long text should produce larger WAV file
      expect(longBuffer.length).toBeGreaterThan(shortBuffer.length);
    });

    it('generates artifacts with correct structure for downstream', async () => {
      const handler = createHandler('simulated');
      const request = createJobContext('eleven_v3', {
        produces: ['Artifact:Narration', 'Artifact:Backup'],
      });

      const result = await handler.invoke(request);

      expect(result.status).toBe('succeeded');
      expect(result.artefacts).toHaveLength(2);

      // First artifact
      expect(result.artefacts[0]).toMatchObject({
        artefactId: 'Artifact:Narration',
        status: 'succeeded',
        blob: {
          mimeType: 'audio/mpeg',
        },
      });
      expect(result.artefacts[0]?.blob?.data).toBeInstanceOf(Buffer);

      // Second artifact (shares same buffer)
      expect(result.artefacts[1]).toMatchObject({
        artefactId: 'Artifact:Backup',
        status: 'succeeded',
        blob: {
          mimeType: 'audio/mpeg',
        },
      });
      expect(result.artefacts[1]?.blob?.data).toBeInstanceOf(Buffer);
    });

    it('includes simulated flag in diagnostics', async () => {
      const handler = createHandler('simulated');
      const request = createJobContext('eleven_v3');

      const result = await handler.invoke(request);

      expect(result.diagnostics?.simulated).toBe(true);
      expect(result.diagnostics?.outputType).toBe('binary');
      expect(typeof result.diagnostics?.bufferSize).toBe('number');
    });
  });

  describe('Music handler simulated mode', () => {
    it('does NOT call API in simulated mode', async () => {
      const handler = createMusicHandler('simulated');
      const request = createJobContext('music_v1');

      const result = await handler.invoke(request);

      expect(mocks.invoke).not.toHaveBeenCalled();
      expect(result.status).toBe('succeeded');
    });

    it('generates mock WAV with duration from music_length_ms', async () => {
      const handler = createMusicHandler('simulated');

      // Request with 60 seconds duration
      const request = createJobContext('music_v1', {
        context: {
          extras: {
            schema: {
              input: JSON.stringify({
                type: 'object',
                properties: { prompt: { type: 'string' }, music_length_ms: { type: 'integer' } },
                required: ['prompt'],
              }),
            },
            resolvedInputs: { 'Input:Prompt': 'Epic soundtrack', 'Input:Duration': 60000 },
            jobContext: {
              sdkMapping: {
                Prompt: { field: 'prompt' },
                Duration: { field: 'music_length_ms' },
              },
              inputBindings: {
                Prompt: 'Input:Prompt',
                Duration: 'Input:Duration',
              },
            },
          },
        },
      });

      const result = await handler.invoke(request);

      expect(result.status).toBe('succeeded');
      expect(result.artefacts).toHaveLength(1);

      const buffer = result.artefacts[0]?.blob?.data as Buffer;
      // WAV generator uses 8kHz mono 8-bit (~8KB/second)
      // 60 seconds = ~480044 bytes (60 * 8000 + 44 header)
      expect(buffer.length).toBeGreaterThan(400_000); // At least 400KB for 60s
      expect(buffer.length).toBeLessThan(600_000); // But less than 600KB
    });

    it('uses default 30 seconds when music_length_ms not provided', async () => {
      const handler = createMusicHandler('simulated');

      const request = createJobContext('music_v1', {
        context: {
          extras: {
            schema: {
              input: JSON.stringify({
                type: 'object',
                properties: { prompt: { type: 'string' } },
                required: ['prompt'],
              }),
            },
            resolvedInputs: { 'Input:Prompt': 'Epic soundtrack' },
            jobContext: {
              sdkMapping: {
                Prompt: { field: 'prompt' },
              },
              inputBindings: {
                Prompt: 'Input:Prompt',
              },
            },
          },
        },
      });

      const result = await handler.invoke(request);

      expect(result.status).toBe('succeeded');
      const buffer = result.artefacts[0]?.blob?.data as Buffer;
      // WAV generator uses 8kHz mono 8-bit (~8KB/second)
      // 30 seconds = ~240044 bytes (30 * 8000 + 44 header)
      expect(buffer.length).toBeGreaterThan(200_000); // At least 200KB for 30s
      expect(buffer.length).toBeLessThan(300_000); // But less than 300KB
    });
  });

  describe('Schema validation (runs in both modes)', () => {
    it('throws when input schema is missing', async () => {
      const handler = createHandler('simulated');

      const request: ProviderJobContext = {
        jobId: 'job-no-schema',
        provider: 'elevenlabs',
        model: 'eleven_v3',
        revision: 'rev-test',
        layerIndex: 0,
        attempt: 1,
        inputs: [],
        produces: ['Artifact:Audio'],
        context: {
          providerConfig: {},
          rawAttachments: [],
          environment: 'local',
          extras: {
            // No schema provided!
          },
        },
      };

      await expect(handler.invoke(request)).rejects.toThrow(/input schema/i);
    });

    it('validates input against schema before mock generation', async () => {
      const handler = createHandler('simulated');

      // The schema requires 'text' but we'll test that validation runs
      // by checking the codepath (buildPayload + validatePayload)
      const request = createJobContext('eleven_v3');

      const result = await handler.invoke(request);

      // If we got here without error, validation passed
      expect(result.status).toBe('succeeded');
    });
  });

  describe('Same codepath as live mode', () => {
    it('shares schema parsing and payload building with live mode', async () => {
      const handler = createHandler('simulated');
      const request = createJobContext('eleven_v3');

      const result = await handler.invoke(request);

      // Diagnostics should show the same input processing happened
      expect(result.diagnostics?.provider).toBe('elevenlabs');
      expect(result.diagnostics?.model).toBe('eleven_v3');
      expect(result.diagnostics?.input).toBeDefined();
      expect((result.diagnostics?.input as Record<string, unknown>)?.text).toBeDefined();
    });

    it('uses same artifact building logic as live mode', async () => {
      const handler = createHandler('simulated');
      const request = createJobContext('eleven_v3', {
        produces: ['Artifact:Audio1', 'Artifact:Audio2', 'Artifact:Audio3'],
      });

      const result = await handler.invoke(request);

      // All artifacts should be produced with correct IDs
      expect(result.artefacts).toHaveLength(3);
      expect(result.artefacts.map((a) => a.artefactId)).toEqual([
        'Artifact:Audio1',
        'Artifact:Audio2',
        'Artifact:Audio3',
      ]);

      // All should have the same blob (they share the audio buffer)
      const sizes = result.artefacts.map((a) => (a.blob?.data as Buffer)?.length);
      expect(sizes[0]).toBe(sizes[1]);
      expect(sizes[1]).toBe(sizes[2]);
    });
  });

  describe('Live mode calls API (for comparison)', () => {
    it('calls API in live mode', async () => {
      mocks.createClient.mockResolvedValue({});
      mocks.invoke.mockResolvedValue({
        audioStream: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([0x49, 0x44, 0x33])); // ID3 header
            controller.close();
          },
        }),
        model: 'eleven_v3',
      });

      const handler = createHandler('live');
      const request = createJobContext('eleven_v3');

      await handler.invoke(request);

      expect(mocks.invoke).toHaveBeenCalledTimes(1);
    });
  });
});
