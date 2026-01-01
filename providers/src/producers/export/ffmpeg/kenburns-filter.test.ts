import { describe, it, expect } from 'vitest';
import {
  buildKenBurnsFilter,
  buildImageFilterChain,
  buildImageInputArgs,
} from './kenburns-filter.js';
import type { KenBurnsEffect } from '@gorenku/compositions';

describe('kenburns-filter', () => {
  const defaultOptions = {
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 5,
  };

  describe('buildKenBurnsFilter', () => {
    it('should build a basic zoompan filter with default values', () => {
      const effect: KenBurnsEffect = {
        assetId: 'Artifact:Image[0][0]',
      };

      const result = buildKenBurnsFilter(effect, defaultOptions);

      // Should have all required zoompan parameters
      expect(result).toContain('zoompan=');
      expect(result).toContain('d=150'); // 5 seconds * 30 fps
      expect(result).toContain('s=1920x1080');
      expect(result).toContain('fps=30');
      expect(result).toContain("z='1'"); // No zoom change
    });

    it('should build portraitZoomIn effect (zoom 1.0 -> 1.2)', () => {
      const effect: KenBurnsEffect = {
        assetId: 'Artifact:Image[0][0]',
        style: 'portraitZoomIn',
        startScale: 1,
        endScale: 1.2,
        startX: 0,
        startY: 0,
        endX: 0,
        endY: 0,
      };

      const result = buildKenBurnsFilter(effect, defaultOptions);

      // Should interpolate zoom from 1 to ~1.2 (allow floating point variance)
      expect(result).toMatch(/z='1\+0\.1999/);
      // Should center the visible area (no pan)
      expect(result).toContain("x='(iw-iw/zoom)/2'");
      expect(result).toContain("y='(ih-ih/zoom)/2'");
    });

    it('should build portraitZoomOut effect (zoom 1.2 -> 1.0)', () => {
      const effect: KenBurnsEffect = {
        assetId: 'Artifact:Image[0][0]',
        style: 'portraitZoomOut',
        startScale: 1.2,
        endScale: 1,
        startX: 0,
        startY: 0,
        endX: 0,
        endY: 0,
      };

      const result = buildKenBurnsFilter(effect, defaultOptions);

      // Should interpolate zoom from 1.2 to 1 (negative delta, allow floating point variance)
      expect(result).toMatch(/z='1\.2\+-0\.1999/);
    });

    it('should build diagonalZoomInDownLeft effect with pan', () => {
      const effect: KenBurnsEffect = {
        assetId: 'Artifact:Image[0][0]',
        style: 'diagonalZoomInDownLeft',
        startX: 40,
        startY: -40,
        endX: -30,
        endY: 30,
        startScale: 1,
        endScale: 1.3,
      };

      const result = buildKenBurnsFilter(effect, defaultOptions);

      // Should have zoom interpolation
      expect(result).toContain("z='1+0.3");
      // Should have X pan from 40 to -30 (delta = -70)
      expect(result).toContain('40+-70');
      // Should have Y pan from -40 to 30 (delta = 70)
      expect(result).toContain('-40+70');
    });

    it('should build landscapePanLeft effect', () => {
      const effect: KenBurnsEffect = {
        assetId: 'Artifact:Image[0][0]',
        style: 'landscapePanLeft',
        startX: 60,
        startY: 0,
        endX: -60,
        endY: 0,
        startScale: 1.1,
        endScale: 1.3,
      };

      const result = buildKenBurnsFilter(effect, defaultOptions);

      // Should have zoom from 1.1 to 1.3 (allow floating point variance)
      expect(result).toMatch(/z='1\.1\+0\.1999/);
      // Should have X pan from 60 to -60 (delta = -120)
      expect(result).toContain('60+-120');
      // Y should be centered (no offset)
      expect(result).toContain("y='(ih-ih/zoom)/2'");
    });

    it('should handle single frame duration', () => {
      const effect: KenBurnsEffect = {
        assetId: 'Artifact:Image[0][0]',
        startScale: 1,
        endScale: 1.5,
        startX: 10,
        endX: 20,
      };

      const result = buildKenBurnsFilter(effect, {
        ...defaultOptions,
        duration: 1 / 30, // Single frame
      });

      // Should have d=1
      expect(result).toContain('d=1');
      // Should use startScale only
      expect(result).toContain("z='1'");
    });

    it('should handle custom resolution and fps', () => {
      const effect: KenBurnsEffect = {
        assetId: 'Artifact:Image[0][0]',
      };

      const result = buildKenBurnsFilter(effect, {
        width: 1280,
        height: 720,
        fps: 24,
        duration: 3,
      });

      expect(result).toContain('s=1280x720');
      expect(result).toContain('fps=24');
      expect(result).toContain('d=72'); // 3 * 24
    });
  });

  describe('buildImageFilterChain', () => {
    it('should build a complete filter chain with label', () => {
      const effect: KenBurnsEffect = {
        assetId: 'Artifact:Image[0][0]',
        startScale: 1,
        endScale: 1.2,
      };

      const result = buildImageFilterChain(0, effect, defaultOptions, 'img0');

      // Should start with input index
      expect(result).toMatch(/^\[0:v\]/);
      // Should have zoompan filter
      expect(result).toContain('zoompan=');
      // Should convert format
      expect(result).toContain('format=yuv420p');
      // Should reset timestamps
      expect(result).toContain('setpts=PTS-STARTPTS');
      // Should end with output label
      expect(result).toMatch(/\[img0\]$/);
    });

    it('should use correct input index for multiple images', () => {
      const effect: KenBurnsEffect = {
        assetId: 'Artifact:Image[1][2]',
      };

      const result = buildImageFilterChain(5, effect, defaultOptions, 'img5');

      expect(result).toMatch(/^\[5:v\]/);
      expect(result).toMatch(/\[img5\]$/);
    });
  });

  describe('buildImageInputArgs', () => {
    it('should build input arguments for an image', () => {
      const result = buildImageInputArgs('/path/to/image.jpg', 5);

      expect(result).toEqual(['-loop', '1', '-t', '5', '-i', '/path/to/image.jpg']);
    });

    it('should handle decimal durations', () => {
      const result = buildImageInputArgs('/path/to/image.png', 3.5);

      expect(result).toContain('3.5');
    });
  });
});
