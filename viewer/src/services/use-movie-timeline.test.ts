/**
 * @vitest-environment jsdom
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchBuildTimeline } from '@/data/blueprint-client';
import { useMovieTimeline } from './use-movie-timeline';

vi.mock('@/data/blueprint-client', () => ({
  fetchBuildTimeline: vi.fn(),
}));

describe('useMovieTimeline', () => {
  const mockFetchBuildTimeline = vi.mocked(fetchBuildTimeline);

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('loads timeline for a build', async () => {
    mockFetchBuildTimeline.mockResolvedValueOnce({
      id: 'timeline-rev-1',
      duration: 12,
      tracks: [],
    });

    const { result } = renderHook(() =>
      useMovieTimeline('/Users/Shared/ken-burns-documentary', 'movie-1')
    );

    await waitFor(() => {
      expect(result.current.status).toBe('success');
    });

    expect(result.current.timeline?.id).toBe('timeline-rev-1');
    expect(mockFetchBuildTimeline).toHaveBeenCalledWith(
      '/Users/Shared/ken-burns-documentary',
      'movie-1'
    );
  });

  it('refetches when revision key changes for same movie', async () => {
    mockFetchBuildTimeline
      .mockResolvedValueOnce({
        id: 'timeline-rev-1',
        duration: 12,
        tracks: [],
      })
      .mockResolvedValueOnce({
        id: 'timeline-rev-2',
        duration: 13,
        tracks: [],
      });

    const { result, rerender } = renderHook(
      ({ refreshKey }) =>
        useMovieTimeline(
          '/Users/Shared/ken-burns-documentary',
          'movie-1',
          refreshKey
        ),
      { initialProps: { refreshKey: 'rev-1' } }
    );

    await waitFor(() => {
      expect(result.current.timeline?.id).toBe('timeline-rev-1');
    });

    rerender({ refreshKey: 'rev-2' });

    await waitFor(() => {
      expect(result.current.timeline?.id).toBe('timeline-rev-2');
    });

    expect(mockFetchBuildTimeline).toHaveBeenCalledTimes(2);
  });

  it('retries retryable timeline fetch failures', async () => {
    mockFetchBuildTimeline
      .mockRejectedValueOnce(
        new Error('Request failed (503): temporarily unavailable')
      )
      .mockResolvedValueOnce({
        id: 'timeline-rev-2',
        duration: 15,
        tracks: [],
      });

    const { result } = renderHook(() =>
      useMovieTimeline('/Users/Shared/ken-burns-documentary', 'movie-1')
    );

    await waitFor(
      () => {
        expect(result.current.status).toBe('success');
      },
      { timeout: 3000 }
    );

    expect(result.current.timeline?.id).toBe('timeline-rev-2');
    expect(mockFetchBuildTimeline).toHaveBeenCalledTimes(2);
  });

  it('allows manual retry after non-retryable error', async () => {
    mockFetchBuildTimeline
      .mockRejectedValueOnce(new Error('Request failed (400): bad request'))
      .mockResolvedValueOnce({
        id: 'timeline-rev-3',
        duration: 16,
        tracks: [],
      });

    const { result } = renderHook(() =>
      useMovieTimeline('/Users/Shared/ken-burns-documentary', 'movie-1')
    );

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    await act(async () => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.status).toBe('success');
    });

    expect(result.current.timeline?.id).toBe('timeline-rev-3');
    expect(mockFetchBuildTimeline).toHaveBeenCalledTimes(2);
  });
});
