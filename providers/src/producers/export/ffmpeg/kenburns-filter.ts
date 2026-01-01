import type { KenBurnsEffect } from '@gorenku/compositions';

/**
 * Options for building a KenBurns filter expression.
 */
export interface KenBurnsFilterOptions {
  /** Output width in pixels */
  width: number;
  /** Output height in pixels */
  height: number;
  /** Frames per second */
  fps: number;
  /** Duration of the effect in seconds */
  duration: number;
}

/**
 * Build an FFmpeg zoompan filter expression for a KenBurns effect.
 *
 * The zoompan filter creates a pan and zoom effect on a static image.
 * We convert the timeline's effect parameters (center-based offsets and scale)
 * to FFmpeg's zoompan format.
 *
 * Timeline format:
 * - startX/endX, startY/endY: pixel offsets from center (-60 to +60 typical)
 * - startScale/endScale: zoom factor (1.0 = normal, 1.2 = 20% zoom in)
 *
 * FFmpeg zoompan format:
 * - z: zoom expression (how much to zoom, affects visible area)
 * - x, y: position of top-left corner of the visible area
 * - d: duration in frames
 * - s: output size
 * - fps: output frame rate
 *
 * @param effect - The KenBurns effect parameters
 * @param options - Filter configuration options
 * @returns FFmpeg filter expression string
 */
export function buildKenBurnsFilter(
  effect: KenBurnsEffect,
  options: KenBurnsFilterOptions
): string {
  const { width, height, fps, duration } = options;
  const totalFrames = Math.ceil(duration * fps);

  // Extract effect parameters with defaults
  const startScale = effect.startScale ?? 1;
  const endScale = effect.endScale ?? 1;
  const startX = effect.startX ?? 0;
  const endX = effect.endX ?? 0;
  const startY = effect.startY ?? 0;
  const endY = effect.endY ?? 0;

  // Build zoom expression: interpolate from startScale to endScale over time
  // 'on' is the current output frame number (0-indexed)
  // Progress: on / (totalFrames - 1) goes from 0 to 1
  const zoomExpr = buildZoomExpression(startScale, endScale, totalFrames);

  // Build pan expressions
  // The timeline uses center-relative offsets, we need to convert to FFmpeg's
  // top-left corner position. The zoompan filter's x/y specify where to position
  // the center of the crop rectangle.
  //
  // For FFmpeg zoompan:
  // - x is measured from left edge of image to left edge of visible area
  // - y is measured from top edge of image to top edge of visible area
  // - When zoomed in, the visible area is (iw/zoom) x (ih/zoom)
  //
  // To center: x = (iw - iw/zoom) / 2 = iw * (1 - 1/zoom) / 2
  // With offset: x = center_x + offset_x (scaled appropriately)
  const xExpr = buildPanExpression('iw', startX, endX, totalFrames);
  const yExpr = buildPanExpression('ih', startY, endY, totalFrames);

  // Build the complete zoompan filter
  // Note: We add format=yuva420p for proper alpha handling and compatibility
  return `zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=${totalFrames}:s=${width}x${height}:fps=${fps}`;
}

/**
 * Build the zoom expression that interpolates from startScale to endScale.
 *
 * @param startScale - Initial zoom level (1.0 = 100%)
 * @param endScale - Final zoom level
 * @param totalFrames - Total number of frames
 * @returns FFmpeg expression string
 */
function buildZoomExpression(startScale: number, endScale: number, totalFrames: number): string {
  if (totalFrames <= 1) {
    return String(startScale);
  }

  // Linear interpolation: startScale + (endScale - startScale) * (on / (totalFrames - 1))
  // Simplified: startScale + delta * progress
  const delta = endScale - startScale;

  if (Math.abs(delta) < 0.0001) {
    // No zoom change, return constant
    return String(startScale);
  }

  // Using 'on' (current frame number) to calculate progress
  // FFmpeg expression: startScale + delta * (on / (totalFrames - 1))
  const progressDenom = totalFrames - 1;
  return `${startScale}+${delta}*(on/${progressDenom})`;
}

/**
 * Build a pan expression that calculates the position of the visible area.
 *
 * The formula centers the visible area and applies the interpolated offset.
 * FFmpeg zoompan x/y specify the top-left corner of the visible area.
 *
 * Base centering: (dimension - dimension/zoom) / 2
 * With offset: base + interpolated_offset
 *
 * @param dimension - 'iw' for width or 'ih' for height
 * @param startOffset - Starting offset in pixels (from center)
 * @param endOffset - Ending offset in pixels (from center)
 * @param totalFrames - Total number of frames
 * @returns FFmpeg expression string
 */
function buildPanExpression(
  dimension: 'iw' | 'ih',
  startOffset: number,
  endOffset: number,
  totalFrames: number
): string {
  // Base centering formula: (dimension - dimension/zoom) / 2
  // This centers the visible area within the image
  const centerExpr = `(${dimension}-${dimension}/zoom)/2`;

  if (totalFrames <= 1) {
    // Single frame, apply startOffset directly
    if (Math.abs(startOffset) < 0.0001) {
      return centerExpr;
    }
    return `${centerExpr}+${startOffset}`;
  }

  // Interpolate offset from startOffset to endOffset
  const offsetDelta = endOffset - startOffset;
  const progressDenom = totalFrames - 1;

  if (Math.abs(startOffset) < 0.0001 && Math.abs(endOffset) < 0.0001) {
    // No offset at all, just center
    return centerExpr;
  }

  if (Math.abs(offsetDelta) < 0.0001) {
    // Constant offset, no interpolation needed
    return `${centerExpr}+${startOffset}`;
  }

  // Full interpolation: center + startOffset + delta * progress
  const offsetExpr = `${startOffset}+${offsetDelta}*(on/${progressDenom})`;
  return `${centerExpr}+${offsetExpr}`;
}

/**
 * Build a complete image input filter chain for a single image with KenBurns.
 *
 * This combines:
 * 1. Input specification with loop (-loop 1 -t duration -i image.jpg)
 * 2. Zoompan filter for the KenBurns effect
 * 3. Format conversion for compatibility
 *
 * @param inputIndex - FFmpeg input stream index (0-based)
 * @param effect - The KenBurns effect parameters
 * @param options - Filter configuration options
 * @param outputLabel - Label for the output stream (e.g., "img0")
 * @returns FFmpeg filter expression string
 */
export function buildImageFilterChain(
  inputIndex: number,
  effect: KenBurnsEffect,
  options: KenBurnsFilterOptions,
  outputLabel: string
): string {
  const zoompan = buildKenBurnsFilter(effect, options);

  // Chain: input -> zoompan -> format conversion -> setpts for timing
  // The setpts=PTS-STARTPTS ensures the video starts at time 0
  return `[${inputIndex}:v]${zoompan},format=yuv420p,setpts=PTS-STARTPTS[${outputLabel}]`;
}

/**
 * Build input arguments for an image file with looping.
 *
 * @param imagePath - Path to the image file
 * @param duration - Duration in seconds
 * @returns Array of FFmpeg input arguments
 */
export function buildImageInputArgs(imagePath: string, duration: number): string[] {
  return ['-loop', '1', '-t', String(duration), '-i', imagePath];
}
