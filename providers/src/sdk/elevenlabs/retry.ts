import type { ProviderLogger } from '../../types.js';
import { createProviderError, SdkErrorCode, type ProviderError, type ProviderErrorKind } from '../errors.js';

/**
 * ElevenLabs API error codes from the API documentation.
 * https://elevenlabs.io/docs/api-reference/error-messages
 */
export type ElevenlabsErrorCode =
  // 400/401 errors
  | 'max_character_limit_exceeded'
  | 'invalid_api_key'
  | 'quota_exceeded'
  | 'voice_not_found'
  // 403 errors
  | 'only_for_creator+'
  // 429 errors
  | 'too_many_concurrent_requests'
  | 'system_busy'
  // Generic
  | 'unknown';

/**
 * Parsed error information from an ElevenLabs API error.
 */
export interface ParsedElevenlabsError {
  status: number | undefined;
  code: ElevenlabsErrorCode;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
}

/**
 * Parse an error from ElevenLabs API into structured form.
 */
export function parseElevenlabsError(error: unknown): ParsedElevenlabsError {
  const status = parseStatus(error);
  const code = parseErrorCode(error);
  const message = parseErrorMessage(error);
  const retryAfterMs = parseRetryAfterMs(error);

  // Determine if error is retryable
  const retryable = isRetryableError(status, code);

  return {
    status,
    code,
    message,
    retryable,
    retryAfterMs,
  };
}

/**
 * Parse HTTP status from error.
 */
function parseStatus(error: unknown): number | undefined {
  const candidate =
    (error as any)?.status ??
    (error as any)?.statusCode ??
    (error as any)?.response?.status ??
    (error as any)?.response?.statusCode;

  if (typeof candidate === 'number') {
    return candidate;
  }

  // Try to extract from error message
  const message = String((error as any)?.message ?? error ?? '');
  const match = /status[:\s]+(\d{3})/i.exec(message) || /(\d{3})\s+/i.exec(message);
  if (match) {
    return Number(match[1]);
  }

  return undefined;
}

/**
 * Parse ElevenLabs error code from error object.
 */
function parseErrorCode(error: unknown): ElevenlabsErrorCode {
  // Check for explicit error code in response body
  const bodyCode =
    (error as any)?.detail?.status ??
    (error as any)?.body?.detail?.status ??
    (error as any)?.code ??
    (error as any)?.error?.code;

  if (typeof bodyCode === 'string') {
    const code = bodyCode.toLowerCase();
    if (code.includes('max_character_limit') || code.includes('character_limit')) {
      return 'max_character_limit_exceeded';
    }
    if (code.includes('invalid_api_key') || code.includes('unauthorized')) {
      return 'invalid_api_key';
    }
    if (code.includes('quota_exceeded') || code.includes('quota')) {
      return 'quota_exceeded';
    }
    if (code.includes('voice_not_found') || code.includes('voice')) {
      return 'voice_not_found';
    }
    if (code.includes('only_for_creator') || code.includes('creator')) {
      return 'only_for_creator+';
    }
    if (code.includes('too_many_concurrent') || code.includes('concurrent')) {
      return 'too_many_concurrent_requests';
    }
    if (code.includes('system_busy') || code.includes('busy')) {
      return 'system_busy';
    }
  }

  // Infer from status code
  const status = parseStatus(error);
  if (status === 429) {
    // Check message for more specific code
    const message = String((error as any)?.message ?? '');
    if (/concurrent/i.test(message)) {
      return 'too_many_concurrent_requests';
    }
    if (/busy/i.test(message)) {
      return 'system_busy';
    }
    return 'too_many_concurrent_requests'; // Default 429 to concurrency
  }
  if (status === 401) {
    return 'invalid_api_key';
  }
  if (status === 403) {
    return 'only_for_creator+';
  }
  if (status === 400) {
    const message = String((error as any)?.message ?? '');
    if (/character/i.test(message)) {
      return 'max_character_limit_exceeded';
    }
    if (/voice/i.test(message)) {
      return 'voice_not_found';
    }
    if (/quota/i.test(message)) {
      return 'quota_exceeded';
    }
  }

  return 'unknown';
}

/**
 * Parse error message from error object.
 */
function parseErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  const detail =
    (error as any)?.detail?.message ??
    (error as any)?.body?.detail?.message ??
    (error as any)?.message ??
    (error as any)?.error?.message;
  if (typeof detail === 'string') {
    return detail;
  }
  return String(error ?? 'Unknown ElevenLabs error');
}

/**
 * Parse retry-after value from error (in milliseconds).
 */
function parseRetryAfterMs(error: unknown): number | undefined {
  // Check for retry-after header
  const retryAfter =
    (error as any)?.headers?.['retry-after'] ??
    (error as any)?.response?.headers?.['retry-after'] ??
    (error as any)?.retryAfter;

  if (typeof retryAfter === 'number') {
    // If small number, assume seconds
    return retryAfter < 1000 ? retryAfter * 1000 : retryAfter;
  }
  if (typeof retryAfter === 'string') {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      return seconds * 1000;
    }
  }

  // Try to parse from message
  const message = String((error as any)?.message ?? '');
  const match = /retry[_\-\s]*after[:\s]*(\d+)/i.exec(message);
  if (match) {
    return Number(match[1]) * 1000;
  }

  return undefined;
}

/**
 * Check if an error is retryable based on status and code.
 */
function isRetryableError(status: number | undefined, code: ElevenlabsErrorCode): boolean {
  // 429 errors are always retryable
  if (status === 429) {
    return true;
  }
  // system_busy is retryable
  if (code === 'system_busy' || code === 'too_many_concurrent_requests') {
    return true;
  }
  // Other errors are generally not retryable
  return false;
}

/**
 * Create a ProviderError from a parsed ElevenLabs error.
 */
export function createElevenlabsProviderError(parsed: ParsedElevenlabsError, raw: unknown): ProviderError {
  const { code, message, retryable, status } = parsed;

  // Map ElevenLabs error code to SDK error code
  let sdkCode: string;
  let kind: ProviderErrorKind;

  switch (code) {
    case 'max_character_limit_exceeded':
      sdkCode = SdkErrorCode.CHARACTER_LIMIT_EXCEEDED;
      kind = 'user_input';
      break;
    case 'invalid_api_key':
      sdkCode = SdkErrorCode.INVALID_API_KEY;
      kind = 'user_input';
      break;
    case 'quota_exceeded':
      sdkCode = SdkErrorCode.QUOTA_EXCEEDED;
      kind = 'user_input';
      break;
    case 'voice_not_found':
      sdkCode = SdkErrorCode.INVALID_VOICE;
      kind = 'user_input';
      break;
    case 'only_for_creator+':
      sdkCode = SdkErrorCode.SUBSCRIPTION_REQUIRED;
      kind = 'user_input';
      break;
    case 'too_many_concurrent_requests':
    case 'system_busy':
      sdkCode = SdkErrorCode.RATE_LIMITED;
      kind = 'rate_limited';
      break;
    default:
      sdkCode = SdkErrorCode.PROVIDER_PREDICTION_FAILED;
      kind = 'unknown';
  }

  return createProviderError(sdkCode, `ElevenLabs API error: ${message}`, {
    kind,
    retryable,
    causedByUser: kind === 'user_input',
    metadata: {
      elevenlabsCode: code,
      httpStatus: status,
    },
    raw,
  });
}

/**
 * Options for running ElevenLabs API calls with retry.
 */
export interface ElevenlabsRetryOptions {
  logger?: ProviderLogger;
  jobId: string;
  model: string;
  plannerContext: Record<string, unknown>;
  maxAttempts?: number;
  defaultRetryMs?: number;
}

/**
 * Run an ElevenLabs API call with automatic retry on rate limit errors.
 * Only retries on 429 errors (too_many_concurrent_requests, system_busy).
 * Non-retryable errors are thrown immediately.
 */
export async function runWithRetries<T>(
  fn: () => Promise<T>,
  options: ElevenlabsRetryOptions,
): Promise<T> {
  const {
    logger,
    jobId,
    model,
    plannerContext,
    maxAttempts = 3,
    defaultRetryMs = 10_000,
  } = options;

  let attempt = 0;
  let lastError: unknown;
  let sawRateLimit = false;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const parsed = parseElevenlabsError(error);

      // Log the error
      logger?.debug?.('providers.elevenlabs.retry.error', {
        producer: jobId,
        model,
        plannerContext,
        status: parsed.status,
        code: parsed.code,
        message: parsed.message,
        attempt,
        maxAttempts,
        retryable: parsed.retryable,
      });

      // If not retryable, throw immediately with structured error
      if (!parsed.retryable) {
        throw createElevenlabsProviderError(parsed, error);
      }

      // Check if we should retry
      const shouldRetry = attempt < maxAttempts;
      if (!shouldRetry) {
        break;
      }

      sawRateLimit = true;
      const retryMs = parsed.retryAfterMs ?? defaultRetryMs;

      logger?.info?.(
        `ElevenLabs provider will retry after ${retryMs}ms for job ${jobId}. Attempt #${attempt}`,
      );
      logger?.debug?.('providers.elevenlabs.retry', {
        producer: jobId,
        model,
        plannerContext,
        status: parsed.status,
        code: parsed.code,
        attempt,
        maxAttempts,
        retryAfterMs: retryMs,
      });

      const before = Date.now();
      await new Promise((resolve) => setTimeout(resolve, retryMs));
      const waitedMs = Date.now() - before;

      logger?.info?.(`ElevenLabs provider for job ${jobId} using model ${model} waited for ${waitedMs}ms`);
      logger?.debug?.('providers.elevenlabs.retry.waited', {
        producer: jobId,
        model,
        attempt,
        waitedMs,
      });
    }
  }

  // All retries exhausted
  if (sawRateLimit) {
    const message =
      'ElevenLabs rate limit hit (429); retries exhausted. Lower concurrency, wait, or upgrade subscription.';
    throw createProviderError(SdkErrorCode.RATE_LIMITED, message, {
      kind: 'rate_limited',
      retryable: false,
      metadata: { attempts: attempt },
      raw: lastError,
    });
  }

  // Should not reach here, but handle gracefully
  const parsed = parseElevenlabsError(lastError);
  throw createElevenlabsProviderError(parsed, lastError);
}

/**
 * Creates a retry wrapper for ElevenLabs API calls.
 * Useful when you need to make multiple calls with the same retry options.
 */
export function createElevenlabsRetryWrapper(options: ElevenlabsRetryOptions): {
  execute: <T>(fn: () => Promise<T>) => Promise<T>;
} {
  return {
    execute: <T>(fn: () => Promise<T>) => runWithRetries(fn, options),
  };
}
