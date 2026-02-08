/**
 * Shared config flattening utilities.
 *
 * Used by input-loader, producer-options, and prompt-input-loader to
 * consistently flatten nested config objects into dot-separated keys.
 */

/** Keys whose values are treated as opaque (not recursed into). */
const OPAQUE_KEYS = new Set(['responseFormat']);

/**
 * Flatten a nested config object into dot-separated key/value pairs.
 *
 * Objects are recursed into; arrays and primitives are leaf values.
 * Keys in {@link OPAQUE_KEYS} are always treated as leaves regardless of type.
 */
export function flattenConfigValues(
  source: Record<string, unknown>,
  prefix = '',
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (OPAQUE_KEYS.has(key)) {
      result[fullKey] = value;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenConfigValues(value as Record<string, unknown>, fullKey));
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

/**
 * Flatten a nested config object and return just the dot-separated keys.
 */
export function flattenConfigKeys(source: Record<string, unknown>, prefix = ''): string[] {
  return Object.keys(flattenConfigValues(source, prefix));
}

/**
 * Deep-merge two config objects. `override` values take precedence.
 * Plain objects are merged recursively; arrays and primitives are replaced.
 */
export function deepMergeConfig(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = deepMergeConfig(existing as Record<string, unknown>, value as Record<string, unknown>);
      continue;
    }
    result[key] = value;
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
