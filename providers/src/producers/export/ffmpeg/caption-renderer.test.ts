import { describe, it, expect } from 'vitest';
import {
  buildCaptionFilter,
  buildCaptionFilterChain,
  parseCaptionsFromArray,
  buildCaptionOverlayGenerator,
} from './caption-renderer.js';
import type { CaptionEntry } from './types.js';

describe('caption-renderer', () => {
  const defaultOptions = {
    width: 1920,
    height: 1080,
  };

  describe('buildCaptionFilter', () => {
    it('should return empty string for no captions', () => {
      const result = buildCaptionFilter([], defaultOptions);

      expect(result).toBe('');
    });

    it('should build a single caption filter', () => {
      const captions: CaptionEntry[] = [
        {
          text: 'Hello World',
          startTime: 0,
          endTime: 5,
        },
      ];

      const result = buildCaptionFilter(captions, defaultOptions);

      expect(result).toContain('drawtext=');
      expect(result).toContain("text='Hello World'");
      expect(result).toContain('fontsize=48'); // default
      expect(result).toContain('fontcolor=white'); // default
      expect(result).toContain("enable='between(t,0,5)'");
    });

    it('should build multiple caption filters', () => {
      const captions: CaptionEntry[] = [
        { text: 'First', startTime: 0, endTime: 3 },
        { text: 'Second', startTime: 3, endTime: 6 },
        { text: 'Third', startTime: 6, endTime: 9 },
      ];

      const result = buildCaptionFilter(captions, defaultOptions);

      expect(result).toContain("text='First'");
      expect(result).toContain("text='Second'");
      expect(result).toContain("text='Third'");
      expect(result.split('drawtext=').length).toBe(4); // 3 drawtext filters + 1 empty split
    });

    it('should apply custom font size', () => {
      const captions: CaptionEntry[] = [
        { text: 'Test', startTime: 0, endTime: 5 },
      ];

      const result = buildCaptionFilter(captions, {
        ...defaultOptions,
        fontSize: 72,
      });

      expect(result).toContain('fontsize=72');
    });

    it('should apply custom colors', () => {
      const captions: CaptionEntry[] = [
        { text: 'Test', startTime: 0, endTime: 5 },
      ];

      const result = buildCaptionFilter(captions, {
        ...defaultOptions,
        fontColor: 'yellow',
        boxColor: 'blue@0.8',
      });

      expect(result).toContain('fontcolor=yellow');
      expect(result).toContain('boxcolor=blue@0.8');
    });

    it('should escape special characters in text', () => {
      const captions: CaptionEntry[] = [
        { text: "It's a test: with 'quotes'", startTime: 0, endTime: 5 },
      ];

      const result = buildCaptionFilter(captions, defaultOptions);

      // Single quotes should be escaped
      expect(result).toContain("'\\''");
      // Colons should be escaped
      expect(result).toContain('\\:');
    });

    it('should center horizontally and position from bottom', () => {
      const captions: CaptionEntry[] = [
        { text: 'Test', startTime: 0, endTime: 5 },
      ];

      const result = buildCaptionFilter(captions, defaultOptions);

      expect(result).toContain('x=(w-text_w)/2');
      expect(result).toContain('y=');
    });

    it('should include font file when specified', () => {
      const captions: CaptionEntry[] = [
        { text: 'Test', startTime: 0, endTime: 5 },
      ];

      const result = buildCaptionFilter(captions, {
        ...defaultOptions,
        fontFile: '/path/to/font.ttf',
      });

      expect(result).toContain("fontfile='/path/to/font.ttf'");
    });
  });

  describe('buildCaptionFilterChain', () => {
    it('should pass through when no captions', () => {
      const result = buildCaptionFilterChain('[v0]', [], defaultOptions, 'vout');

      expect(result).toBe('[v0]null[vout]');
    });

    it('should build filter chain with captions', () => {
      const captions: CaptionEntry[] = [
        { text: 'Hello', startTime: 0, endTime: 5 },
      ];

      const result = buildCaptionFilterChain('[v0]', captions, defaultOptions, 'vout');

      expect(result).toMatch(/^\[v0\]/);
      expect(result).toContain('drawtext=');
      expect(result).toMatch(/\[vout\]$/);
    });
  });

  describe('parseCaptionsFromArray', () => {
    it('should create timed entries from caption array', () => {
      const captions = ['First line', 'Second line', 'Third line'];

      const result = parseCaptionsFromArray(captions, 0, 9);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        text: 'First line',
        startTime: 0,
        endTime: 3,
      });
      expect(result[1]).toEqual({
        text: 'Second line',
        startTime: 3,
        endTime: 6,
      });
      expect(result[2]).toEqual({
        text: 'Third line',
        startTime: 6,
        endTime: 9,
      });
    });

    it('should handle non-zero start time', () => {
      const captions = ['First', 'Second'];

      const result = parseCaptionsFromArray(captions, 5, 10);

      expect(result[0]).toEqual({
        text: 'First',
        startTime: 5,
        endTime: 10,
      });
      expect(result[1]).toEqual({
        text: 'Second',
        startTime: 10,
        endTime: 15,
      });
    });

    it('should return empty array for empty input', () => {
      const result = parseCaptionsFromArray([], 0, 10);

      expect(result).toEqual([]);
    });

    it('should partition captions by word count', () => {
      const captions = ['This is a very long caption with many words'];

      const result = parseCaptionsFromArray(captions, 0, 8, 3); // 3 words per caption

      expect(result).toHaveLength(3);
      expect(result[0]!.text).toBe('This is a');
      expect(result[1]!.text).toBe('very long caption');
      expect(result[2]!.text).toBe('with many words');
    });

    it('should handle multiple captions with partition', () => {
      const captions = ['One two three', 'Four five six'];

      const result = parseCaptionsFromArray(captions, 0, 6, 2);

      expect(result).toHaveLength(4);
      expect(result[0]!.text).toBe('One two');
      expect(result[1]!.text).toBe('three');
      expect(result[2]!.text).toBe('Four five');
      expect(result[3]!.text).toBe('six');
    });

    it('should trim whitespace from captions', () => {
      const captions = ['  trimmed text  '];

      const result = parseCaptionsFromArray(captions, 0, 5);

      expect(result[0]!.text).toBe('trimmed text');
    });
  });

  describe('buildCaptionOverlayGenerator', () => {
    it('should generate transparent overlay when no captions', () => {
      const result = buildCaptionOverlayGenerator([], defaultOptions, 'capover');

      expect(result).toContain('color=c=black@0');
      expect(result).toContain('s=1920x1080');
      expect(result).toContain('[capover]');
    });

    it('should generate overlay with captions', () => {
      const captions: CaptionEntry[] = [
        { text: 'Overlay text', startTime: 0, endTime: 5 },
      ];

      const result = buildCaptionOverlayGenerator(captions, defaultOptions, 'capover');

      expect(result).toContain('color=c=black@0');
      expect(result).toContain('drawtext=');
      expect(result).toContain("text='Overlay text'");
      expect(result).toMatch(/\[capover\]$/);
    });
  });
});
