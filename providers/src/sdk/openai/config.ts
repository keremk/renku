import type { JSONSchema7 } from 'ai';

type JsonObject = Record<string, unknown>;

/**
 * Common AI SDK CallSettings that work across all providers.
 * These are validated and passed directly to generateText/streamText.
 */
export const COMMON_CALL_SETTINGS = new Set([
  'maxOutputTokens',
  'temperature',
  'topP',
  'topK',
  'presencePenalty',
  'frequencyPenalty',
  'stopSequences',
  'seed',
]);

/**
 * Producer config keys that are specific to our LLM producer.
 * These are NOT passed to providerOptions.
 */
export const PRODUCER_CONFIG_KEYS = new Set([
  'systemPrompt',
  'userPrompt',
  'variables',
  'responseFormat',
  'textFormat',
  'jsonSchema',
  'system_prompt',
  'prompt_settings',
  // Legacy keys
  'reasoning', // Legacy OpenAI-specific, handled separately
]);

export interface OpenAiResponseFormat {
  type: 'json_schema' | 'text';
  schema?: JsonObject;
  name?: string;
  description?: string;
}

export interface OpenAiLlmConfig {
  // Producer config (our stuff)
  systemPrompt: string;
  userPrompt?: string;
  variables?: string[];
  responseFormat: OpenAiResponseFormat;

  // Common AI SDK settings
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stopSequences?: string[];
  seed?: number;

  // Legacy OpenAI-specific (backward compat)
  reasoning?: 'minimal' | 'low' | 'medium' | 'high';

  // Provider-specific options (any remaining keys, passed through)
  [key: string]: unknown;
}

/**
 * Separates config into common call settings and provider-specific options.
 * @param config The parsed LLM config
 * @returns Separated call settings and provider-specific options
 */
export function separateConfigOptions(config: OpenAiLlmConfig): {
  callSettings: Record<string, unknown>;
  providerSpecific: Record<string, unknown>;
} {
  const callSettings: Record<string, unknown> = {};
  const providerSpecific: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) {
      continue;
    }

    if (COMMON_CALL_SETTINGS.has(key)) {
      callSettings[key] = value;
    } else if (!PRODUCER_CONFIG_KEYS.has(key)) {
      // Not common, not producer config → provider-specific
      providerSpecific[key] = value;
    }
  }

  return { callSettings, providerSpecific };
}

export function parseOpenAiConfig(raw: unknown): OpenAiLlmConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error('OpenAI provider configuration must be an object.');
  }

  const normalized = normalizeOpenAiConfig(raw as Record<string, unknown>);
  const systemPrompt = readString(normalized.systemPrompt, 'systemPrompt');
  const userPrompt = readOptionalString(normalized.userPrompt);
  const variables = readOptionalStringArray(normalized.variables);
  const responseFormat = parseResponseFormat(normalized.responseFormat);

  // Build base config with producer settings and common call settings
  const config: OpenAiLlmConfig = {
    systemPrompt,
    userPrompt,
    variables,
    responseFormat,
    // Common AI SDK settings
    temperature: readOptionalNumber(normalized.temperature),
    maxOutputTokens: readOptionalNumber(normalized.maxOutputTokens),
    topP: readOptionalNumber(normalized.topP),
    topK: readOptionalNumber(normalized.topK),
    presencePenalty: readOptionalNumber(normalized.presencePenalty),
    frequencyPenalty: readOptionalNumber(normalized.frequencyPenalty),
    stopSequences: readOptionalStringArray(normalized.stopSequences),
    seed: readOptionalInteger(normalized.seed),
    // Legacy OpenAI-specific
    reasoning: readOptionalReasoning(normalized.reasoning),
  };

  // Pass through any remaining keys as provider-specific options
  for (const [key, value] of Object.entries(normalized)) {
    if (
      value !== undefined &&
      !COMMON_CALL_SETTINGS.has(key) &&
      !PRODUCER_CONFIG_KEYS.has(key) &&
      !(key in config)
    ) {
      config[key] = value;
    }
  }

  return config;
}

function parseResponseFormat(raw: unknown): OpenAiResponseFormat {
  if (!raw || typeof raw !== 'object') {
    return { type: 'text' };
  }

  const format = raw as Record<string, unknown>;
  const type = readString(format.type, 'responseFormat.type') as 'json_schema' | 'text';

  if (type === 'json_schema') {
    const schema = format.schema;
    if (!schema || typeof schema !== 'object') {
      throw new Error('responseFormat.schema must be provided when type is "json_schema".');
    }

    return {
      type,
      schema: schema as JsonObject,
      name: readOptionalString(format.name),
      description: readOptionalString(format.description),
    };
  }

  return { type: 'text' };
}

/**
 * Normalizes TOML/JSON config from various formats to a consistent structure.
 * Supports both [system_prompt] and [prompt_settings] sections for backward compatibility.
 */
function normalizeOpenAiConfig(source: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...source };

  // Handle legacy [system_prompt] or [prompt_settings] section
  const section = normalized.system_prompt ?? normalized.prompt_settings;
  if (isRecord(section)) {
    if (typeof section.systemPrompt === 'string') {
      normalized.systemPrompt = section.systemPrompt;
    }
    if (typeof section.userPrompt === 'string' && normalized.userPrompt === undefined) {
      normalized.userPrompt = section.userPrompt;
    }
    if (normalized.responseFormat === undefined) {
      const { responseFormat, reasoning } = normalizeResponseFormatFromSection(section);
      normalized.responseFormat = responseFormat;
      if (reasoning && normalized.reasoning === undefined) {
        normalized.reasoning = reasoning;
      }
    }
    if (normalized.variables === undefined && section.variables !== undefined) {
      normalized.variables = section.variables;
    }
    delete normalized.system_prompt;
    delete normalized.prompt_settings;
  }

  if (normalized.responseFormat === undefined) {
    normalized.responseFormat = { type: 'text' };
  }

  const hasTextFormat = typeof (normalized as Record<string, unknown>).textFormat === 'string';
  if (hasTextFormat) {
    const currentFormat = normalized.responseFormat as { type?: string } | undefined;
    const isDefaultTextFormat = !currentFormat || currentFormat.type === 'text';
    if (isDefaultTextFormat) {
      const pseudoSection: Record<string, unknown> = {
        textFormat: (normalized as Record<string, unknown>).textFormat,
      };
      if ((normalized as Record<string, unknown>).jsonSchema !== undefined) {
        pseudoSection.jsonSchema = (normalized as Record<string, unknown>).jsonSchema;
      }
      const { responseFormat, reasoning } = normalizeResponseFormatFromSection(pseudoSection);
      normalized.responseFormat = responseFormat;
      if (reasoning && normalized.reasoning === undefined) {
        normalized.reasoning = reasoning;
      }
    }
  }

  return normalized;
}

function normalizeResponseFormatFromSection(
  section: Record<string, unknown>,
): { responseFormat: Record<string, unknown>; reasoning?: string } {
  const rawFormat = typeof section.textFormat === 'string' ? section.textFormat.toLowerCase() : 'text';

  if (rawFormat === 'json_schema') {
    const schemaText = typeof section.jsonSchema === 'string' ? section.jsonSchema.trim() : '';
    if (!schemaText) {
      throw new Error('jsonSchema must be a non-empty string when textFormat is "json_schema".');
    }

    const schemaDefinition = parseJsonSchemaDefinition(schemaText);
    const responseFormat: Record<string, unknown> = {
      type: 'json_schema',
      schema: schemaDefinition.schema,
    };

    if (schemaDefinition.name) {
      responseFormat.name = schemaDefinition.name;
    }
    if (schemaDefinition.description) {
      responseFormat.description = schemaDefinition.description;
    }

    return {
      responseFormat,
      reasoning: schemaDefinition.reasoning,
    };
  }

  return { responseFormat: { type: 'text' } };
}

function parseJsonSchemaDefinition(schemaText: string): {
  schema: JsonObject;
  name?: string;
  description?: string;
  reasoning?: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(schemaText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse jsonSchema: ${message}`);
  }

  if (!isRecord(parsed)) {
    throw new Error('jsonSchema must parse to an object.');
  }

  // Extract schema - supports both { schema: {...} } and direct schema
  const schema =
    isRecord(parsed.schema) && Object.keys(parsed.schema).length > 0
      ? (parsed.schema as JsonObject)
      : (parsed as JsonObject);

  return {
    schema,
    name: typeof parsed.name === 'string' ? parsed.name : undefined,
    description: typeof parsed.description === 'string' ? parsed.description : undefined,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined,
  };
}

/**
 * Normalizes JSON schema to ensure compatibility with AI SDK.
 * Sets additionalProperties: false for object schemas if not specified.
 */
export function normalizeJsonSchema(
  schema: JSONSchema7,
  meta?: { title?: string; description?: string },
): JSONSchema7 {
  // Unwrap schemas that are nested under a "schema" key (e.g., { schema: { type: 'object', ... } })
  const baseSchema = (() => {
    const clone = deepClone(schema);
    if (
      clone &&
      typeof clone === 'object' &&
      !Array.isArray(clone) &&
      !clone.type &&
      'schema' in clone &&
      clone.schema &&
      typeof clone.schema === 'object'
    ) {
      return clone.schema as JSONSchema7;
    }
    return clone;
  })();

  const clone = deepClone(baseSchema);

  function visit(node: JSONSchema7, isRoot: boolean): JSONSchema7 {
    const next: JSONSchema7 = { ...node };

    if (isRoot) {
      if (meta?.title && !next.title) {
        next.title = meta.title;
      }
      if (meta?.description && !next.description) {
        next.description = meta.description;
      }
    }

    const isObjectSchema =
      includesType(next.type, 'object') || (!!next.properties && next.type === undefined);
    if (isObjectSchema) {
      if (next.additionalProperties === undefined) {
        next.additionalProperties = false;
      }
      if (next.properties) {
        next.properties = Object.fromEntries(
          Object.entries(next.properties).map(([key, value]) => [
            key,
            typeof value === 'boolean' ? value : visit(value, false),
          ]),
        );
      }
    }

    const isArraySchema =
      includesType(next.type, 'array') || Array.isArray(next.items) || !!next.items;
    if (isArraySchema && next.items) {
      if (Array.isArray(next.items)) {
        next.items = next.items.map((item) => (typeof item === 'boolean' ? item : visit(item, false)));
      } else if (typeof next.items !== 'boolean') {
        next.items = visit(next.items, false);
      }
    }

    if (next.oneOf) {
      next.oneOf = next.oneOf.map((entry) =>
        typeof entry === 'boolean' ? entry : visit(entry, false),
      );
    }
    if (next.anyOf) {
      next.anyOf = next.anyOf.map((entry) =>
        typeof entry === 'boolean' ? entry : visit(entry, false),
      );
    }
    if (next.allOf) {
      next.allOf = next.allOf.map((entry) =>
        typeof entry === 'boolean' ? entry : visit(entry, false),
      );
    }
    if (next.not && typeof next.not !== 'boolean') {
      next.not = visit(next.not, false);
    }

    if (next.definitions) {
      next.definitions = Object.fromEntries(
        Object.entries(next.definitions).map(([key, value]) => [
          key,
          typeof value === 'boolean' ? value : visit(value, false),
        ]),
      );
    }

    if (next.$defs) {
      next.$defs = Object.fromEntries(
        Object.entries(next.$defs).map(([key, value]) => [
          key,
          typeof value === 'boolean' ? value : visit(value, false),
        ]),
      );
    }

    return next;
  }

  return visit(clone, true);
}

function includesType(type: JSONSchema7['type'], expected: string): boolean {
  if (!type) {
    return false;
  }
  if (Array.isArray(type)) {
    return type.some((t) => t === expected);
  }
  return type === expected;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// Helper functions

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function readOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const num = Number(value);
  if (Number.isNaN(num)) {
    throw new Error(`Expected numeric value, received ${value}`);
  }
  return num;
}

function readOptionalInteger(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const num = Number(value);
  if (Number.isNaN(num) || !Number.isInteger(num)) {
    throw new Error(`Expected integer value, received ${value}`);
  }
  return num;
}

function readOptionalStringArray(value: unknown): string[] | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  return undefined;
}

function readOptionalReasoning(value: unknown): OpenAiLlmConfig['reasoning'] {
  if (value === null || value === undefined) {
    return undefined;
  }
  const reasoning = String(value);
  const valid = ['minimal', 'low', 'medium', 'high'] as const;
  if (valid.includes(reasoning as (typeof valid)[number])) {
    return reasoning as OpenAiLlmConfig['reasoning'];
  }
  throw new Error(`Unsupported reasoning level "${reasoning}".`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
