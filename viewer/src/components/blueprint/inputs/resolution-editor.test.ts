import { describe, expect, it } from 'vitest';
import {
  inferPresetKey,
  parsePositiveInteger,
  resolveHeightForWidth,
  resolveWidthForHeight,
} from './resolution-editor-utils';
import type { RatioPreset } from './resolution-editor-utils';

describe('resolution editor helpers', () => {
  it('infers portrait preset from canonical portrait dimensions', () => {
    expect(inferPresetKey(1080, 1920, PRESETS)).toBe('portrait-9-16');
  });

  it('marks non-preset ratio as custom', () => {
    expect(inferPresetKey(1000, 777, PRESETS)).toBe('custom');
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
    expect(parsePositiveInteger('0')).toBeUndefined();
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
    key: 'portrait-9-16',
    label: 'Portrait 9:16',
    width: 9,
    height: 16,
    defaultWidth: 1080,
    defaultHeight: 1920,
  },
];
