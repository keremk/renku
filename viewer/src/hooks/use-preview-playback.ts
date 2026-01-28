import { useState, useCallback, useMemo } from "react";

interface UsePreviewPlaybackResult {
  currentTime: number;
  isPlaying: boolean;
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  reset: () => void;
}

/**
 * Hook to manage playback state for the preview player.
 * The state automatically resets when the movieId changes by using
 * a key-based state reset pattern.
 */
export function usePreviewPlayback(movieId: string | null): UsePreviewPlaybackResult {
  // Include movieId in state key to force reset when it changes
  const [state, setState] = useState({ currentTime: 0, isPlaying: false, key: movieId });

  // If movieId changed, reset the state
  const currentTime = state.key === movieId ? state.currentTime : 0;
  const isPlaying = state.key === movieId ? state.isPlaying : false;

  // Sync state key with movieId if they don't match
  // This is safe because we're only updating when the key changes
  if (state.key !== movieId) {
    setState({ currentTime: 0, isPlaying: false, key: movieId });
  }

  const play = useCallback(() => {
    setState((prev) => ({ ...prev, isPlaying: true }));
  }, []);

  const pause = useCallback(() => {
    setState((prev) => ({ ...prev, isPlaying: false }));
  }, []);

  const seek = useCallback((time: number) => {
    setState((prev) => ({ ...prev, currentTime: time }));
  }, []);

  const reset = useCallback(() => {
    setState((prev) => ({ ...prev, currentTime: 0, isPlaying: false }));
  }, []);

  return useMemo(
    () => ({ currentTime, isPlaying, play, pause, seek, reset }),
    [currentTime, isPlaying, play, pause, seek, reset]
  );
}
