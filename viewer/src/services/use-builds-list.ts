import { startTransition, useEffect, useState } from "react";
import { fetchBuildsList } from "@/data/blueprint-client";
import type { BuildInfo, BuildsListResponse } from "@/types/builds";

type Status = "idle" | "loading" | "success" | "error";

interface BuildsListState {
  builds: BuildInfo[];
  blueprintFolder: string | null;
  status: Status;
  error: Error | null;
}

const idleState: BuildsListState = {
  builds: [],
  blueprintFolder: null,
  status: "idle",
  error: null,
};

export function useBuildsList(blueprintFolder: string | null): BuildsListState {
  const [state, setState] = useState<BuildsListState>(idleState);

  useEffect(() => {
    if (!blueprintFolder) {
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
        const data: BuildsListResponse = await fetchBuildsList(blueprintFolder);

        if (cancelled) return;
        startTransition(() => {
          setState({
            builds: data.builds,
            blueprintFolder: data.blueprintFolder,
            status: "success",
            error: null,
          });
        });
      } catch (err) {
        if (cancelled) return;
        startTransition(() => {
          setState({
            builds: [],
            blueprintFolder: null,
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
  }, [blueprintFolder]);

  return blueprintFolder ? state : idleState;
}
