import { writeFile } from 'node:fs/promises';
import type { TranscriptionArtifact, TranscriptionWord } from '../../transcription/types.js';

/**
 * Options for rendering ASS karaoke subtitles.
 */
export interface AssRenderOptions {
  /** Output width in pixels */
  width: number;
  /** Output height in pixels */
  height: number;
  /** Font size in pixels (default: 48) */
  fontSize?: number;
  /** Font name (default: Arial) */
  fontName?: string;
  /** Default text color in hex format, e.g., "#FFFFFF" (default: white) */
  fontColor?: string;
  /** Highlight color for currently spoken word (default: #FFD700 - gold) */
  highlightColor?: string;
  /** Outline color (default: black) */
  outlineColor?: string;
  /** Position from bottom as percentage of height (default: 10) */
  bottomMarginPercent?: number;
  /** Maximum words to display at once per line (default: 8) */
  maxWordsPerLine?: number;
  /** Use background box instead of outline only (default: false) */
  boxBackground?: boolean;
  /** Background box color in hex format (default: #000000) */
  backgroundColor?: string;
  /** Background box opacity 0-1 (default: 0.5) */
  backgroundOpacity?: number;
}

const DEFAULT_FONT_SIZE = 48;
const DEFAULT_FONT_NAME = 'Arial';
const DEFAULT_FONT_COLOR = '#FFFFFF';
const DEFAULT_HIGHLIGHT_COLOR = '#FFD700';
const DEFAULT_OUTLINE_COLOR = '#000000';
const DEFAULT_BACKGROUND_COLOR = '#000000';
const DEFAULT_BACKGROUND_OPACITY = 0.5;
const DEFAULT_BOTTOM_MARGIN_PERCENT = 10;
const DEFAULT_MAX_WORDS_PER_LINE = 8;
const DEFAULT_OUTLINE_SIZE = 3; // Thick outline for readability
const DEFAULT_SHADOW_SIZE = 0; // Shadow off by default

/**
 * Word group for rendering - groups consecutive words to display together.
 */
interface WordGroup {
  /** Words in this group */
  words: TranscriptionWord[];
  /** Start time of the group */
  startTime: number;
  /** End time of the group */
  endTime: number;
}

/**
 * Check if a string is a valid 6-character hex color.
 */
function isValidHexColor(hex: string | undefined | null): hex is string {
  if (!hex || typeof hex !== 'string') {
    return false;
  }
  const cleanHex = hex.replace(/^#/, '');
  return /^[0-9A-Fa-f]{6}$/.test(cleanHex);
}

/**
 * Convert hex color (#RRGGBB) to ASS format (&HAABBGGRR).
 * ASS uses BGR order with alpha prefix.
 * Used for style definitions (PrimaryColour, OutlineColour, etc.).
 *
 * @param hex - Hex color string (with or without #)
 * @param alpha - Alpha value 0-1 (0 = opaque, 1 = transparent) - note: ASS alpha is inverted
 * @returns ASS color string
 */
export function hexToAssColor(hex: string, alpha: number = 0): string {
  // Validate and fallback to white if invalid
  const validHex = isValidHexColor(hex) ? hex : '#FFFFFF';

  // Remove # if present
  const cleanHex = validHex.replace(/^#/, '');

  // Parse RGB components
  const r = parseInt(cleanHex.slice(0, 2), 16);
  const g = parseInt(cleanHex.slice(2, 4), 16);
  const b = parseInt(cleanHex.slice(4, 6), 16);

  // ASS alpha: 00 = opaque, FF = transparent (inverted from typical alpha)
  const a = Math.round(alpha * 255);

  // Format as &HAABBGGRR (note: BGR order, not RGB)
  return `&H${a.toString(16).padStart(2, '0').toUpperCase()}${b.toString(16).padStart(2, '0').toUpperCase()}${g.toString(16).padStart(2, '0').toUpperCase()}${r.toString(16).padStart(2, '0').toUpperCase()}`;
}

/**
 * Convert hex color (#RRGGBB) to ASS inline override format (&HBBGGRR&).
 * Used for inline color tags like \1c, \2c, \3c, \4c.
 * Note: This format has NO alpha prefix and uses trailing ampersand.
 *
 * @param hex - Hex color string (with or without #)
 * @returns ASS inline color string
 */
export function hexToAssInlineColor(hex: string): string {
  // Validate and fallback to white if invalid
  const validHex = isValidHexColor(hex) ? hex : '#FFFFFF';

  // Remove # if present
  const cleanHex = validHex.replace(/^#/, '');

  // Parse RGB components
  const r = parseInt(cleanHex.slice(0, 2), 16);
  const g = parseInt(cleanHex.slice(2, 4), 16);
  const b = parseInt(cleanHex.slice(4, 6), 16);

  // Format as &HBBGGRR& (BGR order, no alpha, trailing &)
  return `&H${b.toString(16).padStart(2, '0').toUpperCase()}${g.toString(16).padStart(2, '0').toUpperCase()}${r.toString(16).padStart(2, '0').toUpperCase()}&`;
}

/**
 * Convert seconds to ASS time format (H:MM:SS.cc where cc is centiseconds).
 *
 * @param seconds - Time in seconds
 * @returns ASS formatted time string
 */
export function formatAssTime(seconds: number): string {
  // Round to centiseconds first to handle overflow correctly
  const totalCentiseconds = Math.round(seconds * 100);
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const cs = totalCentiseconds % 100;

  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

/**
 * Escape special characters for ASS subtitle text.
 *
 * @param text - Text to escape
 * @returns Escaped text safe for ASS
 */
export function escapeAssText(text: string): string {
  return text
    // Escape backslashes first
    .replace(/\\/g, '\\\\')
    // Escape curly braces (used for override tags)
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    // Handle newlines
    .replace(/\n/g, '\\N');
}

/**
 * Group consecutive words into display lines.
 */
export function groupWordsIntoLines(
  words: TranscriptionWord[],
  maxWordsPerLine: number
): WordGroup[] {
  const groups: WordGroup[] = [];
  let currentGroup: TranscriptionWord[] = [];

  for (const word of words) {
    currentGroup.push(word);

    // Create a new group when we reach max words
    if (currentGroup.length >= maxWordsPerLine) {
      groups.push({
        words: currentGroup,
        startTime: currentGroup[0]!.startTime,
        endTime: currentGroup[currentGroup.length - 1]!.endTime,
      });
      currentGroup = [];
    }
  }

  // Add remaining words
  if (currentGroup.length > 0) {
    groups.push({
      words: currentGroup,
      startTime: currentGroup[0]!.startTime,
      endTime: currentGroup[currentGroup.length - 1]!.endTime,
    });
  }

  return groups;
}

/**
 * Build a single karaoke dialogue line for a word group.
 * Uses \k tags for timing - words progressively highlight as they're spoken.
 * This creates ONE dialogue line per group, eliminating flashing.
 *
 * With \k tags:
 * - Words start in SecondaryColour (default/before)
 * - Words change to PrimaryColour after their duration (highlighted/after)
 * - Words STAY highlighted after being spoken (traditional karaoke style)
 *
 * @param group - Word group to render
 * @param styleName - Style name to use
 * @returns ASS dialogue line with karaoke timing
 */
function buildKaraokeDialogueLine(group: WordGroup, styleName: string): string {
  // Build text with \k timing tags for each word
  // \k duration is in centiseconds (1/100th of a second)
  const textParts = group.words.map((word) => {
    const escaped = escapeAssText(word.text);
    // Duration in centiseconds
    const durationCs = Math.round((word.endTime - word.startTime) * 100);
    return `{\\k${durationCs}}${escaped}`;
  });

  const formattedStart = formatAssTime(group.startTime);
  const formattedEnd = formatAssTime(group.endTime);

  // Dialogue format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
  return `Dialogue: 0,${formattedStart},${formattedEnd},${styleName},,0,0,0,,${textParts.join(' ')}`;
}

/**
 * Build karaoke dialogue lines for all word groups.
 * One line per group - no flashing!
 */
function buildKaraokeDialogueLines(
  groups: WordGroup[],
  styleName: string
): string[] {
  return groups.map((group) => buildKaraokeDialogueLine(group, styleName));
}

/**
 * Build complete ASS subtitle content with word-by-word highlighting.
 *
 * Uses traditional karaoke \k tags for timing. Words progressively highlight
 * as they're spoken and STAY highlighted (no flashing).
 *
 * Color behavior with \k tags:
 * - SecondaryColour = "before" color (default, not yet spoken)
 * - PrimaryColour = "after" color (highlighted, already spoken)
 *
 * @param transcription - Word-level transcription data
 * @param options - Rendering options
 * @returns Complete ASS file content as string
 */
export function buildAssSubtitles(
  transcription: TranscriptionArtifact,
  options: AssRenderOptions
): string {
  if (transcription.words.length === 0) {
    return '';
  }

  const width = options.width;
  const height = options.height;
  const fontSize = options.fontSize ?? DEFAULT_FONT_SIZE;
  const fontName = options.fontName ?? DEFAULT_FONT_NAME;
  const fontColor = options.fontColor ?? DEFAULT_FONT_COLOR;
  const highlightColor = options.highlightColor ?? DEFAULT_HIGHLIGHT_COLOR;
  const outlineColor = options.outlineColor ?? DEFAULT_OUTLINE_COLOR;
  const bottomMarginPercent = options.bottomMarginPercent ?? DEFAULT_BOTTOM_MARGIN_PERCENT;
  const maxWordsPerLine = options.maxWordsPerLine ?? DEFAULT_MAX_WORDS_PER_LINE;
  const boxBackground = options.boxBackground ?? false;
  const backgroundColor = options.backgroundColor ?? DEFAULT_BACKGROUND_COLOR;
  const backgroundOpacity = options.backgroundOpacity ?? DEFAULT_BACKGROUND_OPACITY;

  // Calculate margin from bottom (in pixels)
  const marginV = Math.round(height * (bottomMarginPercent / 100));

  // For karaoke mode with \k tags:
  // - PrimaryColour = highlighted/after color (gold) - shown AFTER word timing
  // - SecondaryColour = default/before color (white) - shown BEFORE word timing
  const primaryColor = hexToAssColor(highlightColor, 0); // Highlight = after
  const secondaryColor = hexToAssColor(fontColor, 0); // Default = before
  const outlineColorAss = hexToAssColor(outlineColor, 0);
  const backColorAss = boxBackground
    ? hexToAssColor(backgroundColor, backgroundOpacity)
    : hexToAssColor('#000000', 1); // Fully transparent if no box

  // BorderStyle: 1 = outline + drop shadow (no box), 3 = outline + opaque box
  const borderStyle = boxBackground ? 3 : 1;

  // Build style definition
  // Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,
  //         Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle,
  //         BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
  const styleName = 'Default';
  const styleLine = `Style: ${styleName},${fontName},${fontSize},${primaryColor},${secondaryColor},${outlineColorAss},${backColorAss},0,0,0,0,100,100,0,0,${borderStyle},${DEFAULT_OUTLINE_SIZE},${DEFAULT_SHADOW_SIZE},2,10,10,${marginV},1`;

  // Group words into lines
  const wordGroups = groupWordsIntoLines(transcription.words, maxWordsPerLine);

  // Build karaoke dialogue lines (one per group - no flashing!)
  const dialogueLines = buildKaraokeDialogueLines(wordGroups, styleName);

  // Assemble complete ASS content
  const lines = [
    '[Script Info]',
    'Title: Karaoke Subtitles',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    styleLine,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...dialogueLines,
  ];

  return lines.join('\n');
}

/**
 * Generate ASS file and write to disk.
 *
 * @param transcription - Word-level transcription data
 * @param options - Rendering options
 * @param outputPath - Path to write the ASS file
 * @returns Path to the generated ASS file
 */
export async function generateAssFile(
  transcription: TranscriptionArtifact,
  options: AssRenderOptions,
  outputPath: string
): Promise<string> {
  const assContent = buildAssSubtitles(transcription, options);
  await writeFile(outputPath, assContent, 'utf-8');
  return outputPath;
}

// Export for testing
export const __test__ = {
  groupWordsIntoLines,
  buildKaraokeDialogueLine,
  buildKaraokeDialogueLines,
};
