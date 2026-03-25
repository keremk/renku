export interface RatioPreset {
  key: string;
  label: string;
  width: number;
  height: number;
  defaultWidth: number;
  defaultHeight: number;
}

export const ASPECT_CUSTOM_KEY = 'custom';

export type AspectMode = 'landscape' | 'portrait' | 'square' | 'custom';

export interface ResolutionValue {
  width: number;
  height: number;
}

export function inferPresetKey(
  width: number,
  height: number,
  presets: RatioPreset[]
): string {
  for (const preset of presets) {
    if (width * preset.height === height * preset.width) {
      return preset.key;
    }
  }

  return ASPECT_CUSTOM_KEY;
}

export function getAspectMode(
  selectedPresetKey: string,
  presets: RatioPreset[]
): AspectMode {
  if (selectedPresetKey === ASPECT_CUSTOM_KEY) {
    return 'custom';
  }

  const preset = presets.find((entry) => entry.key === selectedPresetKey);
  if (!preset) {
    return 'custom';
  }

  if (preset.width === preset.height) {
    return 'square';
  }

  if (preset.width > preset.height) {
    return 'landscape';
  }

  return 'portrait';
}

export function getPresetByKey(
  selectedPresetKey: string,
  presets: RatioPreset[]
): RatioPreset | undefined {
  if (selectedPresetKey === ASPECT_CUSTOM_KEY) {
    return undefined;
  }
  return presets.find((entry) => entry.key === selectedPresetKey);
}

export function resolutionFromPreset(
  selectedPresetKey: string,
  currentResolution: ResolutionValue,
  presets: RatioPreset[]
): ResolutionValue {
  const preset = getPresetByKey(selectedPresetKey, presets);
  if (!preset) {
    return currentResolution;
  }

  return {
    width: preset.defaultWidth,
    height: preset.defaultHeight,
  };
}

export function resolutionFromWidthSelection(
  selectedPreset: RatioPreset,
  aspectMode: Exclude<AspectMode, 'portrait' | 'custom'>,
  width: number
): ResolutionValue {
  if (aspectMode === 'square') {
    return {
      width,
      height: width,
    };
  }

  return {
    width,
    height: resolveHeightForWidth(width, selectedPreset),
  };
}

export function resolutionFromHeightSelection(
  selectedPreset: RatioPreset,
  aspectMode: Exclude<AspectMode, 'landscape' | 'custom'>,
  height: number
): ResolutionValue {
  if (aspectMode === 'square') {
    return {
      width: height,
      height,
    };
  }

  return {
    width: resolveWidthForHeight(height, selectedPreset),
    height,
  };
}

export function parsePositiveInteger(value: string): number | undefined {
  if (!/^[0-9]+$/.test(value)) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

export function sanitizeNumericInput(value: string): string {
  return value.replace(/\D+/g, '');
}

export function buildDimensionOptions(
  options: number[],
  current: number
): number[] {
  const values = dedupePositiveIntegers([current, ...options]);
  return [...values].sort((left, right) => left - right);
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

function dedupePositiveIntegers(values: number[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];

  for (const value of values) {
    if (!Number.isInteger(value) || value <= 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }

  return result;
}
