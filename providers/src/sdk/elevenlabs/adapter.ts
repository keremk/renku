import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import type {
  ProviderAdapter,
  ProviderClient,
  ClientOptions,
  UnifiedInvokeResult,
} from '../unified/provider-adapter.js';
import { createElevenlabsClient, resolveVoiceId } from './client.js';
import { generateWavWithDuration } from '../unified/wav-generator.js';
import { estimateTTSDuration, extractMusicDuration } from './output.js';
import { isSimulatedProviderClient } from '../unified/simulated-client.js';
import { createProviderError, SdkErrorCode } from '../errors.js';

/**
 * Voice settings for ElevenLabs TTS.
 */
interface VoiceSettings {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  speed?: number;
  use_speaker_boost?: boolean;
}

/**
 * ElevenLabs provider adapter for the unified handler.
 *
 * Note: ElevenLabs returns binary audio streams directly, not URLs.
 * The custom handler (createElevenlabsHandler) collects the stream
 * into a buffer and returns it as artifact data.
 */
export const elevenlabsAdapter: ProviderAdapter = {
  name: 'elevenlabs',
  secretKey: 'ELEVENLABS_API_KEY',

  async createClient(options: ClientOptions): Promise<ProviderClient> {
    return createElevenlabsClient(options);
  },

  formatModelIdentifier(model: string): string {
    // ElevenLabs uses simple model names like "eleven_v3", "eleven_multilingual_v2"
    return model;
  },

  async invoke(
    client: ProviderClient,
    model: string,
    input: Record<string, unknown>
  ): Promise<UnifiedInvokeResult> {
    if (isSimulatedProviderClient(client)) {
      const audioBuffer = generateWavWithDuration(
        estimateDuration(model, input)
      );
      return {
        result: {
          audioStream: createAudioStream(audioBuffer),
          model,
        },
      };
    }

    const elevenlabs = client as ElevenLabsClient;

    if (model === 'music_v1') {
      // Music generation
      const audioStream = await elevenlabs.music.compose({
        prompt: input.prompt as string,
        musicLengthMs: input.music_length_ms as number | undefined,
        modelId: 'music_v1',
        forceInstrumental: input.force_instrumental as boolean | undefined,
      });
      return { result: { audioStream, model } };
    } else {
      // TTS generation
      const rawVoice = input.voice;
      if (typeof rawVoice !== 'string' || rawVoice.trim().length === 0) {
        throw createProviderError(
          SdkErrorCode.MISSING_REQUIRED_INPUT,
          'Missing required ElevenLabs voice input "voice". Provide it through the mapped VoiceId input or the model config field "voice".',
          {
            kind: 'user_input',
            causedByUser: true,
            metadata: {
              model,
            },
          }
        );
      }

      const voiceId = resolveVoiceId(rawVoice);
      const voiceSettings = input.voice_settings as VoiceSettings | undefined;

      // Build voice settings object if provided
      const apiVoiceSettings = voiceSettings ? {
        stability: voiceSettings.stability,
        similarityBoost: voiceSettings.similarity_boost,
        style: voiceSettings.style,
        speed: voiceSettings.speed,
        useSpeakerBoost: voiceSettings.use_speaker_boost,
      } : undefined;

      const audioStream = await elevenlabs.textToSpeech.convert(voiceId, {
        text: input.text as string,
        modelId: model,
        outputFormat: (input.output_format as 'mp3_44100_128' | undefined) ?? 'mp3_44100_128',
        voiceSettings: apiVoiceSettings,
      });
      return { result: { audioStream, model } };
    }
  },

  normalizeOutput(_response: unknown): string[] {
    // ElevenLabs returns binary streams, not URLs.
    // The custom handler handles the binary data directly.
    // Return empty array since we don't use URL-based artifact building.
    return [];
  },
};

function estimateDuration(model: string, input: Record<string, unknown>): number {
  if (model === 'music_v1') {
    return extractMusicDuration(input);
  }

  const text = input.text;
  if (typeof text === 'string') {
    return estimateTTSDuration(text);
  }

  return 5;
}

function createAudioStream(buffer: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    },
  });
}
