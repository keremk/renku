import { createProviderError, SdkErrorCode } from '../../sdk/errors.js';
import type {
  SttNormalizerAdapter,
  TimestampedTranscript,
  TimestampedTranscriptWord,
} from './types.js';

interface ElevenLabsWord {
  text?: unknown;
  start?: unknown;
  end?: unknown;
  type?: unknown;
}

interface ElevenLabsOutput {
  text?: unknown;
  language_code?: unknown;
  words?: unknown;
}

const SPOKEN_WORD_TYPE = 'word';

const elevenlabsWordTimestampsAdapter: SttNormalizerAdapter = {
  id: 'elevenlabs-word-timestamps-v1',
  normalize(raw: unknown): TimestampedTranscript {
    if (!isRecord(raw)) {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        'STT normalizer expected the raw transcription payload to be an object.',
        { kind: 'user_input', causedByUser: true },
      );
    }

    const payload = raw as ElevenLabsOutput;
    if (typeof payload.text !== 'string') {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        'ElevenLabs raw transcription is missing a string "text" field.',
        { kind: 'user_input', causedByUser: true },
      );
    }
    if (typeof payload.language_code !== 'string') {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        'ElevenLabs raw transcription is missing a string "language_code" field.',
        { kind: 'user_input', causedByUser: true },
      );
    }
    if (!Array.isArray(payload.words)) {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        'ElevenLabs raw transcription is missing a "words" array.',
        { kind: 'user_input', causedByUser: true },
      );
    }

    const words: TimestampedTranscriptWord[] = payload.words
      .filter((entry) => isSpokenWord(entry))
      .map((entry) => normalizeElevenLabsWord(entry));

    const sourceDuration = words.length > 0
      ? words[words.length - 1]!.endTime
      : 0;

    return {
      text: payload.text,
      language: payload.language_code,
      words,
      sourceDuration,
    };
  },
};

const NORMALIZER_ADAPTERS = new Map<string, SttNormalizerAdapter>([
  [elevenlabsWordTimestampsAdapter.id, elevenlabsWordTimestampsAdapter],
]);

export function resolveSttNormalizerAdapter(
  adapterId: string,
): SttNormalizerAdapter {
  const adapter = NORMALIZER_ADAPTERS.get(adapterId);
  if (!adapter) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      `STT normalizer adapter "${adapterId}" is not registered.`,
      { kind: 'user_input', causedByUser: true, metadata: { adapterId } },
    );
  }
  return adapter;
}

function normalizeElevenLabsWord(raw: unknown): TimestampedTranscriptWord {
  if (!isRecord(raw)) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      'ElevenLabs word entries must be objects.',
      { kind: 'user_input', causedByUser: true },
    );
  }

  const word = raw as ElevenLabsWord;
  if (typeof word.text !== 'string' || word.text.trim().length === 0) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      'ElevenLabs word entries must include non-empty text.',
      { kind: 'user_input', causedByUser: true, metadata: { word } },
    );
  }
  if (typeof word.start !== 'number' || Number.isNaN(word.start)) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      'ElevenLabs word entries must include a numeric "start" time in seconds.',
      { kind: 'user_input', causedByUser: true, metadata: { word } },
    );
  }
  if (typeof word.end !== 'number' || Number.isNaN(word.end)) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      'ElevenLabs word entries must include a numeric "end" time in seconds.',
      { kind: 'user_input', causedByUser: true, metadata: { word } },
    );
  }
  if (word.end < word.start) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      'ElevenLabs word entries must have end >= start.',
      { kind: 'user_input', causedByUser: true, metadata: { word } },
    );
  }

  return {
    text: word.text,
    startTime: word.start,
    endTime: word.end,
  };
}

function isSpokenWord(raw: unknown): boolean {
  if (!isRecord(raw)) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      'ElevenLabs word entries must be objects.',
      { kind: 'user_input', causedByUser: true, metadata: { raw } },
    );
  }

  const type = raw.type;
  if (typeof type !== 'string') {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      'ElevenLabs word entries must include a string "type" field.',
      { kind: 'user_input', causedByUser: true, metadata: { raw } },
    );
  }

  return type === SPOKEN_WORD_TYPE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
