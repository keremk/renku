import type { IncomingMessage } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { createMockResponse } from '../generation/test-utils.js';
import {
  handleOnboardingEndpoint,
  onboardingHandlerTestUtils,
} from './handler.js';

function createRequest(method: string): IncomingMessage {
  return { method } as IncomingMessage;
}

describe('onboarding folder picker support matrix', () => {
  it('uses desktop mode on Linux when running in desktop runtime', () => {
    const strategy = onboardingHandlerTestUtils.resolveFolderPickerStrategy({
      platform: 'linux',
      isDesktopRuntime: true,
      isWsl: false,
    });

    expect(strategy).toEqual({ mode: 'desktop' });
  });

  it('uses macOS script mode outside desktop on macOS', () => {
    const strategy = onboardingHandlerTestUtils.resolveFolderPickerStrategy({
      platform: 'darwin',
      isDesktopRuntime: false,
      isWsl: false,
    });

    expect(strategy).toEqual({ mode: 'macos-script' });
  });

  it('disables picker outside desktop on Linux', () => {
    const strategy = onboardingHandlerTestUtils.resolveFolderPickerStrategy({
      platform: 'linux',
      isDesktopRuntime: false,
      isWsl: false,
    });

    expect(strategy).toEqual({
      mode: 'unsupported',
      reason:
        'Native folder picker is available on Linux only in Renku Desktop. Enter the path manually.',
    });
  });

  it('disables picker outside desktop on WSL', () => {
    const strategy = onboardingHandlerTestUtils.resolveFolderPickerStrategy({
      platform: 'linux',
      isDesktopRuntime: false,
      isWsl: true,
    });

    expect(strategy).toEqual({
      mode: 'unsupported',
      reason:
        'Native folder picker is unavailable in WSL outside Renku Desktop. Enter the path manually.',
    });
  });

  it('disables picker outside desktop on Windows', () => {
    const strategy = onboardingHandlerTestUtils.resolveFolderPickerStrategy({
      platform: 'win32',
      isDesktopRuntime: false,
      isWsl: false,
    });

    expect(strategy).toEqual({
      mode: 'unsupported',
      reason:
        'Native folder picker is available on Windows only in Renku Desktop. Enter the path manually.',
    });
  });
});

describe('onboarding browse-folder endpoint with desktop picker bridge', () => {
  it('returns selected path from desktop picker callback', async () => {
    const req = createRequest('POST');
    const res = createMockResponse();
    const openDesktopFolderPicker = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValue('/tmp/renku-workspace');

    const handled = await handleOnboardingEndpoint(
      req,
      res,
      'browse-folder',
      undefined,
      {
        isDesktopRuntime: true,
        openDesktopFolderPicker,
      }
    );

    expect(handled).toBe(true);
    expect(openDesktopFolderPicker).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ path: '/tmp/renku-workspace' });
  });

  it('returns null path when desktop picker is cancelled', async () => {
    const req = createRequest('POST');
    const res = createMockResponse();
    const openDesktopFolderPicker = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValue(null);

    const handled = await handleOnboardingEndpoint(
      req,
      res,
      'browse-folder',
      undefined,
      {
        isDesktopRuntime: true,
        openDesktopFolderPicker,
      }
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ path: null });
  });

  it('reports unsupported support state if desktop picker bridge is missing', async () => {
    const req = createRequest('GET');
    const res = createMockResponse();

    const handled = await handleOnboardingEndpoint(
      req,
      res,
      'browse-folder-support',
      undefined,
      {
        isDesktopRuntime: true,
      }
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      supported: false,
      reason: 'Desktop folder picker is not configured.',
    });
  });
});
