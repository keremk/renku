import { describe, it, expect } from 'vitest';
import { buildMixCommand } from './audio-concatenator.js';
import type { AudioSegment } from './types.js';

describe('audio-concatenator', () => {
  describe('buildMixCommand', () => {
    const tempDir = '/tmp/test-dir';

    it('generates correct ffmpeg args for single segment', () => {
      const segments: AudioSegment[] = [
        { buffer: Buffer.alloc(0), startTime: 0, duration: 5, clipId: 'clip-1', assetId: 'asset-1' },
      ];
      const segmentFiles = ['/tmp/test-dir/segment-0.mp3'];

      const args = buildMixCommand(segmentFiles, segments, 10, tempDir);

      // Should have silence input and segment input
      expect(args).toContain('-f');
      expect(args).toContain('lavfi');
      expect(args).toContain('-i');

      // Should have filter_complex
      expect(args).toContain('-filter_complex');

      // Should output WAV
      expect(args).toContain('-acodec');
      expect(args).toContain('pcm_s16le');
      expect(args).toContain('-f');
      expect(args).toContain('wav');

      // Should have output path
      expect(args).toContain('/tmp/test-dir/output.wav');
    });

    it('generates correct ffmpeg args for multiple segments', () => {
      const segments: AudioSegment[] = [
        { buffer: Buffer.alloc(0), startTime: 0, duration: 5, clipId: 'clip-1', assetId: 'asset-1' },
        { buffer: Buffer.alloc(0), startTime: 7, duration: 3, clipId: 'clip-2', assetId: 'asset-2' },
      ];
      const segmentFiles = [
        '/tmp/test-dir/segment-0.mp3',
        '/tmp/test-dir/segment-1.mp3',
      ];

      const args = buildMixCommand(segmentFiles, segments, 15, tempDir);

      // Should have multiple inputs (silence + 2 segments)
      const inputCount = args.filter(a => a === '-i').length;
      expect(inputCount).toBeGreaterThanOrEqual(3);

      // Check for adelay filters in filter_complex
      const filterComplexIndex = args.indexOf('-filter_complex');
      expect(filterComplexIndex).toBeGreaterThan(-1);

      const filterComplex = args[filterComplexIndex + 1] ?? '';
      // First segment has 0 delay
      expect(filterComplex).toContain('adelay=0|0');
      // Second segment has 7000ms delay
      expect(filterComplex).toContain('adelay=7000|7000');

      // Should have amix for combining
      expect(filterComplex).toContain('amix=inputs=3');
    });

    it('generates correct delay values for segments', () => {
      const segments: AudioSegment[] = [
        { buffer: Buffer.alloc(0), startTime: 2.5, duration: 3, clipId: 'clip-1', assetId: 'asset-1' },
      ];
      const segmentFiles = ['/tmp/test-dir/segment-0.mp3'];

      const args = buildMixCommand(segmentFiles, segments, 10, tempDir);

      const filterComplexIndex = args.indexOf('-filter_complex');
      const filterComplex = args[filterComplexIndex + 1] ?? '';

      // Delay should be 2500ms (2.5 seconds * 1000)
      expect(filterComplex).toContain('adelay=2500|2500');
    });

    it('handles empty segment list', () => {
      const segments: AudioSegment[] = [];
      const segmentFiles: string[] = [];

      const args = buildMixCommand(segmentFiles, segments, 10, tempDir);

      // Should still generate a valid command with just silence
      expect(args).toContain('-filter_complex');
      expect(args).toContain('/tmp/test-dir/output.wav');
    });

    it('includes sample rate normalization in filters', () => {
      const segments: AudioSegment[] = [
        { buffer: Buffer.alloc(0), startTime: 0, duration: 5, clipId: 'clip-1', assetId: 'asset-1' },
      ];
      const segmentFiles = ['/tmp/test-dir/segment-0.mp3'];

      const args = buildMixCommand(segmentFiles, segments, 10, tempDir);

      const filterComplexIndex = args.indexOf('-filter_complex');
      const filterComplex = args[filterComplexIndex + 1] ?? '';

      // Should have aformat filter for sample rate normalization
      expect(filterComplex).toContain('aformat=sample_rates=16000');
      expect(filterComplex).toContain('channel_layouts=mono');
    });

    it('uses correct amix options', () => {
      const segments: AudioSegment[] = [
        { buffer: Buffer.alloc(0), startTime: 0, duration: 5, clipId: 'clip-1', assetId: 'asset-1' },
        { buffer: Buffer.alloc(0), startTime: 7, duration: 3, clipId: 'clip-2', assetId: 'asset-2' },
      ];
      const segmentFiles = [
        '/tmp/test-dir/segment-0.mp3',
        '/tmp/test-dir/segment-1.mp3',
      ];

      const args = buildMixCommand(segmentFiles, segments, 15, tempDir);

      const filterComplexIndex = args.indexOf('-filter_complex');
      const filterComplex = args[filterComplexIndex + 1] ?? '';

      // Should use longest duration and no dropout transition
      expect(filterComplex).toContain('duration=longest');
      expect(filterComplex).toContain('dropout_transition=0');
    });
  });
});
