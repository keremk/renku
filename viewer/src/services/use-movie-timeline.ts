import { startTransition, useEffect, useState } from "react";
import { fetchBuildTimeline } from "@/data/blueprint-client";
import { fetchTimeline } from "@/data/client";
import type { TimelineDocument } from "@/types/timeline";

type Status = "idle" | "loading" | "success" | "error";

interface TimelineState {
  timeline: TimelineDocument | null;
  status: Status;
  error: Error | null;
}

const idleState: TimelineState = {
  timeline: null,
  status: "idle",
  error: null,
};

/**
 * Hook to fetch timeline data for a movie.
 *
 * @param blueprintFolderOrMovieId - Either the blueprint folder (when using with movieId)
 *                                    or the movie ID alone (for backward compatibility with movies route)
 * @param movieId - The movie ID (optional, only needed when first param is blueprintFolder)
 *
 * Usage:
 * - useMovieTimeline(blueprintFolder, movieId) - Uses blueprints API with folder context
 * - useMovieTimeline(movieId) - Uses movies API with global viewer root (backward compat)
 */
export function useMovieTimeline(
  blueprintFolderOrMovieId: string | null,
  movieId?: string | null
): TimelineState {
  const [state, setState] = useState<TimelineState>(idleState);

  // Determine which mode we're in based on argument count
  const isLegacyMode = movieId === undefined;
  const effectiveMovieId = isLegacyMode ? blueprintFolderOrMovieId : movieId;
  const blueprintFolder = isLegacyMode ? null : blueprintFolderOrMovieId;

  useEffect(() => {
    if (!effectiveMovieId) {
      return;
    }

    // For legacy mode, we don't need blueprintFolder
    // For new mode, we need both
    if (!isLegacyMode && !blueprintFolder) {
      return;
    }

    let cancelled = false;

    startTransition(() => {
      setState((prev) => ({
        ...prev,
        status: "loading",
        error: null,
      }));
    });

    const fetchPromise = isLegacyMode
      ? fetchTimeline(effectiveMovieId)
      : fetchBuildTimeline(blueprintFolder!, effectiveMovieId);

    fetchPromise
      .then((data) => {
        if (cancelled) return;
        startTransition(() => {
          setState({
            timeline: data,
            status: "success",
            error: null,
          });
        });
      })
      .catch((err: Error) => {
        if (cancelled) return;
        startTransition(() => {
          setState({
            timeline: null,
            status: "error",
            error: err,
          });
        });
      });

    return () => {
      cancelled = true;
    };
  }, [blueprintFolder, effectiveMovieId, isLegacyMode]);

  const shouldReturnIdle = isLegacyMode
    ? !effectiveMovieId
    : !blueprintFolder || !effectiveMovieId;

  return shouldReturnIdle ? idleState : state;
}
