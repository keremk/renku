import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { fetchBuildTimeline } from '@/data/blueprint-client';
import type { TimelineDocument } from '@/types/timeline';

type Status = 'idle' | 'loading' | 'success' | 'error';

interface TimelineState {
  timeline: TimelineDocument | null;
  status: Status;
  error: Error | null;
}

interface TimelineResult extends TimelineState {
  retry: () => void;
}

const TIMELINE_FETCH_MAX_ATTEMPTS = 3;
const TIMELINE_FETCH_RETRY_DELAYS_MS = [200, 600];
const RETRYABLE_TIMELINE_STATUS_CODES = new Set([
  404, 408, 425, 429, 500, 502, 503, 504,
]);

const idleState: TimelineState = {
  timeline: null,
  status: 'idle',
  error: null,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractRequestFailureStatus(error: Error): number | null {
  const match = /Request failed \((\d+)\):/.exec(error.message);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function shouldRetryTimelineFetch(error: Error): boolean {
  const status = extractRequestFailureStatus(error);
  if (status !== null) {
    return RETRYABLE_TIMELINE_STATUS_CODES.has(status);
  }

  return error.name === 'TypeError';
}

async function fetchTimelineWithRetry(
  blueprintFolder: string,
  movieId: string
): Promise<TimelineDocument> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= TIMELINE_FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fetchBuildTimeline(blueprintFolder, movieId);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (
        attempt >= TIMELINE_FETCH_MAX_ATTEMPTS ||
        !shouldRetryTimelineFetch(lastError)
      ) {
        throw lastError;
      }

      const delayMs =
        TIMELINE_FETCH_RETRY_DELAYS_MS[attempt - 1] ??
        TIMELINE_FETCH_RETRY_DELAYS_MS[
          TIMELINE_FETCH_RETRY_DELAYS_MS.length - 1
        ];
      await sleep(delayMs);
    }
  }

  throw lastError ?? new Error('Timeline loading failed');
}

/**
 * Hook to fetch timeline data for a movie build.
 *
 * @param blueprintFolder - The blueprint folder containing the build
 * @param movieId - The movie/build ID
 */
export function useMovieTimeline(
  blueprintFolder: string | null,
  movieId: string | null,
  refreshKey?: string | null
): TimelineResult {
  const [state, setState] = useState<TimelineState>(idleState);
  const [retryCount, setRetryCount] = useState(0);

  const retry = useCallback(() => {
    if (!blueprintFolder || !movieId) {
      return;
    }
    setRetryCount((current) => current + 1);
  }, [blueprintFolder, movieId]);

  useEffect(() => {
    if (!blueprintFolder || !movieId) {
      return;
    }

    let cancelled = false;

    startTransition(() => {
      setState((prev) => ({
        ...prev,
        status: 'loading',
        error: null,
      }));
    });

    fetchTimelineWithRetry(blueprintFolder, movieId)
      .then((data) => {
        if (cancelled) return;
        startTransition(() => {
          setState({
            timeline: data,
            status: 'success',
            error: null,
          });
        });
      })
      .catch((err: Error) => {
        if (cancelled) return;
        startTransition(() => {
          setState({
            timeline: null,
            status: 'error',
            error: err instanceof Error ? err : new Error(String(err)),
          });
        });
      });

    return () => {
      cancelled = true;
    };
  }, [blueprintFolder, movieId, refreshKey, retryCount]);

  const currentState = useMemo(() => {
    if (!blueprintFolder || !movieId) {
      return idleState;
    }
    return state;
  }, [blueprintFolder, movieId, state]);

  return {
    ...currentState,
    retry,
  };
}
