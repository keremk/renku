import { describe, expect, it } from 'vitest';
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
    coverWidth: 2400,
    coverHeight: 1350,
    fps: 30,
    duration: 5,
  };

  describe('buildKenBurnsFilter', () => {
    it('builds zoompan expressions with linear progress', () => {
      const effect: KenBurnsEffect = {
        assetId: 'Artifact:Image[0][0]',
        startScale: 1,
        endScale: 1.3,
        startX: 40,
        endX: -30,
        startY: -20,
        endY: 25,
      };

      const result = buildKenBurnsFilter(effect, defaultOptions);

      expect(result).toContain("zoompan=z='");
      expect(result).toContain(':d=1:s=1920x1080:fps=30');
      expect(result).toContain('if(lte(on,0),0,if(gte(on,149),1,on/149))');
      expect(result).not.toContain('*(3-2*(');
      expect(result).toContain('40+(-70)');
      expect(result).toContain('-20+(45)');
      expect(result).toContain("x='clip(");
      expect(result).toContain("y='clip(");
    });

    it('keeps constant expressions when start and end values match', () => {
      const effect: KenBurnsEffect = {
        assetId: 'Artifact:Image[0][0]',
        startScale: 1.2,
        endScale: 1.2,
        startX: 10,
        endX: 10,
        startY: -8,
        endY: -8,
      };

      const result = buildKenBurnsFilter(effect, defaultOptions);

      expect(result).toContain("zoompan=z='1.2'");
      expect(result).toContain('+(10)');
      expect(result).toContain('+(-8)');
      expect(result).not.toContain('on/149');
    });

    it('defaults end values to start values', () => {
      const effect: KenBurnsEffect = {
        assetId: 'Artifact:Image[0][0]',
        startScale: 1.15,
        startX: -12,
        startY: 8,
      };

      const result = buildKenBurnsFilter(effect, defaultOptions);

      expect(result).toContain("zoompan=z='1.15'");
      expect(result).toContain('+(-12)');
      expect(result).toContain('+(8)');
    });

    it('raises scale to keep offsets inside bounds', () => {
      const effect: KenBurnsEffect = {
        assetId: 'Artifact:Image[0][0]',
        startScale: 1,
        endScale: 1,
        startX: 18,
        endX: 18,
        startY: 0,
        endY: 0,
      };

      const constrained = {
        ...defaultOptions,
        coverWidth: 1930,
        coverHeight: 1082,
      };

      const result = buildKenBurnsFilter(effect, constrained);

      expect(result).not.toContain("zoompan=z='1'");
      expect(result).toContain("zoompan=z='");
    });

    it('throws when scale is below 1', () => {
      const effect: KenBurnsEffect = {
        assetId: 'Artifact:Image[0][0]',
        startScale: 0.9,
        endScale: 1,
      };

      expect(() => buildKenBurnsFilter(effect, defaultOptions)).toThrow(
        /greater than or equal to 1/
      );
    });

    it('throws when duration is not positive', () => {
      const effect: KenBurnsEffect = {
        assetId: 'Artifact:Image[0][0]',
      };

      expect(() =>
        buildKenBurnsFilter(effect, {
          ...defaultOptions,
          duration: 0,
        })
      ).toThrow(/must be greater than 0/);
    });
  });

  describe('buildImageFilterChain', () => {
    it('builds the full image processing chain with 2x working space', () => {
      const effect: KenBurnsEffect = {
        assetId: 'Artifact:Image[0][0]',
        startScale: 1,
        endScale: 1.2,
      };

      const result = buildImageFilterChain(
        0,
        effect,
        {
          width: 1920,
          height: 1080,
          fps: 30,
          duration: 5,
        },
        { width: 1408, height: 768 },
        'img0'
      );

      expect(result).toMatch(/^\[0:v\]/);
      expect(result).toContain('fps=30');
      expect(result).toContain('scale=3960:2160:flags=lanczos');
      expect(result).toContain('format=gbrp');
      expect(result).toContain('zoompan=');
      expect(result).toContain('scale=1920:1080:flags=lanczos');
      expect(result).toContain('setsar=1');
      expect(result).toContain('format=yuv420p');
      expect(result).toContain('setpts=PTS-STARTPTS');
      expect(result).toMatch(/\[img0\]$/);
    });
  });

  describe('buildImageInputArgs', () => {
    it('builds looped image input args with fps and duration', () => {
      const result = buildImageInputArgs('/path/to/image.jpg', 5, 30);

      expect(result).toEqual([
        '-loop',
        '1',
        '-framerate',
        '30',
        '-t',
        '5',
        '-i',
        '/path/to/image.jpg',
      ]);
    });

    it('preserves paths with spaces', () => {
      const result = buildImageInputArgs(
        '/path with spaces/image.png',
        3.5,
        24
      );

      expect(result).toEqual([
        '-loop',
        '1',
        '-framerate',
        '24',
        '-t',
        '3.5',
        '-i',
        '/path with spaces/image.png',
      ]);
    });
  });
});
