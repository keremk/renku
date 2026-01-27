import { startTransition, useEffect, useState, useCallback, useRef } from "react";
import { fetchBuildsList } from "@/data/blueprint-client";
import type { BuildInfo, BuildsListResponse } from "@/types/builds";

type Status = "idle" | "loading" | "success" | "error";

interface BuildsListState {
  builds: BuildInfo[];
  blueprintFolder: string | null;
  status: Status;
  error: Error | null;
}

interface BuildsListResult extends BuildsListState {
  /** Refetch builds list (useful after creating new builds) */
  refetch: () => Promise<void>;
}

const idleState: BuildsListState = {
  builds: [],
  blueprintFolder: null,
  status: "idle",
  error: null,
};

export function useBuildsList(blueprintFolder: string | null): BuildsListResult {
  const [state, setState] = useState<BuildsListState>(idleState);
  const blueprintFolderRef = useRef(blueprintFolder);
  blueprintFolderRef.current = blueprintFolder;

  const loadData = useCallback(async (folder: string) => {
    startTransition(() => {
      setState((prev) => ({
        ...prev,
        status: "loading",
        error: null,
      }));
    });

    try {
      const data: BuildsListResponse = await fetchBuildsList(folder);

      startTransition(() => {
        setState({
          builds: data.builds,
          blueprintFolder: data.blueprintFolder,
          status: "success",
          error: null,
        });
      });
    } catch (err) {
      startTransition(() => {
        setState({
          builds: [],
          blueprintFolder: null,
          status: "error",
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
    }
  }, []);

  useEffect(() => {
    if (!blueprintFolder) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      if (cancelled) return;
      await loadData(blueprintFolder);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [blueprintFolder, loadData]);

  const refetch = useCallback(async () => {
    const folder = blueprintFolderRef.current;
    if (!folder) return;
    await loadData(folder);
  }, [loadData]);

  const result: BuildsListResult = blueprintFolder
    ? { ...state, refetch }
    : { ...idleState, refetch };

  return result;
}
