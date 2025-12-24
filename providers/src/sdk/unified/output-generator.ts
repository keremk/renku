import type { JSONSchema7 } from 'ai';
import type { SchemaFile } from './schema-file.js';

/**
 * Options for generating output from a schema.
 */
export interface OutputGeneratorOptions {
  /** Provider name for URL generation (e.g., 'fal-ai', 'replicate') */
  provider: string;
  /** Model name for URL generation */
  model: string;
  /** Number of artifacts to produce (determines array lengths for media outputs) */
  producesCount?: number;
  /** Base URL for generated mock URLs */
  baseUrl?: string;
}

/**
 * Context passed through recursive schema generation.
 */
interface GeneratorContext {
  provider: string;
  model: string;
  definitions: Record<string, JSONSchema7>;
  baseUrl: string;
  producesCount: number;
  depth: number;
  urlCounter: number;
}

/**
 * Generate a mock URL for a provider/model combination.
 */
function generateMockUrl(
  context: GeneratorContext,
  extension: string = 'png'
): string {
  const sanitizedModel = context.model.replace(/[/:.]/g, '-');
  const counter = context.urlCounter++;
  return `${context.baseUrl}/${sanitizedModel}/output_${counter}.${extension}`;
}

/**
 * Resolve a $ref to its definition.
 */
function resolveRef(
  ref: string,
  definitions: Record<string, JSONSchema7>
): JSONSchema7 | undefined {
  // Handle "#/TypeName" or "#/$defs/TypeName" format
  let typeName: string;
  if (ref.startsWith('#/$defs/')) {
    typeName = ref.slice(8);
  } else if (ref.startsWith('#/')) {
    typeName = ref.slice(2);
  } else {
    return undefined;
  }
  return definitions[typeName];
}

/**
 * Resolve the effective type from a schema, handling anyOf/oneOf.
 */
function resolveType(schema: JSONSchema7): JSONSchema7['type'] | undefined {
  if (schema.type) {
    return Array.isArray(schema.type) ? schema.type[0] : schema.type;
  }
  return undefined;
}

/**
 * Check if a schema (or its resolved $ref) contains a URI-formatted string.
 * This is used to determine if an array should use producesCount.
 */
function schemaContainsUri(
  schema: JSONSchema7,
  definitions: Record<string, JSONSchema7>,
  depth: number = 0
): boolean {
  if (depth > 10) {
    return false;
  }

  // Handle $ref
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, definitions);
    if (resolved) {
      return schemaContainsUri(resolved, definitions, depth + 1);
    }
    return false;
  }

  // Direct URI format
  if (schema.type === 'string' && schema.format === 'uri') {
    return true;
  }

  // Check object properties
  if (schema.properties) {
    for (const prop of Object.values(schema.properties)) {
      if (schemaContainsUri(prop as JSONSchema7, definitions, depth + 1)) {
        return true;
      }
    }
  }

  // Check anyOf/oneOf
  if (schema.anyOf) {
    for (const option of schema.anyOf) {
      if (schemaContainsUri(option as JSONSchema7, definitions, depth + 1)) {
        return true;
      }
    }
  }
  if (schema.oneOf) {
    for (const option of schema.oneOf) {
      if (schemaContainsUri(option as JSONSchema7, definitions, depth + 1)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Generate a value from a JSON schema.
 */
function generateFromSchema(
  schema: JSONSchema7,
  context: GeneratorContext
): unknown {
  // Prevent infinite recursion
  if (context.depth > 20) {
    return null;
  }

  const nextContext = { ...context, depth: context.depth + 1 };

  // Handle $ref
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, context.definitions);
    if (resolved) {
      return generateFromSchema(resolved, nextContext);
    }
    return null;
  }

  // Handle anyOf/oneOf - pick first option
  if (schema.anyOf && schema.anyOf.length > 0) {
    return generateFromSchema(schema.anyOf[0] as JSONSchema7, nextContext);
  }
  if (schema.oneOf && schema.oneOf.length > 0) {
    return generateFromSchema(schema.oneOf[0] as JSONSchema7, nextContext);
  }

  // Handle allOf - merge schemas
  if (schema.allOf && schema.allOf.length > 0) {
    // For simplicity, just use the first one
    return generateFromSchema(schema.allOf[0] as JSONSchema7, nextContext);
  }

  const resolvedType = resolveType(schema);

  // Handle object type
  if (resolvedType === 'object' || (schema.properties && !resolvedType)) {
    const obj: Record<string, unknown> = {};
    const properties = schema.properties ?? {};

    for (const [key, value] of Object.entries(properties)) {
      obj[key] = generateFromSchema(value as JSONSchema7, nextContext);
    }

    return obj;
  }

  // Handle array type
  if (resolvedType === 'array' || schema.items) {
    const itemSchema = schema.items as JSONSchema7 | undefined;
    if (!itemSchema) {
      return [];
    }

    // Use producesCount for arrays whose items contain URI fields (media outputs)
    const isMediaArray = schemaContainsUri(itemSchema, context.definitions);
    const length = determineArrayLength(
      isMediaArray,
      context.producesCount,
      schema
    );

    return Array.from({ length }, () =>
      generateFromSchema(itemSchema, nextContext)
    );
  }

  // Handle string with format: uri (generate URL)
  if (resolvedType === 'string' && schema.format === 'uri') {
    return generateMockUrl(context, 'png');
  }

  // Handle string type
  if (resolvedType === 'string') {
    if (schema.enum && schema.enum.length > 0) {
      return schema.enum[0];
    }
    return 'simulated_value';
  }

  // Handle integer type
  if (resolvedType === 'integer') {
    if (schema.minimum !== undefined) {
      return schema.minimum as number;
    }
    if (schema.default !== undefined) {
      return schema.default;
    }
    return 1;
  }

  // Handle number type
  if (resolvedType === 'number') {
    if (schema.minimum !== undefined) {
      return schema.minimum as number;
    }
    if (schema.default !== undefined) {
      return schema.default;
    }
    return 1.0;
  }

  // Handle boolean type
  if (resolvedType === 'boolean') {
    if (schema.default !== undefined) {
      return schema.default;
    }
    return true;
  }

  // Default fallback
  return null;
}

/**
 * Determine array length based on whether it's a media array.
 */
function determineArrayLength(
  isMediaArray: boolean,
  producesCount: number,
  schema: JSONSchema7
): number {
  // Check schema constraints
  if (schema.minItems !== undefined) {
    return Math.max(
      isMediaArray ? producesCount : 1,
      schema.minItems as number
    );
  }

  // For media output arrays (containing URIs), use producesCount
  if (isMediaArray) {
    return producesCount;
  }

  // Default to 1 for non-media arrays
  return 1;
}

/**
 * Generate a fallback output for schemas without output_schema.
 * Returns a simple URL array matching the provider's typical format.
 */
function generateFallbackOutput(
  options: OutputGeneratorOptions,
  modelType: 'image' | 'video' | 'audio' | 'unknown'
): unknown {
  const count = options.producesCount ?? 1;
  const baseUrl = options.baseUrl ?? `https://mock.${options.provider}.media`;
  const sanitizedModel = options.model.replace(/[/:.]/g, '-');

  const extension =
    modelType === 'video' ? 'mp4' : modelType === 'audio' ? 'mp3' : 'png';

  // Replicate format: simple array of URLs
  if (options.provider === 'replicate') {
    return Array.from(
      { length: count },
      (_, i) => `${baseUrl}/${sanitizedModel}/output_${i}.${extension}`
    );
  }

  // Wavespeed format: { data: { outputs: [...] } }
  if (options.provider === 'wavespeed-ai') {
    return {
      data: {
        id: `simulated-${Date.now()}`,
        status: 'completed',
        outputs: Array.from(
          { length: count },
          (_, i) => `${baseUrl}/${sanitizedModel}/output_${i}.${extension}`
        ),
      },
    };
  }

  // Fal.ai format: varies by type
  if (options.provider === 'fal-ai') {
    if (modelType === 'video') {
      return {
        video: {
          url: `${baseUrl}/${sanitizedModel}/video.mp4`,
          content_type: 'video/mp4',
        },
        seed: Math.floor(Math.random() * 2147483647),
      };
    }
    if (modelType === 'audio') {
      return {
        audio: {
          url: `${baseUrl}/${sanitizedModel}/audio.mp3`,
          content_type: 'audio/mpeg',
        },
      };
    }
    // Default to images
    return {
      images: Array.from({ length: count }, (_, i) => ({
        url: `${baseUrl}/${sanitizedModel}/image_${i}.png`,
        content_type: 'image/png',
      })),
      seed: Math.floor(Math.random() * 2147483647),
    };
  }

  // Generic fallback: array of URLs
  return Array.from(
    { length: count },
    (_, i) => `${baseUrl}/${sanitizedModel}/output_${i}.${extension}`
  );
}

/**
 * Generate mock output from a schema file.
 *
 * If the schema file has an output_schema, generates structured output matching that schema.
 * Otherwise, generates a fallback output based on the provider's typical format.
 *
 * @param schemaFile - The parsed schema file (may or may not have output_schema)
 * @param options - Generation options including provider and model info
 * @returns Generated mock output matching the expected provider response format
 */
export function generateOutputFromSchema(
  schemaFile: SchemaFile | undefined,
  options: OutputGeneratorOptions
): unknown {
  const baseUrl = options.baseUrl ?? `https://mock.${options.provider}.media`;

  // If no schema file or no output schema, use fallback
  if (!schemaFile?.outputSchema) {
    // Try to infer model type from provider patterns
    const modelType = inferModelType(options.model);
    return generateFallbackOutput(options, modelType);
  }

  const context: GeneratorContext = {
    provider: options.provider,
    model: options.model,
    definitions: schemaFile.definitions,
    baseUrl,
    producesCount: options.producesCount ?? 1,
    depth: 0,
    urlCounter: 0,
  };

  return generateFromSchema(schemaFile.outputSchema, context);
}

/**
 * Infer model type from model name using generic keywords only.
 * This is used for fallback when there's no output_schema.
 * We only check for explicit type indicators in the model name,
 * defaulting to 'image' as the most common case.
 */
function inferModelType(
  model: string
): 'image' | 'video' | 'audio' | 'unknown' {
  const lower = model.toLowerCase();
  // Only check for explicit type keywords, not model-specific names
  if (
    lower.includes('video') ||
    lower.includes('text-to-video') ||
    lower.includes('image-to-video')
  ) {
    return 'video';
  }
  if (
    lower.includes('audio') ||
    lower.includes('speech') ||
    lower.includes('tts') ||
    lower.includes('text-to-speech')
  ) {
    return 'audio';
  }
  // Default to image for most generation models
  return 'image';
}
