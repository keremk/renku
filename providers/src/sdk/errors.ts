import { SdkErrorCode, type SdkErrorCodeValue } from '@gorenku/core';

export { SdkErrorCode };

export type ProviderErrorKind = 'rate_limited' | 'transient' | 'user_input' | 'unknown';

export interface ProviderError extends Error {
  code: string;
  kind: ProviderErrorKind;
  retryable: boolean;
  causedByUser?: boolean;
  metadata?: Record<string, unknown>;
  raw?: unknown;
}

export function createProviderError(
  code: SdkErrorCodeValue | string,
  message: string,
  options: {
    kind?: ProviderErrorKind;
    retryable?: boolean;
    causedByUser?: boolean;
    metadata?: Record<string, unknown>;
    raw?: unknown;
  } = {},
): ProviderError {
  const error = new Error(message) as ProviderError;
  error.code = code;
  error.kind = options.kind ?? 'unknown';
  error.retryable = options.retryable ?? false;
  error.causedByUser = options.causedByUser;
  error.metadata = options.metadata;
  error.raw = options.raw;
  return error;
}
