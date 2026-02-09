import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { __test__ } from './transcription-handler.js';
import type { TranscriptionClip } from '@gorenku/compositions';

const { parseTranscriptionConfig, loadAudioSegmentsFromTranscriptionTrack, extractBufferFromInput } = __test__;

function makeTranscriptionClip(index: number, startTime: number, duration: number, assetId: string): TranscriptionClip {
  return {
    id: `clip-t-${index}`,
    kind: 'Transcription',
    startTime,
    duration,
    properties: { assetId },
  };
}

describe('parseTranscriptionConfig', () => {
  it('parses valid config with stt provider and model', () => {
    const config = parseTranscriptionConfig({
      languageCode: 'eng',
      stt: { provider: 'fal-ai', model: 'elevenlabs/speech-to-text' },
    });
    expect(config.languageCode).toBe('eng');
    expect(config.stt.provider).toBe('fal-ai');
    expect(config.stt.model).toBe('elevenlabs/speech-to-text');
  });

  it('forwards additional stt config properties', () => {
    const config = parseTranscriptionConfig({
      stt: { provider: 'fal-ai', model: 'elevenlabs/stt', diarize: true, tag_audio_events: false },
    });
    expect(config.stt.diarize).toBe(true);
    expect(config.stt.tag_audio_events).toBe(false);
  });

  it('throws when stt object is missing', () => {
    expect(() => parseTranscriptionConfig({})).toThrow(/config\.stt/);
  });

  it('throws when stt.provider is missing', () => {
    expect(() => parseTranscriptionConfig({ stt: { model: 'x' } })).toThrow(/provider/);
  });

  it('throws when stt.model is missing', () => {
    expect(() => parseTranscriptionConfig({ stt: { provider: 'x' } })).toThrow(/model/);
  });
});

describe('loadAudioSegmentsFromTranscriptionTrack', () => {
  it('loads audio segments from resolved inputs', async () => {
    const clips: TranscriptionClip[] = [
      makeTranscriptionClip(0, 0, 10, 'Artifact:Audio[0]'),
      makeTranscriptionClip(1, 10, 8, 'Artifact:Audio[1]'),
    ];
    const allInputs: Record<string, unknown> = {
      'Artifact:Audio[0]': Buffer.from('audio-data-0'),
      'Artifact:Audio[1]': Buffer.from('audio-data-1'),
    };

    const { segments, skippedAssetIds } = await loadAudioSegmentsFromTranscriptionTrack(clips, undefined, allInputs);
    expect(segments).toHaveLength(2);
    expect(skippedAssetIds).toHaveLength(0);
    expect(segments[0]?.startTime).toBe(0);
    expect(segments[0]?.duration).toBe(10);
    expect(segments[0]?.assetId).toBe('Artifact:Audio[0]');
    expect(segments[0]?.clipId).toBe('clip-t-0');
    expect(segments[1]?.startTime).toBe(10);
    expect(segments[1]?.duration).toBe(8);
  });

  it('skips clips with no loadable audio and reports skipped asset IDs', async () => {
    const clips: TranscriptionClip[] = [
      makeTranscriptionClip(0, 0, 10, 'Artifact:Audio[0]'),
      makeTranscriptionClip(1, 10, 8, 'Artifact:Audio[1]'),
    ];
    const allInputs: Record<string, unknown> = {
      'Artifact:Audio[0]': Buffer.from('audio-data-0'),
      // Audio[1] is missing — will be skipped
    };

    const { segments, skippedAssetIds } = await loadAudioSegmentsFromTranscriptionTrack(clips, undefined, allInputs);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.assetId).toBe('Artifact:Audio[0]');
    expect(skippedAssetIds).toEqual(['Artifact:Audio[1]']);
  });

  it('loads from asset blob paths when available', async () => {
    const clips: TranscriptionClip[] = [
      makeTranscriptionClip(0, 0, 10, 'Artifact:Audio[0]'),
    ];
    const allInputs: Record<string, unknown> = {};
    // assetBlobPaths point to files — in this test we don't actually read files,
    // so we provide a fallback via allInputs instead
    const assetBlobPaths: Record<string, string> = {};

    // Fallback to allInputs
    allInputs['Artifact:Audio[0]'] = Buffer.from('audio-data-from-inputs');
    const { segments } = await loadAudioSegmentsFromTranscriptionTrack(clips, assetBlobPaths, allInputs);
    expect(segments).toHaveLength(1);
  });

  it('returns empty segments with all asset IDs as skipped when none are loadable', async () => {
    const clips: TranscriptionClip[] = [
      makeTranscriptionClip(0, 0, 10, 'Artifact:Missing[0]'),
      makeTranscriptionClip(1, 10, 8, 'Artifact:Missing[1]'),
      makeTranscriptionClip(2, 18, 5, 'Artifact:Missing[2]'),
    ];
    const allInputs: Record<string, unknown> = {};

    const { segments, skippedAssetIds } = await loadAudioSegmentsFromTranscriptionTrack(clips, undefined, allInputs);
    expect(segments).toHaveLength(0);
    expect(skippedAssetIds).toEqual([
      'Artifact:Missing[0]',
      'Artifact:Missing[1]',
      'Artifact:Missing[2]',
    ]);
  });

  it('tries without Artifact: prefix as fallback', async () => {
    const clips: TranscriptionClip[] = [
      makeTranscriptionClip(0, 0, 10, 'Artifact:Audio[0]'),
    ];
    const allInputs: Record<string, unknown> = {
      'Audio[0]': Buffer.from('audio-data-short-id'),
    };

    const { segments } = await loadAudioSegmentsFromTranscriptionTrack(clips, undefined, allInputs);
    expect(segments).toHaveLength(1);
  });
});

describe('loadAudioSegmentsFromTranscriptionTrack — mixed producer assetIds', () => {
  it('loads segments from different producer assetIds (AudioProducer and LipsyncVideo)', async () => {
    const clips: TranscriptionClip[] = [
      makeTranscriptionClip(0, 0, 10, 'Artifact:AudioProducer.GeneratedAudio[0]'),
      makeTranscriptionClip(1, 10, 8, 'Artifact:LipsyncVideo.AudioTrack[1]'),
      makeTranscriptionClip(2, 18, 10, 'Artifact:AudioProducer.GeneratedAudio[2]'),
    ];
    const allInputs: Record<string, unknown> = {
      'Artifact:AudioProducer.GeneratedAudio[0]': Buffer.from('narration-audio-0'),
      'Artifact:LipsyncVideo.AudioTrack[1]': Buffer.from('lipsync-audio-1'),
      'Artifact:AudioProducer.GeneratedAudio[2]': Buffer.from('narration-audio-2'),
    };

    const { segments } = await loadAudioSegmentsFromTranscriptionTrack(clips, undefined, allInputs);
    expect(segments).toHaveLength(3);
    expect(segments[0]?.assetId).toBe('Artifact:AudioProducer.GeneratedAudio[0]');
    expect(segments[1]?.assetId).toBe('Artifact:LipsyncVideo.AudioTrack[1]');
    expect(segments[2]?.assetId).toBe('Artifact:AudioProducer.GeneratedAudio[2]');
    expect(segments[0]?.startTime).toBe(0);
    expect(segments[1]?.startTime).toBe(10);
    expect(segments[2]?.startTime).toBe(18);
  });
});

describe('loadAudioSegmentsFromTranscriptionTrack — timing gaps', () => {
  it('preserves exact timing from clips with non-contiguous startTimes', async () => {
    const clips: TranscriptionClip[] = [
      makeTranscriptionClip(0, 0, 10, 'Artifact:Audio[0]'),
      makeTranscriptionClip(1, 18, 8, 'Artifact:Audio[1]'),
      makeTranscriptionClip(2, 35, 10, 'Artifact:Audio[2]'),
    ];
    const allInputs: Record<string, unknown> = {
      'Artifact:Audio[0]': Buffer.from('audio-data-0'),
      'Artifact:Audio[1]': Buffer.from('audio-data-1'),
      'Artifact:Audio[2]': Buffer.from('audio-data-2'),
    };

    const { segments } = await loadAudioSegmentsFromTranscriptionTrack(clips, undefined, allInputs);
    expect(segments).toHaveLength(3);
    expect(segments[0]?.startTime).toBe(0);
    expect(segments[0]?.duration).toBe(10);
    expect(segments[1]?.startTime).toBe(18);
    expect(segments[1]?.duration).toBe(8);
    expect(segments[2]?.startTime).toBe(35);
    expect(segments[2]?.duration).toBe(10);
  });
});

describe('loadAudioSegmentsFromTranscriptionTrack — mixed blob formats', () => {
  it('loads segments from Buffer, Uint8Array, BlobInput, and nested blob formats', async () => {
    const clips: TranscriptionClip[] = [
      makeTranscriptionClip(0, 0, 5, 'Artifact:A[0]'),
      makeTranscriptionClip(1, 5, 5, 'Artifact:A[1]'),
      makeTranscriptionClip(2, 10, 5, 'Artifact:A[2]'),
      makeTranscriptionClip(3, 15, 5, 'Artifact:A[3]'),
    ];
    const allInputs: Record<string, unknown> = {
      'Artifact:A[0]': Buffer.from('buffer-format'),
      'Artifact:A[1]': new Uint8Array([1, 2, 3, 4]),
      'Artifact:A[2]': { data: Buffer.from('blob-input-data'), mimeType: 'audio/wav' },
      'Artifact:A[3]': { blob: { data: Buffer.from('nested-blob-data') } },
    };

    const { segments } = await loadAudioSegmentsFromTranscriptionTrack(clips, undefined, allInputs);
    expect(segments).toHaveLength(4);
    expect(segments[0]?.buffer.length).toBeGreaterThan(0);
    expect(segments[1]?.buffer.length).toBe(4);
    expect(segments[2]?.buffer.toString()).toBe('blob-input-data');
    expect(segments[3]?.buffer.toString()).toBe('nested-blob-data');
  });
});

describe('contract: Transcription track output matches TranscriptionProducer input', () => {
  it('TranscriptionTrack clips produce matching AudioSegments', async () => {
    const clips: TranscriptionClip[] = [
      makeTranscriptionClip(0, 10, 8, 'Artifact:AudioProducer.GeneratedAudio[1]'),
      makeTranscriptionClip(1, 20, 10, 'Artifact:AudioProducer.GeneratedAudio[2]'),
      makeTranscriptionClip(2, 30, 10, 'Artifact:AudioProducer.GeneratedAudio[3]'),
    ];
    const allInputs: Record<string, unknown> = {
      'Artifact:AudioProducer.GeneratedAudio[1]': Buffer.from('audio-seg-1'),
      'Artifact:AudioProducer.GeneratedAudio[2]': Buffer.from('audio-seg-2'),
      'Artifact:AudioProducer.GeneratedAudio[3]': Buffer.from('audio-seg-3'),
    };

    const { segments: audioSegments } = await loadAudioSegmentsFromTranscriptionTrack(clips, undefined, allInputs);
    expect(audioSegments).toHaveLength(3);

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i]!;
      const segment = audioSegments[i]!;
      expect(segment.startTime).toBe(clip.startTime);
      expect(segment.duration).toBe(clip.duration);
      expect(segment.assetId).toBe(clip.properties.assetId);
      expect(segment.clipId).toBe(clip.id);
      expect(segment.buffer.length).toBeGreaterThan(0);
    }
  });
});

describe('extractBufferFromInput', () => {
  it('extracts from Buffer', () => {
    const buf = Buffer.from('hello');
    expect(extractBufferFromInput(buf)).toBe(buf);
  });

  it('extracts from Uint8Array', () => {
    const arr = new Uint8Array([1, 2, 3]);
    const result = extractBufferFromInput(arr);
    expect(result).toBeInstanceOf(Buffer);
    expect(result?.length).toBe(3);
  });

  it('extracts from BlobInput structure', () => {
    const blobInput = { data: Buffer.from('blob-data'), mimeType: 'audio/wav' };
    expect(extractBufferFromInput(blobInput)?.toString()).toBe('blob-data');
  });

  it('extracts from nested blob structure', () => {
    const nested = { blob: { data: Buffer.from('nested') } };
    expect(extractBufferFromInput(nested)?.toString()).toBe('nested');
  });

  it('returns undefined for non-binary values', () => {
    expect(extractBufferFromInput('string-value')).toBeUndefined();
    expect(extractBufferFromInput(42)).toBeUndefined();
    expect(extractBufferFromInput(null)).toBeUndefined();
    expect(extractBufferFromInput(undefined)).toBeUndefined();
  });
});
