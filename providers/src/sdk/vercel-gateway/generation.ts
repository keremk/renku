import {
  generateText,
  jsonSchema,
  Output,
  type CallSettings,
  type JSONSchema7,
  type JSONValue,
  type LanguageModel,
} from 'ai';
import type { OpenAiResponseFormat, OpenAiLlmConfig } from '../openai/config.js';
import { normalizeJsonSchema, separateConfigOptions } from '../openai/config.js';
import type { RenderedPrompts } from '../openai/prompts.js';
import type { ProviderJobContext, ProviderMode } from '../../types.js';
import { simulateOpenAiGeneration } from '../openai/simulation.js';

type JsonObject = Record<string, unknown>;

/**
 * Model type from OpenAI-compatible provider.
 * Using LanguageModel for compatibility with AI SDK generateText/generateObject.
 */
type CompatibleModel = LanguageModel;

export interface VercelGatewayGenerationOptions {
  /** AI SDK model instance from the client manager */
  model: CompatibleModel;
  prompts: RenderedPrompts;
  responseFormat: OpenAiResponseFormat;
  config: OpenAiLlmConfig;
  /** Provider mode - 'simulated' for dry-run, 'live' for actual API calls */
  mode?: ProviderMode;
  /** Full request context for simulation (required when mode is 'simulated') */
  request?: ProviderJobContext;
}

export interface VercelGatewayGenerationResult {
  data: JsonObject | string;
  usage?: Record<string, unknown>;
  warnings?: unknown[];
  response?: Record<string, unknown>;
}

/**
 * Extracts the provider prefix from a model name.
 * @example extractProviderPrefix('anthropic/claude-sonnet-4') -> 'anthropic'
 */
function extractProviderPrefix(modelName: string): string | undefined {
  const slashIndex = modelName.indexOf('/');
  if (slashIndex === -1) {
    return undefined;
  }
  return modelName.substring(0, slashIndex);
}

type JSONObject = Record<string, JSONValue>;

/**
 * Builds provider options for the AI SDK.
 * Combines provider-specific settings with gateway routing configuration.
 *
 * @param providerPrefix - The provider name (e.g., 'anthropic', 'openai')
 * @param providerSpecific - Provider-specific options from config
 * @returns Provider options object or undefined if empty
 */
function buildProviderOptions(
  providerPrefix: string | undefined,
  providerSpecific: Record<string, unknown>
): Record<string, JSONObject> | undefined {
  const hasProviderSpecific = Object.keys(providerSpecific).length > 0;

  if (!providerPrefix && !hasProviderSpecific) {
    return undefined;
  }

  const options: Record<string, JSONObject> = {};

  // Add provider-specific options under the provider key
  if (providerPrefix && hasProviderSpecific) {
    options[providerPrefix] = providerSpecific as JSONObject;
  }

  // Add gateway routing to restrict to the specified provider
  if (providerPrefix) {
    options.gateway = { only: [providerPrefix] } as JSONObject;
  }

  return Object.keys(options).length > 0 ? options : undefined;
}

/**
 * Calls a provider via the Vercel AI SDK with either structured (JSON) or text output.
 *
 * In simulated mode, all validation and setup runs identically to live mode.
 * The only difference is at the very end: instead of calling the AI SDK,
 * it returns mock data based on the schema.
 */
export async function callVercelGateway(
  options: VercelGatewayGenerationOptions
): Promise<VercelGatewayGenerationResult> {
  const { model, prompts, responseFormat, config, mode, request } = options;

  // Build prompt string (required by AI SDK)
  const prompt = prompts.user?.trim() || prompts.system?.trim() || ' ';

  // Separate common call settings from provider-specific options
  const { callSettings: separatedSettings, providerSpecific } = separateConfigOptions(config);

  // Build call settings (AI SDK CallSettings)
  const callSettings: CallSettings = {
    temperature: separatedSettings.temperature as number | undefined,
    maxOutputTokens: separatedSettings.maxOutputTokens as number | undefined,
    topP: separatedSettings.topP as number | undefined,
    topK: separatedSettings.topK as number | undefined,
    presencePenalty: separatedSettings.presencePenalty as number | undefined,
    frequencyPenalty: separatedSettings.frequencyPenalty as number | undefined,
    stopSequences: separatedSettings.stopSequences as string[] | undefined,
    seed: separatedSettings.seed as number | undefined,
  };

  // Extract provider from model name to restrict gateway routing
  // e.g., 'anthropic/claude-sonnet-4' -> only use 'anthropic' provider
  const providerPrefix = request?.model ? extractProviderPrefix(request.model) : undefined;

  // Call provider based on response format
  if (responseFormat.type === 'json_schema') {
    return await generateStructuredOutput({
      model,
      prompt,
      system: prompts.system,
      responseFormat,
      callSettings,
      mode,
      request,
      config,
      providerPrefix,
      providerSpecific,
    });
  } else {
    return await generatePlainText({
      model,
      prompt,
      system: prompts.system,
      callSettings,
      mode,
      request,
      providerPrefix,
      providerSpecific,
    });
  }
}

interface StructuredOutputOptions {
  model: CompatibleModel;
  prompt: string;
  system?: string;
  responseFormat: OpenAiResponseFormat;
  callSettings: CallSettings;
  mode?: ProviderMode;
  request?: ProviderJobContext;
  config: OpenAiLlmConfig;
  providerPrefix?: string;
  providerSpecific: Record<string, unknown>;
}

async function generateStructuredOutput(
  options: StructuredOutputOptions
): Promise<VercelGatewayGenerationResult> {
  const { model, prompt, system, responseFormat, callSettings, mode, request, providerPrefix, providerSpecific } =
    options;

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
    return simulateOpenAiGeneration({ request, config: { responseFormat } as OpenAiLlmConfig });
  }

  // Build provider options: provider-specific settings + gateway routing
  const providerOptions = buildProviderOptions(providerPrefix, providerSpecific);

  const generation = await generateText({
    ...callSettings,
    model,
    prompt,
    system,
    output: Output.object({
      schema,
      name: responseFormat.name,
      description: responseFormat.description,
    }),
    ...(providerOptions && { providerOptions }),
  });

  return {
    data: generation.output as JsonObject,
    usage: generation.usage as Record<string, unknown> | undefined,
    warnings: generation.warnings,
    response: generation.response as Record<string, unknown> | undefined,
  };
}

interface PlainTextOptions {
  model: CompatibleModel;
  prompt: string;
  system?: string;
  callSettings: CallSettings;
  mode?: ProviderMode;
  request?: ProviderJobContext;
  providerPrefix?: string;
  providerSpecific: Record<string, unknown>;
}

async function generatePlainText(options: PlainTextOptions): Promise<VercelGatewayGenerationResult> {
  const { model, prompt, system, callSettings, mode, request, providerPrefix, providerSpecific } = options;

  // In simulated mode, return mock data instead of calling the AI SDK
  // All validation and setup has already run identically to live mode
  if (mode === 'simulated' && request) {
    return simulateOpenAiGeneration({
      request,
      config: { responseFormat: { type: 'text' } } as OpenAiLlmConfig,
    });
  }

  // Build provider options: provider-specific settings + gateway routing
  const providerOptions = buildProviderOptions(providerPrefix, providerSpecific);

  const generation = await generateText({
    ...callSettings,
    model,
    prompt,
    system,
    ...(providerOptions && { providerOptions }),
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
