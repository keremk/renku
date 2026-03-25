import { describe, expect, it } from 'vitest';
import {
  ASPECT_CUSTOM_KEY,
  buildDimensionOptions,
  getAspectMode,
  getPresetByKey,
  inferPresetKey,
  parsePositiveInteger,
  resolutionFromHeightSelection,
  resolutionFromPreset,
  resolutionFromWidthSelection,
  sanitizeNumericInput,
  type RatioPreset,
} from './resolution-editor-utils';

const PRESETS: RatioPreset[] = [
  {
    key: 'landscape-16-9',
    label: 'Landscape 16:9',
    width: 16,
    height: 9,
    defaultWidth: 1280,
    defaultHeight: 720,
  },
  {
    key: 'landscape-4-3',
    label: 'Landscape 4:3',
    width: 4,
    height: 3,
    defaultWidth: 1440,
    defaultHeight: 1080,
  },
  {
    key: 'square-1-1',
    label: 'Square 1:1',
    width: 1,
    height: 1,
    defaultWidth: 1080,
    defaultHeight: 1080,
  },
  {
    key: 'portrait-3-4',
    label: 'Portrait 3:4',
    width: 3,
    height: 4,
    defaultWidth: 1080,
    defaultHeight: 1440,
  },
  {
    key: 'portrait-9-16',
    label: 'Portrait 9:16',
    width: 9,
    height: 16,
    defaultWidth: 1080,
    defaultHeight: 1920,
  },
  {
    key: 'landscape-21-9',
    label: 'Landscape 21:9',
    width: 21,
    height: 9,
    defaultWidth: 1680,
    defaultHeight: 720,
  },
];

describe('resolution-editor-utils', () => {
  describe('inferPresetKey', () => {
    it('infers landscape-16-9 for canonical values', () => {
      expect(inferPresetKey(1280, 720, PRESETS)).toBe('landscape-16-9');
    });

    it('infers landscape-16-9 for equivalent larger values', () => {
      expect(inferPresetKey(1920, 1080, PRESETS)).toBe('landscape-16-9');
    });

    it('infers landscape-4-3 for equivalent values', () => {
      expect(inferPresetKey(2048, 1536, PRESETS)).toBe('landscape-4-3');
    });

    it('infers square-1-1 for equivalent values', () => {
      expect(inferPresetKey(2048, 2048, PRESETS)).toBe('square-1-1');
    });

    it('infers portrait-3-4 for equivalent values', () => {
      expect(inferPresetKey(1080, 1440, PRESETS)).toBe('portrait-3-4');
    });

    it('infers portrait-9-16 for equivalent values', () => {
      expect(inferPresetKey(720, 1280, PRESETS)).toBe('portrait-9-16');
    });

    it('infers landscape-21-9 for default values', () => {
      expect(inferPresetKey(1680, 720, PRESETS)).toBe('landscape-21-9');
    });

    it('infers landscape-21-9 for equivalent non-default values', () => {
      expect(inferPresetKey(2520, 1080, PRESETS)).toBe('landscape-21-9');
    });

    it('returns custom for near-but-not-exact ratios', () => {
      expect(inferPresetKey(1919, 1080, PRESETS)).toBe(ASPECT_CUSTOM_KEY);
    });

    it('returns custom for unsupported ratio', () => {
      expect(inferPresetKey(1000, 777, PRESETS)).toBe(ASPECT_CUSTOM_KEY);
    });
  });

  describe('getAspectMode', () => {
    it('returns landscape for landscape preset', () => {
      expect(getAspectMode('landscape-16-9', PRESETS)).toBe('landscape');
    });

    it('returns portrait for portrait preset', () => {
      expect(getAspectMode('portrait-9-16', PRESETS)).toBe('portrait');
    });

    it('returns square for square preset', () => {
      expect(getAspectMode('square-1-1', PRESETS)).toBe('square');
    });

    it('returns custom for custom key', () => {
      expect(getAspectMode(ASPECT_CUSTOM_KEY, PRESETS)).toBe('custom');
    });

    it('returns custom for unknown key', () => {
      expect(getAspectMode('unknown', PRESETS)).toBe('custom');
    });
  });

  describe('getPresetByKey', () => {
    it('returns preset for known key', () => {
      expect(getPresetByKey('landscape-16-9', PRESETS)?.label).toBe(
        'Landscape 16:9'
      );
    });

    it('returns undefined for custom', () => {
      expect(getPresetByKey(ASPECT_CUSTOM_KEY, PRESETS)).toBeUndefined();
    });
  });

  describe('resolutionFromPreset', () => {
    it('returns preset defaults when selecting known preset', () => {
      expect(
        resolutionFromPreset(
          'landscape-21-9',
          { width: 1280, height: 720 },
          PRESETS
        )
      ).toEqual({ width: 1680, height: 720 });
    });

    it('returns current resolution when selecting custom', () => {
      expect(
        resolutionFromPreset(
          ASPECT_CUSTOM_KEY,
          { width: 1280, height: 720 },
          PRESETS
        )
      ).toEqual({ width: 1280, height: 720 });
    });
  });

  describe('resolutionFromWidthSelection', () => {
    it('keeps ratio for landscape width changes', () => {
      const preset = PRESETS[0]!;
      expect(resolutionFromWidthSelection(preset, 'landscape', 1920)).toEqual({
        width: 1920,
        height: 1080,
      });
    });

    it('keeps square dimensions equal for square width changes', () => {
      const preset = PRESETS[2]!;
      expect(resolutionFromWidthSelection(preset, 'square', 1440)).toEqual({
        width: 1440,
        height: 1440,
      });
    });
  });

  describe('resolutionFromHeightSelection', () => {
    it('keeps ratio for portrait height changes', () => {
      const preset = PRESETS[4]!;
      expect(resolutionFromHeightSelection(preset, 'portrait', 1280)).toEqual({
        width: 720,
        height: 1280,
      });
    });

    it('keeps square dimensions equal for square height changes', () => {
      const preset = PRESETS[2]!;
      expect(resolutionFromHeightSelection(preset, 'square', 960)).toEqual({
        width: 960,
        height: 960,
      });
    });
  });

  describe('parsePositiveInteger', () => {
    it('parses positive integer strings', () => {
      expect(parsePositiveInteger('720')).toBe(720);
      expect(parsePositiveInteger('0720')).toBe(720);
    });

    it('rejects non-digit or invalid values', () => {
      expect(parsePositiveInteger('')).toBeUndefined();
      expect(parsePositiveInteger('0')).toBeUndefined();
      expect(parsePositiveInteger('-1')).toBeUndefined();
      expect(parsePositiveInteger('10px')).toBeUndefined();
      expect(parsePositiveInteger('12.5')).toBeUndefined();
      expect(parsePositiveInteger('abc')).toBeUndefined();
    });
  });

  describe('sanitizeNumericInput', () => {
    it('removes non-digits and preserves digits', () => {
      expect(sanitizeNumericInput('12ab3')).toBe('123');
      expect(sanitizeNumericInput(' 7 2 0 ')).toBe('720');
      expect(sanitizeNumericInput('')).toBe('');
      expect(sanitizeNumericInput('abc')).toBe('');
    });
  });

  describe('buildDimensionOptions', () => {
    it('dedupes and sorts options, keeping current value', () => {
      expect(buildDimensionOptions([720, 1080, 720], 1280)).toEqual([
        720, 1080, 1280,
      ]);
    });

    it('filters invalid values', () => {
      expect(buildDimensionOptions([720, -1, 0, 1080], 1280)).toEqual([
        720, 1080, 1280,
      ]);
    });
  });
});
