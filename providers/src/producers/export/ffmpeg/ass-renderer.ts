import { writeFile } from 'node:fs/promises';
import type {
  TranscriptionArtifact,
  TranscriptionWord,
} from '../../transcription/types.js';
import type { OverlayPosition } from './types.js';

/**
 * Options for rendering ASS subtitles with optional karaoke-style highlighting.
 */
export interface AssRenderOptions {
  /** Output width in pixels */
  width: number;
  /** Output height in pixels */
  height: number;
  /** Font name - uses system fonts (default: Arial) */
  font?: string;
  /** Font size in pixels (default: 48) */
  fontSize?: number;
  /** Default text color in hex format, e.g., "#FFFFFF" (default: white) */
  fontBaseColor?: string;
  /** Highlight color for currently spoken word (default: #FFD700 - gold) */
  fontHighlightColor?: string;
  /** Outline color (default: black) */
  outlineColor?: string;
  /** Background box color in hex format (default: #000000) */
  backgroundColor?: string;
  /** Background box opacity 0-1, 0 = no box (default: 0) */
  backgroundOpacity?: number;
  /** Subtitle anchor position (default: bottom-center) */
  position?: OverlayPosition;
  /** Distance from anchored edges as percentage of height (default: 8) */
  edgePaddingPercent?: number;
  /** Maximum words to display at once per line (default: 4) */
  maxWordsPerLine?: number;
  /** Enable karaoke-style word highlighting (default: true) */
  highlightEffect?: boolean;
}

const DEFAULT_FONT_NAME = 'Arial';
const DEFAULT_FONT_SIZE = 48;
const DEFAULT_FONT_BASE_COLOR = '#FFFFFF';
const DEFAULT_FONT_HIGHLIGHT_COLOR = '#FFD700';
const DEFAULT_OUTLINE_COLOR = '#000000';
const DEFAULT_BACKGROUND_COLOR = '#000000';
const DEFAULT_BACKGROUND_OPACITY = 0; // 0 = no box by default
const DEFAULT_POSITION: OverlayPosition = 'bottom-center';
const DEFAULT_EDGE_PADDING_PERCENT = 8;
const DEFAULT_MAX_WORDS_PER_LINE = 4;
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
  return (
    text
      // Escape backslashes first
      .replace(/\\/g, '\\\\')
      // Escape curly braces (used for override tags)
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}')
      // Handle newlines
      .replace(/\n/g, '\\N')
  );
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
 * Options for building dialogue lines.
 */
interface DialogueOptions {
  /** Background alpha override (for BorderStyle=3 compatibility) */
  backgroundAlphaOverride?: string;
  /** Fixed subtitle position override (\an + \pos) */
  positionOverride?: string;
}

interface PlacementOptions {
  width: number;
  height: number;
  position: OverlayPosition;
  edgePaddingPercent: number;
}

function resolvePlacement(options: PlacementOptions): {
  alignment: number;
  x: number;
  y: number;
} {
  const edgePaddingPx = Math.round(
    options.height * (options.edgePaddingPercent / 100)
  );

  switch (options.position) {
    case 'top-left':
      return { alignment: 7, x: edgePaddingPx, y: edgePaddingPx };
    case 'top-center':
      return {
        alignment: 8,
        x: Math.round(options.width / 2),
        y: edgePaddingPx,
      };
    case 'top-right':
      return {
        alignment: 9,
        x: options.width - edgePaddingPx,
        y: edgePaddingPx,
      };
    case 'middle-left':
      return {
        alignment: 4,
        x: edgePaddingPx,
        y: Math.round(options.height / 2),
      };
    case 'middle-center':
      return {
        alignment: 5,
        x: Math.round(options.width / 2),
        y: Math.round(options.height / 2),
      };
    case 'middle-right':
      return {
        alignment: 6,
        x: options.width - edgePaddingPx,
        y: Math.round(options.height / 2),
      };
    case 'bottom-left':
      return {
        alignment: 1,
        x: edgePaddingPx,
        y: options.height - edgePaddingPx,
      };
    case 'bottom-center':
      return {
        alignment: 2,
        x: Math.round(options.width / 2),
        y: options.height - edgePaddingPx,
      };
    case 'bottom-right':
      return {
        alignment: 3,
        x: options.width - edgePaddingPx,
        y: options.height - edgePaddingPx,
      };
  }
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
 * @param dialogueOptions - Optional dialogue options including alpha overrides
 * @returns ASS dialogue line with karaoke timing
 */
function buildKaraokeDialogueLine(
  group: WordGroup,
  styleName: string,
  dialogueOptions?: DialogueOptions
): string {
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

  // Build text content with optional alpha override
  // The \4a tag overrides shadow/background alpha (needed for BorderStyle=3 transparency)
  const overrideTags: string[] = [];
  if (dialogueOptions?.positionOverride) {
    overrideTags.push(dialogueOptions.positionOverride);
  }
  if (dialogueOptions?.backgroundAlphaOverride) {
    overrideTags.push(`\\4a${dialogueOptions.backgroundAlphaOverride}`);
  }
  const textContent =
    overrideTags.length > 0
      ? `{${overrideTags.join('')}}${textParts.join(' ')}`
      : textParts.join(' ');

  // Dialogue format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
  return `Dialogue: 0,${formattedStart},${formattedEnd},${styleName},,0,0,0,,${textContent}`;
}

/**
 * Build karaoke dialogue lines for all word groups.
 * One line per group - no flashing!
 */
function buildKaraokeDialogueLines(
  groups: WordGroup[],
  styleName: string,
  dialogueOptions?: DialogueOptions
): string[] {
  return groups.map((group) =>
    buildKaraokeDialogueLine(group, styleName, dialogueOptions)
  );
}

/**
 * Build a simple dialogue line for a word group (no karaoke highlighting).
 * All words display in the same color for the duration of the group.
 *
 * @param group - Word group to render
 * @param styleName - Style name to use
 * @param dialogueOptions - Optional dialogue options including alpha overrides
 * @returns ASS dialogue line without karaoke timing
 */
function buildSimpleDialogueLine(
  group: WordGroup,
  styleName: string,
  dialogueOptions?: DialogueOptions
): string {
  const text = group.words.map((w) => escapeAssText(w.text)).join(' ');
  const formattedStart = formatAssTime(group.startTime);
  const formattedEnd = formatAssTime(group.endTime);

  // Build text content with optional alpha override
  const overrideTags: string[] = [];
  if (dialogueOptions?.positionOverride) {
    overrideTags.push(dialogueOptions.positionOverride);
  }
  if (dialogueOptions?.backgroundAlphaOverride) {
    overrideTags.push(`\\4a${dialogueOptions.backgroundAlphaOverride}`);
  }
  const textContent =
    overrideTags.length > 0 ? `{${overrideTags.join('')}}${text}` : text;

  return `Dialogue: 0,${formattedStart},${formattedEnd},${styleName},,0,0,0,,${textContent}`;
}

/**
 * Build simple dialogue lines for all word groups (no highlighting).
 */
function buildSimpleDialogueLines(
  groups: WordGroup[],
  styleName: string,
  dialogueOptions?: DialogueOptions
): string[] {
  return groups.map((group) =>
    buildSimpleDialogueLine(group, styleName, dialogueOptions)
  );
}

/**
 * Build complete ASS subtitle content with optional word-by-word highlighting.
 *
 * When highlightEffect is true (default):
 * - Uses traditional karaoke \k tags for timing
 * - Words progressively highlight as they're spoken and STAY highlighted
 * - Color behavior: SecondaryColour = "before", PrimaryColour = "after"
 *
 * When highlightEffect is false:
 * - Simple subtitles without karaoke timing
 * - All text displays in fontBaseColor
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
  const fontName = options.font ?? DEFAULT_FONT_NAME;
  const fontSize = options.fontSize ?? DEFAULT_FONT_SIZE;
  const fontBaseColor = options.fontBaseColor ?? DEFAULT_FONT_BASE_COLOR;
  const fontHighlightColor =
    options.fontHighlightColor ?? DEFAULT_FONT_HIGHLIGHT_COLOR;
  const outlineColor = options.outlineColor ?? DEFAULT_OUTLINE_COLOR;
  const backgroundColor = options.backgroundColor ?? DEFAULT_BACKGROUND_COLOR;
  const backgroundOpacity =
    options.backgroundOpacity ?? DEFAULT_BACKGROUND_OPACITY;
  const position = options.position ?? DEFAULT_POSITION;
  const edgePaddingPercent =
    options.edgePaddingPercent ?? DEFAULT_EDGE_PADDING_PERCENT;
  const maxWordsPerLine = options.maxWordsPerLine ?? DEFAULT_MAX_WORDS_PER_LINE;
  const highlightEffect = options.highlightEffect ?? true;
  const placement = resolvePlacement({
    width,
    height,
    position,
    edgePaddingPercent,
  });

  // Determine if background box should be rendered (only when opacity > 0)
  const showBackground = backgroundOpacity > 0;

  // For karaoke mode with \k tags:
  // - PrimaryColour = highlighted/after color (gold) - shown AFTER word timing
  // - SecondaryColour = default/before color (white) - shown BEFORE word timing
  // For simple mode (no highlighting):
  // - PrimaryColour = fontBaseColor (same as secondary)
  const primaryColor = highlightEffect
    ? hexToAssColor(fontHighlightColor, 0) // Highlight = after
    : hexToAssColor(fontBaseColor, 0); // No highlight, use base color
  const secondaryColor = hexToAssColor(fontBaseColor, 0); // Default = before
  const outlineColorAss = hexToAssColor(outlineColor, 0);
  const backColorAss = showBackground
    ? hexToAssColor(backgroundColor, 1 - backgroundOpacity) // ASS alpha is inverted: 0=opaque, 1=transparent
    : hexToAssColor('#000000', 1); // Fully transparent if no box

  // BorderStyle options:
  // - 1 = outline + drop shadow (no box)
  // - 3 = outline + opaque box (ignores alpha - libass limitation)
  // - 4 = outline + semi-transparent box (libass extension, supports alpha!)
  // Use BorderStyle=4 for any background (works for both opaque and semi-transparent)
  const borderStyle = showBackground ? 4 : 1;

  // Build style definition
  // Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,
  //         Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle,
  //         BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
  const styleName = 'Default';
  const styleLine = `Style: ${styleName},${fontName},${fontSize},${primaryColor},${secondaryColor},${outlineColorAss},${backColorAss},0,0,0,0,100,100,0,0,${borderStyle},${DEFAULT_OUTLINE_SIZE},${DEFAULT_SHADOW_SIZE},${placement.alignment},0,0,0,1`;

  // Group words into lines
  const wordGroups = groupWordsIntoLines(transcription.words, maxWordsPerLine);

  // Calculate background alpha override for dialogue lines
  // This is needed because BorderStyle=3 ignores BackColour alpha in many renderers
  // The \4a inline tag forces the alpha override at the dialogue level
  const dialogueOptions: DialogueOptions = {
    positionOverride: `\\an${placement.alignment}\\pos(${placement.x},${placement.y})`,
  };
  if (showBackground && backgroundOpacity < 1) {
    // Convert opacity (0=transparent, 1=opaque) to ASS alpha (00=opaque, FF=transparent)
    // Format: &HXX& where XX is the hex alpha
    dialogueOptions.backgroundAlphaOverride = `&H${Math.round(
      (1 - backgroundOpacity) * 255
    )
      .toString(16)
      .padStart(2, '0')
      .toUpperCase()}&`;
  }

  // Build dialogue lines based on highlight mode
  const dialogueLines = highlightEffect
    ? buildKaraokeDialogueLines(wordGroups, styleName, dialogueOptions)
    : buildSimpleDialogueLines(wordGroups, styleName, dialogueOptions);

  // Assemble complete ASS content
  const lines = [
    '[Script Info]',
    'Title: Subtitles',
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
  buildSimpleDialogueLine,
  buildSimpleDialogueLines,
};
