import type {
  MappingFieldDefinition,
  MappingCondition,
  CombineTransform,
} from '@gorenku/core';
import { createProviderError, SdkErrorCode } from './errors.js';

/**
 * Context for applying transforms.
 * Contains all resolved inputs and their bindings.
 */
export interface TransformContext {
  /** All resolved input values keyed by canonical ID */
  inputs: Record<string, unknown>;
  /** Maps input aliases to canonical IDs */
  inputBindings: Record<string, string>;
}

/**
 * Result of applying a mapping transform.
 */
export type MappingResult =
  | { field: string; value: unknown }
  | { expand: Record<string, unknown> }
  | undefined;

/**
 * Applies a mapping transform to produce a field/value pair or expanded object.
 *
 * Transform application order:
 * 1. Check conditional -> skip if condition not met
 * 2. Apply combine -> merge multiple inputs
 * 3. Apply firstOf -> extract first from array
 * 4. Apply invert -> flip boolean
 * 5. Apply intToString -> convert to string
 * 6. Apply durationToFrames -> multiply by fps
 * 7. Apply transform -> value lookup
 *
 * @param inputAlias - The producer input name (e.g., "AspectRatio")
 * @param mapping - The mapping field definition
 * @param context - Transform context with inputs and bindings
 * @returns The transformed field/value, expanded object, or undefined if skipped
 */
export function applyMapping(
  inputAlias: string,
  mapping: MappingFieldDefinition,
  context: TransformContext,
): MappingResult {
  // 1. Check conditional - skip if condition not met
  if (mapping.conditional) {
    const conditionMet = evaluateCondition(mapping.conditional.when, context);
    if (!conditionMet) {
      return undefined;
    }
    // Recurse with the "then" mapping
    return applyMapping(inputAlias, mapping.conditional.then, context);
  }

  // 2. Apply combine - merge multiple inputs into one value
  if (mapping.combine) {
    const combinedValue = applyCombineTransform(mapping.combine, context);
    if (combinedValue === undefined) {
      return undefined;
    }
    // Combined values may produce objects for expand
    if (mapping.expand && typeof combinedValue === 'object' && combinedValue !== null) {
      return { expand: combinedValue as Record<string, unknown> };
    }
    if (!mapping.field) {
      throw createProviderError(
        SdkErrorCode.COMBINE_REQUIRES_FIELD,
        `Combine transform requires 'field' unless using 'expand'`,
        { kind: 'user_input', causedByUser: true },
      );
    }
    return { field: mapping.field, value: combinedValue };
  }

  // Get the raw input value
  const canonicalId = context.inputBindings[inputAlias];
  let value: unknown;

  if (canonicalId) {
    // Direct lookup succeeded - check if we have a resolved value
    value = resolveInputValue(canonicalId, context.inputs);
  }

  // If direct lookup didn't yield a value, check for element-level bindings
  // This handles cases where:
  // 1. Collection inputs are bound element-by-element (e.g., ReferenceImages[0], ReferenceImages[1])
  // 2. Direct binding points to an unresolved Input node (e.g., "Input:VideoProducer.ReferenceImages[0]")
  if (value === undefined) {
    const elementBindings = collectElementBindings(inputAlias, context.inputBindings);
    if (elementBindings.length > 0) {
      // Reconstruct array from element bindings, filtering out undefined values
      const elements = elementBindings.map((binding) =>
        resolveInputValue(binding.canonicalId, context.inputs),
      );
      // Only return if we have at least one valid element
      if (elements.some((element) => element !== undefined)) {
        value = elements;
      }
    }
  }

  if (value === undefined) {
    return undefined;
  }

  // 3. Apply firstOf - extract first element from array
  if (mapping.firstOf) {
    value = applyFirstOf(value);
    if (value === undefined) {
      return undefined;
    }
  }

  // 4. Apply invert - flip boolean value
  if (mapping.invert) {
    value = applyInvert(value);
  }

  // 5. Apply intToString - convert integer to string
  if (mapping.intToString) {
    value = applyIntToString(value);
  }

  // 5b. Apply intToSecondsString - convert integer to string with "s" suffix
  if (mapping.intToSecondsString) {
    value = applyIntToSecondsString(value);
  }

  // 6. Apply durationToFrames - convert seconds to frame count
  if (mapping.durationToFrames) {
    value = applyDurationToFrames(value, mapping.durationToFrames.fps);
  }

  // 7. Apply transform - value lookup table
  if (mapping.transform) {
    value = applyValueTransform(value, mapping.transform);
  }

  // Handle expand - spread object into payload
  if (mapping.expand) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return { expand: value as Record<string, unknown> };
    }
    throw createProviderError(
      SdkErrorCode.CANNOT_EXPAND_NON_OBJECT,
      `Cannot expand non-object value for "${inputAlias}". ` +
        `expand:true requires the value to be an object, got ${typeof value}.`,
      { kind: 'user_input', causedByUser: true },
    );
  }

  // Regular field assignment
  if (!mapping.field) {
    throw createProviderError(
      SdkErrorCode.MISSING_FIELD_PROPERTY,
      `Mapping for "${inputAlias}" requires 'field' property`,
      { kind: 'user_input', causedByUser: true },
    );
  }
  return { field: mapping.field, value };
}

/**
 * Sets a value at a potentially nested path using dot notation.
 * Creates intermediate objects as needed.
 *
 * @example
 * setNestedValue(obj, "voice_setting.voice_id", "en-US")
 * // Results in: { voice_setting: { voice_id: "en-US" } }
 */
export function setNestedValue(
  payload: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = payload;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  const finalKey = parts[parts.length - 1];
  current[finalKey] = value;
}

/**
 * Evaluates a condition against the transform context.
 * @throws Error if condition has no valid operator (equals, notEmpty, empty)
 */
function evaluateCondition(condition: MappingCondition, context: TransformContext): boolean {
  const canonicalId = context.inputBindings[condition.input];
  const value = canonicalId ? resolveInputValue(canonicalId, context.inputs) : undefined;

  // Check equals condition
  if ('equals' in condition) {
    return value === condition.equals;
  }

  // Check notEmpty condition
  if (condition.notEmpty) {
    return value !== undefined && value !== null && value !== '';
  }

  // Check empty condition
  if (condition.empty) {
    return value === undefined || value === null || value === '';
  }

  // No valid condition operator - this is likely a configuration error
  throw createProviderError(
    SdkErrorCode.INVALID_CONDITION_CONFIG,
    `Invalid condition for input "${condition.input}": ` +
      `must specify one of "equals", "notEmpty", or "empty".`,
    { kind: 'user_input', causedByUser: true },
  );
}

/**
 * Applies combine transform - merges multiple inputs using a lookup table.
 * Key format: "{value1}+{value2}" where empty values result in just "+" or "+{value2}"
 */
function applyCombineTransform(
  combine: CombineTransform,
  context: TransformContext,
): unknown {
  // Build composite key from input values
  const keyParts: string[] = [];
  let hasAnyValue = false;

  for (const inputName of combine.inputs) {
    const canonicalId = context.inputBindings[inputName];
    const value = canonicalId ? resolveInputValue(canonicalId, context.inputs) : undefined;

    if (value !== undefined && value !== null && value !== '') {
      keyParts.push(String(value));
      hasAnyValue = true;
    } else {
      keyParts.push('');
    }
  }

  // If no inputs have values, skip the combine
  if (!hasAnyValue) {
    return undefined;
  }

  const key = keyParts.join('+');

  // Look up the combined value
  if (key in combine.table) {
    return combine.table[key];
  }

  // No matching combination found
  return undefined;
}

/**
 * Applies firstOf transform - extracts first element from array.
 */
function applyFirstOf(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.length > 0 ? value[0] : undefined;
  }
  // If not an array, return as-is
  return value;
}

/**
 * Applies invert transform - flips boolean value.
 */
function applyInvert(value: unknown): unknown {
  if (typeof value === 'boolean') {
    return !value;
  }
  // For non-boolean values, treat truthy as true
  return !value;
}

/**
 * Applies intToString transform - converts integer to string.
 */
function applyIntToString(value: unknown): unknown {
  if (typeof value === 'number') {
    return String(value);
  }
  return value;
}

/**
 * Applies intToSecondsString transform - converts integer to string with "s" suffix.
 * Example: 8 → "8s"
 */
function applyIntToSecondsString(value: unknown): unknown {
  if (typeof value === 'number') {
    return `${value}s`;
  }
  return value;
}

/**
 * Applies durationToFrames transform - converts seconds to frame count.
 */
function applyDurationToFrames(value: unknown, fps: number): unknown {
  if (typeof value === 'number') {
    return Math.round(value * fps);
  }
  return value;
}

/**
 * Applies value transform - looks up value in transform table.
 */
function applyValueTransform(
  value: unknown,
  transform: Record<string, unknown>,
): unknown {
  // Convert value to string for lookup (supports numbers, booleans, strings)
  const key = String(value);
  if (key in transform) {
    return transform[key];
  }
  // No matching transform, return original value
  return value;
}

/**
 * Collects element-level bindings for a collection input.
 *
 * When a collection input like "ReferenceImages" is bound element-by-element
 * (e.g., ReferenceImages[0], ReferenceImages[1]), this function finds all
 * matching element bindings and returns them sorted by index.
 *
 * @param baseAlias - The base input alias (e.g., "ReferenceImages")
 * @param inputBindings - The input bindings map
 * @returns Array of element bindings sorted by index
 *
 * @example
 * // Given bindings: { "Foo[0]": "artifact1", "Foo[1]": "artifact2", "Bar": "artifact3" }
 * collectElementBindings("Foo", bindings)
 * // Returns: [{ index: 0, canonicalId: "artifact1" }, { index: 1, canonicalId: "artifact2" }]
 */
export function collectElementBindings(
  baseAlias: string,
  inputBindings: Record<string, string>,
): Array<{ index: number; canonicalId: string }> {
  // Escape special regex characters in the base alias
  const escapedAlias = baseAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escapedAlias}\\[(\\d+)\\]$`);
  const elements: Array<{ index: number; canonicalId: string }> = [];

  for (const [key, canonicalId] of Object.entries(inputBindings)) {
    const match = key.match(pattern);
    if (match) {
      elements.push({ index: parseInt(match[1]!, 10), canonicalId });
    }
  }

  // Sort by index to ensure correct array order
  return elements.sort((a, b) => a.index - b.index);
}

interface IndexedInputAccess {
  baseId: string;
  indices: number[];
}

function resolveInputValue(
  canonicalId: string,
  inputs: Record<string, unknown>,
): unknown {
  if (canonicalId in inputs) {
    return inputs[canonicalId];
  }

  const indexedAccess = parseIndexedInputAccess(canonicalId);
  if (!indexedAccess) {
    return undefined;
  }

  const baseValue = inputs[indexedAccess.baseId];
  if (baseValue === undefined) {
    return undefined;
  }

  let currentValue: unknown = baseValue;
  let currentPath = indexedAccess.baseId;

  for (let i = 0; i < indexedAccess.indices.length; i += 1) {
    const index = indexedAccess.indices[i]!;
    if (!Array.isArray(currentValue)) {
      throw createProviderError(
        SdkErrorCode.INVALID_INDEXED_INPUT_ACCESS,
        `Invalid indexed input access "${canonicalId}": "${currentPath}" is not an array.`,
        { kind: 'user_input', causedByUser: true },
      );
    }
    if (index >= currentValue.length) {
      throw createProviderError(
        SdkErrorCode.INVALID_INDEXED_INPUT_ACCESS,
        `Invalid indexed input access "${canonicalId}": index ${index} is out of bounds for "${currentPath}" (length ${currentValue.length}).`,
        { kind: 'user_input', causedByUser: true },
      );
    }

    currentValue = currentValue[index];
    currentPath = `${currentPath}[${index}]`;

    if (currentValue === undefined && i < indexedAccess.indices.length - 1) {
      throw createProviderError(
        SdkErrorCode.INVALID_INDEXED_INPUT_ACCESS,
        `Invalid indexed input access "${canonicalId}": "${currentPath}" cannot be indexed further because it is undefined.`,
        { kind: 'user_input', causedByUser: true },
      );
    }
  }

  return currentValue;
}

function parseIndexedInputAccess(canonicalId: string): IndexedInputAccess | undefined {
  if (!canonicalId.startsWith('Input:')) {
    return undefined;
  }

  const indices: number[] = [];
  let baseId = canonicalId;

  while (true) {
    const match = baseId.match(/^(.*)\[(\d+)\]$/);
    if (!match) {
      break;
    }
    indices.unshift(parseInt(match[2]!, 10));
    baseId = match[1]!;
  }

  if (indices.length === 0 || baseId === canonicalId) {
    return undefined;
  }

  return { baseId, indices };
}
