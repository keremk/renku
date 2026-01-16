import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import type { ClientOptions, ProviderClient } from '../unified/provider-adapter.js';

/**
 * Mapping of preset voice names to ElevenLabs voice IDs.
 * These are the default voices available in ElevenLabs.
 */
export const VOICE_NAME_MAP: Record<string, string> = {
  // Female voices
  'Rachel': 'EXAVITQu4vr4xnSDxMaL',
  'Aria': 'Xb7hH8MSUJpSbSDYk0k2',
  'Sarah': 'EXAVITQu4vr4xnSDxMaL',
  'Laura': '21m00Tcm4TlvDq8ikWAM',
  'Charlotte': 'XB0fDUnXU5powFXDhCwa',
  'Alice': 'Xb7hH8MSUJpSbSDYk0k2',
  'Matilda': 'XrExE9yKIg1WjnnlVkGX',
  'Jessica': 'cgSgspJ2msm6clMCkdW9',
  'Lily': 'pFZP5JQG7iQjIQuC4Bku',
  // Male voices
  'Roger': 'CwhRBWXzGAHq8TQ4Fs17',
  'Charlie': 'IKne3meq5aSn9XLyUdCD',
  'George': 'JBFqnCBsd6RMkjVDRZzb',
  'Callum': 'N2lVS1w4EtoT3dr4eOWO',
  'River': 'SAz9YHcvj6GT2YYXdXww',
  'Liam': 'TX3LPaxmHKxFdv7VOQHJ',
  'Will': 'bIHbv24MWmeRgasZH58o',
  'Eric': 'cjVigY5qzO86Huf0OWal',
  'Chris': 'iP95p4xoKVk53GoZ742B',
  'Brian': 'nPczCjzI2devNBz1zQrb',
  'Daniel': 'onwK4e9ZLuTAKqWW03F9',
  'Bill': 'pqHfZKP75CvOlQylNhV4',
};

/**
 * Resolve a voice input to a voice ID.
 * Accepts either a voice name (e.g., "Rachel") or a voice ID directly.
 */
export function resolveVoiceId(voiceInput: string): string {
  // If it looks like a voice ID (long alphanumeric string), return as-is
  if (voiceInput.length > 15 && /^[a-zA-Z0-9]+$/.test(voiceInput)) {
    return voiceInput;
  }

  // Try to map from preset voice name
  const mapped = VOICE_NAME_MAP[voiceInput];
  if (mapped) {
    return mapped;
  }

  // Return as-is (might be a custom voice ID or unknown name)
  return voiceInput;
}

/**
 * Create an ElevenLabs client.
 */
export async function createElevenlabsClient(options: ClientOptions): Promise<ProviderClient> {
  if (options.mode === 'simulated') {
    return createSimulatedStub();
  }

  const apiKey = await options.secretResolver.getSecret('ELEVENLABS_API_KEY');
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY is required to use the ElevenLabs provider.');
  }

  return new ElevenLabsClient({ apiKey });
}

/**
 * Creates a stub client for simulated mode.
 * This should never be called - the handler generates mock output instead.
 */
function createSimulatedStub(): ProviderClient {
  return {
    textToSpeech: {
      convert() {
        throw new Error(
          'ElevenLabs stub client was called in simulated mode. ' +
          'This indicates a bug - the handler should generate mock audio.'
        );
      },
    },
    music: {
      compose() {
        throw new Error(
          'ElevenLabs stub client was called in simulated mode. ' +
          'This indicates a bug - the handler should generate mock audio.'
        );
      },
    },
  } as unknown as ProviderClient;
}
