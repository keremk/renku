import { useEffect, useState } from 'react';
import { fetchStoryboardProjection } from '@/data/blueprint-client';
import type { StoryboardProjection } from '@/types/storyboard';

export interface UseStoryboardProjectionOptions {
  blueprintPath: string | null;
  blueprintFolder?: string | null;
  movieId?: string | null;
  catalogRoot?: string | null;
  refreshKey?: string | null;
}

export interface UseStoryboardProjectionResult {
  projection: StoryboardProjection | null;
  isLoading: boolean;
  error: Error | null;
}

export function useStoryboardProjection(
  options: UseStoryboardProjectionOptions
): UseStoryboardProjectionResult {
  const { blueprintPath, blueprintFolder, movieId, catalogRoot, refreshKey } =
    options;
  const [projection, setProjection] = useState<StoryboardProjection | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!blueprintPath) {
      setProjection(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const nextProjection = await fetchStoryboardProjection({
          blueprintPath,
          blueprintFolder,
          movieId,
          catalogRoot,
        });
        if (!cancelled) {
          setProjection(nextProjection);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setProjection(null);
          setError(
            caughtError instanceof Error
              ? caughtError
              : new Error(String(caughtError))
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [blueprintPath, blueprintFolder, movieId, catalogRoot, refreshKey]);

  return {
    projection,
    isLoading,
    error,
  };
}
