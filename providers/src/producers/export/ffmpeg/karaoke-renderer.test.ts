import { describe, it, expect } from 'vitest';
import {
  buildKaraokeFilter,
  buildKaraokeFilterChain,
  __test__,
} from './karaoke-renderer.js';
import type { TranscriptionArtifact } from '../../transcription/types.js';

const { escapeDrawtext, groupWordsIntoLines, buildAnimatedFontsize } = __test__;

describe('karaoke-renderer', () => {
  describe('escapeDrawtext', () => {
    it('escapes single quotes for FFmpeg', () => {
      expect(escapeDrawtext("it's")).toBe("it'\\''s");
    });

    it('escapes colons for FFmpeg', () => {
      expect(escapeDrawtext('note: test')).toBe('note\\: test');
    });

    it('escapes backslashes', () => {
      expect(escapeDrawtext('path\\file')).toBe('path\\\\file');
    });

    it('handles empty string', () => {
      expect(escapeDrawtext('')).toBe('');
    });

    it('escapes newlines', () => {
      expect(escapeDrawtext('line1\nline2')).toBe('line1\\nline2');
    });

    it('handles multiple special characters', () => {
      expect(escapeDrawtext("it's: a\\test")).toBe("it'\\''s\\: a\\\\test");
    });
  });

  describe('groupWordsIntoLines', () => {
    const words = [
      { text: 'Hello', startTime: 0, endTime: 0.5, clipId: 'clip-1' },
      { text: 'world', startTime: 0.5, endTime: 1, clipId: 'clip-1' },
      { text: 'this', startTime: 1, endTime: 1.5, clipId: 'clip-1' },
      { text: 'is', startTime: 1.5, endTime: 2, clipId: 'clip-1' },
      { text: 'a', startTime: 2, endTime: 2.5, clipId: 'clip-1' },
      { text: 'test', startTime: 2.5, endTime: 3, clipId: 'clip-1' },
    ];

    it('groups words into lines of max size', () => {
      const groups = groupWordsIntoLines(words, 3);
      expect(groups.length).toBe(2);
      expect(groups[0]?.words.length).toBe(3);
      expect(groups[1]?.words.length).toBe(3);
    });

    it('handles words less than max per line', () => {
      const groups = groupWordsIntoLines(words.slice(0, 2), 5);
      expect(groups.length).toBe(1);
      expect(groups[0]?.words.length).toBe(2);
    });

    it('sets correct start and end times for groups', () => {
      const groups = groupWordsIntoLines(words, 3);
      expect(groups[0]?.startTime).toBe(0);
      expect(groups[0]?.endTime).toBe(1.5);
      expect(groups[1]?.startTime).toBe(1.5);
      expect(groups[1]?.endTime).toBe(3);
    });

    it('handles empty words array', () => {
      const groups = groupWordsIntoLines([], 5);
      expect(groups.length).toBe(0);
    });

    it('creates single group when words equal max', () => {
      const groups = groupWordsIntoLines(words, 6);
      expect(groups.length).toBe(1);
      expect(groups[0]?.words.length).toBe(6);
    });
  });

  describe('buildKaraokeFilter', () => {
    const transcription: TranscriptionArtifact = {
      text: 'Hello world',
      words: [
        { text: 'Hello', startTime: 0, endTime: 0.5, clipId: 'clip-1' },
        { text: 'world', startTime: 0.5, endTime: 1, clipId: 'clip-1' },
      ],
      segments: [],
      language: 'eng',
      totalDuration: 1,
    };

    const options = {
      width: 1920,
      height: 1080,
    };

    it('generates correct drawtext filter for single word', () => {
      const singleWord: TranscriptionArtifact = {
        ...transcription,
        words: [{ text: 'Hello', startTime: 0, endTime: 1, clipId: 'clip-1' }],
      };

      const filter = buildKaraokeFilter(singleWord, options);
      expect(filter).toContain('drawtext=');
      expect(filter).toContain("text='Hello'");
      expect(filter).toContain('between(t,0.000,1.000)');
    });

    it('generates correct filter chain for multiple words', () => {
      const filter = buildKaraokeFilter(transcription, options);

      // Should have background layer with both words
      expect(filter).toContain("text='Hello world'");

      // Should have highlight layers for each word
      expect(filter).toContain("text='Hello'");
      expect(filter).toContain("text='world'");
    });

    it('applies default colors correctly', () => {
      const filter = buildKaraokeFilter(transcription, options);

      // Background uses white
      expect(filter).toContain('fontcolor=white');
      // Highlight uses gold
      expect(filter).toContain('fontcolor=#FFD700');
    });

    it('applies custom colors when provided', () => {
      const filter = buildKaraokeFilter(transcription, {
        ...options,
        fontColor: 'yellow',
        highlightColor: 'red',
      });

      expect(filter).toContain('fontcolor=yellow');
      expect(filter).toContain('fontcolor=red');
    });

    it('handles empty transcription gracefully', () => {
      const empty: TranscriptionArtifact = {
        text: '',
        words: [],
        segments: [],
        language: 'eng',
        totalDuration: 0,
      };

      const filter = buildKaraokeFilter(empty, options);
      expect(filter).toBe('');
    });

    it('includes enable conditions with correct timing', () => {
      const filter = buildKaraokeFilter(transcription, options);

      // Check for time-based enable conditions
      expect(filter).toContain("enable='between(t,0.000,0.500)'");
      expect(filter).toContain("enable='between(t,0.500,1.000)'");
    });

    it('respects fontSize option', () => {
      const filter = buildKaraokeFilter(transcription, {
        ...options,
        fontSize: 64,
      });

      expect(filter).toContain('fontsize=64');
    });

    it('includes box styling for background', () => {
      const filter = buildKaraokeFilter(transcription, options);

      expect(filter).toContain('box=1');
      expect(filter).toContain('boxcolor=black@0.5');
      expect(filter).toContain('boxborderw=8');
    });
  });

  describe('buildKaraokeFilterChain', () => {
    const transcription: TranscriptionArtifact = {
      text: 'Hello',
      words: [{ text: 'Hello', startTime: 0, endTime: 1, clipId: 'clip-1' }],
      segments: [],
      language: 'eng',
      totalDuration: 1,
    };

    const options = {
      width: 1920,
      height: 1080,
    };

    it('wraps filter with input and output labels', () => {
      const chain = buildKaraokeFilterChain('[v0]', transcription, options, 'vout');

      expect(chain).toMatch(/^\[v0\]/);
      expect(chain).toMatch(/\[vout\]$/);
    });

    it('returns null filter for empty transcription', () => {
      const empty: TranscriptionArtifact = {
        text: '',
        words: [],
        segments: [],
        language: 'eng',
        totalDuration: 0,
      };

      const chain = buildKaraokeFilterChain('[v0]', empty, options, 'vout');
      expect(chain).toBe('[v0]null[vout]');
    });
  });

  describe('buildAnimatedFontsize', () => {
    it('returns static fontsize for none animation', () => {
      const result = buildAnimatedFontsize(48, 0, 1, 'none', 1.15);
      expect(result).toBe('48');
    });

    it('returns FFmpeg expression for pop animation', () => {
      const result = buildAnimatedFontsize(48, 1.5, 2.0, 'pop', 1.15);
      // Should contain exponential decay expression with clamped elapsed time using gte()
      expect(result).toMatch(/^'\d+\+\d+\*exp\(-\d+\*\(t-[\d.]+\)\*gte\(t,[\d.]+\)\)'$/);
      expect(result).toContain('48+'); // base size
      expect(result).toContain('7'); // extra size (48 * 0.15 ≈ 7)
      expect(result).toContain('t-1.500'); // time offset
    });

    it('calculates correct extra size from scale factor', () => {
      // With scale 1.25 and fontSize 100, extra should be 25
      const result = buildAnimatedFontsize(100, 0, 1, 'pop', 1.25);
      expect(result).toContain('100+25');
    });

    it('handles small scale factors', () => {
      // With scale 1.05 and fontSize 48, extra should be ~2
      const result = buildAnimatedFontsize(48, 0, 1, 'pop', 1.05);
      expect(result).toContain('48+2');
    });
  });

  describe('animation integration', () => {
    const transcription: TranscriptionArtifact = {
      text: 'Hello world',
      words: [
        { text: 'Hello', startTime: 0, endTime: 0.5, clipId: 'clip-1' },
        { text: 'world', startTime: 0.5, endTime: 1, clipId: 'clip-1' },
      ],
      segments: [],
      language: 'eng',
      totalDuration: 1,
    };

    const options = {
      width: 1920,
      height: 1080,
    };

    it('uses pop animation by default', () => {
      const filter = buildKaraokeFilter(transcription, options);
      // Default is pop animation, should have exp() expression with clamped elapsed time using gte()
      expect(filter).toMatch(/fontsize='48\+\d+\*exp\(-\d+\*\(t-/);
    });

    it('uses no animation when set to none', () => {
      const filter = buildKaraokeFilter(transcription, {
        ...options,
        highlightAnimation: 'none',
      });
      // Highlight layers should have static fontsize
      // Count occurrences - background has fontsize=48, highlights should too
      const matches = filter.match(/fontsize=48/g);
      expect(matches?.length).toBeGreaterThanOrEqual(2); // background + highlights
    });

    it('respects custom animation scale', () => {
      const filter = buildKaraokeFilter(transcription, {
        ...options,
        highlightAnimation: 'pop',
        animationScale: 1.3, // 30% larger
        fontSize: 50,
      });
      // Extra size should be 50 * 0.3 = 15
      expect(filter).toContain('50+15');
    });
  });
});
