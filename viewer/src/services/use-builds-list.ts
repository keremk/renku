import {
  startTransition,
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';
import { fetchBuildsList } from '@/data/blueprint-client';
import type { BuildInfo, BuildsListResponse } from '@/types/builds';

type Status = 'idle' | 'loading' | 'success' | 'error';

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
  status: 'idle',
  error: null,
};

export function useBuildsList(
  blueprintFolder: string | null
): BuildsListResult {
  const [state, setState] = useState<BuildsListState>(idleState);
  const blueprintFolderRef = useRef(blueprintFolder);
  const latestRequestIdRef = useRef(0);
  blueprintFolderRef.current = blueprintFolder;

  const loadData = useCallback(async (folder: string, requestId: number) => {
    startTransition(() => {
      setState((prev) => ({
        ...prev,
        status: 'loading',
        error: null,
      }));
    });

    try {
      const data: BuildsListResponse = await fetchBuildsList(folder);
      if (
        latestRequestIdRef.current !== requestId ||
        blueprintFolderRef.current !== folder
      ) {
        return;
      }

      startTransition(() => {
        setState({
          builds: data.builds,
          blueprintFolder: data.blueprintFolder,
          status: 'success',
          error: null,
        });
      });
    } catch (err) {
      if (
        latestRequestIdRef.current !== requestId ||
        blueprintFolderRef.current !== folder
      ) {
        return;
      }

      startTransition(() => {
        setState({
          builds: [],
          blueprintFolder: null,
          status: 'error',
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
    }
  }, []);

  useEffect(() => {
    if (!blueprintFolder) {
      latestRequestIdRef.current += 1;
      setState(idleState);
      return;
    }

    // Synchronous full reset — clears stale builds from a previous folder
    // so the auto-select effect in App never fires against old data.
    setState({
      builds: [],
      blueprintFolder: null,
      status: 'loading',
      error: null,
    });

    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    void loadData(blueprintFolder, requestId);
  }, [blueprintFolder, loadData]);

  const refetch = useCallback(async () => {
    const folder = blueprintFolderRef.current;
    if (!folder) return;
    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    await loadData(folder, requestId);
  }, [loadData]);

  const result: BuildsListResult = blueprintFolder
    ? { ...state, refetch }
    : { ...idleState, refetch };

  return result;
}
