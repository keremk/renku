import { describe, it, expect } from 'vitest';
import {
  findClipForTimestamp,
  extractTextForClip,
  alignTranscriptionToTimeline,
} from './timestamp-aligner.js';
import type { AudioSegment, STTOutput } from './types.js';

describe('timestamp-aligner', () => {
  describe('findClipForTimestamp', () => {
    const clips: AudioSegment[] = [
      { buffer: Buffer.alloc(0), startTime: 0, duration: 5, clipId: 'clip-1', assetId: 'asset-1' },
      { buffer: Buffer.alloc(0), startTime: 7, duration: 3, clipId: 'clip-2', assetId: 'asset-2' },
      { buffer: Buffer.alloc(0), startTime: 12, duration: 4, clipId: 'clip-3', assetId: 'asset-3' },
    ];

    it('finds correct clip for timestamp within clip bounds', () => {
      expect(findClipForTimestamp(2, clips)).toBe('clip-1');
      expect(findClipForTimestamp(0, clips)).toBe('clip-1');
      expect(findClipForTimestamp(4.9, clips)).toBe('clip-1');
    });

    it('finds correct clip for timestamp in second clip', () => {
      expect(findClipForTimestamp(7, clips)).toBe('clip-2');
      expect(findClipForTimestamp(8.5, clips)).toBe('clip-2');
    });

    it('finds correct clip for timestamp in third clip', () => {
      expect(findClipForTimestamp(12, clips)).toBe('clip-3');
      expect(findClipForTimestamp(15, clips)).toBe('clip-3');
    });

    it('returns last clip for timestamp beyond all clips', () => {
      expect(findClipForTimestamp(100, clips)).toBe('clip-3');
    });

    it('returns last clip for timestamp in gap between clips', () => {
      // Timestamp 6 is in the gap between clip-1 (ends at 5) and clip-2 (starts at 7)
      // Returns last clip since no clip contains this timestamp
      expect(findClipForTimestamp(6, clips)).toBe('clip-3');
    });

    it('returns empty string for empty clips array', () => {
      expect(findClipForTimestamp(5, [])).toBe('');
    });
  });

  describe('extractTextForClip', () => {
    const words = [
      { text: 'Hello', startTime: 0, endTime: 0.5, clipId: 'clip-1' },
      { text: 'world', startTime: 0.5, endTime: 1, clipId: 'clip-1' },
      { text: 'This', startTime: 5, endTime: 5.5, clipId: 'clip-2' },
      { text: 'is', startTime: 5.5, endTime: 6, clipId: 'clip-2' },
      { text: 'great', startTime: 10, endTime: 10.5, clipId: 'clip-3' },
    ];

    it('extracts words that belong to a specific clip', () => {
      const clip: AudioSegment = {
        buffer: Buffer.alloc(0),
        startTime: 0,
        duration: 3,
        clipId: 'clip-1',
        assetId: 'asset-1',
      };

      const text = extractTextForClip(words, clip);
      expect(text).toBe('Hello world');
    });

    it('extracts words for second clip', () => {
      const clip: AudioSegment = {
        buffer: Buffer.alloc(0),
        startTime: 5,
        duration: 3,
        clipId: 'clip-2',
        assetId: 'asset-2',
      };

      const text = extractTextForClip(words, clip);
      expect(text).toBe('This is');
    });

    it('returns empty string for clip with no words', () => {
      const clip: AudioSegment = {
        buffer: Buffer.alloc(0),
        startTime: 20,
        duration: 3,
        clipId: 'clip-4',
        assetId: 'asset-4',
      };

      const text = extractTextForClip(words, clip);
      expect(text).toBe('');
    });
  });

  describe('alignTranscriptionToTimeline', () => {
    const sttResult: STTOutput = {
      text: 'Hello world',
      language_code: 'eng',
      language_probability: 1,
      words: [
        { text: 'Hello', start: 0.1, end: 0.5, type: 'word', speaker_id: null },
        { text: ' ', start: 0.5, end: 0.6, type: 'spacing', speaker_id: null },
        { text: 'world', start: 0.6, end: 1.0, type: 'word', speaker_id: null },
        { text: ' ', start: 1.0, end: 1.1, type: 'spacing', speaker_id: null },
        { text: '(laughs)', start: 1.1, end: 1.5, type: 'audio_event', speaker_id: null },
      ],
    };

    const audioClips: AudioSegment[] = [
      {
        buffer: Buffer.alloc(0),
        startTime: 0,
        duration: 2,
        clipId: 'clip-1',
        assetId: 'asset-1',
      },
    ];

    it('filters out spacing elements', () => {
      const result = alignTranscriptionToTimeline(sttResult, audioClips);
      expect(result.words.length).toBe(2);
      expect(result.words.map(w => w.text)).toEqual(['Hello', 'world']);
    });

    it('filters out audio_event elements', () => {
      const result = alignTranscriptionToTimeline(sttResult, audioClips);
      const audioEvents = result.words.filter(w => w.text === '(laughs)');
      expect(audioEvents.length).toBe(0);
    });

    it('assigns correct timestamps to words', () => {
      const result = alignTranscriptionToTimeline(sttResult, audioClips);
      expect(result.words[0]?.startTime).toBe(0.1);
      expect(result.words[0]?.endTime).toBe(0.5);
      expect(result.words[1]?.startTime).toBe(0.6);
      expect(result.words[1]?.endTime).toBe(1.0);
    });

    it('assigns correct clip IDs to words', () => {
      const result = alignTranscriptionToTimeline(sttResult, audioClips);
      expect(result.words[0]?.clipId).toBe('clip-1');
      expect(result.words[1]?.clipId).toBe('clip-1');
    });

    it('builds segments with text per clip', () => {
      const result = alignTranscriptionToTimeline(sttResult, audioClips);
      expect(result.segments.length).toBe(1);
      expect(result.segments[0]?.clipId).toBe('clip-1');
      expect(result.segments[0]?.text).toBe('Hello world');
    });

    it('preserves language code', () => {
      const result = alignTranscriptionToTimeline(sttResult, audioClips);
      expect(result.language).toBe('eng');
    });

    it('calculates total duration from last word', () => {
      const result = alignTranscriptionToTimeline(sttResult, audioClips);
      expect(result.totalDuration).toBe(1.0);
    });

    it('handles empty STT result', () => {
      const emptyResult: STTOutput = {
        text: '',
        language_code: 'eng',
        language_probability: 1,
        words: [],
      };

      const result = alignTranscriptionToTimeline(emptyResult, audioClips);
      expect(result.words.length).toBe(0);
      expect(result.segments.length).toBe(1);
      expect(result.segments[0]?.text).toBe('');
    });
  });
});
