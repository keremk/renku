import { describe, expect, it, vi } from 'vitest';
import { SdkErrorCode } from '@gorenku/core';
import type { ProviderError } from '../errors.js';
import {
  parseElevenlabsError,
  createElevenlabsProviderError,
  runWithRetries,
  createElevenlabsRetryWrapper,
  type ParsedElevenlabsError,
} from './retry.js';

describe('parseElevenlabsError', () => {
  describe('status parsing', () => {
    it('extracts status from error.status', () => {
      const error = { status: 429, message: 'Too many requests' };
      const parsed = parseElevenlabsError(error);
      expect(parsed.status).toBe(429);
    });

    it('extracts status from error.statusCode', () => {
      const error = { statusCode: 401, message: 'Unauthorized' };
      const parsed = parseElevenlabsError(error);
      expect(parsed.status).toBe(401);
    });

    it('extracts status from error.response.status', () => {
      const error = { response: { status: 403 }, message: 'Forbidden' };
      const parsed = parseElevenlabsError(error);
      expect(parsed.status).toBe(403);
    });

    it('extracts status from message string', () => {
      const error = new Error('Request failed with status 500');
      const parsed = parseElevenlabsError(error);
      expect(parsed.status).toBe(500);
    });

    it('returns undefined for errors without status', () => {
      const error = new Error('Network error');
      const parsed = parseElevenlabsError(error);
      expect(parsed.status).toBeUndefined();
    });
  });

  describe('error code parsing', () => {
    it('parses max_character_limit_exceeded from body', () => {
      const error = { status: 400, detail: { status: 'max_character_limit_exceeded' } };
      const parsed = parseElevenlabsError(error);
      expect(parsed.code).toBe('max_character_limit_exceeded');
    });

    it('parses invalid_api_key from body', () => {
      const error = { status: 401, body: { detail: { status: 'invalid_api_key' } } };
      const parsed = parseElevenlabsError(error);
      expect(parsed.code).toBe('invalid_api_key');
    });

    it('parses quota_exceeded from body', () => {
      const error = { status: 400, code: 'quota_exceeded' };
      const parsed = parseElevenlabsError(error);
      expect(parsed.code).toBe('quota_exceeded');
    });

    it('parses voice_not_found from body', () => {
      const error = { status: 400, error: { code: 'voice_not_found' } };
      const parsed = parseElevenlabsError(error);
      expect(parsed.code).toBe('voice_not_found');
    });

    it('parses only_for_creator+ from body', () => {
      const error = { status: 403, detail: { status: 'only_for_creator+' } };
      const parsed = parseElevenlabsError(error);
      expect(parsed.code).toBe('only_for_creator+');
    });

    it('parses too_many_concurrent_requests from body', () => {
      const error = { status: 429, detail: { status: 'too_many_concurrent_requests' } };
      const parsed = parseElevenlabsError(error);
      expect(parsed.code).toBe('too_many_concurrent_requests');
    });

    it('parses system_busy from body', () => {
      const error = { status: 429, code: 'system_busy' };
      const parsed = parseElevenlabsError(error);
      expect(parsed.code).toBe('system_busy');
    });

    it('infers too_many_concurrent_requests from 429 status', () => {
      const error = { status: 429, message: 'Rate limited' };
      const parsed = parseElevenlabsError(error);
      expect(parsed.code).toBe('too_many_concurrent_requests');
    });

    it('infers system_busy from 429 with busy in message', () => {
      const error = { status: 429, message: 'System busy, try again' };
      const parsed = parseElevenlabsError(error);
      expect(parsed.code).toBe('system_busy');
    });

    it('infers invalid_api_key from 401 status', () => {
      const error = { status: 401 };
      const parsed = parseElevenlabsError(error);
      expect(parsed.code).toBe('invalid_api_key');
    });

    it('infers only_for_creator+ from 403 status', () => {
      const error = { status: 403 };
      const parsed = parseElevenlabsError(error);
      expect(parsed.code).toBe('only_for_creator+');
    });

    it('infers max_character_limit_exceeded from 400 with character in message', () => {
      const error = { status: 400, message: 'Character limit exceeded' };
      const parsed = parseElevenlabsError(error);
      expect(parsed.code).toBe('max_character_limit_exceeded');
    });

    it('infers voice_not_found from 400 with voice in message', () => {
      const error = { status: 400, message: 'Voice ID not found' };
      const parsed = parseElevenlabsError(error);
      expect(parsed.code).toBe('voice_not_found');
    });

    it('returns unknown for unrecognized errors', () => {
      const error = { status: 500, message: 'Internal server error' };
      const parsed = parseElevenlabsError(error);
      expect(parsed.code).toBe('unknown');
    });
  });

  describe('retryable determination', () => {
    it('marks 429 errors as retryable', () => {
      const error = { status: 429, message: 'Rate limited' };
      const parsed = parseElevenlabsError(error);
      expect(parsed.retryable).toBe(true);
    });

    it('marks system_busy as retryable', () => {
      const error = { status: 429, code: 'system_busy' };
      const parsed = parseElevenlabsError(error);
      expect(parsed.retryable).toBe(true);
    });

    it('marks too_many_concurrent_requests as retryable', () => {
      const error = { status: 429, code: 'too_many_concurrent_requests' };
      const parsed = parseElevenlabsError(error);
      expect(parsed.retryable).toBe(true);
    });

    it('marks 400 errors as not retryable', () => {
      const error = { status: 400, message: 'Bad request' };
      const parsed = parseElevenlabsError(error);
      expect(parsed.retryable).toBe(false);
    });

    it('marks 401 errors as not retryable', () => {
      const error = { status: 401, message: 'Unauthorized' };
      const parsed = parseElevenlabsError(error);
      expect(parsed.retryable).toBe(false);
    });

    it('marks 403 errors as not retryable', () => {
      const error = { status: 403, message: 'Forbidden' };
      const parsed = parseElevenlabsError(error);
      expect(parsed.retryable).toBe(false);
    });

    it('marks quota_exceeded as not retryable', () => {
      const error = { status: 400, code: 'quota_exceeded' };
      const parsed = parseElevenlabsError(error);
      expect(parsed.retryable).toBe(false);
    });
  });

  describe('retry-after parsing', () => {
    it('extracts retry-after from headers (seconds)', () => {
      const error = { status: 429, headers: { 'retry-after': '30' } };
      const parsed = parseElevenlabsError(error);
      expect(parsed.retryAfterMs).toBe(30000);
    });

    it('extracts retry-after from response headers', () => {
      const error = { status: 429, response: { headers: { 'retry-after': 15 } } };
      const parsed = parseElevenlabsError(error);
      expect(parsed.retryAfterMs).toBe(15000);
    });

    it('extracts retry-after from error property', () => {
      const error = { status: 429, retryAfter: 60 };
      const parsed = parseElevenlabsError(error);
      expect(parsed.retryAfterMs).toBe(60000);
    });

    it('extracts retry-after from message', () => {
      const error = { status: 429, message: 'Rate limited, retry after 45 seconds' };
      const parsed = parseElevenlabsError(error);
      expect(parsed.retryAfterMs).toBe(45000);
    });

    it('returns undefined when no retry-after found', () => {
      const error = { status: 429, message: 'Rate limited' };
      const parsed = parseElevenlabsError(error);
      expect(parsed.retryAfterMs).toBeUndefined();
    });
  });
});

describe('createElevenlabsProviderError', () => {
  it('creates CHARACTER_LIMIT_EXCEEDED error', () => {
    const parsed: ParsedElevenlabsError = {
      status: 400,
      code: 'max_character_limit_exceeded',
      message: 'Text too long',
      retryable: false,
    };
    const error = createElevenlabsProviderError(parsed, new Error('original'));

    expect(error.code).toBe(SdkErrorCode.CHARACTER_LIMIT_EXCEEDED);
    expect(error.kind).toBe('user_input');
    expect(error.retryable).toBe(false);
    expect(error.causedByUser).toBe(true);
  });

  it('creates INVALID_API_KEY error', () => {
    const parsed: ParsedElevenlabsError = {
      status: 401,
      code: 'invalid_api_key',
      message: 'Invalid API key',
      retryable: false,
    };
    const error = createElevenlabsProviderError(parsed, new Error('original'));

    expect(error.code).toBe(SdkErrorCode.INVALID_API_KEY);
    expect(error.kind).toBe('user_input');
    expect(error.causedByUser).toBe(true);
  });

  it('creates QUOTA_EXCEEDED error', () => {
    const parsed: ParsedElevenlabsError = {
      status: 400,
      code: 'quota_exceeded',
      message: 'Quota exceeded',
      retryable: false,
    };
    const error = createElevenlabsProviderError(parsed, new Error('original'));

    expect(error.code).toBe(SdkErrorCode.QUOTA_EXCEEDED);
    expect(error.kind).toBe('user_input');
  });

  it('creates INVALID_VOICE error', () => {
    const parsed: ParsedElevenlabsError = {
      status: 400,
      code: 'voice_not_found',
      message: 'Voice not found',
      retryable: false,
    };
    const error = createElevenlabsProviderError(parsed, new Error('original'));

    expect(error.code).toBe(SdkErrorCode.INVALID_VOICE);
    expect(error.kind).toBe('user_input');
  });

  it('creates SUBSCRIPTION_REQUIRED error', () => {
    const parsed: ParsedElevenlabsError = {
      status: 403,
      code: 'only_for_creator+',
      message: 'Requires Creator tier',
      retryable: false,
    };
    const error = createElevenlabsProviderError(parsed, new Error('original'));

    expect(error.code).toBe(SdkErrorCode.SUBSCRIPTION_REQUIRED);
    expect(error.kind).toBe('user_input');
  });

  it('creates RATE_LIMITED error for 429', () => {
    const parsed: ParsedElevenlabsError = {
      status: 429,
      code: 'too_many_concurrent_requests',
      message: 'Too many concurrent requests',
      retryable: true,
    };
    const error = createElevenlabsProviderError(parsed, new Error('original'));

    expect(error.code).toBe(SdkErrorCode.RATE_LIMITED);
    expect(error.kind).toBe('rate_limited');
    expect(error.retryable).toBe(true);
  });

  it('creates RATE_LIMITED error for system_busy', () => {
    const parsed: ParsedElevenlabsError = {
      status: 429,
      code: 'system_busy',
      message: 'System busy',
      retryable: true,
    };
    const error = createElevenlabsProviderError(parsed, new Error('original'));

    expect(error.code).toBe(SdkErrorCode.RATE_LIMITED);
    expect(error.kind).toBe('rate_limited');
  });

  it('creates PROVIDER_PREDICTION_FAILED for unknown errors', () => {
    const parsed: ParsedElevenlabsError = {
      status: 500,
      code: 'unknown',
      message: 'Internal server error',
      retryable: false,
    };
    const error = createElevenlabsProviderError(parsed, new Error('original'));

    expect(error.code).toBe(SdkErrorCode.PROVIDER_PREDICTION_FAILED);
    expect(error.kind).toBe('unknown');
  });

  it('includes metadata with elevenlabs error code and status', () => {
    const parsed: ParsedElevenlabsError = {
      status: 429,
      code: 'too_many_concurrent_requests',
      message: 'Rate limited',
      retryable: true,
    };
    const error = createElevenlabsProviderError(parsed, new Error('original'));

    expect(error.metadata).toEqual({
      elevenlabsCode: 'too_many_concurrent_requests',
      httpStatus: 429,
    });
  });
});

describe('runWithRetries', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await runWithRetries(fn, {
      jobId: 'job-1',
      model: 'eleven_v3',
      plannerContext: {},
    });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 error and succeeds', async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 429, message: 'Rate limited' })
      .mockResolvedValue('success');

    const logger = { info: vi.fn(), debug: vi.fn() } as any;
    try {
      const promise = runWithRetries(fn, {
        logger,
        jobId: 'job-1',
        model: 'eleven_v3',
        plannerContext: {},
        defaultRetryMs: 100,
      });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses retry-after header when present', async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 429, retryAfter: 2 })
      .mockResolvedValue('success');

    const logger = { info: vi.fn(), debug: vi.fn() } as any;
    try {
      const promise = runWithRetries(fn, {
        logger,
        jobId: 'job-1',
        model: 'eleven_v3',
        plannerContext: {},
        defaultRetryMs: 100,
      });

      await vi.runAllTimersAsync();
      await promise;

      // Should have used 2000ms (2 seconds * 1000) instead of default 100ms
      const retryLog = logger.debug.mock.calls.find(
        ([event]: [string]) => event === 'providers.elevenlabs.retry',
      );
      expect(retryLog[1].retryAfterMs).toBe(2000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after max attempts and throws rate limit error', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 429, message: 'Rate limited' });

    await expect(
      runWithRetries(fn, {
        logger: { info: vi.fn(), debug: vi.fn() } as any,
        jobId: 'job-1',
        model: 'eleven_v3',
        plannerContext: {},
        maxAttempts: 2,
        defaultRetryMs: 10,
      }),
    ).rejects.toThrow(/rate limit/i);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on non-retryable error (400)', async () => {
    const fn = vi.fn().mockRejectedValue({
      status: 400,
      code: 'max_character_limit_exceeded',
      message: 'Text too long',
    });

    const error = (await runWithRetries(fn, {
      jobId: 'job-1',
      model: 'eleven_v3',
      plannerContext: {},
    }).catch((e) => e)) as ProviderError;

    expect(fn).toHaveBeenCalledTimes(1);
    expect(error.code).toBe(SdkErrorCode.CHARACTER_LIMIT_EXCEEDED);
  });

  it('throws immediately on invalid_api_key (401)', async () => {
    const fn = vi.fn().mockRejectedValue({
      status: 401,
      message: 'Invalid API key',
    });

    const error = (await runWithRetries(fn, {
      jobId: 'job-1',
      model: 'eleven_v3',
      plannerContext: {},
    }).catch((e) => e)) as ProviderError;

    expect(fn).toHaveBeenCalledTimes(1);
    expect(error.code).toBe(SdkErrorCode.INVALID_API_KEY);
  });

  it('throws immediately on subscription error (403)', async () => {
    const fn = vi.fn().mockRejectedValue({
      status: 403,
      message: 'Only for Creator+',
    });

    const error = (await runWithRetries(fn, {
      jobId: 'job-1',
      model: 'eleven_v3',
      plannerContext: {},
    }).catch((e) => e)) as ProviderError;

    expect(fn).toHaveBeenCalledTimes(1);
    expect(error.code).toBe(SdkErrorCode.SUBSCRIPTION_REQUIRED);
  });

  it('throws immediately on quota_exceeded', async () => {
    const fn = vi.fn().mockRejectedValue({
      status: 400,
      code: 'quota_exceeded',
      message: 'Quota exceeded',
    });

    const error = (await runWithRetries(fn, {
      jobId: 'job-1',
      model: 'eleven_v3',
      plannerContext: {},
    }).catch((e) => e)) as ProviderError;

    expect(fn).toHaveBeenCalledTimes(1);
    expect(error.code).toBe(SdkErrorCode.QUOTA_EXCEEDED);
  });

  it('throws immediately on voice_not_found', async () => {
    const fn = vi.fn().mockRejectedValue({
      status: 400,
      message: 'Voice not found',
    });

    const error = (await runWithRetries(fn, {
      jobId: 'job-1',
      model: 'eleven_v3',
      plannerContext: {},
    }).catch((e) => e)) as ProviderError;

    expect(fn).toHaveBeenCalledTimes(1);
    expect(error.code).toBe(SdkErrorCode.INVALID_VOICE);
  });

  it('logs retry attempts with debug', async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 429 })
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValue('success');

    const logger = { info: vi.fn(), debug: vi.fn() } as any;
    try {
      const promise = runWithRetries(fn, {
        logger,
        jobId: 'job-1',
        model: 'eleven_v3',
        plannerContext: { segment: 0 },
        maxAttempts: 3,
        defaultRetryMs: 100,
      });

      await vi.runAllTimersAsync();
      await promise;

      const retryLogs = logger.debug.mock.calls.filter(
        ([event]: [string]) => event === 'providers.elevenlabs.retry',
      );
      expect(retryLogs).toHaveLength(2);
      expect(retryLogs[0][1].attempt).toBe(1);
      expect(retryLogs[1][1].attempt).toBe(2);

      const waitedLogs = logger.debug.mock.calls.filter(
        ([event]: [string]) => event === 'providers.elevenlabs.retry.waited',
      );
      expect(waitedLogs).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('createElevenlabsRetryWrapper', () => {
  it('creates wrapper that can be reused', async () => {
    const wrapper = createElevenlabsRetryWrapper({
      jobId: 'job-1',
      model: 'eleven_v3',
      plannerContext: {},
    });

    const result1 = await wrapper.execute(() => Promise.resolve('first'));
    const result2 = await wrapper.execute(() => Promise.resolve('second'));

    expect(result1).toBe('first');
    expect(result2).toBe('second');
  });

  it('applies retry logic to executed functions', async () => {
    vi.useFakeTimers();
    const wrapper = createElevenlabsRetryWrapper({
      logger: { info: vi.fn(), debug: vi.fn() } as any,
      jobId: 'job-1',
      model: 'eleven_v3',
      plannerContext: {},
      defaultRetryMs: 100,
    });

    let callCount = 0;
    try {
      const promise = wrapper.execute(async () => {
        callCount++;
        if (callCount < 2) {
          throw { status: 429, message: 'Rate limited' };
        }
        return 'success';
      });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(callCount).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
