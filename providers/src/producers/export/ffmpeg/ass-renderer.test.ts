import { describe, it, expect } from 'vitest';
import {
  buildAssSubtitles,
  hexToAssColor,
  hexToAssInlineColor,
  formatAssTime,
  escapeAssText,
  groupWordsIntoLines,
  __test__,
} from './ass-renderer.js';
import type { TranscriptionArtifact } from '../../transcription/types.js';

const {
  buildKaraokeDialogueLine,
  buildKaraokeDialogueLines,
  buildSimpleDialogueLine,
  buildSimpleDialogueLines,
} = __test__;

describe('ass-renderer', () => {
  describe('hexToAssColor', () => {
    it('converts white to ASS format', () => {
      expect(hexToAssColor('#FFFFFF')).toBe('&H00FFFFFF');
    });

    it('converts black to ASS format', () => {
      expect(hexToAssColor('#000000')).toBe('&H00000000');
    });

    it('converts gold (#FFD700) to ASS format', () => {
      // ASS uses BGR, so FFD700 (RGB) becomes 00D7FF (BGR)
      expect(hexToAssColor('#FFD700')).toBe('&H0000D7FF');
    });

    it('converts red to ASS format', () => {
      // Red is FF0000 in RGB, becomes 0000FF in BGR
      expect(hexToAssColor('#FF0000')).toBe('&H000000FF');
    });

    it('converts green to ASS format', () => {
      // Green is 00FF00 in RGB, becomes 00FF00 in BGR
      expect(hexToAssColor('#00FF00')).toBe('&H0000FF00');
    });

    it('converts blue to ASS format', () => {
      // Blue is 0000FF in RGB, becomes FF0000 in BGR
      expect(hexToAssColor('#0000FF')).toBe('&H00FF0000');
    });

    it('handles alpha value for semi-transparent', () => {
      // 50% alpha (0.5) = 128 = 0x80
      expect(hexToAssColor('#000000', 0.5)).toBe('&H80000000');
    });

    it('handles fully transparent', () => {
      expect(hexToAssColor('#FFFFFF', 1)).toBe('&HFFFFFFFF');
    });

    it('handles hex without # prefix', () => {
      expect(hexToAssColor('FFD700')).toBe('&H0000D7FF');
    });
  });

  describe('hexToAssInlineColor', () => {
    it('converts white to ASS inline format', () => {
      expect(hexToAssInlineColor('#FFFFFF')).toBe('&HFFFFFF&');
    });

    it('converts black to ASS inline format', () => {
      expect(hexToAssInlineColor('#000000')).toBe('&H000000&');
    });

    it('converts gold (#FFD700) to ASS inline format', () => {
      // ASS uses BGR, so FFD700 (RGB) becomes 00D7FF (BGR)
      expect(hexToAssInlineColor('#FFD700')).toBe('&H00D7FF&');
    });

    it('converts red to ASS inline format', () => {
      // Red is FF0000 in RGB, becomes 0000FF in BGR
      expect(hexToAssInlineColor('#FF0000')).toBe('&H0000FF&');
    });

    it('converts green to ASS inline format', () => {
      // Green is 00FF00 in RGB, stays 00FF00 in BGR
      expect(hexToAssInlineColor('#00FF00')).toBe('&H00FF00&');
    });

    it('converts blue to ASS inline format', () => {
      // Blue is 0000FF in RGB, becomes FF0000 in BGR
      expect(hexToAssInlineColor('#0000FF')).toBe('&HFF0000&');
    });

    it('handles hex without # prefix', () => {
      expect(hexToAssInlineColor('FFD700')).toBe('&H00D7FF&');
    });

    it('does NOT include alpha prefix (unlike hexToAssColor)', () => {
      const styleColor = hexToAssColor('#FFFFFF', 0);
      const inlineColor = hexToAssInlineColor('#FFFFFF');
      // Style format has alpha prefix: &H00FFFFFF
      expect(styleColor).toBe('&H00FFFFFF');
      // Inline format has no alpha, has trailing &: &HFFFFFF&
      expect(inlineColor).toBe('&HFFFFFF&');
    });

    it('falls back to white for invalid hex input', () => {
      // Invalid inputs should produce white (&HFFFFFF&)
      expect(hexToAssInlineColor('invalid')).toBe('&HFFFFFF&');
      expect(hexToAssInlineColor('white')).toBe('&HFFFFFF&');
      expect(hexToAssInlineColor('')).toBe('&HFFFFFF&');
    });

    it('falls back to white for undefined/null-like input', () => {
      // @ts-expect-error - testing runtime behavior with invalid types
      expect(hexToAssInlineColor(undefined)).toBe('&HFFFFFF&');
      // @ts-expect-error - testing runtime behavior with invalid types
      expect(hexToAssInlineColor(null)).toBe('&HFFFFFF&');
    });
  });

  describe('formatAssTime', () => {
    it('formats zero seconds', () => {
      expect(formatAssTime(0)).toBe('0:00:00.00');
    });

    it('formats seconds with centiseconds', () => {
      expect(formatAssTime(1.5)).toBe('0:00:01.50');
    });

    it('formats minutes correctly', () => {
      expect(formatAssTime(125.75)).toBe('0:02:05.75');
    });

    it('formats hours correctly', () => {
      expect(formatAssTime(3661.23)).toBe('1:01:01.23');
    });

    it('rounds centiseconds correctly', () => {
      expect(formatAssTime(0.999)).toBe('0:00:01.00');
      expect(formatAssTime(0.994)).toBe('0:00:00.99');
    });

    it('pads single digits with zeros', () => {
      expect(formatAssTime(61.05)).toBe('0:01:01.05');
    });
  });

  describe('escapeAssText', () => {
    it('escapes backslashes', () => {
      expect(escapeAssText('path\\file')).toBe('path\\\\file');
    });

    it('escapes curly braces', () => {
      expect(escapeAssText('text {tag} here')).toBe('text \\{tag\\} here');
    });

    it('escapes newlines', () => {
      expect(escapeAssText('line1\nline2')).toBe('line1\\Nline2');
    });

    it('handles multiple special characters', () => {
      expect(escapeAssText('test\\{data}\nend')).toBe('test\\\\\\{data\\}\\Nend');
    });

    it('leaves normal text unchanged', () => {
      expect(escapeAssText('Hello world')).toBe('Hello world');
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
  });

  describe('buildKaraokeDialogueLine', () => {
    const group = {
      words: [
        { text: 'Hello', startTime: 0, endTime: 0.5, clipId: 'clip-1' },
        { text: 'world', startTime: 0.5, endTime: 1, clipId: 'clip-1' },
        { text: 'today', startTime: 1, endTime: 1.5, clipId: 'clip-1' },
      ],
      startTime: 0,
      endTime: 1.5,
    };

    it('generates dialogue line with Layer 0', () => {
      const result = buildKaraokeDialogueLine(group, 'Default');
      expect(result).toMatch(/^Dialogue: 0,/);
    });

    it('uses group timing for start/end', () => {
      const result = buildKaraokeDialogueLine(group, 'Default');
      expect(result).toContain('0:00:00.00,0:00:01.50');
    });

    it('includes \\k tags with duration in centiseconds', () => {
      const result = buildKaraokeDialogueLine(group, 'Default');
      // Each word is 0.5s = 50 centiseconds
      expect(result).toContain('{\\k50}Hello');
      expect(result).toContain('{\\k50}world');
      expect(result).toContain('{\\k50}today');
    });

    it('includes all words in the line', () => {
      const result = buildKaraokeDialogueLine(group, 'Default');
      expect(result).toContain('Hello');
      expect(result).toContain('world');
      expect(result).toContain('today');
    });

    it('uses specified style', () => {
      const result = buildKaraokeDialogueLine(group, 'MyStyle');
      expect(result).toContain(',MyStyle,');
    });

    it('escapes special characters in words', () => {
      const groupWithSpecial = {
        words: [
          { text: 'Hello{world}', startTime: 0, endTime: 0.5, clipId: 'clip-1' },
        ],
        startTime: 0,
        endTime: 0.5,
      };
      const result = buildKaraokeDialogueLine(groupWithSpecial, 'Default');
      expect(result).toContain('Hello\\{world\\}');
    });

    it('handles varying word durations', () => {
      const variedGroup = {
        words: [
          { text: 'Quick', startTime: 0, endTime: 0.2, clipId: 'clip-1' }, // 20cs
          { text: 'slow', startTime: 0.2, endTime: 1.2, clipId: 'clip-1' }, // 100cs
        ],
        startTime: 0,
        endTime: 1.2,
      };
      const result = buildKaraokeDialogueLine(variedGroup, 'Default');
      expect(result).toContain('{\\k20}Quick');
      expect(result).toContain('{\\k100}slow');
    });
  });

  describe('buildKaraokeDialogueLines', () => {
    const groups = [
      {
        words: [
          { text: 'Hello', startTime: 0, endTime: 0.5, clipId: 'clip-1' },
          { text: 'world', startTime: 0.5, endTime: 1, clipId: 'clip-1' },
        ],
        startTime: 0,
        endTime: 1,
      },
      {
        words: [
          { text: 'Good', startTime: 1.5, endTime: 2, clipId: 'clip-1' },
          { text: 'day', startTime: 2, endTime: 2.5, clipId: 'clip-1' },
        ],
        startTime: 1.5,
        endTime: 2.5,
      },
    ];

    it('generates one dialogue line per group', () => {
      const lines = buildKaraokeDialogueLines(groups, 'Default');
      expect(lines.length).toBe(2);
    });

    it('all lines are Layer 0', () => {
      const lines = buildKaraokeDialogueLines(groups, 'Default');
      expect(lines[0]).toMatch(/^Dialogue: 0,/);
      expect(lines[1]).toMatch(/^Dialogue: 0,/);
    });

    it('each line has \\k tags for its words', () => {
      const lines = buildKaraokeDialogueLines(groups, 'Default');

      // First group
      expect(lines[0]).toContain('{\\k50}Hello');
      expect(lines[0]).toContain('{\\k50}world');

      // Second group
      expect(lines[1]).toContain('{\\k50}Good');
      expect(lines[1]).toContain('{\\k50}day');
    });

    it('each line has correct group timing', () => {
      const lines = buildKaraokeDialogueLines(groups, 'Default');
      expect(lines[0]).toContain('0:00:00.00,0:00:01.00');
      expect(lines[1]).toContain('0:00:01.50,0:00:02.50');
    });
  });

  describe('buildSimpleDialogueLine', () => {
    const group = {
      words: [
        { text: 'Hello', startTime: 0, endTime: 0.5, clipId: 'clip-1' },
        { text: 'world', startTime: 0.5, endTime: 1, clipId: 'clip-1' },
      ],
      startTime: 0,
      endTime: 1,
    };

    it('generates dialogue line with Layer 0', () => {
      const result = buildSimpleDialogueLine(group, 'Default');
      expect(result).toMatch(/^Dialogue: 0,/);
    });

    it('uses group timing for start/end', () => {
      const result = buildSimpleDialogueLine(group, 'Default');
      expect(result).toContain('0:00:00.00,0:00:01.00');
    });

    it('does NOT include \\k tags (simple mode)', () => {
      const result = buildSimpleDialogueLine(group, 'Default');
      expect(result).not.toContain('{\\k');
    });

    it('includes all words joined by space', () => {
      const result = buildSimpleDialogueLine(group, 'Default');
      expect(result).toContain('Hello world');
    });

    it('uses specified style', () => {
      const result = buildSimpleDialogueLine(group, 'MyStyle');
      expect(result).toContain(',MyStyle,');
    });

    it('escapes special characters in words', () => {
      const groupWithSpecial = {
        words: [
          { text: 'Hello{world}', startTime: 0, endTime: 0.5, clipId: 'clip-1' },
        ],
        startTime: 0,
        endTime: 0.5,
      };
      const result = buildSimpleDialogueLine(groupWithSpecial, 'Default');
      expect(result).toContain('Hello\\{world\\}');
    });
  });

  describe('buildSimpleDialogueLines', () => {
    const groups = [
      {
        words: [
          { text: 'Hello', startTime: 0, endTime: 0.5, clipId: 'clip-1' },
          { text: 'world', startTime: 0.5, endTime: 1, clipId: 'clip-1' },
        ],
        startTime: 0,
        endTime: 1,
      },
      {
        words: [
          { text: 'Good', startTime: 1.5, endTime: 2, clipId: 'clip-1' },
          { text: 'day', startTime: 2, endTime: 2.5, clipId: 'clip-1' },
        ],
        startTime: 1.5,
        endTime: 2.5,
      },
    ];

    it('generates one dialogue line per group', () => {
      const lines = buildSimpleDialogueLines(groups, 'Default');
      expect(lines.length).toBe(2);
    });

    it('lines do NOT have \\k tags (simple mode)', () => {
      const lines = buildSimpleDialogueLines(groups, 'Default');
      expect(lines[0]).not.toContain('{\\k');
      expect(lines[1]).not.toContain('{\\k');
    });

    it('each line has words joined by space', () => {
      const lines = buildSimpleDialogueLines(groups, 'Default');
      expect(lines[0]).toContain('Hello world');
      expect(lines[1]).toContain('Good day');
    });

    it('each line has correct group timing', () => {
      const lines = buildSimpleDialogueLines(groups, 'Default');
      expect(lines[0]).toContain('0:00:00.00,0:00:01.00');
      expect(lines[1]).toContain('0:00:01.50,0:00:02.50');
    });
  });

  describe('buildAssSubtitles', () => {
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

    it('returns empty string for empty transcription', () => {
      const empty: TranscriptionArtifact = {
        text: '',
        words: [],
        segments: [],
        language: 'eng',
        totalDuration: 0,
      };
      expect(buildAssSubtitles(empty, options)).toBe('');
    });

    it('generates valid ASS structure', () => {
      const result = buildAssSubtitles(transcription, options);
      expect(result).toContain('[Script Info]');
      expect(result).toContain('[V4+ Styles]');
      expect(result).toContain('[Events]');
    });

    it('includes correct resolution', () => {
      const result = buildAssSubtitles(transcription, options);
      expect(result).toContain('PlayResX: 1920');
      expect(result).toContain('PlayResY: 1080');
    });

    it('includes single Default style definition', () => {
      const result = buildAssSubtitles(transcription, options);
      expect(result).toContain('Style: Default,');
      // Should NOT have separate Highlight style (colors are inline)
      expect(result).not.toContain('Style: Highlight,');
    });

    it('includes dialogue lines with karaoke tags', () => {
      const result = buildAssSubtitles(transcription, options);
      // All dialogue lines should be Layer 0
      expect(result).toContain('Dialogue: 0,');
      // Should NOT have Layer 1
      expect(result).not.toContain('Dialogue: 1,');
      // Should have karaoke timing tags
      expect(result).toContain('{\\k');
    });

    it('uses BorderStyle 1 (no box) by default when backgroundOpacity is 0', () => {
      const result = buildAssSubtitles(transcription, options);
      // BorderStyle is field 16 in the style definition
      // Format: ...0,0,<BorderStyle>,<Outline>,<Shadow>,...
      expect(result).toMatch(/Style: Default,[^,]+,[^,]+,[^,]+,[^,]+,[^,]+,[^,]+,0,0,0,0,100,100,0,0,1,/);
    });

    it('uses BorderStyle 3 (box) when backgroundOpacity is greater than 0', () => {
      const result = buildAssSubtitles(transcription, {
        ...options,
        backgroundOpacity: 0.5,
      });
      expect(result).toMatch(/Style: Default,[^,]+,[^,]+,[^,]+,[^,]+,[^,]+,[^,]+,0,0,0,0,100,100,0,0,3,/);
    });

    it('respects custom font size', () => {
      const result = buildAssSubtitles(transcription, { ...options, fontSize: 64 });
      expect(result).toContain(',64,'); // Font size in style
    });

    it('uses highlight as Primary and base as Secondary in style when highlightEffect is true', () => {
      const result = buildAssSubtitles(transcription, {
        ...options,
        fontBaseColor: '#FFFFFF',
        fontHighlightColor: '#FFD700',
        highlightEffect: true,
      });
      // In karaoke mode (highlightEffect: true):
      // - PrimaryColour = highlight (gold) - shown AFTER word timing
      // - SecondaryColour = base (white) - shown BEFORE word timing
      // Style format: Name,Font,Size,Primary,Secondary,...
      // Gold (#FFD700) in BGR with alpha = &H0000D7FF
      // White (#FFFFFF) in BGR with alpha = &H00FFFFFF
      expect(result).toMatch(/Style: Default,[^,]+,[^,]+,&H0000D7FF,&H00FFFFFF,/);
    });

    it('uses base color for both Primary and Secondary when highlightEffect is false', () => {
      const result = buildAssSubtitles(transcription, {
        ...options,
        fontBaseColor: '#FFFFFF',
        fontHighlightColor: '#FFD700', // Should be ignored
        highlightEffect: false,
      });
      // In simple mode (highlightEffect: false):
      // - PrimaryColour = base (white)
      // - SecondaryColour = base (white)
      // Both should be white (#FFFFFF in BGR = &H00FFFFFF)
      expect(result).toMatch(/Style: Default,[^,]+,[^,]+,&H00FFFFFF,&H00FFFFFF,/);
    });

    it('calculates bottom margin from percent', () => {
      const result = buildAssSubtitles(transcription, {
        ...options,
        bottomMarginPercent: 20,
      });
      // 20% of 1080 = 216
      expect(result).toContain(',216,1'); // MarginV at end of style
    });

    it('generates one dialogue line per word group with karaoke tags', () => {
      const result = buildAssSubtitles(transcription, options);

      const lines = result.split('\n');
      const dialogueLines = lines.filter((line) => line.startsWith('Dialogue:'));

      // 2 words in 1 group = 1 dialogue line (karaoke mode: one line per group)
      expect(dialogueLines.length).toBe(1);

      // Line should have all words with karaoke timing
      expect(dialogueLines[0]).toContain('Hello');
      expect(dialogueLines[0]).toContain('world');

      // Line should have karaoke timing tags
      expect(dialogueLines[0]).toContain('{\\k');
    });

    it('groups words according to maxWordsPerLine', () => {
      const longTranscription: TranscriptionArtifact = {
        text: 'one two three four five six',
        words: [
          { text: 'one', startTime: 0, endTime: 0.5, clipId: 'clip-1' },
          { text: 'two', startTime: 0.5, endTime: 1, clipId: 'clip-1' },
          { text: 'three', startTime: 1, endTime: 1.5, clipId: 'clip-1' },
          { text: 'four', startTime: 1.5, endTime: 2, clipId: 'clip-1' },
          { text: 'five', startTime: 2, endTime: 2.5, clipId: 'clip-1' },
          { text: 'six', startTime: 2.5, endTime: 3, clipId: 'clip-1' },
        ],
        segments: [],
        language: 'eng',
        totalDuration: 3,
      };

      const result = buildAssSubtitles(longTranscription, {
        ...options,
        maxWordsPerLine: 3,
      });

      const lines = result.split('\n');
      const dialogueLines = lines.filter((line) => line.startsWith('Dialogue:'));

      // 6 words with max 3 per line = 2 groups
      // Karaoke mode: 1 dialogue line per group = 2 lines
      expect(dialogueLines.length).toBe(2);

      // First line should contain "one two three"
      expect(dialogueLines[0]).toContain('one');
      expect(dialogueLines[0]).toContain('two');
      expect(dialogueLines[0]).toContain('three');
      expect(dialogueLines[0]).not.toContain('four');

      // Second line should contain "four five six"
      expect(dialogueLines[1]).toContain('four');
      expect(dialogueLines[1]).toContain('five');
      expect(dialogueLines[1]).toContain('six');
      expect(dialogueLines[1]).not.toContain('three');
    });

    it('each dialogue line has correct group timing', () => {
      const result = buildAssSubtitles(transcription, options);

      const lines = result.split('\n');
      const dialogueLines = lines.filter((line) => line.startsWith('Dialogue:'));

      // Single line for the group: 0-1s (covers both words)
      expect(dialogueLines[0]).toContain('0:00:00.00,0:00:01.00');
    });

    it('includes \\k tags with word durations in dialogue', () => {
      const result = buildAssSubtitles(transcription, options);

      const lines = result.split('\n');
      const dialogueLines = lines.filter((line) => line.startsWith('Dialogue:'));

      // Each word is 0.5s = 50 centiseconds
      expect(dialogueLines[0]).toContain('{\\k50}Hello');
      expect(dialogueLines[0]).toContain('{\\k50}world');
    });

    it('generates simple subtitles without \\k tags when highlightEffect is false', () => {
      const result = buildAssSubtitles(transcription, {
        ...options,
        highlightEffect: false,
      });

      const lines = result.split('\n');
      const dialogueLines = lines.filter((line) => line.startsWith('Dialogue:'));

      // Should have dialogue lines
      expect(dialogueLines.length).toBeGreaterThan(0);

      // Should NOT have karaoke timing tags
      expect(dialogueLines[0]).not.toContain('{\\k');

      // Should have words as plain text
      expect(dialogueLines[0]).toContain('Hello world');
    });

    it('respects custom font name', () => {
      const result = buildAssSubtitles(transcription, {
        ...options,
        font: 'Helvetica',
      });
      // Style format: Name,Fontname,Fontsize,...
      expect(result).toContain('Style: Default,Helvetica,');
    });

    it('uses default maxWordsPerLine of 4', () => {
      const longTranscription: TranscriptionArtifact = {
        text: 'one two three four five',
        words: [
          { text: 'one', startTime: 0, endTime: 0.5, clipId: 'clip-1' },
          { text: 'two', startTime: 0.5, endTime: 1, clipId: 'clip-1' },
          { text: 'three', startTime: 1, endTime: 1.5, clipId: 'clip-1' },
          { text: 'four', startTime: 1.5, endTime: 2, clipId: 'clip-1' },
          { text: 'five', startTime: 2, endTime: 2.5, clipId: 'clip-1' },
        ],
        segments: [],
        language: 'eng',
        totalDuration: 2.5,
      };

      // With default maxWordsPerLine of 4, 5 words should create 2 groups
      const result = buildAssSubtitles(longTranscription, options);
      const lines = result.split('\n');
      const dialogueLines = lines.filter((line) => line.startsWith('Dialogue:'));

      // 5 words with max 4 per line = 2 groups
      expect(dialogueLines.length).toBe(2);
    });
  });
});
