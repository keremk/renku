import {
  generateText,
  jsonSchema,
  Output,
  type CallSettings,
  type JSONSchema7,
  type JSONValue,
} from 'ai';
import type { OpenAiResponseFormat, OpenAiLlmConfig } from './config.js';
import { normalizeJsonSchema } from './config.js';
import type { RenderedPrompts } from './prompts.js';
import type { ProviderJobContext, ProviderMode, ConditionHints } from '../../types.js';
import { simulateOpenAiGeneration, type SimulationSizeHints } from './simulation.js';

type JsonObject = Record<string, unknown>;

export interface GenerationOptions {
  /** AI SDK model (required for both live and simulated modes) */
  model: ReturnType<ReturnType<typeof import('@ai-sdk/openai').createOpenAI>>;
  prompts: RenderedPrompts;
  responseFormat: OpenAiResponseFormat;
  config: OpenAiLlmConfig;
  /** Provider mode - 'simulated' for dry-run, 'live' for actual API calls */
  mode?: ProviderMode;
  /** Full request context for simulation (required when mode is 'simulated') */
  request?: ProviderJobContext;
  /** Condition hints for dry-run simulation (controls value alternation) */
  conditionHints?: ConditionHints;
}

export interface GenerationResult {
  data: JsonObject | string;
  usage?: Record<string, unknown>;
  warnings?: unknown[];
  response?: Record<string, unknown>;
}

/**
 * Calls OpenAI via AI SDK with either structured (JSON) or text output.
 *
 * In simulated mode, all validation and setup runs identically to live mode.
 * The only difference is at the very end: instead of calling the AI SDK,
 * it returns mock data based on the schema.
 */
export async function callOpenAi(options: GenerationOptions): Promise<GenerationResult> {
  const { model, prompts, responseFormat, config, mode, request, conditionHints } = options;

  // Build prompt string (required by AI SDK)
  const prompt = prompts.user?.trim() || prompts.system?.trim() || ' ';

  // Build call settings
  const callSettings: CallSettings = {
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
    presencePenalty: config.presencePenalty,
    frequencyPenalty: config.frequencyPenalty,
  };

  // Build provider-specific options
  const openAiOptions: Record<string, JSONValue> = {};
  if (responseFormat.type === 'json_schema') {
    openAiOptions.strictJsonSchema = true;
  }
  if (config.reasoning) {
    openAiOptions.reasoningEffort = config.reasoning;
  }

  const providerOptions =
    Object.keys(openAiOptions).length > 0 ? { openai: openAiOptions } : undefined;

  const baseCallOptions = {
    ...callSettings,
    ...(providerOptions ? { providerOptions } : {}),
  } as CallSettings & { providerOptions?: Record<string, Record<string, JSONValue>> };

  // Call OpenAI based on response format
  if (responseFormat.type === 'json_schema') {
    return await generateStructuredOutput({
      model,
      prompt,
      system: prompts.system,
      responseFormat,
      baseCallOptions,
      mode,
      request,
      conditionHints,
    });
  } else {
    return await generatePlainText({
      model,
      prompt,
      system: prompts.system,
      baseCallOptions,
      mode,
      request,
    });
  }
}

interface StructuredOutputOptions {
  model: ReturnType<ReturnType<typeof import('@ai-sdk/openai').createOpenAI>>;
  prompt: string;
  system?: string;
  responseFormat: OpenAiResponseFormat;
  baseCallOptions: CallSettings & { providerOptions?: Record<string, Record<string, JSONValue>> };
  mode?: ProviderMode;
  request?: ProviderJobContext;
  conditionHints?: ConditionHints;
}

async function generateStructuredOutput(options: StructuredOutputOptions): Promise<GenerationResult> {
  const { model, prompt, system, responseFormat, baseCallOptions, mode, request, conditionHints } = options;

  if (!responseFormat.schema) {
    throw new Error('Schema is required for json_schema response format.');
  }

  const normalizedSchema = normalizeJsonSchema(responseFormat.schema as JSONSchema7, {
    title: responseFormat.name,
    description: responseFormat.description,
  });

  const schema = jsonSchema(normalizedSchema);

  // In simulated mode, return mock data instead of calling the AI SDK
  // All validation and setup has already run identically to live mode
  if (mode === 'simulated' && request) {
    const sizeHints: SimulationSizeHints | undefined = conditionHints
      ? { conditionHints }
      : undefined;
    return simulateOpenAiGeneration({
      request,
      config: { responseFormat } as OpenAiLlmConfig,
      sizeHints,
    });
  }

  // Use generateText with Output.object() instead of deprecated generateObject
  const generation = await generateText({
    ...baseCallOptions,
    model,
    prompt,
    system,
    output: Output.object({
      schema,
      name: responseFormat.name,
      description: responseFormat.description,
    }),
  });

  return {
    data: generation.output as JsonObject,
    usage: generation.usage as Record<string, unknown> | undefined,
    warnings: generation.warnings,
    response: generation.response as Record<string, unknown> | undefined,
  };
}

interface PlainTextOptions {
  model: ReturnType<ReturnType<typeof import('@ai-sdk/openai').createOpenAI>>;
  prompt: string;
  system?: string;
  baseCallOptions: CallSettings & { providerOptions?: Record<string, Record<string, JSONValue>> };
  mode?: ProviderMode;
  request?: ProviderJobContext;
}

async function generatePlainText(options: PlainTextOptions): Promise<GenerationResult> {
  const { model, prompt, system, baseCallOptions, mode, request } = options;

  // In simulated mode, return mock data instead of calling the AI SDK
  // All validation and setup has already run identically to live mode
  if (mode === 'simulated' && request) {
    return simulateOpenAiGeneration({ request, config: { responseFormat: { type: 'text' } } as OpenAiLlmConfig });
  }

  const generation = await generateText({
    ...baseCallOptions,
    model,
    prompt,
    system,
  });

  return {
    data: generation.text,
    usage: generation.usage as Record<string, unknown> | undefined,
    warnings: generation.warnings,
    response: generation.response as Record<string, unknown> | undefined,
  };
}

/**
 * Sanitizes response metadata for diagnostics.
 */
export function sanitizeResponseMetadata(metadata: unknown): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }
  const response = metadata as Record<string, unknown>;
  return {
    id: response.id,
    model: response.model,
    createdAt: response.createdAt ?? response.created_at,
  };
}
