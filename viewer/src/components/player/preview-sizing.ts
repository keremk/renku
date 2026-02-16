export interface PreviewDimensions {
  width: number;
  height: number;
}

export interface DetectedVisualDimensions {
  assetId: string;
  dimensions: PreviewDimensions;
}

const BASE_ASPECT_HEIGHT = 1080;

export const DEFAULT_COMPOSITION_SIZE: PreviewDimensions = {
  width: 1920,
  height: 1080,
};

export function parseAspectRatio(
  aspectRatio: string
): PreviewDimensions | null {
  const match = /^\s*(\d+)\s*:\s*(\d+)/.exec(aspectRatio);
  if (!match) {
    return null;
  }

  const ratioWidth = Number(match[1]);
  const ratioHeight = Number(match[2]);
  if (ratioWidth <= 0 || ratioHeight <= 0) {
    return null;
  }

  return {
    width: Math.round((BASE_ASPECT_HEIGHT / ratioHeight) * ratioWidth),
    height: BASE_ASPECT_HEIGHT,
  };
}

export function fitWithinBounds(
  content: PreviewDimensions,
  bounds: PreviewDimensions
): PreviewDimensions {
  if (bounds.width <= 0 || bounds.height <= 0) {
    return {
      width: 0,
      height: 0,
    };
  }

  const scale = Math.min(
    bounds.width / content.width,
    bounds.height / content.height
  );
  return {
    width: Math.max(1, Math.round(content.width * scale)),
    height: Math.max(1, Math.round(content.height * scale)),
  };
}

export function resolveCompositionDimensions(args: {
  explicitAspectDimensions: PreviewDimensions | null;
  detectedVisualDimensions: DetectedVisualDimensions | null;
  firstVisualAssetId: string | null;
}): PreviewDimensions {
  const {
    explicitAspectDimensions,
    detectedVisualDimensions,
    firstVisualAssetId,
  } = args;

  if (explicitAspectDimensions) {
    return explicitAspectDimensions;
  }

  if (
    firstVisualAssetId &&
    detectedVisualDimensions &&
    detectedVisualDimensions.assetId === firstVisualAssetId
  ) {
    return detectedVisualDimensions.dimensions;
  }

  return DEFAULT_COMPOSITION_SIZE;
}
