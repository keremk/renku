import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import type { ProviderAdapter, ProviderClient, ClientOptions } from '../unified/provider-adapter.js';
import { createElevenlabsClient, resolveVoiceId } from './client.js';

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

  async invoke(client: ProviderClient, model: string, input: Record<string, unknown>): Promise<unknown> {
    const elevenlabs = client as ElevenLabsClient;

    if (model === 'music_v1') {
      // Music generation
      const audioStream = await elevenlabs.music.compose({
        prompt: input.prompt as string,
        musicLengthMs: input.music_length_ms as number | undefined,
        modelId: 'music_v1',
        forceInstrumental: input.force_instrumental as boolean | undefined,
      });
      return { audioStream, model };
    } else {
      // TTS generation
      const voiceId = resolveVoiceId(input.voice as string);
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
      return { audioStream, model };
    }
  },

  normalizeOutput(_response: unknown): string[] {
    // ElevenLabs returns binary streams, not URLs.
    // The custom handler handles the binary data directly.
    // Return empty array since we don't use URL-based artifact building.
    return [];
  },
};
