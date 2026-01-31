import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { fetchBuildManifest } from "@/data/blueprint-client";
import type { BuildManifestResponse } from "@/types/builds";

type Status = "idle" | "loading" | "success" | "error";

interface BuildManifestState {
  manifest: BuildManifestResponse | null;
  status: Status;
  error: Error | null;
}

interface BuildManifestResult extends BuildManifestState {
  refetch: () => void;
}

const idleState: BuildManifestState = {
  manifest: null,
  status: "idle",
  error: null,
};

export function useBuildManifest(
  blueprintFolder: string | null,
  movieId: string | null
): BuildManifestResult {
  const [state, setState] = useState<BuildManifestState>(idleState);
  // Track trigger for refetch - increment to force re-run
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  // Store current params in refs so refetch callback doesn't need dependencies
  const paramsRef = useRef({ blueprintFolder, movieId });
  paramsRef.current = { blueprintFolder, movieId };

  useEffect(() => {
    if (!blueprintFolder || !movieId) {
      setState(idleState);
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

    const loadData = async () => {
      try {
        const data = await fetchBuildManifest(blueprintFolder, movieId);

        if (cancelled) return;
        startTransition(() => {
          setState({
            manifest: data,
            status: "success",
            error: null,
          });
        });
      } catch (err) {
        if (cancelled) return;
        startTransition(() => {
          setState({
            manifest: null,
            status: "error",
            error: err instanceof Error ? err : new Error(String(err)),
          });
        });
      }
    };

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [blueprintFolder, movieId, refetchTrigger]);

  const refetch = useCallback(() => {
    // Only refetch if we have valid params
    if (paramsRef.current.blueprintFolder && paramsRef.current.movieId) {
      setRefetchTrigger((prev) => prev + 1);
    }
  }, []);

  const result = blueprintFolder && movieId ? state : idleState;
  return { ...result, refetch };
}
