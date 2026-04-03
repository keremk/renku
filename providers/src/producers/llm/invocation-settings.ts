import type { OpenAiLlmConfig } from '../../sdk/openai/config.js';
import type { ProviderJobContext } from '../../types.js';

interface RuntimeLlmInvocationSettings {
  requestTimeoutMs?: number;
  maxRetries?: number;
}

export function applyRuntimeLlmInvocationSettings(
  config: OpenAiLlmConfig,
  request: ProviderJobContext
): OpenAiLlmConfig {
  const runtimeSettings = extractRuntimeLlmInvocationSettings(request);
  return {
    ...config,
    requestTimeoutMs: runtimeSettings?.requestTimeoutMs,
    maxRetries: runtimeSettings?.maxRetries,
  };
}

function extractRuntimeLlmInvocationSettings(
  request: ProviderJobContext
): RuntimeLlmInvocationSettings | undefined {
  const extras = request.context.extras;
  if (!isRecord(extras)) {
    return undefined;
  }

  const raw = extras.runtimeLlmInvocationSettings;
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    throw new Error(
      'runtimeLlmInvocationSettings must be an object when provided in job context extras.'
    );
  }

  const requestTimeoutMs = readOptionalInteger(
    raw.requestTimeoutMs,
    'runtimeLlmInvocationSettings.requestTimeoutMs',
    1
  );
  const maxRetries = readOptionalInteger(
    raw.maxRetries,
    'runtimeLlmInvocationSettings.maxRetries',
    0
  );

  const normalized: RuntimeLlmInvocationSettings = {};
  if (requestTimeoutMs !== undefined) {
    normalized.requestTimeoutMs = requestTimeoutMs;
  }
  if (maxRetries !== undefined) {
    normalized.maxRetries = maxRetries;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function readOptionalInteger(
  value: unknown,
  label: string,
  minValue: number
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer when provided.`);
  }
  if ((value as number) < minValue) {
    throw new Error(`${label} must be greater than or equal to ${minValue}.`);
  }
  return value as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
