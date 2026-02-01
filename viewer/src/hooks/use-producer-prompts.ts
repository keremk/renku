import { useState, useEffect, useCallback, useMemo } from "react";
import {
  fetchProducerPrompts,
  saveProducerPrompts,
  restoreProducerPrompts,
} from "@/data/blueprint-client";
import type { ProducerModelInfo, PromptData } from "@/types/blueprint-graph";

export interface UseProducerPromptsOptions {
  blueprintFolder: string | null;
  blueprintPath: string | null;
  movieId: string | null;
  producerModels: Record<string, ProducerModelInfo>;
  catalogRoot?: string | null;
  /** Only fetch if true (requires an editable build) */
  enabled?: boolean;
}

export interface UseProducerPromptsResult {
  /** Prompt data keyed by producerId */
  promptDataByProducer: Record<string, PromptData>;
  /** Whether prompts are currently loading */
  isLoading: boolean;
  /** Save updated prompt for a producer */
  savePrompt: (producerId: string, prompts: PromptData) => Promise<void>;
  /** Restore prompt to original template version */
  restorePrompt: (producerId: string) => Promise<void>;
  /** Refresh prompt data for all producers */
  refreshPrompts: () => Promise<void>;
}

/**
 * Hook for fetching and managing prompt data for prompt-type producers.
 * Automatically fetches prompts for all producers with category === "prompt".
 */
export function useProducerPrompts(
  options: UseProducerPromptsOptions
): UseProducerPromptsResult {
  const {
    blueprintFolder,
    blueprintPath,
    movieId,
    producerModels,
    catalogRoot,
    enabled = true,
  } = options;

  const [promptDataByProducer, setPromptDataByProducer] = useState<
    Record<string, PromptData>
  >({});
  const [isLoading, setIsLoading] = useState(false);

  // Get list of prompt producers
  const promptProducerIds = useMemo(() => {
    return Object.entries(producerModels)
      .filter(([, info]) => info.category === "prompt")
      .map(([id]) => id);
  }, [producerModels]);

  // Fetch prompts for all prompt producers
  const loadPrompts = useCallback(async () => {
    if (
      !blueprintFolder ||
      !blueprintPath ||
      !movieId ||
      !enabled ||
      promptProducerIds.length === 0
    ) {
      return;
    }

    setIsLoading(true);
    try {
      const results = await Promise.all(
        promptProducerIds.map(async (producerId) => {
          try {
            const response = await fetchProducerPrompts(
              blueprintFolder,
              movieId,
              blueprintPath,
              producerId,
              catalogRoot
            );
            return {
              producerId,
              data: {
                ...response.prompts,
                source: response.source,
              } as PromptData,
            };
          } catch (error) {
            console.error(`Failed to fetch prompts for ${producerId}:`, error);
            return null;
          }
        })
      );

      const newPromptData: Record<string, PromptData> = {};
      for (const result of results) {
        if (result) {
          newPromptData[result.producerId] = result.data;
        }
      }
      setPromptDataByProducer(newPromptData);
    } finally {
      setIsLoading(false);
    }
  }, [
    blueprintFolder,
    blueprintPath,
    movieId,
    promptProducerIds,
    catalogRoot,
    enabled,
  ]);

  // Load prompts when dependencies change
  useEffect(() => {
    void loadPrompts();
  }, [loadPrompts]);

  // Save prompt for a producer
  const savePrompt = useCallback(
    async (producerId: string, prompts: PromptData) => {
      if (!blueprintFolder || !blueprintPath || !movieId) {
        throw new Error("Cannot save prompts: missing required parameters");
      }

      await saveProducerPrompts(
        blueprintFolder,
        movieId,
        blueprintPath,
        producerId,
        prompts
      );

      // Update local state
      setPromptDataByProducer((prev) => ({
        ...prev,
        [producerId]: {
          ...prompts,
          source: "build",
        },
      }));
    },
    [blueprintFolder, blueprintPath, movieId]
  );

  // Restore prompt to template version
  const restorePrompt = useCallback(
    async (producerId: string) => {
      if (!blueprintFolder || !movieId) {
        throw new Error("Cannot restore prompts: missing required parameters");
      }

      await restoreProducerPrompts(blueprintFolder, movieId, producerId);

      // Refresh to get the template version
      await loadPrompts();
    },
    [blueprintFolder, movieId, loadPrompts]
  );

  return {
    promptDataByProducer,
    isLoading,
    savePrompt,
    restorePrompt,
    refreshPrompts: loadPrompts,
  };
}
