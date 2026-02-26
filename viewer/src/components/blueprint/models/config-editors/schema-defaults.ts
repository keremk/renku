import type { SchemaProperty } from '@/types/blueprint-graph';

function cloneDefaultValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function materializeSchemaDefault(schema: SchemaProperty | undefined): unknown {
  if (!schema) {
    return undefined;
  }

  if (schema.default !== undefined) {
    return cloneDefaultValue(schema.default);
  }

  if (schema.type === 'object' || schema.properties) {
    const defaults: Record<string, unknown> = {};
    for (const [key, propertySchema] of Object.entries(
      schema.properties ?? {}
    )) {
      const nestedDefault = materializeSchemaDefault(propertySchema);
      if (nestedDefault !== undefined) {
        defaults[key] = nestedDefault;
      }
    }
    if (Object.keys(defaults).length > 0) {
      return defaults;
    }
  }

  return undefined;
}

export function resolveObjectDefaults<T extends Record<string, unknown>>(
  schema: SchemaProperty | undefined
): T {
  const defaults = materializeSchemaDefault(schema);
  if (defaults && typeof defaults === 'object' && !Array.isArray(defaults)) {
    return defaults as T;
  }
  return {} as T;
}
