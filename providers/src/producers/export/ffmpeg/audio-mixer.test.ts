import { describe, it, expect } from 'vitest';
import {
  buildAudioMixFilter,
  buildAudioInputArgs,
  buildLoopedAudioInputArgs,
  calculateLoopsNeeded,
} from './audio-mixer.js';
import type { AudioTrackInfo } from './types.js';

describe('audio-mixer', () => {
  describe('buildAudioMixFilter', () => {
    it('should generate silence when no tracks provided', () => {
      const result = buildAudioMixFilter([], { totalDuration: 10 });

      expect(result.filterExpr).toContain('anullsrc');
      expect(result.filterExpr).toContain('atrim=0:10');
      expect(result.outputLabel).toBe('aout');
    });

    it('should build filter for single audio track', () => {
      const tracks: AudioTrackInfo[] = [
        {
          inputIndex: 0,
          volume: 1,
          startTime: 0,
          duration: 5,
        },
      ];

      const result = buildAudioMixFilter(tracks, { totalDuration: 5 });

      expect(result.filterExpr).toContain('[0:a]');
      expect(result.filterExpr).toContain('[aud0]');
      expect(result.filterExpr).toContain('amix=inputs=1');
      expect(result.filterExpr).toContain('atrim=0:5');
      expect(result.outputLabel).toBe('aout');
    });

    it('should apply volume adjustment', () => {
      const tracks: AudioTrackInfo[] = [
        {
          inputIndex: 0,
          volume: 0.5,
          startTime: 0,
          duration: 5,
        },
      ];

      const result = buildAudioMixFilter(tracks, { totalDuration: 5 });

      expect(result.filterExpr).toContain('volume=0.5');
    });

    it('should apply delay for non-zero start time', () => {
      const tracks: AudioTrackInfo[] = [
        {
          inputIndex: 0,
          volume: 1,
          startTime: 2.5,
          duration: 5,
        },
      ];

      const result = buildAudioMixFilter(tracks, { totalDuration: 10 });

      // 2.5 seconds = 2500ms
      expect(result.filterExpr).toContain('adelay=2500|2500');
    });

    it('should apply fade in effect', () => {
      const tracks: AudioTrackInfo[] = [
        {
          inputIndex: 0,
          volume: 1,
          startTime: 0,
          duration: 10,
          fadeInDuration: 2,
        },
      ];

      const result = buildAudioMixFilter(tracks, { totalDuration: 10 });

      expect(result.filterExpr).toContain('afade=t=in:st=0:d=2');
    });

    it('should apply fade out effect', () => {
      const tracks: AudioTrackInfo[] = [
        {
          inputIndex: 0,
          volume: 1,
          startTime: 0,
          duration: 10,
          fadeOutDuration: 3,
        },
      ];

      const result = buildAudioMixFilter(tracks, { totalDuration: 10 });

      // Fade out starts at 10 - 3 = 7 seconds
      expect(result.filterExpr).toContain('afade=t=out:st=7:d=3');
    });

    it('should handle looped audio tracks', () => {
      const tracks: AudioTrackInfo[] = [
        {
          inputIndex: 0,
          volume: 0.3,
          startTime: 0,
          duration: 30,
          loop: true,
        },
      ];

      const result = buildAudioMixFilter(tracks, { totalDuration: 30 });

      expect(result.filterExpr).toContain('aloop=loop=-1');
      expect(result.filterExpr).toContain('atrim=0:30');
    });

    it('should mix multiple audio tracks', () => {
      const tracks: AudioTrackInfo[] = [
        {
          inputIndex: 0,
          volume: 1,
          startTime: 0,
          duration: 10,
        },
        {
          inputIndex: 1,
          volume: 0.3,
          startTime: 0,
          duration: 10,
          loop: true,
        },
      ];

      const result = buildAudioMixFilter(tracks, { totalDuration: 10 });

      expect(result.filterExpr).toContain('[0:a]');
      expect(result.filterExpr).toContain('[1:a]');
      expect(result.filterExpr).toContain('[aud0][aud1]amix=inputs=2');
    });

    it('should normalize output when requested', () => {
      const tracks: AudioTrackInfo[] = [
        {
          inputIndex: 0,
          volume: 1,
          startTime: 0,
          duration: 5,
        },
      ];

      const result = buildAudioMixFilter(tracks, { totalDuration: 5, normalize: true });

      expect(result.filterExpr).toContain('normalize=1');
    });

    it('should not normalize by default', () => {
      const tracks: AudioTrackInfo[] = [
        {
          inputIndex: 0,
          volume: 1,
          startTime: 0,
          duration: 5,
        },
      ];

      const result = buildAudioMixFilter(tracks, { totalDuration: 5 });

      expect(result.filterExpr).toContain('normalize=0');
    });

    it('should handle multiple tracks with different start times', () => {
      const tracks: AudioTrackInfo[] = [
        {
          inputIndex: 0,
          volume: 1,
          startTime: 0,
          duration: 5,
        },
        {
          inputIndex: 1,
          volume: 1,
          startTime: 5,
          duration: 5,
        },
        {
          inputIndex: 2,
          volume: 1,
          startTime: 10,
          duration: 5,
        },
      ];

      const result = buildAudioMixFilter(tracks, { totalDuration: 15 });

      // First track has no delay
      expect(result.filterExpr).not.toMatch(/\[0:a\].*adelay=0/);
      // Second track starts at 5 seconds
      expect(result.filterExpr).toContain('adelay=5000|5000');
      // Third track starts at 10 seconds
      expect(result.filterExpr).toContain('adelay=10000|10000');
      // All three tracks mixed
      expect(result.filterExpr).toContain('amix=inputs=3');
    });

    it('should apply atrim BEFORE adelay for non-looped audio to trim to scheduled duration', () => {
      // All clips are trimmed to their scheduled duration BEFORE being delayed.
      // This ensures clips play for exactly their scheduled time, even if the
      // source file is longer (e.g., music clips reusing the same file to fill timeline)
      const tracks: AudioTrackInfo[] = [
        {
          inputIndex: 0,
          volume: 1,
          startTime: 0,
          duration: 12,
        },
        {
          inputIndex: 1,
          volume: 1,
          startTime: 12,
          duration: 13,
        },
      ];

      const result = buildAudioMixFilter(tracks, { totalDuration: 25 });

      // Parse the filter expression to check each track's filter chain
      const filterParts = result.filterExpr.split(';');

      // The first track should have atrim with its duration
      const firstTrackFilter = filterParts.find(f => f.includes('[aud0]'));
      expect(firstTrackFilter).toContain('atrim=0:12');

      // The second track should have atrim BEFORE adelay
      const secondTrackFilter = filterParts.find(f => f.includes('[aud1]'));
      expect(secondTrackFilter).toContain('atrim=0:13');
      expect(secondTrackFilter).toContain('adelay=12000|12000');

      // Verify atrim comes before adelay (important for correct trimming)
      const atrimIndex = secondTrackFilter!.indexOf('atrim');
      const adelayIndex = secondTrackFilter!.indexOf('adelay');
      expect(atrimIndex).toBeLessThan(adelayIndex);
    });

    it('should trim non-looped music clips to their scheduled duration', () => {
      // This test verifies the fix for music clips that reuse the same file
      // (e.g., 20s music file used twice, with second clip only needing 5s)
      const tracks: AudioTrackInfo[] = [
        {
          inputIndex: 0,
          volume: 0.3,
          startTime: 0,
          duration: 20, // First play of full music file
        },
        {
          inputIndex: 1,
          volume: 0.3,
          startTime: 20,
          duration: 5, // Second instance, only needs 5 seconds
        },
      ];

      const result = buildAudioMixFilter(tracks, { totalDuration: 25 });

      // Both tracks should be trimmed to their scheduled duration
      expect(result.filterExpr).toContain('atrim=0:20');
      expect(result.filterExpr).toContain('atrim=0:5');
    });
  });

  describe('buildAudioInputArgs', () => {
    it('should build simple input arguments', () => {
      const result = buildAudioInputArgs('/path/to/audio.mp3');

      expect(result).toEqual(['-i', '/path/to/audio.mp3']);
    });
  });

  describe('buildLoopedAudioInputArgs', () => {
    it('should build looped input arguments with infinite loop', () => {
      const result = buildLoopedAudioInputArgs('/path/to/music.mp3');

      expect(result).toEqual(['-stream_loop', '-1', '-i', '/path/to/music.mp3']);
    });

    it('should build looped input arguments with specific loop count', () => {
      const result = buildLoopedAudioInputArgs('/path/to/music.mp3', 3);

      expect(result).toEqual(['-stream_loop', '3', '-i', '/path/to/music.mp3']);
    });
  });

  describe('calculateLoopsNeeded', () => {
    it('should calculate correct number of loops', () => {
      // 10 second music, 30 second video = need 3 loops
      expect(calculateLoopsNeeded(10, 30)).toBe(3);
    });

    it('should round up for partial loops', () => {
      // 10 second music, 25 second video = need 3 loops
      expect(calculateLoopsNeeded(10, 25)).toBe(3);
    });

    it('should handle exact division', () => {
      // 10 second music, 20 second video = need 2 loops
      expect(calculateLoopsNeeded(10, 20)).toBe(2);
    });

    it('should return 0 for zero music duration', () => {
      expect(calculateLoopsNeeded(0, 30)).toBe(0);
    });

    it('should handle music longer than target', () => {
      // 30 second music, 10 second video = need 1 loop (will be trimmed)
      expect(calculateLoopsNeeded(30, 10)).toBe(1);
    });
  });
});
