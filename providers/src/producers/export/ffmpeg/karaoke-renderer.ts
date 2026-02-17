import type {
  TranscriptionArtifact,
  TranscriptionWord,
} from '../../transcription/types.js';
import type { OverlayPosition } from './types.js';

/**
 * Animation style for highlighted word (deprecated - use ASS renderer instead).
 * @deprecated Use ass-renderer.ts for karaoke subtitles
 */
export type HighlightAnimation = 'none' | 'pop';

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
  /** Subtitle anchor position (default: bottom-center) */
  position?: OverlayPosition;
  /** Distance from anchored edges as percentage of height (default: 8) */
  edgePaddingPercent?: number;
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
const DEFAULT_POSITION: OverlayPosition = 'bottom-center';
const DEFAULT_EDGE_PADDING_PERCENT = 8;
const DEFAULT_MAX_WORDS_PER_LINE = 8;
const DEFAULT_HIGHLIGHT_ANIMATION: HighlightAnimation = 'pop';
const DEFAULT_ANIMATION_SCALE = 1.15; // 15% larger at peak

interface KaraokePlacement {
  horizontalAnchor: 'left' | 'center' | 'right';
  yExpression: string;
  edgePaddingPx: number;
}

function resolveKaraokePlacement(
  position: OverlayPosition,
  edgePaddingPercent: number,
  height: number
): KaraokePlacement {
  const edgePaddingPx = Math.round(height * (edgePaddingPercent / 100));

  switch (position) {
    case 'top-left':
      return {
        horizontalAnchor: 'left',
        yExpression: `${edgePaddingPx}`,
        edgePaddingPx,
      };
    case 'top-center':
      return {
        horizontalAnchor: 'center',
        yExpression: `${edgePaddingPx}`,
        edgePaddingPx,
      };
    case 'top-right':
      return {
        horizontalAnchor: 'right',
        yExpression: `${edgePaddingPx}`,
        edgePaddingPx,
      };
    case 'middle-left':
      return {
        horizontalAnchor: 'left',
        yExpression: '(h-text_h)/2',
        edgePaddingPx,
      };
    case 'middle-center':
      return {
        horizontalAnchor: 'center',
        yExpression: '(h-text_h)/2',
        edgePaddingPx,
      };
    case 'middle-right':
      return {
        horizontalAnchor: 'right',
        yExpression: '(h-text_h)/2',
        edgePaddingPx,
      };
    case 'bottom-left':
      return {
        horizontalAnchor: 'left',
        yExpression: `h-text_h-${edgePaddingPx}`,
        edgePaddingPx,
      };
    case 'bottom-center':
      return {
        horizontalAnchor: 'center',
        yExpression: `h-text_h-${edgePaddingPx}`,
        edgePaddingPx,
      };
    case 'bottom-right':
      return {
        horizontalAnchor: 'right',
        yExpression: `h-text_h-${edgePaddingPx}`,
        edgePaddingPx,
      };
  }
}

function buildGroupBaseXExpression(
  placement: KaraokePlacement,
  totalWidth: number
): string {
  const roundedWidth = Math.round(totalWidth);

  switch (placement.horizontalAnchor) {
    case 'left':
      return `${placement.edgePaddingPx}`;
    case 'center':
      return `(w-${roundedWidth})/2`;
    case 'right':
      return `w-${roundedWidth}-${placement.edgePaddingPx}`;
  }
}

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
  const position = options.position ?? DEFAULT_POSITION;
  const edgePaddingPercent =
    options.edgePaddingPercent ?? DEFAULT_EDGE_PADDING_PERCENT;
  const maxWords = options.maxWordsPerLine ?? DEFAULT_MAX_WORDS_PER_LINE;
  const highlightAnimation =
    options.highlightAnimation ?? DEFAULT_HIGHLIGHT_ANIMATION;
  const animationScale = options.animationScale ?? DEFAULT_ANIMATION_SCALE;
  const placement = resolveKaraokePlacement(
    position,
    edgePaddingPercent,
    options.height
  );

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
      placement,
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
function groupWordsIntoLines(
  words: TranscriptionWord[],
  maxWordsPerLine: number
): WordGroup[] {
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
 * Each word is rendered individually at a calculated position.
 * Words are shown in default color, switching to highlight color when spoken.
 * This avoids alignment issues from trying to overlay highlight text on background.
 */
function buildWordGroupFilters(
  group: WordGroup,
  options: {
    fontSize: number;
    fontColor: string;
    highlightColor: string;
    boxColor: string;
    placement: KaraokePlacement;
    fontFile?: string;
    highlightAnimation: HighlightAnimation;
    animationScale: number;
  }
): string[] {
  const filters: string[] = [];
  const {
    fontSize,
    fontColor,
    highlightColor,
    boxColor,
    placement,
    fontFile,
    highlightAnimation,
    animationScale,
  } = options;

  // Calculate positioning for all words using consistent width estimation
  const charWidth = fontSize * 0.6;
  const spaceWidth = charWidth;
  const fullText = group.words.map((w) => w.text).join(' ');
  const totalWidth = fullText.length * charWidth;
  const baseX = buildGroupBaseXExpression(placement, totalWidth);
  const yExpression = placement.yExpression;

  // First, render the background box using a transparent/invisible text
  // This ensures the box is rendered once for the whole group
  const escapedFullText = escapeDrawtext(fullText);
  const boxParts: string[] = [
    `text='${escapedFullText}'`,
    `fontsize=${fontSize}`,
    `fontcolor=${boxColor.split('@')[0] || 'black'}@0`, // Invisible text (0 alpha)
    `x=${baseX}`,
    `y=${yExpression}`,
    `box=1`,
    `boxcolor=${boxColor}`,
    `boxborderw=8`,
    `enable='between(t,${group.startTime.toFixed(3)},${group.endTime.toFixed(3)})'`,
  ];
  if (fontFile) {
    boxParts.push(`fontfile='${fontFile}'`);
  }
  filters.push(`drawtext=${boxParts.join(':')}`);

  // Render each word individually
  let cumulativeOffset = 0;

  for (let i = 0; i < group.words.length; i++) {
    const word = group.words[i]!;
    const escapedWord = escapeDrawtext(word.text);

    // Calculate X position for this word
    const wordX =
      cumulativeOffset === 0
        ? baseX
        : `${baseX}+${Math.round(cumulativeOffset)}`;

    // Word in default color (when not being spoken but group is visible)
    const defaultParts: string[] = [
      `text='${escapedWord}'`,
      `fontsize=${fontSize}`,
      `fontcolor=${fontColor}`,
      `x=${wordX}`,
      `y=${yExpression}`,
      `enable='between(t,${group.startTime.toFixed(3)},${group.endTime.toFixed(3)})*not(between(t,${word.startTime.toFixed(3)},${word.endTime.toFixed(3)}))'`,
    ];
    if (fontFile) {
      defaultParts.push(`fontfile='${fontFile}'`);
    }
    filters.push(`drawtext=${defaultParts.join(':')}`);

    // Word in highlight color (when being spoken)
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
      `x=${wordX}`,
      `y=${yExpression}`,
      `enable='between(t,${word.startTime.toFixed(3)},${word.endTime.toFixed(3)})'`,
    ];
    if (fontFile) {
      highlightParts.push(`fontfile='${fontFile}'`);
    }
    filters.push(`drawtext=${highlightParts.join(':')}`);

    // Update cumulative offset for next word (word width + space)
    cumulativeOffset += word.text.length * charWidth + spaceWidth;
  }

  return filters;
}

/**
 * Build an FFmpeg expression for animated font size.
 *
 * NOTE: This function is deprecated in favor of ASS-based karaoke rendering.
 * The ASS renderer (ass-renderer.ts) provides more reliable karaoke effects.
 *
 * @param baseFontSize - Base font size in pixels
 * @param startTime - Word start time in seconds
 * @param _endTime - Word end time in seconds (unused, kept for API compatibility)
 * @param animation - Animation type ('none' or 'pop')
 * @param scale - Peak scale factor (e.g., 1.15 = 15% larger)
 * @returns FFmpeg expression string or static number
 */
function buildAnimatedFontsize(
  baseFontSize: number,
  startTime: number,
  _endTime: number,
  animation: HighlightAnimation,
  scale: number
): string {
  if (animation === 'none') {
    return String(baseFontSize);
  }

  // Calculate the time offset from word start
  const startT = startTime.toFixed(3);

  // Amount to add at peak: baseFontSize * (scale - 1)
  const extraSize = Math.round(baseFontSize * (scale - 1));

  // Clamp elapsed time to non-negative using multiplication by gte() result.
  const elapsed = `(t-${startT})*gte(t,${startT})`;

  // 'pop': Quick pop then exponential decay
  const decay = 8;
  return `'${baseFontSize}+${extraSize}*exp(-${decay}*${elapsed})'`;
}

/**
 * Escape special characters for FFmpeg drawtext filter.
 */
export function escapeDrawtext(text: string): string {
  return (
    text
      // First escape backslashes
      .replace(/\\/g, '\\\\')
      // Then escape single quotes
      .replace(/'/g, "'\\''")
      // Escape colons
      .replace(/:/g, '\\:')
      // Handle newlines
      .replace(/\n/g, '\\n')
  );
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
  escapeDrawtext,
  buildAnimatedFontsize,
};
