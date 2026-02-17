import type { KenBurnsEffect } from '@gorenku/compositions';

const INTERNAL_SCALE_FACTOR = 2;
const MOTION_SAFETY_MARGIN = 2;
const EPSILON = 0.0001;

export interface SourceDimensions {
  width: number;
  height: number;
}

/**
 * Options for building a KenBurns filter expression.
 */
export interface KenBurnsFilterOptions {
  /** Output width in pixels */
  width: number;
  /** Output height in pixels */
  height: number;
  /** Cover-scaled source width (after aspect-fit-to-cover) */
  coverWidth: number;
  /** Cover-scaled source height (after aspect-fit-to-cover) */
  coverHeight: number;
  /** Frames per second */
  fps: number;
  /** Duration of the effect in seconds */
  duration: number;
}

export interface KenBurnsImageOptions {
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
 * Build an FFmpeg crop expression for a KenBurns effect.
 *
 * The exported timeline uses the same semantic values as the Remotion preview:
 * - startScale/endScale are relative zoom values (1 = base framing)
 * - startX/endX and startY/endY are pixel offsets from center
 *
 * We implement this by:
 * 1. Cover-scaling the image to the output aspect ratio (in buildImageFilterChain)
 * 2. Animating a crop window (zoom + pan) over that cover-scaled frame
 * 3. Re-scaling the cropped result back to output size
 *
 * The crop expression uses `n` (frame index) and `exact=1` so x/y are not rounded
 * to chroma subsampling boundaries, which reduces visible jitter on slow pans.
 *
 * @param effect - The KenBurns effect parameters
 * @param options - Filter configuration options
 * @returns FFmpeg crop filter expression string
 */
export function buildKenBurnsFilter(
  effect: KenBurnsEffect,
  options: KenBurnsFilterOptions
): string {
  const { width, height, coverWidth, coverHeight, fps, duration } = options;
  if (duration <= 0) {
    throw new Error(
      `KenBurns duration must be greater than 0. Got ${duration}.`
    );
  }
  if (width <= 0 || height <= 0) {
    throw new Error(
      `KenBurns output dimensions must be positive. Got width=${width}, height=${height}.`
    );
  }
  if (coverWidth < width || coverHeight < height) {
    throw new Error(
      `KenBurns cover dimensions must be at least the output size. Got coverWidth=${coverWidth}, coverHeight=${coverHeight}, width=${width}, height=${height}.`
    );
  }

  const totalFrames = Math.max(1, Math.round(duration * fps));

  const startScale = effect.startScale ?? 1;
  const endScale = effect.endScale ?? startScale;
  const startX = effect.startX ?? 0;
  const endX = effect.endX ?? startX;
  const startY = effect.startY ?? 0;
  const endY = effect.endY ?? startY;

  if (startScale < 1 || endScale < 1) {
    throw new Error(
      `KenBurns scale values must be greater than or equal to 1. Got startScale=${startScale}, endScale=${endScale}.`
    );
  }

  const motion = resolveMotionPlan(
    {
      startScale,
      endScale,
      startX,
      endX,
      startY,
      endY,
    },
    {
      width,
      height,
      coverWidth,
      coverHeight,
    }
  );

  const progressExpr = buildProgressExpression(totalFrames);

  const scaleExpr = buildLinearExpression(
    motion.startScale,
    motion.endScale,
    progressExpr
  );
  const offsetXExpr = buildLinearExpression(
    motion.startX,
    motion.endX,
    progressExpr
  );
  const offsetYExpr = buildLinearExpression(
    motion.startY,
    motion.endY,
    progressExpr
  );

  const cropWidthExpr = `${width}/(${scaleExpr})`;
  const cropHeightExpr = `${height}/(${scaleExpr})`;

  const maxXExpr = `iw-(${cropWidthExpr})`;
  const maxYExpr = `ih-(${cropHeightExpr})`;
  const xExpr = `((iw-(${cropWidthExpr}))/2)+(${offsetXExpr})`;
  const yExpr = `((ih-(${cropHeightExpr}))/2)+(${offsetYExpr})`;

  return `crop=w='${cropWidthExpr}':h='${cropHeightExpr}':x='clip(${xExpr},0,${maxXExpr})':y='clip(${yExpr},0,${maxYExpr})':exact=1`;
}

/**
 * Build a normalized progress expression from frame index `n`.
 */
function buildProgressExpression(totalFrames: number): string {
  if (totalFrames <= 1) {
    return '0';
  }

  const maxFrame = totalFrames - 1;
  return `if(lte(n,0),0,if(gte(n,${maxFrame}),1,n/${maxFrame}))`;
}

/**
 * Build a linear interpolation expression using a progress expression.
 *
 * @param startValue - Start value
 * @param endValue - End value
 * @param progressExpr - Expression that yields 0..1 progress
 * @returns FFmpeg expression string
 */
function buildLinearExpression(
  startValue: number,
  endValue: number,
  progressExpr: string
): string {
  const delta = endValue - startValue;

  if (Math.abs(delta) < EPSILON) {
    return String(startValue);
  }

  return `${startValue}+(${delta})*(${progressExpr})`;
}

interface MotionInput {
  startScale: number;
  endScale: number;
  startX: number;
  endX: number;
  startY: number;
  endY: number;
}

interface MotionGeometry {
  width: number;
  height: number;
  coverWidth: number;
  coverHeight: number;
}

interface MotionPlan {
  startScale: number;
  endScale: number;
  startX: number;
  endX: number;
  startY: number;
  endY: number;
}

function resolveMotionPlan(
  input: MotionInput,
  geometry: MotionGeometry
): MotionPlan {
  const maxOffsetX = Math.max(Math.abs(input.startX), Math.abs(input.endX));
  const maxOffsetY = Math.max(Math.abs(input.startY), Math.abs(input.endY));

  const globalScaleFloor = Math.max(
    1,
    requiredScaleForOffset(maxOffsetX, geometry.coverWidth, geometry.width),
    requiredScaleForOffset(maxOffsetY, geometry.coverHeight, geometry.height)
  );

  const startScale = Math.max(input.startScale, globalScaleFloor);
  const endScale = Math.max(input.endScale, globalScaleFloor);

  const start = normalizeMotionEndpoint(
    { scale: startScale, x: input.startX, y: input.startY },
    geometry
  );

  const end = normalizeMotionEndpoint(
    { scale: endScale, x: input.endX, y: input.endY },
    geometry
  );

  return {
    startScale: start.scale,
    endScale: end.scale,
    startX: start.x,
    endX: end.x,
    startY: start.y,
    endY: end.y,
  };
}

function normalizeMotionEndpoint(
  endpoint: { scale: number; x: number; y: number },
  geometry: MotionGeometry
): { scale: number; x: number; y: number } {
  const scale = Math.max(endpoint.scale, 1);

  const maxOffsetX = maxOffsetForScale(
    geometry.coverWidth,
    geometry.width,
    scale
  );
  const maxOffsetY = maxOffsetForScale(
    geometry.coverHeight,
    geometry.height,
    scale
  );

  const clampedX = clampOffset(endpoint.x, maxOffsetX);
  const clampedY = clampOffset(endpoint.y, maxOffsetY);

  return {
    scale,
    x: clampedX,
    y: clampedY,
  };
}

function clampOffset(value: number, maxOffset: number): number {
  if (Math.abs(value) <= maxOffset + EPSILON) {
    return value;
  }
  return Math.sign(value) * maxOffset;
}

function requiredScaleForOffset(
  offset: number,
  coverSize: number,
  viewportSize: number
): number {
  if (offset < EPSILON) {
    return 1;
  }

  const denominator = coverSize - 2 * (offset + MOTION_SAFETY_MARGIN);
  if (denominator <= EPSILON) {
    throw new Error(
      `KenBurns offset ${offset} exceeds available cover size ${coverSize}.`
    );
  }

  return viewportSize / denominator;
}

function maxOffsetForScale(
  coverSize: number,
  viewportSize: number,
  scale: number
): number {
  const max = (coverSize - viewportSize / scale) / 2 - MOTION_SAFETY_MARGIN;
  return Math.max(0, max);
}

/**
 * Build a complete image input filter chain for a single image with KenBurns.
 *
 * This combines:
 * 1. FPS normalization
 * 2. Cover scaling to match output aspect ratio
 * 3. RGB working format for stable subpixel crop movement
 * 4. Animated crop for pan/zoom (KenBurns)
 * 5. Final output scaling + pixel format conversion
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
  options: KenBurnsImageOptions,
  sourceDimensions: SourceDimensions,
  outputLabel: string
): string {
  const { width, height, fps } = options;
  const workingWidth = width * INTERNAL_SCALE_FACTOR;
  const workingHeight = height * INTERNAL_SCALE_FACTOR;
  const scaledEffect = scaleEffectOffsets(effect, INTERNAL_SCALE_FACTOR);
  const coverSize = computeCoverDimensions(
    sourceDimensions,
    workingWidth,
    workingHeight
  );

  const coverScale = `scale=${coverSize.width}:${coverSize.height}:flags=lanczos`;
  const kenBurnsCrop = buildKenBurnsFilter(scaledEffect, {
    ...options,
    width: workingWidth,
    height: workingHeight,
    coverWidth: coverSize.width,
    coverHeight: coverSize.height,
  });

  return `[${inputIndex}:v]fps=${fps},${coverScale},format=gbrp,${kenBurnsCrop},scale=${width}:${height}:flags=lanczos,setsar=1,format=yuv420p,setpts=PTS-STARTPTS[${outputLabel}]`;
}

function scaleEffectOffsets(
  effect: KenBurnsEffect,
  factor: number
): KenBurnsEffect {
  const startX = effect.startX ?? 0;
  const endX = effect.endX ?? startX;
  const startY = effect.startY ?? 0;
  const endY = effect.endY ?? startY;

  return {
    ...effect,
    startX: startX * factor,
    endX: endX * factor,
    startY: startY * factor,
    endY: endY * factor,
  };
}

function computeCoverDimensions(
  sourceDimensions: SourceDimensions,
  targetWidth: number,
  targetHeight: number
): SourceDimensions {
  if (sourceDimensions.width <= 0 || sourceDimensions.height <= 0) {
    throw new Error(
      `Image dimensions must be positive. Got width=${sourceDimensions.width}, height=${sourceDimensions.height}.`
    );
  }

  const sourceRatio = sourceDimensions.width / sourceDimensions.height;
  const targetRatio = targetWidth / targetHeight;

  if (sourceRatio >= targetRatio) {
    return {
      width: roundUpToEven(targetHeight * sourceRatio),
      height: targetHeight,
    };
  }

  return {
    width: targetWidth,
    height: roundUpToEven(targetWidth / sourceRatio),
  };
}

function roundUpToEven(value: number): number {
  const rounded = Math.ceil(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

/**
 * Build input arguments for a single image file.
 *
 * @param imagePath - Path to the image file
 * @param duration - Clip duration in seconds
 * @param fps - Frame rate used by the render graph
 * @returns Array of FFmpeg input arguments
 */
export function buildImageInputArgs(
  imagePath: string,
  duration: number,
  fps: number
): string[] {
  return [
    '-loop',
    '1',
    '-framerate',
    String(fps),
    '-t',
    String(duration),
    '-i',
    imagePath,
  ];
}
