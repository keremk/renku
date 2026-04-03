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
import type { ProviderJobContext, ProviderMode, ConditionHints } from '../../types.js';
import { simulateOpenAiGeneration, type SimulationSizeHints } from '../openai/simulation.js';
import { validatePayload } from '../schema-validator.js';

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
  /** Condition hints for dry-run simulation (for alternating/cycling values) */
  conditionHints?: ConditionHints;
}

export interface VercelGatewayGenerationResult {
  data: JsonObject | string;
  usage?: Record<string, unknown>;
  warnings?: unknown[];
  response?: Record<string, unknown>;
  providerMetadata?: Record<string, unknown>;
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

  if (!providerPrefix && hasProviderSpecific) {
    throw new Error(
      'Provider-specific options require a model identifier with a provider prefix (for example "anthropic/claude-sonnet-4.6").'
    );
  }

  if (!providerPrefix && !hasProviderSpecific) {
    return undefined;
  }

  const options: Record<string, JSONObject> = {};

  // Add provider-specific options under the provider key
  if (providerPrefix && hasProviderSpecific) {
    options[providerPrefix] = providerSpecific as JSONObject;
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
  const { model, prompts, responseFormat, config, mode, request, conditionHints } = options;

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
    maxRetries: separatedSettings.maxRetries as number | undefined,
  };

  // Extract provider from model name for provider-scoped options.
  // e.g., 'anthropic/claude-sonnet-4' -> provider key 'anthropic'
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
      requestSignal: request?.signal,
      requestTimeoutMs: config.requestTimeoutMs,
      conditionHints,
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
      requestSignal: request?.signal,
      requestTimeoutMs: config.requestTimeoutMs,
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
  requestSignal?: AbortSignal;
  requestTimeoutMs?: number;
  conditionHints?: ConditionHints;
}

async function generateStructuredOutput(
  options: StructuredOutputOptions
): Promise<VercelGatewayGenerationResult> {
  const {
    model,
    prompt,
    system,
    responseFormat,
    callSettings,
    mode,
    request,
    providerPrefix,
    providerSpecific,
    requestSignal,
    requestTimeoutMs,
    conditionHints,
  } =
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
    const sizeHints: SimulationSizeHints | undefined = conditionHints
      ? { conditionHints }
      : undefined;
    return simulateOpenAiGeneration({
      request,
      config: { responseFormat } as OpenAiLlmConfig,
      sizeHints,
    });
  }

  // Build provider options from provider-specific settings
  const providerOptions = buildProviderOptions(providerPrefix, providerSpecific);

  const { abortSignal, cleanup } = createAbortSignal(
    requestSignal,
    requestTimeoutMs
  );
  try {
    const generation = await generateText({
      ...callSettings,
      model,
      prompt,
      system,
      abortSignal,
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
      providerMetadata: generation.providerMetadata as Record<string, unknown> | undefined,
    };
  } catch (error) {
    const timeoutError = mapTimeoutError(error, abortSignal, requestTimeoutMs);
    if (timeoutError !== error) {
      throw timeoutError;
    }

    if (!shouldFallbackStructuredOutputToJsonText(error)) {
      throw error;
    }

    return await generateStructuredViaJsonTextFallback({
      model,
      prompt,
      system,
      callSettings,
      providerOptions,
      abortSignal,
      normalizedSchema,
      reason: 'Structured output fallback used (JSON text + local schema validation).',
    });
  } finally {
    cleanup();
  }
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
  requestSignal?: AbortSignal;
  requestTimeoutMs?: number;
}

async function generatePlainText(options: PlainTextOptions): Promise<VercelGatewayGenerationResult> {
  const {
    model,
    prompt,
    system,
    callSettings,
    mode,
    request,
    providerPrefix,
    providerSpecific,
    requestSignal,
    requestTimeoutMs,
  } = options;

  // In simulated mode, return mock data instead of calling the AI SDK
  // All validation and setup has already run identically to live mode
  if (mode === 'simulated' && request) {
    return simulateOpenAiGeneration({
      request,
      config: { responseFormat: { type: 'text' } } as OpenAiLlmConfig,
    });
  }

  // Build provider options from provider-specific settings
  const providerOptions = buildProviderOptions(providerPrefix, providerSpecific);

  const { abortSignal, cleanup } = createAbortSignal(
    requestSignal,
    requestTimeoutMs
  );
  try {
    const generation = await generateText({
      ...callSettings,
      model,
      prompt,
      system,
      abortSignal,
      ...(providerOptions && { providerOptions }),
    });

    return {
      data: generation.text,
      usage: generation.usage as Record<string, unknown> | undefined,
      warnings: generation.warnings,
      response: generation.response as Record<string, unknown> | undefined,
      providerMetadata: generation.providerMetadata as Record<string, unknown> | undefined,
    };
  } catch (error) {
    throw mapTimeoutError(error, abortSignal, requestTimeoutMs);
  } finally {
    cleanup();
  }
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

export function sanitizeProviderMetadata(metadata: unknown): Record<string, unknown> | undefined {
  if (!isJsonObject(metadata)) {
    return undefined;
  }

  const gateway = metadata.gateway;
  if (!isJsonObject(gateway)) {
    return undefined;
  }

  return { gateway };
}

function shouldFallbackStructuredOutputToJsonText(error: unknown): boolean {
  if (!isJsonObject(error)) {
    return false;
  }

  const message = typeof error.message === 'string' ? error.message : '';
  const name = typeof error.name === 'string' ? error.name : '';

  if (name === 'GatewayResponseError' && message.includes('Invalid error response format')) {
    return true;
  }

  const lower = message.toLowerCase();
  return (
    lower.includes('json_schema') ||
    lower.includes('response_format') ||
    lower.includes('structured output') ||
    lower.includes('unsupported') && lower.includes('format')
  );
}

interface JsonTextStructuredFallbackOptions {
  model: CompatibleModel;
  prompt: string;
  system?: string;
  callSettings: CallSettings;
  providerOptions: Record<string, JSONObject> | undefined;
  abortSignal: AbortSignal | undefined;
  normalizedSchema: JSONSchema7;
  reason: string;
}

async function generateStructuredViaJsonTextFallback(
  options: JsonTextStructuredFallbackOptions,
): Promise<VercelGatewayGenerationResult> {
  const {
    model,
    prompt,
    system,
    callSettings,
    providerOptions,
    abortSignal,
    normalizedSchema,
    reason,
  } = options;

  const fallbackPrompt = buildSchemaFallbackPrompt(prompt, normalizedSchema);
  const fallbackGeneration = await generateText({
    ...callSettings,
    model,
    prompt: fallbackPrompt,
    system,
    abortSignal,
    ...(providerOptions && { providerOptions }),
  });
  const parsedFallback = parseStructuredJsonText(fallbackGeneration.text);
  validatePayload(
    JSON.stringify(normalizedSchema),
    parsedFallback,
    'Vercel Gateway structured output',
  );

  if (!isJsonObject(parsedFallback)) {
    throw new Error(
      'Structured output fallback produced non-object JSON payload. Expected a JSON object.',
    );
  }

  return {
    data: parsedFallback,
    usage: fallbackGeneration.usage as Record<string, unknown> | undefined,
    warnings: [
      ...(fallbackGeneration.warnings ?? []),
      reason,
    ],
    response: fallbackGeneration.response as Record<string, unknown> | undefined,
    providerMetadata: fallbackGeneration.providerMetadata as Record<string, unknown> | undefined,
  };
}

function buildSchemaFallbackPrompt(
  prompt: string,
  schema: JSONSchema7,
): string {
  return `${prompt}

Return only JSON that matches this JSON Schema exactly.
Do not include markdown, code fences, commentary, or prose.
JSON Schema:
${JSON.stringify(schema)}`;
}

function parseStructuredJsonText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(
      'Structured output fallback returned empty text; expected JSON payload.',
    );
  }

  const direct = tryParseJson(trimmed);
  if (direct.parsed) {
    return direct.value;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    const fencedParse = tryParseJson(fenced[1].trim());
    if (fencedParse.parsed) {
      return fencedParse.value;
    }
  }

  const start = trimmed.search(/[{[]/);
  const lastObject = trimmed.lastIndexOf('}');
  const lastArray = trimmed.lastIndexOf(']');
  const end = Math.max(lastObject, lastArray);
  if (start >= 0 && end > start) {
    const slice = trimmed.slice(start, end + 1);
    const slicedParse = tryParseJson(slice);
    if (slicedParse.parsed) {
      return slicedParse.value;
    }
  }

  throw new Error(
    'Structured output fallback did not produce parseable JSON text.',
  );
}

function tryParseJson(input: string): { parsed: true; value: unknown } | { parsed: false } {
  try {
    return { parsed: true, value: JSON.parse(input) };
  } catch {
    return { parsed: false };
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createAbortSignal(
  sourceSignal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): { abortSignal?: AbortSignal; cleanup: () => void } {
  if (timeoutMs === undefined) {
    return {
      abortSignal: sourceSignal,
      cleanup: () => undefined,
    };
  }

  const controller = new AbortController();
  const onSourceAbort = () => {
    controller.abort(sourceSignal?.reason);
  };

  if (sourceSignal?.aborted) {
    controller.abort(sourceSignal.reason);
  } else if (sourceSignal) {
    sourceSignal.addEventListener('abort', onSourceAbort, { once: true });
  }

  const timeoutHandle = setTimeout(() => {
    controller.abort(new Error(`Provider request timed out after ${timeoutMs}ms.`));
  }, timeoutMs);

  return {
    abortSignal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutHandle);
      if (sourceSignal && !sourceSignal.aborted) {
        sourceSignal.removeEventListener('abort', onSourceAbort);
      }
    },
  };
}

function mapTimeoutError(
  error: unknown,
  abortSignal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): unknown {
  if (timeoutMs === undefined || !abortSignal?.aborted) {
    return error;
  }

  const reason = abortSignal.reason;
  if (reason instanceof Error && isTimeoutMessage(reason.message)) {
    return new Error(reason.message);
  }

  return error;
}

function isTimeoutMessage(message: string): boolean {
  return /^Provider request timed out after \d+ms\.$/.test(message);
}
