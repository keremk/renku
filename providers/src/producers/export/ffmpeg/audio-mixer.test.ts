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

    it('should NOT apply atrim for non-looped audio with startTime > 0', () => {
      // This is critical: applying atrim AFTER adelay would cut off most of the audio
      // because atrim=0:duration would trim the delayed stream, keeping mostly silence.
      // The audio file duration already matches the segment duration since audio is master.
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

      // The second track (aud1) should have adelay but NOT atrim
      const secondTrackFilter = filterParts.find(f => f.includes('[aud1]'));
      expect(secondTrackFilter).toContain('adelay=12000|12000');
      // Ensure no atrim is present for the second track
      expect(secondTrackFilter).not.toContain('atrim');

      // The first track should also NOT have atrim since it's not looped
      const firstTrackFilter = filterParts.find(f => f.includes('[aud0]'));
      expect(firstTrackFilter).not.toContain('atrim');
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
