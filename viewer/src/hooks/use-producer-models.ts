import { useState, useEffect } from "react";
import { fetchProducerModels } from "@/data/blueprint-client";
import type { ProducerModelInfo } from "@/types/blueprint-graph";

export interface UseProducerModelsOptions {
  blueprintPath: string | null;
  catalogRoot?: string | null;
}

export interface UseProducerModelsResult {
  producerModels: Record<string, ProducerModelInfo>;
  isLoading: boolean;
}

/**
 * Hook for fetching producer model information from the server.
 * Returns available models for each producer in the blueprint.
 */
export function useProducerModels(options: UseProducerModelsOptions): UseProducerModelsResult {
  const { blueprintPath, catalogRoot } = options;

  const [producerModels, setProducerModels] = useState<Record<string, ProducerModelInfo>>({});
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!blueprintPath) return;

    let cancelled = false;

    const loadProducerModels = async () => {
      setIsLoading(true);
      try {
        const response = await fetchProducerModels(blueprintPath, catalogRoot);
        if (!cancelled) {
          setProducerModels(response.producers);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to fetch producer models:", error);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadProducerModels();

    return () => {
      cancelled = true;
    };
  }, [blueprintPath, catalogRoot]);

  return {
    producerModels,
    isLoading,
  };
}
