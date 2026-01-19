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
export type FieldType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multiline'
  | 'file'            // Single file selection
  | 'file-collection'; // Multiple file selection

/**
 * Blob types supported for file inputs.
 */
export type BlobType = 'image' | 'audio' | 'video';

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
  /** For file fields: allowed file extensions */
  fileExtensions?: string[];
  /** For file fields: the blob type (image, audio, video) */
  blobType?: BlobType;
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

/**
 * Mapping from producer input name to schema field name.
 */
export interface ProducerInputMapping {
  /** Producer input name (e.g., "Prompt", "NumImages") */
  producerInput: string;
  /** Schema field name (e.g., "prompt", "num_images") */
  schemaField: string;
}

/**
 * Extract mappings between producer inputs and schema fields.
 *
 * Mappings in producer YAML look like:
 * ```yaml
 * mappings:
 *   provider:
 *     model:
 *       Prompt: prompt           # Simple: producer input "Prompt" -> schema field "prompt"
 *       NumImages: num_images
 *       AspectRatio:
 *         field: image_size      # Complex: producer input -> schema field "image_size"
 *         transform: ...
 * ```
 *
 * @param modelMappings - The mappings for a specific model
 * @returns Array of producer input to schema field mappings
 */
export function extractProducerInputMappings(
  modelMappings: Record<string, unknown>,
): ProducerInputMapping[] {
  const mappings: ProducerInputMapping[] = [];

  for (const [producerInput, mapping] of Object.entries(modelMappings)) {
    if (typeof mapping === 'string') {
      // Simple mapping: Prompt: prompt
      mappings.push({ producerInput, schemaField: mapping });
    } else if (typeof mapping === 'object' && mapping !== null) {
      // Complex mapping with field property
      const mappingObj = mapping as Record<string, unknown>;
      if (typeof mappingObj.field === 'string') {
        mappings.push({ producerInput, schemaField: mappingObj.field });
      }
    }
  }

  return mappings;
}

/**
 * Get set of schema field names that are mapped from producer inputs.
 */
export function getMappedSchemaFieldNames(
  mappings: ProducerInputMapping[],
): Set<string> {
  return new Set(mappings.map((m) => m.schemaField));
}

/**
 * Producer input definition for blob type detection.
 * Matches the type from producer-mode.ts but avoids circular imports.
 */
export interface ProducerInputDef {
  name: string;
  type?: string;
  itemType?: string;
  description?: string;
}

/**
 * Check if a producer input is a blob type (image, audio, video).
 */
export function isBlobInput(input: ProducerInputDef): boolean {
  const blobTypes = ['image', 'audio', 'video'];
  return (
    blobTypes.includes(input.type ?? '') ||
    (input.type === 'collection' && blobTypes.includes(input.itemType ?? ''))
  );
}

/**
 * Get file extensions for a blob type.
 */
export function getExtensionsForBlobType(blobType: string): string[] {
  switch (blobType) {
    case 'image':
      return ['png', 'jpg', 'jpeg', 'webp', 'gif'];
    case 'audio':
      return ['mp3', 'wav', 'webm', 'ogg', 'flac', 'aac'];
    case 'video':
      return ['mp4', 'webm', 'mov', 'mkv'];
    default:
      return [];
  }
}

/**
 * Create a form field config for a blob input.
 */
export function createBlobFieldConfig(input: ProducerInputDef): FormFieldConfig | null {
  if (!isBlobInput(input)) {
    return null;
  }

  const isCollection = input.type === 'collection';
  const blobType = (isCollection ? input.itemType : input.type) as BlobType;
  const extensions = getExtensionsForBlobType(blobType);

  return {
    name: input.name,
    label: formatLabel(input.name),
    type: isCollection ? 'file-collection' : 'file',
    required: false, // Producer inputs don't have required field
    description: input.description,
    fileExtensions: extensions,
    blobType,
  };
}

/**
 * Categorize schema fields into producer inputs vs config.
 *
 * For producer inputs:
 * - Uses producer input names (Prompt, NumImages) as the field names
 * - Gets field configuration (type, options, etc.) from the mapped schema field
 * - For blob inputs (image, audio, video), creates file picker fields
 *
 * For config:
 * - Uses schema field names directly (acceleration, enable_safety_checker)
 * - Only includes schema fields NOT mapped from any producer input
 *
 * @param schemaFile - The loaded schema file for a model
 * @param inputMappings - Mappings from producer inputs to schema fields
 * @param producerInputs - Optional producer input definitions for blob type detection
 * @returns Categorized fields with inputFields (using producer names) and configFields (using schema names)
 */
export function categorizeSchemaFields(
  schemaFile: SchemaFile,
  inputMappings: ProducerInputMapping[],
  producerInputs?: ProducerInputDef[],
): { inputFields: FormFieldConfig[]; configFields: FormFieldConfig[] } {
  const allSchemaFields = schemaFileToFields(schemaFile);
  const schemaFieldMap = new Map(allSchemaFields.map((f) => [f.name, f]));
  const mappedSchemaFieldNames = getMappedSchemaFieldNames(inputMappings);

  // Create a map of producer input definitions by name for quick lookup
  const producerInputMap = new Map(
    (producerInputs ?? []).map((input) => [input.name, input])
  );

  const inputFields: FormFieldConfig[] = [];
  const configFields: FormFieldConfig[] = [];

  // Build input fields using producer input names but schema field config
  for (const mapping of inputMappings) {
    const producerInput = producerInputMap.get(mapping.producerInput);

    // Check if this is a blob input (image, audio, video, or collection of these)
    if (producerInput && isBlobInput(producerInput)) {
      const blobField = createBlobFieldConfig(producerInput);
      if (blobField) {
        inputFields.push(blobField);
        continue;
      }
    }

    // For non-blob inputs, use schema field config
    const schemaField = schemaFieldMap.get(mapping.schemaField);
    if (schemaField) {
      // Create field with producer input name but schema field configuration
      inputFields.push({
        ...schemaField,
        name: mapping.producerInput, // Use producer input name
        label: formatLabel(mapping.producerInput), // Format producer input name as label
      });
    }
  }

  // Config fields are schema fields NOT mapped from producer inputs
  for (const field of allSchemaFields) {
    if (!mappedSchemaFieldNames.has(field.name)) {
      configFields.push(field);
    }
  }

  // Sort: required fields first, then by order/name
  const sortFields = (fields: FormFieldConfig[]) => {
    return fields.sort((a, b) => {
      // Required fields first
      if (a.required !== b.required) {
        return a.required ? -1 : 1;
      }
      // Then by order if available
      const orderA = a.order ?? 1000;
      const orderB = b.order ?? 1000;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      // Then alphabetically
      return a.name.localeCompare(b.name);
    });
  };

  return {
    inputFields: sortFields(inputFields),
    configFields: sortFields(configFields),
  };
}
