import { startTransition, useEffect, useState } from "react";
import { fetchBuildTimeline } from "@/data/blueprint-client";
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
 * Hook to fetch timeline data for a movie build.
 *
 * @param blueprintFolder - The blueprint folder containing the build
 * @param movieId - The movie/build ID
 */
export function useMovieTimeline(
  blueprintFolder: string | null,
  movieId: string | null
): TimelineState {
  const [state, setState] = useState<TimelineState>(idleState);

  useEffect(() => {
    if (!blueprintFolder || !movieId) {
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

    fetchBuildTimeline(blueprintFolder, movieId)
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
  }, [blueprintFolder, movieId]);

  return !blueprintFolder || !movieId ? idleState : state;
}
