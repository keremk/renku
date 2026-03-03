/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMediaPrompt } from './use-media-prompt';

interface HookProps {
  url: string | undefined;
  enabled: boolean;
}

describe('useMediaPrompt', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads prompt text when enabled with a prompt URL', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('prompt content', { status: 200 })
    );

    const { result } = renderHook(() => useMediaPrompt('/prompt.txt', true));

    await waitFor(() => {
      expect(result.current.isPromptLoading).toBe(false);
      expect(result.current.promptText).toBe('prompt content');
      expect(result.current.promptError).toBeNull();
    });
  });

  it('clears stale state when disabled or when prompt URL is missing', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('old prompt', { status: 200 })
    );

    const initialProps: HookProps = {
      url: '/prompt.txt',
      enabled: true,
    };

    const { result, rerender } = renderHook(
      ({ url, enabled }: HookProps) => useMediaPrompt(url, enabled),
      {
        initialProps,
      }
    );

    await waitFor(() => {
      expect(result.current.promptText).toBe('old prompt');
      expect(result.current.isPromptLoading).toBe(false);
    });

    rerender({ url: undefined, enabled: true });

    await waitFor(() => {
      expect(result.current.promptText).toBeNull();
      expect(result.current.promptError).toBeNull();
      expect(result.current.isPromptLoading).toBe(false);
    });
  });

  it('does not keep loading true after an in-flight request is cancelled', async () => {
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            return;
          }

          signal.addEventListener('abort', () => {
            reject(
              new DOMException('The operation was aborted.', 'AbortError')
            );
          });
        })
    );

    const initialProps: HookProps = {
      url: '/prompt.txt',
      enabled: true,
    };

    const { result, rerender } = renderHook(
      ({ url, enabled }: HookProps) => useMediaPrompt(url, enabled),
      {
        initialProps,
      }
    );

    await waitFor(() => {
      expect(result.current.isPromptLoading).toBe(true);
    });

    rerender({ url: '/prompt.txt', enabled: false });

    await waitFor(() => {
      expect(result.current.isPromptLoading).toBe(false);
      expect(result.current.promptText).toBeNull();
      expect(result.current.promptError).toBeNull();
    });
  });
});
