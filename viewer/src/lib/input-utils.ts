import type { BlueprintInputDef } from '@/types/blueprint-graph';

/**
 * Input category types.
 */
export type InputCategory =
  | 'media'
  | 'text'
  | 'textArray'
  | 'stringArray'
  | 'other';

/**
 * Inputs grouped by category.
 */
export interface CategorizedInputs {
  /** Image, video, audio inputs (including arrays of these types) */
  media: BlueprintInputDef[];
  /** Scalar text type inputs (long-form content) */
  text: BlueprintInputDef[];
  /** Array inputs containing long-form text items (itemType=text) */
  textArray: BlueprintInputDef[];
  /** Array inputs containing short string items (itemType=string) */
  stringArray: BlueprintInputDef[];
  /** All other inputs (string, int, enum, boolean, etc.) */
  other: BlueprintInputDef[];
}

/**
 * Media type values.
 */
export type MediaType = 'image' | 'video' | 'audio';

/**
 * Known valid input types for categorization.
 * Mirrors the VALID_INPUT_TYPES from core validation.
 */
const KNOWN_INPUT_TYPES = new Set([
  'string',
  'text',
  'int',
  'integer',
  'number',
  'boolean',
  'array',
  'collection',
  'image',
  'video',
  'audio',
  'json',
  'enum',
]);

/**
 * Checks if a type is a media type (image, video, audio).
 */
export function isMediaType(type: string, itemType?: string): boolean {
  const effectiveType = itemType ?? type;
  return (
    effectiveType === 'image' ||
    effectiveType === 'video' ||
    effectiveType === 'audio'
  );
}

/**
 * Gets the media type from an input type, or null if not a media type.
 */
export function getMediaTypeFromInput(
  type: string,
  itemType?: string
): MediaType | null {
  const effectiveType = itemType ?? type;
  // Reuse isMediaType check to avoid duplicating the media type list
  if (!isMediaType(type, itemType)) {
    return null;
  }
  // Type assertion is safe here since isMediaType verified it
  return effectiveType as MediaType;
}

/**
 * Gets the category for an input definition.
 */
export function getInputCategory(input: BlueprintInputDef): InputCategory {
  // Check for media types (image, video, audio or array of these)
  if (isMediaType(input.type, input.itemType)) {
    return 'media';
  }

  // Check for scalar text type (long-form content)
  if (input.type === 'text') {
    return 'text';
  }

  // Check for long-form text arrays
  if (input.type === 'array' && input.itemType === 'text') {
    return 'textArray';
  }

  // Check for short-form string arrays
  if (input.type === 'array' && input.itemType === 'string') {
    return 'stringArray';
  }

  // Log warning for unknown types in development
  if (
    process.env.NODE_ENV === 'development' &&
    !KNOWN_INPUT_TYPES.has(input.type)
  ) {
    console.warn(
      `[getInputCategory] Unknown input type "${input.type}" for input "${input.name}". Categorizing as "other".`
    );
  }

  // Everything else (string, int, enum, boolean, etc.)
  return 'other';
}

/**
 * Categorizes input definitions into media, text, text arrays, string arrays,
 * and all remaining input groups.
 */
export function categorizeInputs(
  inputs: BlueprintInputDef[]
): CategorizedInputs {
  const result: CategorizedInputs = {
    media: [],
    text: [],
    textArray: [],
    stringArray: [],
    other: [],
  };

  for (const input of inputs) {
    const category = getInputCategory(input);
    result[category].push(input);
  }

  return result;
}

/**
 * Returns whether an input should be shown in the Inputs panel.
 * Derived/runtime system inputs are hidden because they are not user-supplied.
 */
export function isInputVisibleInPanel(input: BlueprintInputDef): boolean {
  if (!input.system) {
    return true;
  }
  return input.system.userSupplied;
}

/**
 * Filters inputs to only those that should be displayed in the Inputs panel.
 */
export function filterPanelVisibleInputs(
  inputs: BlueprintInputDef[]
): BlueprintInputDef[] {
  return inputs.filter(isInputVisibleInPanel);
}

/**
 * Groups inputs by name into a Map for efficient lookup.
 * @deprecated Use groupInputsByName instead.
 */
export function groupMediaInputsByName(
  inputs: BlueprintInputDef[]
): Map<string, BlueprintInputDef> {
  return groupInputsByName(inputs);
}

/**
 * Groups inputs by name into a Map for efficient lookup.
 */
export function groupInputsByName(
  inputs: BlueprintInputDef[]
): Map<string, BlueprintInputDef> {
  const map = new Map<string, BlueprintInputDef>();
  for (const input of inputs) {
    map.set(input.name, input);
  }
  return map;
}
