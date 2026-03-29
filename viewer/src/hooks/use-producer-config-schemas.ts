import { useState, useEffect } from 'react';
import { fetchProducerConfigSchemas } from '@/data/blueprint-client';
import type {
  ProducerConfigSchemas,
  ProducerContractError,
} from '@/types/blueprint-graph';

export interface UseProducerConfigSchemasOptions {
  blueprintPath: string | null;
  catalogRoot?: string | null;
}

export interface UseProducerConfigSchemasResult {
  configSchemas: Record<string, ProducerConfigSchemas>;
  errorsByProducer: Record<string, ProducerContractError>;
  isLoading: boolean;
  /** Error message if schema fetch failed */
  error: string | null;
}

/**
 * Hook for fetching producer config schemas from the server.
 * Returns JSON schema properties for each producer that are NOT mapped through connections.
 */
export function useProducerConfigSchemas(
  options: UseProducerConfigSchemasOptions
): UseProducerConfigSchemasResult {
  const { blueprintPath, catalogRoot } = options;

  const [configSchemas, setConfigSchemas] = useState<
    Record<string, ProducerConfigSchemas>
  >({});
  const [errorsByProducer, setErrorsByProducer] = useState<
    Record<string, ProducerContractError>
  >({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!blueprintPath) return;

    let cancelled = false;

    const loadConfigSchemas = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetchProducerConfigSchemas(
          blueprintPath,
          catalogRoot
        );
        if (!cancelled) {
          setConfigSchemas(response.producers);
          setErrorsByProducer(response.errorsByProducer ?? {});
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          console.error('Failed to fetch producer config schemas:', err);
          setError(`Failed to load config schema: ${message}`);
          setConfigSchemas({});
          setErrorsByProducer({});
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
    errorsByProducer,
    isLoading,
    error,
  };
}
