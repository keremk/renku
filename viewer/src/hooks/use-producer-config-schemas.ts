import { useState, useEffect } from "react";
import { fetchProducerConfigSchemas } from "@/data/blueprint-client";
import type { ProducerConfigSchemas } from "@/types/blueprint-graph";

export interface UseProducerConfigSchemasOptions {
  blueprintPath: string | null;
  catalogRoot?: string | null;
}

export interface UseProducerConfigSchemasResult {
  configSchemas: Record<string, ProducerConfigSchemas>;
  isLoading: boolean;
}

/**
 * Hook for fetching producer config schemas from the server.
 * Returns JSON schema properties for each producer that are NOT mapped through connections.
 */
export function useProducerConfigSchemas(
  options: UseProducerConfigSchemasOptions
): UseProducerConfigSchemasResult {
  const { blueprintPath, catalogRoot } = options;

  const [configSchemas, setConfigSchemas] = useState<Record<string, ProducerConfigSchemas>>({});
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!blueprintPath) return;

    let cancelled = false;

    const loadConfigSchemas = async () => {
      setIsLoading(true);
      try {
        const response = await fetchProducerConfigSchemas(blueprintPath, catalogRoot);
        if (!cancelled) {
          setConfigSchemas(response.producers);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to fetch producer config schemas:", error);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadConfigSchemas();

    return () => {
      cancelled = true;
    };
  }, [blueprintPath, catalogRoot]);

  return {
    configSchemas,
    isLoading,
  };
}
