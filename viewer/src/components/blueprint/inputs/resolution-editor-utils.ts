export interface RatioPreset {
  key: string;
  label: string;
  width: number;
  height: number;
  defaultWidth: number;
  defaultHeight: number;
}

export const ASPECT_CUSTOM_KEY = 'custom';

export function inferPresetKey(
  width: number,
  height: number,
  presets: RatioPreset[]
): string {
  const divisor = greatestCommonDivisor(width, height);
  const normalizedWidth = width / divisor;
  const normalizedHeight = height / divisor;

  for (const preset of presets) {
    if (
      preset.width === normalizedWidth &&
      preset.height === normalizedHeight
    ) {
      return preset.key;
    }
  }

  return ASPECT_CUSTOM_KEY;
}

export function parsePositiveInteger(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

export function resolveHeightForWidth(
  width: number,
  preset: RatioPreset
): number {
  return roundToEven((width * preset.height) / preset.width);
}

export function resolveWidthForHeight(
  height: number,
  preset: RatioPreset
): number {
  return roundToEven((height * preset.width) / preset.height);
}

function roundToEven(value: number): number {
  const rounded = Math.round(value);
  if (rounded % 2 === 0) {
    return rounded;
  }
  return rounded + 1;
}

function greatestCommonDivisor(a: number, b: number): number {
  let left = a;
  let right = b;
  while (right !== 0) {
    const next = left % right;
    left = right;
    right = next;
  }
  return left;
}
