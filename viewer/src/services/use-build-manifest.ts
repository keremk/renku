import { startTransition, useEffect, useState } from "react";
import { fetchBuildManifest } from "@/data/blueprint-client";
import type { BuildManifestResponse } from "@/types/builds";

type Status = "idle" | "loading" | "success" | "error";

interface BuildManifestState {
  manifest: BuildManifestResponse | null;
  status: Status;
  error: Error | null;
}

const idleState: BuildManifestState = {
  manifest: null,
  status: "idle",
  error: null,
};

export function useBuildManifest(
  blueprintFolder: string | null,
  movieId: string | null
): BuildManifestState {
  const [state, setState] = useState<BuildManifestState>(idleState);

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
  }, [blueprintFolder, movieId]);

  return blueprintFolder && movieId ? state : idleState;
}
