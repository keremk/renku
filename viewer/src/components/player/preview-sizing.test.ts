import { describe, it, expect } from 'vitest';
import {
  DEFAULT_COMPOSITION_SIZE,
  fitWithinBounds,
  parseAspectRatio,
  resolveCompositionDimensions,
} from './preview-sizing';

describe('preview-sizing', () => {
  describe('parseAspectRatio', () => {
    it('parses portrait 9:16 ratio', () => {
      expect(parseAspectRatio('9:16')).toEqual({
        width: 608,
        height: 1080,
      });
    });

    it('parses ratio with surrounding whitespace', () => {
      expect(parseAspectRatio(' 4 : 3 ')).toEqual({
        width: 1440,
        height: 1080,
      });
    });

    it('parses ratio prefixes that include a resolution suffix', () => {
      expect(parseAspectRatio('9:16+720p')).toEqual({
        width: 608,
        height: 1080,
      });
    });

    it('returns null when the ratio is invalid', () => {
      expect(parseAspectRatio('auto')).toBeNull();
      expect(parseAspectRatio('0:16')).toBeNull();
      expect(parseAspectRatio('16:0')).toBeNull();
    });
  });

  describe('fitWithinBounds', () => {
    it('letterboxes portrait content inside a wide viewport', () => {
      expect(
        fitWithinBounds(
          { width: 1080, height: 1920 },
          { width: 1200, height: 600 }
        )
      ).toEqual({ width: 338, height: 600 });
    });

    it('pillarboxes landscape content inside a tall viewport', () => {
      expect(
        fitWithinBounds(
          { width: 1920, height: 1080 },
          { width: 600, height: 1200 }
        )
      ).toEqual({ width: 600, height: 338 });
    });

    it('fills the viewport exactly when ratios match', () => {
      expect(
        fitWithinBounds(
          { width: 1920, height: 1080 },
          { width: 1280, height: 720 }
        )
      ).toEqual({ width: 1280, height: 720 });
    });

    it('returns zero dimensions when bounds are not available', () => {
      expect(
        fitWithinBounds(
          { width: 1920, height: 1080 },
          { width: 0, height: 720 }
        )
      ).toEqual({ width: 0, height: 0 });
    });
  });

  describe('resolveCompositionDimensions', () => {
    it('prefers explicit aspect ratio dimensions', () => {
      const explicitAspectDimensions = { width: 720, height: 1280 };
      const detectedVisualDimensions = {
        assetId: 'Artifact:Video.Scene',
        dimensions: { width: 1920, height: 1080 },
      };

      expect(
        resolveCompositionDimensions({
          explicitAspectDimensions,
          detectedVisualDimensions,
          firstVisualAssetId: 'Artifact:Video.Scene',
        })
      ).toEqual(explicitAspectDimensions);
    });

    it('uses detected media dimensions when they match the first visual asset', () => {
      expect(
        resolveCompositionDimensions({
          explicitAspectDimensions: null,
          detectedVisualDimensions: {
            assetId: 'Artifact:Video.Scene',
            dimensions: { width: 720, height: 1280 },
          },
          firstVisualAssetId: 'Artifact:Video.Scene',
        })
      ).toEqual({ width: 720, height: 1280 });
    });

    it('falls back to default dimensions when detection belongs to another asset', () => {
      expect(
        resolveCompositionDimensions({
          explicitAspectDimensions: null,
          detectedVisualDimensions: {
            assetId: 'Artifact:Image.Cover',
            dimensions: { width: 720, height: 1280 },
          },
          firstVisualAssetId: 'Artifact:Video.Scene',
        })
      ).toEqual(DEFAULT_COMPOSITION_SIZE);
    });

    it('falls back to default dimensions when no visual asset is available', () => {
      expect(
        resolveCompositionDimensions({
          explicitAspectDimensions: null,
          detectedVisualDimensions: null,
          firstVisualAssetId: null,
        })
      ).toEqual(DEFAULT_COMPOSITION_SIZE);
    });
  });
});
