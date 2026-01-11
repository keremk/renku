import type { TranscriptionArtifact, TranscriptionWord } from '../../transcription/types.js';
import type { HighlightAnimation } from './types.js';

export type { HighlightAnimation } from './types.js';

/**
 * Options for rendering karaoke-style subtitles.
 */
export interface KaraokeRenderOptions {
  /** Output width in pixels */
  width: number;
  /** Output height in pixels */
  height: number;
  /** Font size in pixels (default: 48) */
  fontSize?: number;
  /** Default text color in FFmpeg format (default: white) */
  fontColor?: string;
  /** Highlight color for the currently spoken word (default: #FFD700 - gold) */
  highlightColor?: string;
  /** Background box color (default: black@0.5) */
  boxColor?: string;
  /** Font file path (optional, uses default if not provided) */
  fontFile?: string;
  /** Position from bottom as percentage of height (default: 10) */
  bottomMarginPercent?: number;
  /** Maximum words to display at once (default: 8) */
  maxWordsPerLine?: number;
  /** Animation style for highlighted word (default: 'pop') */
  highlightAnimation?: HighlightAnimation;
  /** Scale factor for animation peak, e.g., 1.2 = 20% larger (default: 1.15) */
  animationScale?: number;
}

const DEFAULT_FONT_SIZE = 48;
const DEFAULT_FONT_COLOR = 'white';
const DEFAULT_HIGHLIGHT_COLOR = '#FFD700';
const DEFAULT_BOX_COLOR = 'black@0.5';
const DEFAULT_BOTTOM_MARGIN_PERCENT = 10;
const DEFAULT_MAX_WORDS_PER_LINE = 8;
const DEFAULT_HIGHLIGHT_ANIMATION: HighlightAnimation = 'pop';
const DEFAULT_ANIMATION_SCALE = 1.15; // 15% larger at peak

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
 * Build an FFmpeg filter for karaoke-style subtitles.
 *
 * This creates a filter that:
 * 1. Groups words into lines (max words per line)
 * 2. Shows each line during its time window
 * 3. Highlights the currently spoken word in a different color
 *
 * @param transcription - Word-level transcription data
 * @param options - Rendering options
 * @returns FFmpeg filter expression string
 */
export function buildKaraokeFilter(
  transcription: TranscriptionArtifact,
  options: KaraokeRenderOptions
): string {
  if (transcription.words.length === 0) {
    return '';
  }

  const fontSize = options.fontSize ?? DEFAULT_FONT_SIZE;
  const fontColor = options.fontColor ?? DEFAULT_FONT_COLOR;
  const highlightColor = options.highlightColor ?? DEFAULT_HIGHLIGHT_COLOR;
  const boxColor = options.boxColor ?? DEFAULT_BOX_COLOR;
  const bottomMargin = options.bottomMarginPercent ?? DEFAULT_BOTTOM_MARGIN_PERCENT;
  const maxWords = options.maxWordsPerLine ?? DEFAULT_MAX_WORDS_PER_LINE;
  const highlightAnimation = options.highlightAnimation ?? DEFAULT_HIGHLIGHT_ANIMATION;
  const animationScale = options.animationScale ?? DEFAULT_ANIMATION_SCALE;

  // Calculate Y position (from bottom of screen)
  const yPosition = Math.round(options.height * (1 - bottomMargin / 100));

  // Group words into lines
  const wordGroups = groupWordsIntoLines(transcription.words, maxWords);

  // Build drawtext filters for each word group
  const filters: string[] = [];

  for (const group of wordGroups) {
    const groupFilters = buildWordGroupFilters(group, {
      fontSize,
      fontColor,
      highlightColor,
      boxColor,
      yPosition,
      width: options.width,
      fontFile: options.fontFile,
      highlightAnimation,
      animationScale,
    });
    filters.push(...groupFilters);
  }

  return filters.join(',');
}

/**
 * Group consecutive words into display lines.
 */
function groupWordsIntoLines(words: TranscriptionWord[], maxWordsPerLine: number): WordGroup[] {
  const groups: WordGroup[] = [];
  let currentGroup: TranscriptionWord[] = [];

  for (const word of words) {
    currentGroup.push(word);

    // Create a new group when we reach max words or there's a significant gap
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
 * Build drawtext filters for a word group.
 *
 * Creates two layers:
 * 1. Background text (all words in default color)
 * 2. Highlighted word overlay (one at a time, optionally animated)
 */
function buildWordGroupFilters(
  group: WordGroup,
  options: {
    fontSize: number;
    fontColor: string;
    highlightColor: string;
    boxColor: string;
    yPosition: number;
    width: number;
    fontFile?: string;
    highlightAnimation: HighlightAnimation;
    animationScale: number;
  }
): string[] {
  const filters: string[] = [];
  const { fontSize, fontColor, highlightColor, boxColor, yPosition, fontFile, highlightAnimation, animationScale } = options;

  // Build the full text for this group
  const fullText = group.words.map(w => w.text).join(' ');
  const escapedFullText = escapeDrawtext(fullText);

  // Background layer: show all words in default color during the group's time window
  const backgroundParts: string[] = [
    `text='${escapedFullText}'`,
    `fontsize=${fontSize}`,
    `fontcolor=${fontColor}`,
    `x=(w-text_w)/2`, // Center horizontally
    `y=${yPosition}-text_h`,
    `box=1`,
    `boxcolor=${boxColor}`,
    `boxborderw=8`,
    `enable='between(t,${group.startTime.toFixed(3)},${group.endTime.toFixed(3)})'`,
  ];

  if (fontFile) {
    backgroundParts.push(`fontfile='${fontFile}'`);
  }

  filters.push(`drawtext=${backgroundParts.join(':')}`);

  // Highlight layer: overlay each word with highlight color at its specific time
  for (let i = 0; i < group.words.length; i++) {
    const word = group.words[i]!;
    const escapedWord = escapeDrawtext(word.text);

    // Calculate X offset for this word
    // This is an approximation - FFmpeg doesn't give us exact text width
    // We center the whole line and then offset based on character count
    const wordXOffset = calculateWordXOffset(group.words, i, fontSize, options.width);

    // Generate fontsize - either static or animated expression
    const fontsizeExpr = buildAnimatedFontsize(
      fontSize,
      word.startTime,
      word.endTime,
      highlightAnimation,
      animationScale
    );

    const highlightParts: string[] = [
      `text='${escapedWord}'`,
      `fontsize=${fontsizeExpr}`,
      `fontcolor=${highlightColor}`,
      `x=${wordXOffset}`,
      `y=${yPosition}-text_h`,
      `enable='between(t,${word.startTime.toFixed(3)},${word.endTime.toFixed(3)})'`,
    ];

    if (fontFile) {
      highlightParts.push(`fontfile='${fontFile}'`);
    }

    filters.push(`drawtext=${highlightParts.join(':')}`);
  }

  return filters;
}

/**
 * Build an FFmpeg expression for animated font size.
 *
 * The animations create subtle, lively effects like those seen on Instagram/TikTok:
 * - 'none': Static size
 * - 'pop': Quick scale up then exponential decay to normal (snappy, professional)
 * - 'spring': Damped oscillation (bouncy, playful)
 * - 'pulse': Gentle continuous sine wave (rhythmic, musical)
 *
 * IMPORTANT: All expressions use max(0, t-startT) to clamp elapsed time to non-negative.
 * This prevents exp() overflow when FFmpeg evaluates the expression at t < startTime.
 *
 * @param baseFontSize - Base font size in pixels
 * @param startTime - Word start time in seconds
 * @param endTime - Word end time in seconds
 * @param animation - Animation type
 * @param scale - Peak scale factor (e.g., 1.15 = 15% larger)
 * @returns FFmpeg expression string or static number
 */
function buildAnimatedFontsize(
  baseFontSize: number,
  startTime: number,
  endTime: number,
  animation: HighlightAnimation,
  scale: number
): string {
  if (animation === 'none') {
    return String(baseFontSize);
  }

  // Calculate the time offset from word start (normalized for expression)
  const startT = startTime.toFixed(3);
  const duration = endTime - startTime;

  // Amount to add at peak: baseFontSize * (scale - 1)
  const extraSize = Math.round(baseFontSize * (scale - 1));

  // Clamp elapsed time to non-negative using multiplication by gte() result.
  // gte(t,startT) returns 1 when t >= startT, else 0.
  // This avoids exp() overflow when t < startT (which would cause large positive exponent).
  // Using multiplication instead of max() for better FFmpeg compatibility.
  const elapsed = `(t-${startT})*gte(t,${startT})`;

  switch (animation) {
    case 'pop': {
      // Quick pop then exponential decay: size * (1 + extra * exp(-decay * elapsed))
      // decay=8 gives a quick ~0.3s settle time
      const decay = 8;
      return `'${baseFontSize}+${extraSize}*exp(-${decay}*${elapsed})'`;
    }

    case 'spring': {
      // Damped oscillation: size * (1 + extra * exp(-decay * elapsed) * cos(freq * elapsed))
      // decay=6 for visible oscillation, freq=15 for ~2-3 bounces
      const decay = 6;
      const freq = 15;
      return `'${baseFontSize}+${extraSize}*exp(-${decay}*${elapsed})*cos(${freq}*${elapsed})'`;
    }

    case 'pulse': {
      // Gentle continuous pulse: size * (1 + extra * 0.5 * (1 + sin(freq * elapsed)))
      // Frequency based on word duration to complete ~1-2 cycles
      const cycles = Math.max(1, Math.min(2, duration * 3)); // 1-2 cycles
      const freq = (cycles * 2 * Math.PI / duration).toFixed(2);
      return `'${baseFontSize}+${extraSize}*0.5*(1+sin(${freq}*${elapsed}))'`;
    }

    default:
      return String(baseFontSize);
  }
}

/**
 * Estimate word widths based on character count.
 * This is an approximation since FFmpeg doesn't provide exact metrics.
 * Note: Currently unused but kept for potential future precision improvements.
 */
function _calculateWordWidths(words: TranscriptionWord[], fontSize: number): number[] {
  // Approximate character width is about 0.6 * fontSize for most fonts
  const charWidth = fontSize * 0.6;
  return words.map(w => w.text.length * charWidth);
}

/**
 * Calculate X position for a word within a centered line.
 */
function calculateWordXOffset(
  words: TranscriptionWord[],
  wordIndex: number,
  fontSize: number,
  screenWidth: number
): string {
  // Build full text to calculate total width
  const fullText = words.map(w => w.text).join(' ');
  const charWidth = fontSize * 0.6;
  const spaceWidth = charWidth; // Space is roughly same width as a character
  const totalWidth = fullText.length * charWidth;

  // Calculate starting X for centered text
  // Use FFmpeg expression for dynamic centering
  const startX = `(w-${Math.round(totalWidth)})/2`;

  // Calculate offset to this specific word
  let offset = 0;
  for (let i = 0; i < wordIndex; i++) {
    offset += words[i]!.text.length * charWidth + spaceWidth;
  }

  if (offset === 0) {
    return startX;
  }

  return `${startX}+${Math.round(offset)}`;
}

/**
 * Escape special characters for FFmpeg drawtext filter.
 */
export function escapeDrawtext(text: string): string {
  return text
    // First escape backslashes
    .replace(/\\/g, '\\\\')
    // Then escape single quotes
    .replace(/'/g, "'\\''")
    // Escape colons
    .replace(/:/g, '\\:')
    // Handle newlines
    .replace(/\n/g, '\\n');
}

/**
 * Build a karaoke filter chain that overlays subtitles on a video stream.
 *
 * @param inputLabel - Input stream label (e.g., "[v0]")
 * @param transcription - Word-level transcription
 * @param options - Rendering options
 * @param outputLabel - Output stream label
 * @returns FFmpeg filter expression string
 */
export function buildKaraokeFilterChain(
  inputLabel: string,
  transcription: TranscriptionArtifact,
  options: KaraokeRenderOptions,
  outputLabel: string
): string {
  if (transcription.words.length === 0) {
    // No words, pass through unchanged
    return `${inputLabel}null[${outputLabel}]`;
  }

  const karaokeFilter = buildKaraokeFilter(transcription, options);
  return `${inputLabel}${karaokeFilter}[${outputLabel}]`;
}

// Export for testing
export const __test__ = {
  groupWordsIntoLines,
  buildWordGroupFilters,
  calculateWordXOffset,
  escapeDrawtext,
  buildAnimatedFontsize,
};
