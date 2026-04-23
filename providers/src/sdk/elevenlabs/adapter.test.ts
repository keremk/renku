import { describe, expect, it, vi } from 'vitest';
import { elevenlabsAdapter } from './adapter.js';
import { SdkErrorCode } from '../errors.js';
import { createSimulatedProviderClient } from '../unified/simulated-client.js';

describe('elevenlabsAdapter', () => {
  it('fails fast with a provider error when TTS voice is missing', async () => {
    const client = {
      textToSpeech: {
        convert: vi.fn(),
      },
      music: {
        compose: vi.fn(),
      },
    };

    await expect(
      elevenlabsAdapter.invoke(
        client as never,
        'eleven_v3',
        { text: 'Hello world' }
      )
    ).rejects.toMatchObject({
      code: SdkErrorCode.MISSING_REQUIRED_INPUT,
      message:
        'Missing required ElevenLabs voice input "voice". Provide it through the mapped VoiceId input or the model config field "voice".',
    });

    expect(client.textToSpeech.convert).not.toHaveBeenCalled();
  });

  it('passes the resolved voice to ElevenLabs when provided', async () => {
    const convert = vi.fn().mockResolvedValue(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      })
    );
    const client = {
      textToSpeech: {
        convert,
      },
      music: {
        compose: vi.fn(),
      },
    };

    const result = await elevenlabsAdapter.invoke(
      client as never,
      'eleven_v3',
      {
        text: 'Hello world',
        voice: 'Rachel',
      }
    );

    expect(convert).toHaveBeenCalledWith(
      'EXAVITQu4vr4xnSDxMaL',
      expect.objectContaining({
        text: 'Hello world',
        modelId: 'eleven_v3',
      })
    );
    expect(result).toEqual({
      result: {
        audioStream: expect.any(ReadableStream),
        model: 'eleven_v3',
      },
    });
  });

  it('fails fast with the same provider error in simulated mode when TTS voice is missing', async () => {
    await expect(
      elevenlabsAdapter.invoke(
        createSimulatedProviderClient('elevenlabs'),
        'eleven_v3',
        { text: 'Hello world' }
      )
    ).rejects.toMatchObject({
      code: SdkErrorCode.MISSING_REQUIRED_INPUT,
      message:
        'Missing required ElevenLabs voice input "voice". Provide it through the mapped VoiceId input or the model config field "voice".',
    });
  });
});
