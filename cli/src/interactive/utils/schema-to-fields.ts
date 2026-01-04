import type { SchemaFile } from '@gorenku/providers';

/**
 * Simplified JSON Schema type for form field generation.
 * Based on JSON Schema 7 but only includes properties we need.
 */
export interface JSONSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JSONSchema | boolean>;
  required?: string[];
  items?: JSONSchema | boolean;
  oneOf?: (JSONSchema | boolean)[];
  anyOf?: (JSONSchema | boolean)[];
  $ref?: string;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  [key: string]: unknown;
}

/**
 * Field types that can be rendered in the interactive form.
 */
export type FieldType = 'text' | 'number' | 'boolean' | 'select' | 'multiline';

/**
 * A form field configuration derived from JSON schema.
 */
export interface FormFieldConfig {
  /** Field name/key */
  name: string;
  /** Display label */
  label: string;
  /** Field type for rendering */
  type: FieldType;
  /** Whether the field is required */
  required: boolean;
  /** Description/help text */
  description?: string;
  /** Default value from schema */
  defaultValue?: unknown;
  /** For select fields: available options */
  options?: Array<{ label: string; value: string | number | boolean }>;
  /** For number fields: minimum value */
  min?: number;
  /** For number fields: maximum value */
  max?: number;
  /** Order for display (from x-order if available) */
  order?: number;
}

/**
 * Extract form fields from a JSON schema's properties.
 * Handles nested schemas and $ref resolution.
 */
export function schemaToFields(
  schema: JSONSchema,
  definitions: Record<string, JSONSchema> = {},
): FormFieldConfig[] {
  const fields: FormFieldConfig[] = [];
  const properties = schema.properties ?? {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);

  for (const [name, propSchema] of Object.entries(properties)) {
    if (typeof propSchema === 'boolean') {
      continue;
    }

    const resolved = resolveRef(propSchema, definitions);
    const field = propertyToField(name, resolved, required.has(name), definitions);
    if (field) {
      fields.push(field);
    }
  }

  // Sort by x-order if available, then by name
  fields.sort((a, b) => {
    const orderA = a.order ?? 1000;
    const orderB = b.order ?? 1000;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a.name.localeCompare(b.name);
  });

  return fields;
}

/**
 * Convert a schema file to form fields.
 */
export function schemaFileToFields(schemaFile: SchemaFile): FormFieldConfig[] {
  return schemaToFields(
    schemaFile.inputSchema as JSONSchema,
    schemaFile.definitions as Record<string, JSONSchema>,
  );
}

/**
 * Resolve a $ref in a schema property.
 */
function resolveRef(
  schema: JSONSchema,
  definitions: Record<string, JSONSchema>,
): JSONSchema {
  if (!schema.$ref) {
    return schema;
  }

  // Handle refs like "#/ImageSize" or "#/$defs/ImageSize"
  const ref = schema.$ref;
  let defName: string | undefined;

  const directMatch = ref.match(/^#\/([A-Za-z_][A-Za-z0-9_]*)$/);
  if (directMatch) {
    defName = directMatch[1];
  } else {
    const defsMatch = ref.match(/^#\/\$defs\/([A-Za-z_][A-Za-z0-9_]*)$/);
    if (defsMatch) {
      defName = defsMatch[1];
    }
  }

  if (defName && definitions[defName]) {
    return definitions[defName];
  }

  // Could not resolve, return original
  return schema;
}

/**
 * Convert a single schema property to a form field config.
 */
function propertyToField(
  name: string,
  schema: JSONSchema,
  isRequired: boolean,
  definitions: Record<string, JSONSchema>,
): FormFieldConfig | null {
  const label = (schema.title as string) ?? formatLabel(name);
  const description = schema.description as string | undefined;
  const order = (schema as Record<string, unknown>)['x-order'] as number | undefined;

  // Handle enum types
  if (schema.enum && Array.isArray(schema.enum)) {
    return {
      name,
      label,
      type: 'select',
      required: isRequired,
      description,
      defaultValue: schema.default,
      options: schema.enum.map((value) => ({
        label: String(value),
        value: value as string | number | boolean,
      })),
      order,
    };
  }

  // Handle oneOf/anyOf with const values (common pattern for options)
  if (schema.oneOf || schema.anyOf) {
    const variants = schema.oneOf ?? schema.anyOf ?? [];
    const options: Array<{ label: string; value: string | number | boolean }> = [];

    for (const variant of variants) {
      if (typeof variant === 'boolean') {
        continue;
      }
      const resolved = resolveRef(variant, definitions);
      if ('const' in resolved) {
        options.push({
          label: (resolved.title as string) ?? String(resolved.const),
          value: resolved.const as string | number | boolean,
        });
      }
    }

    if (options.length > 0) {
      return {
        name,
        label,
        type: 'select',
        required: isRequired,
        description,
        defaultValue: schema.default,
        options,
        order,
      };
    }
  }

  // Handle type-based fields
  const schemaType = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  switch (schemaType) {
    case 'boolean':
      return {
        name,
        label,
        type: 'boolean',
        required: isRequired,
        description,
        defaultValue: schema.default ?? false,
        order,
      };

    case 'integer':
    case 'number':
      return {
        name,
        label,
        type: 'number',
        required: isRequired,
        description,
        defaultValue: schema.default,
        min: schema.minimum,
        max: schema.maximum,
        order,
      };

    case 'string': {
      // Check if it's a long text field
      const maxLength = schema.maxLength;
      const isMultiline = maxLength && maxLength > 200;

      return {
        name,
        label,
        type: isMultiline ? 'multiline' : 'text',
        required: isRequired,
        description,
        defaultValue: schema.default,
        order,
      };
    }

    case 'array':
    case 'object':
      // Complex types - skip for now, could be expanded later
      return null;

    default:
      // Unknown type - treat as text
      return {
        name,
        label,
        type: 'text',
        required: isRequired,
        description,
        defaultValue: schema.default,
        order,
      };
  }
}

/**
 * Format a schema property name as a human-readable label.
 */
function formatLabel(name: string): string {
  // Convert camelCase/snake_case to Title Case
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase to spaces
    .replace(/[_-]+/g, ' ') // underscores/hyphens to spaces
    .replace(/\b\w/g, (c) => c.toUpperCase()) // capitalize words
    .trim();
}

/**
 * Get a subset of fields that are commonly user-facing.
 * Filters out internal/technical fields.
 */
export function filterUserFacingFields(fields: FormFieldConfig[]): FormFieldConfig[] {
  const internalPatterns = [
    /^(api_?key|secret|token|credential)/i,
    /^(webhook|callback)/i,
    /^_/,
  ];

  return fields.filter((field) => {
    return !internalPatterns.some((pattern) => pattern.test(field.name));
  });
}

/**
 * Create fields from blueprint input definitions.
 */
export function blueprintInputsToFields(
  inputs: Array<{
    name: string;
    type?: string;
    required?: boolean;
    description?: string;
  }>,
): FormFieldConfig[] {
  return inputs.map((input) => ({
    name: input.name,
    label: formatLabel(input.name),
    type: mapBlueprintType(input.type),
    required: input.required ?? true,
    description: input.description,
    order: undefined,
  }));
}

/**
 * Map blueprint input types to form field types.
 */
function mapBlueprintType(type?: string): FieldType {
  switch (type?.toLowerCase()) {
    case 'boolean':
    case 'bool':
      return 'boolean';
    case 'int':
    case 'integer':
    case 'number':
    case 'float':
      return 'number';
    case 'text':
    case 'multiline':
      return 'multiline';
    default:
      return 'text';
  }
}
