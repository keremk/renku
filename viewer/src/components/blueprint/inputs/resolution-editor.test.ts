import { describe, expect, it } from 'vitest';
import {
  ASPECT_CUSTOM_KEY,
  inferPresetKey,
  parsePositiveInteger,
  resolveHeightForWidth,
  resolveWidthForHeight,
} from './resolution-editor-utils';
import type { RatioPreset } from './resolution-editor-utils';

describe('resolution editor helpers', () => {
  describe('inferPresetKey', () => {
    it('infers 16:9 from canonical dimensions', () => {
      expect(inferPresetKey(1280, 720, PRESETS)).toBe('landscape-16-9');
    });

    it('infers 16:9 from non-reduced equivalent dimensions', () => {
      expect(inferPresetKey(1920, 1080, PRESETS)).toBe('landscape-16-9');
    });

    it('infers 4:3 from equivalent dimensions', () => {
      expect(inferPresetKey(1440, 1080, PRESETS)).toBe('landscape-4-3');
    });

    it('infers 1:1 from equivalent dimensions', () => {
      expect(inferPresetKey(2048, 2048, PRESETS)).toBe('square-1-1');
    });

    it('infers 3:4 from equivalent dimensions', () => {
      expect(inferPresetKey(1080, 1440, PRESETS)).toBe('portrait-3-4');
    });

    it('infers 9:16 from canonical portrait dimensions', () => {
      expect(inferPresetKey(1080, 1920, PRESETS)).toBe('portrait-9-16');
    });

    it('infers 21:9 from equivalent dimensions', () => {
      expect(inferPresetKey(1680, 720, PRESETS)).toBe('landscape-21-9');
    });

    it('infers 21:9 from higher equivalent dimensions', () => {
      expect(inferPresetKey(2520, 1080, PRESETS)).toBe('landscape-21-9');
    });

    it('keeps custom for non-matching ratio near 16:9', () => {
      expect(inferPresetKey(1919, 1080, PRESETS)).toBe(ASPECT_CUSTOM_KEY);
    });

    it('keeps custom for arbitrary unsupported ratio', () => {
      expect(inferPresetKey(1000, 777, PRESETS)).toBe(ASPECT_CUSTOM_KEY);
    });
  });

  it('keeps selected ratio when width preset changes', () => {
    const portraitPreset: RatioPreset = {
      key: 'portrait-9-16',
      label: 'Portrait 9:16',
      width: 9,
      height: 16,
      defaultWidth: 1080,
      defaultHeight: 1920,
    };

    expect(resolveHeightForWidth(720, portraitPreset)).toBe(1280);
  });

  it('keeps selected ratio when height preset changes', () => {
    const landscapePreset: RatioPreset = {
      key: 'landscape-4-3',
      label: 'Landscape 4:3',
      width: 4,
      height: 3,
      defaultWidth: 1024,
      defaultHeight: 768,
    };

    expect(resolveWidthForHeight(768, landscapePreset)).toBe(1024);
  });

  it('parses positive integers and rejects invalid text', () => {
    expect(parsePositiveInteger('720')).toBe(720);
    expect(parsePositiveInteger('0720')).toBe(720);
    expect(parsePositiveInteger('0')).toBeUndefined();
    expect(parsePositiveInteger('-4')).toBeUndefined();
    expect(parsePositiveInteger('12.5')).toBe(12);
    expect(parsePositiveInteger('abc')).toBeUndefined();
  });
});

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
