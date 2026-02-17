import type { CaptionEntry } from './types.js';
import type { OverlayPosition } from './types.js';

/**
 * Options for rendering captions.
 */
export interface CaptionRenderOptions {
  /** Output width in pixels */
  width: number;
  /** Output height in pixels */
  height: number;
  /** Font size in pixels (default: 48) */
  fontSize?: number;
  /** Font color in FFmpeg format (default: white) */
  fontColor?: string;
  /** Background box color (default: black@0.5) */
  boxColor?: string;
  /** Font file path (optional, uses default if not provided) */
  fontFile?: string;
  /** Caption anchor position (default: bottom-center) */
  position?: OverlayPosition;
  /** Distance from anchored edges as percentage of height (default: 8) */
  edgePaddingPercent?: number;
}

const DEFAULT_FONT_SIZE = 48;
const DEFAULT_FONT_COLOR = 'white';
const DEFAULT_BOX_COLOR = 'black@0.5';
const DEFAULT_POSITION: OverlayPosition = 'bottom-center';
const DEFAULT_EDGE_PADDING_PERCENT = 8;

function resolveDrawtextPlacement(
  position: OverlayPosition,
  edgePaddingPercent: number,
  height: number
): { xExpression: string; yExpression: string } {
  const edgePaddingPx = Math.round(height * (edgePaddingPercent / 100));

  switch (position) {
    case 'top-left':
      return {
        xExpression: `${edgePaddingPx}`,
        yExpression: `${edgePaddingPx}`,
      };
    case 'top-center':
      return {
        xExpression: '(w-text_w)/2',
        yExpression: `${edgePaddingPx}`,
      };
    case 'top-right':
      return {
        xExpression: `w-text_w-${edgePaddingPx}`,
        yExpression: `${edgePaddingPx}`,
      };
    case 'middle-left':
      return {
        xExpression: `${edgePaddingPx}`,
        yExpression: '(h-text_h)/2',
      };
    case 'middle-center':
      return {
        xExpression: '(w-text_w)/2',
        yExpression: '(h-text_h)/2',
      };
    case 'middle-right':
      return {
        xExpression: `w-text_w-${edgePaddingPx}`,
        yExpression: '(h-text_h)/2',
      };
    case 'bottom-left':
      return {
        xExpression: `${edgePaddingPx}`,
        yExpression: `h-text_h-${edgePaddingPx}`,
      };
    case 'bottom-center':
      return {
        xExpression: '(w-text_w)/2',
        yExpression: `h-text_h-${edgePaddingPx}`,
      };
    case 'bottom-right':
      return {
        xExpression: `w-text_w-${edgePaddingPx}`,
        yExpression: `h-text_h-${edgePaddingPx}`,
      };
  }
}

/**
 * Build an FFmpeg drawtext filter for burning captions into video.
 *
 * This creates a filter that displays caption text at specific times.
 * The text is centered horizontally and positioned near the bottom.
 *
 * @param captions - Array of caption entries with text and timing
 * @param options - Rendering options
 * @returns FFmpeg filter expression string
 */
export function buildCaptionFilter(
  captions: CaptionEntry[],
  options: CaptionRenderOptions
): string {
  if (captions.length === 0) {
    return '';
  }

  const fontSize = options.fontSize ?? DEFAULT_FONT_SIZE;
  const fontColor = options.fontColor ?? DEFAULT_FONT_COLOR;
  const boxColor = options.boxColor ?? DEFAULT_BOX_COLOR;
  const position = options.position ?? DEFAULT_POSITION;
  const edgePaddingPercent =
    options.edgePaddingPercent ?? DEFAULT_EDGE_PADDING_PERCENT;
  const placement = resolveDrawtextPlacement(
    position,
    edgePaddingPercent,
    options.height
  );

  // Build a drawtext filter for each caption
  const drawtextFilters = captions.map((caption) => {
    return buildSingleCaptionFilter(caption, {
      fontSize,
      fontColor,
      boxColor,
      xExpression: placement.xExpression,
      yExpression: placement.yExpression,
      fontFile: options.fontFile,
    });
  });

  return drawtextFilters.join(',');
}

/**
 * Build a single drawtext filter for one caption.
 *
 * @param caption - Caption entry
 * @param options - Rendering parameters
 * @returns FFmpeg drawtext filter string
 */
function buildSingleCaptionFilter(
  caption: CaptionEntry,
  options: {
    fontSize: number;
    fontColor: string;
    boxColor: string;
    xExpression: string;
    yExpression: string;
    fontFile?: string;
  }
): string {
  const { fontSize, fontColor, boxColor, xExpression, yExpression, fontFile } =
    options;

  // Escape special characters in the text
  const escapedText = escapeDrawtext(caption.text);

  // Build the drawtext filter
  const parts: string[] = [
    `text='${escapedText}'`,
    `fontsize=${fontSize}`,
    `fontcolor=${fontColor}`,
    `x=${xExpression}`,
    `y=${yExpression}`,
    `box=1`,
    `boxcolor=${boxColor}`,
    `boxborderw=8`, // Padding around text
    `enable='between(t,${caption.startTime},${caption.endTime})'`,
  ];

  // Add font file if specified
  if (fontFile) {
    parts.push(`fontfile='${fontFile}'`);
  }

  return `drawtext=${parts.join(':')}`;
}

/**
 * Escape special characters for FFmpeg drawtext filter.
 *
 * The drawtext filter requires escaping certain characters:
 * - Single quotes must be escaped
 * - Backslashes must be escaped
 * - Colons need special handling in some contexts
 *
 * @param text - Original caption text
 * @returns Escaped text safe for drawtext filter
 */
function escapeDrawtext(text: string): string {
  return (
    text
      // First escape backslashes
      .replace(/\\/g, '\\\\')
      // Then escape single quotes
      .replace(/'/g, "'\\''")
      // Escape colons (optional, but safer)
      .replace(/:/g, '\\:')
      // Handle newlines
      .replace(/\n/g, '\\n')
  );
}

/**
 * Build a caption filter chain that overlays captions on a video stream.
 *
 * @param inputLabel - Input stream label (e.g., "[v0]")
 * @param captions - Array of caption entries
 * @param options - Rendering options
 * @param outputLabel - Output stream label
 * @returns FFmpeg filter expression string
 */
export function buildCaptionFilterChain(
  inputLabel: string,
  captions: CaptionEntry[],
  options: CaptionRenderOptions,
  outputLabel: string
): string {
  if (captions.length === 0) {
    // No captions, pass through unchanged
    return `${inputLabel}null[${outputLabel}]`;
  }

  const captionFilter = buildCaptionFilter(captions, options);
  return `${inputLabel}${captionFilter}[${outputLabel}]`;
}

/**
 * Parse caption entries from a CaptionsClip.
 *
 * Handles both:
 * - captions array with individual text strings
 * - assetId reference to a caption file
 *
 * @param captions - Array of caption strings from the clip
 * @param clipStartTime - Start time of the clip in seconds
 * @param clipDuration - Duration of the clip in seconds
 * @param partitionBy - Optional number of words per caption
 * @returns Array of CaptionEntry objects with timing
 */
export function parseCaptionsFromArray(
  captions: string[],
  clipStartTime: number,
  clipDuration: number,
  partitionBy?: number
): CaptionEntry[] {
  if (captions.length === 0) {
    return [];
  }

  // If partitionBy is set, split captions into smaller chunks
  const processedCaptions = partitionBy
    ? partitionCaptions(captions, partitionBy)
    : captions;

  // Calculate duration per caption
  const durationPerCaption = clipDuration / processedCaptions.length;

  return processedCaptions.map((text, index) => ({
    text: text.trim(),
    startTime: clipStartTime + index * durationPerCaption,
    endTime: clipStartTime + (index + 1) * durationPerCaption,
  }));
}

/**
 * Partition captions into smaller chunks based on word count.
 *
 * @param captions - Original caption strings
 * @param wordsPerCaption - Maximum words per caption
 * @returns Partitioned caption strings
 */
function partitionCaptions(
  captions: string[],
  wordsPerCaption: number
): string[] {
  const result: string[] = [];

  for (const caption of captions) {
    const words = caption.split(/\s+/).filter((w) => w.length > 0);

    for (let i = 0; i < words.length; i += wordsPerCaption) {
      const chunk = words.slice(i, i + wordsPerCaption).join(' ');
      if (chunk) {
        result.push(chunk);
      }
    }
  }

  return result;
}

/**
 * Build a filter that generates a transparent overlay with captions.
 *
 * This is useful when you want to overlay captions on top of existing video
 * without modifying the base filter chain.
 *
 * @param captions - Array of caption entries
 * @param options - Rendering options
 * @param outputLabel - Output stream label
 * @returns FFmpeg filter expression for generating caption overlay
 */
export function buildCaptionOverlayGenerator(
  captions: CaptionEntry[],
  options: CaptionRenderOptions,
  outputLabel: string
): string {
  const { width, height } = options;

  if (captions.length === 0) {
    // Generate transparent color for empty overlay
    return `color=c=black@0:s=${width}x${height},format=yuva420p[${outputLabel}]`;
  }

  const captionFilter = buildCaptionFilter(captions, options);

  // Start with a transparent background, then draw captions
  return `color=c=black@0:s=${width}x${height},format=yuva420p,${captionFilter}[${outputLabel}]`;
}
