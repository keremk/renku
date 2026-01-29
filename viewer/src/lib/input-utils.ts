import type { BlueprintInputDef } from "@/types/blueprint-graph";

/**
 * Input category types.
 */
export type InputCategory = "media" | "text" | "other";

/**
 * Inputs grouped by category.
 */
export interface CategorizedInputs {
  /** Image, video, audio inputs (including arrays of these types) */
  media: BlueprintInputDef[];
  /** Text type inputs (long-form content) */
  text: BlueprintInputDef[];
  /** All other inputs (string, int, enum, boolean, etc.) */
  other: BlueprintInputDef[];
}

/**
 * Media type values.
 */
export type MediaType = "image" | "video" | "audio";

/**
 * Checks if a type is a media type (image, video, audio).
 */
export function isMediaType(type: string, itemType?: string): boolean {
  const effectiveType = itemType ?? type;
  return (
    effectiveType === "image" ||
    effectiveType === "video" ||
    effectiveType === "audio"
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
  if (
    effectiveType === "image" ||
    effectiveType === "video" ||
    effectiveType === "audio"
  ) {
    return effectiveType;
  }
  return null;
}

/**
 * Gets the category for an input definition.
 */
export function getInputCategory(input: BlueprintInputDef): InputCategory {
  // Check for media types (image, video, audio or array of these)
  if (isMediaType(input.type, input.itemType)) {
    return "media";
  }

  // Check for text type (long-form content)
  if (input.type === "text") {
    return "text";
  }

  // Everything else (string, int, enum, boolean, etc.)
  return "other";
}

/**
 * Categorizes an array of input definitions into media, text, and other groups.
 */
export function categorizeInputs(inputs: BlueprintInputDef[]): CategorizedInputs {
  const result: CategorizedInputs = {
    media: [],
    text: [],
    other: [],
  };

  for (const input of inputs) {
    const category = getInputCategory(input);
    result[category].push(input);
  }

  return result;
}

/**
 * Groups media inputs by name (for separate collapsible sections).
 */
export function groupMediaInputsByName(
  inputs: BlueprintInputDef[]
): Map<string, BlueprintInputDef> {
  const map = new Map<string, BlueprintInputDef>();
  for (const input of inputs) {
    map.set(input.name, input);
  }
  return map;
}
