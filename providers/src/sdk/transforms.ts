import type {
  MappingFieldDefinition,
  MappingCondition,
  CombineTransform,
} from '@gorenku/core';

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
      throw new Error(`Combine transform requires 'field' unless using 'expand'`);
    }
    return { field: mapping.field, value: combinedValue };
  }

  // Get the raw input value
  const canonicalId = context.inputBindings[inputAlias];
  if (!canonicalId) {
    return undefined;
  }
  let value = context.inputs[canonicalId];
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
    throw new Error(
      `Cannot expand non-object value for "${inputAlias}". ` +
        `expand:true requires the value to be an object, got ${typeof value}.`,
    );
  }

  // Regular field assignment
  if (!mapping.field) {
    throw new Error(`Mapping for "${inputAlias}" requires 'field' property`);
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
 */
function evaluateCondition(condition: MappingCondition, context: TransformContext): boolean {
  const canonicalId = context.inputBindings[condition.input];
  const value = canonicalId ? context.inputs[canonicalId] : undefined;

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

  // No condition specified, default to true
  return true;
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
    const value = canonicalId ? context.inputs[canonicalId] : undefined;

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
