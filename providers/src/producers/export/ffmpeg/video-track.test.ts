import { describe, it, expect } from 'vitest';
import {
  buildVideoFilterChain,
  buildFreezeFadeFilterChain,
  buildVideoFilter,
  buildVideoInputArgs,
  calculateSpeedFactor,
  determineFitStrategy,
  buildVideoAudioFilter,
} from './video-track.js';
import type { VideoClipInfo } from './types.js';

describe('video-track', () => {
  const defaultOptions = {
    width: 1920,
    height: 1080,
    fps: 30,
  };

  describe('buildVideoFilterChain', () => {
    it('should build a basic video filter chain', () => {
      const clip: VideoClipInfo = {
        inputIndex: 0,
        startTime: 0,
        targetDuration: 10,
        fitStrategy: 'stretch',
      };

      const result = buildVideoFilterChain(clip, defaultOptions, 'vid0');

      expect(result).toMatch(/^\[0:v\]/);
      expect(result).toContain('scale=1920:1080:force_original_aspect_ratio=decrease');
      expect(result).toContain('pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black');
      expect(result).toContain('fps=30');
      expect(result).toContain('format=yuv420p');
      expect(result).toMatch(/\[vid0\]$/);
    });

    it('should apply speed adjustment for stretch strategy', () => {
      const clip: VideoClipInfo = {
        inputIndex: 0,
        startTime: 0,
        targetDuration: 10,
        originalDuration: 8, // Video is 8s, needs to stretch to 10s
        fitStrategy: 'stretch',
      };

      const result = buildVideoFilterChain(clip, defaultOptions, 'vid0');

      // Speed factor = 8/10 = 0.8, so setpts=PTS/0.8
      expect(result).toContain('setpts=PTS/0.8');
    });

    it('should not apply speed adjustment when durations match', () => {
      const clip: VideoClipInfo = {
        inputIndex: 0,
        startTime: 0,
        targetDuration: 10,
        originalDuration: 10,
        fitStrategy: 'stretch',
      };

      const result = buildVideoFilterChain(clip, defaultOptions, 'vid0');

      // No speed adjustment needed
      expect(result).not.toContain('setpts=PTS/');
    });

    it('should speed up video when longer than target', () => {
      const clip: VideoClipInfo = {
        inputIndex: 0,
        startTime: 0,
        targetDuration: 10,
        originalDuration: 15, // Video is 15s, needs to compress to 10s
        fitStrategy: 'stretch',
      };

      const result = buildVideoFilterChain(clip, defaultOptions, 'vid0');

      // Speed factor = 15/10 = 1.5, so setpts=PTS/1.5
      expect(result).toContain('setpts=PTS/1.5');
    });
  });

  describe('buildFreezeFadeFilterChain', () => {
    it('should build freeze-fade filter when video is shorter', () => {
      const clip: VideoClipInfo = {
        inputIndex: 0,
        startTime: 0,
        targetDuration: 10,
        originalDuration: 6, // Video is 6s, needs 4s of freeze
        fitStrategy: 'freeze-fade',
      };

      const result = buildFreezeFadeFilterChain(clip, defaultOptions, 'vid0');

      expect(result).toContain('trim=0:6');
      expect(result).toContain('tpad=stop_mode=clone:stop_duration=4');
      expect(result).toContain('fade=t=out');
    });

    it('should apply fade at the end of freeze period', () => {
      const clip: VideoClipInfo = {
        inputIndex: 0,
        startTime: 0,
        targetDuration: 10,
        originalDuration: 6, // 4s freeze, 1s fade
        fitStrategy: 'freeze-fade',
      };

      const result = buildFreezeFadeFilterChain(clip, defaultOptions, 'vid0');

      // Fade starts at 10 - 1 = 9
      expect(result).toContain('fade=t=out:st=9:d=1');
    });

    it('should use half of freeze duration for fade if freeze is short', () => {
      const clip: VideoClipInfo = {
        inputIndex: 0,
        startTime: 0,
        targetDuration: 10,
        originalDuration: 9, // Only 1s freeze, so 0.5s fade
        fitStrategy: 'freeze-fade',
      };

      const result = buildFreezeFadeFilterChain(clip, defaultOptions, 'vid0');

      expect(result).toContain('tpad=stop_mode=clone:stop_duration=1');
      expect(result).toContain('d=0.5');
    });

    it('should fall back to stretch filter if no freeze needed', () => {
      const clip: VideoClipInfo = {
        inputIndex: 0,
        startTime: 0,
        targetDuration: 10,
        originalDuration: 12, // Video is longer than target
        fitStrategy: 'freeze-fade',
      };

      const result = buildFreezeFadeFilterChain(clip, defaultOptions, 'vid0');

      // Should not have freeze/fade filters
      expect(result).not.toContain('tpad');
      expect(result).not.toContain('fade');
    });
  });

  describe('buildVideoFilter', () => {
    it('should use stretch filter for stretch strategy', () => {
      const clip: VideoClipInfo = {
        inputIndex: 0,
        startTime: 0,
        targetDuration: 10,
        originalDuration: 8,
        fitStrategy: 'stretch',
      };

      const result = buildVideoFilter(clip, defaultOptions, 'vid0');

      expect(result).toContain('setpts=PTS/0.8');
      expect(result).not.toContain('tpad');
    });

    it('should use freeze-fade filter for freeze-fade strategy', () => {
      const clip: VideoClipInfo = {
        inputIndex: 0,
        startTime: 0,
        targetDuration: 10,
        originalDuration: 6,
        fitStrategy: 'freeze-fade',
      };

      const result = buildVideoFilter(clip, defaultOptions, 'vid0');

      expect(result).toContain('tpad');
      expect(result).toContain('fade');
    });
  });

  describe('buildVideoInputArgs', () => {
    it('should build simple input arguments', () => {
      const result = buildVideoInputArgs('/path/to/video.mp4');

      expect(result).toEqual(['-i', '/path/to/video.mp4']);
    });
  });

  describe('calculateSpeedFactor', () => {
    it('should calculate correct speed factor', () => {
      // 10s video to 5s target = 2x speed
      expect(calculateSpeedFactor(10, 5)).toBe(2);
    });

    it('should calculate slow down factor', () => {
      // 5s video to 10s target = 0.5x speed
      expect(calculateSpeedFactor(5, 10)).toBe(0.5);
    });

    it('should return 1 for equal durations', () => {
      expect(calculateSpeedFactor(10, 10)).toBe(1);
    });

    it('should return 1 for invalid durations', () => {
      expect(calculateSpeedFactor(0, 10)).toBe(1);
      expect(calculateSpeedFactor(10, 0)).toBe(1);
    });
  });

  describe('determineFitStrategy', () => {
    it('should use stretch for small differences', () => {
      // 10s video to 11s target = 10% difference
      expect(determineFitStrategy(10, 11)).toBe('stretch');
    });

    it('should use stretch at exactly 20% difference', () => {
      // 10s video to 12.5s target = 20% difference (ratio = 0.8)
      expect(determineFitStrategy(10, 12.5)).toBe('stretch');
    });

    it('should use freeze-fade for large differences', () => {
      // 10s video to 20s target = 50% difference
      expect(determineFitStrategy(10, 20)).toBe('freeze-fade');
    });

    it('should use stretch for invalid durations', () => {
      expect(determineFitStrategy(0, 10)).toBe('stretch');
      expect(determineFitStrategy(10, 0)).toBe('stretch');
    });

    it('should use freeze-fade when video is much shorter', () => {
      // 5s video to 15s target = very large difference
      expect(determineFitStrategy(5, 15)).toBe('freeze-fade');
    });
  });

  describe('buildVideoAudioFilter', () => {
    it('should return null when volume is 0', () => {
      const clip: VideoClipInfo = {
        inputIndex: 0,
        startTime: 0,
        targetDuration: 10,
        fitStrategy: 'stretch',
        volume: 0,
      };

      const result = buildVideoAudioFilter(clip, 'vaud0');

      expect(result).toBeNull();
    });

    it('should apply volume adjustment', () => {
      const clip: VideoClipInfo = {
        inputIndex: 0,
        startTime: 0,
        targetDuration: 10,
        fitStrategy: 'stretch',
        volume: 0.5,
      };

      const result = buildVideoAudioFilter(clip, 'vaud0');

      expect(result).toContain('volume=0.5');
    });

    it('should apply tempo adjustment for stretch strategy', () => {
      const clip: VideoClipInfo = {
        inputIndex: 0,
        startTime: 0,
        targetDuration: 10,
        originalDuration: 8,
        fitStrategy: 'stretch',
        volume: 1,
      };

      const result = buildVideoAudioFilter(clip, 'vaud0');

      // Speed factor = 8/10 = 0.8, need atempo=0.8
      expect(result).toContain('atempo=0.8');
    });

    it('should chain tempo filters for extreme speed changes', () => {
      const clip: VideoClipInfo = {
        inputIndex: 0,
        startTime: 0,
        targetDuration: 10,
        originalDuration: 25, // 2.5x speed
        fitStrategy: 'stretch',
        volume: 1,
      };

      const result = buildVideoAudioFilter(clip, 'vaud0');

      // Need atempo=2.0,atempo=1.25
      expect(result).toContain('atempo=2.0');
      expect(result).toContain('atempo=1.25');
    });

    it('should include output label', () => {
      const clip: VideoClipInfo = {
        inputIndex: 2,
        startTime: 0,
        targetDuration: 10,
        fitStrategy: 'stretch',
        volume: 1,
      };

      const result = buildVideoAudioFilter(clip, 'vaud2');

      expect(result).toMatch(/^\[2:a\]/);
      expect(result).toMatch(/\[vaud2\]$/);
    });
  });
});
