import { useEffect, useMemo, useState } from 'react';
import { fetchProducerSdkPreview } from '@/data/blueprint-client';
import type { ProducerSdkPreviewEntry } from '@/types/blueprint-graph';

export interface UseProducerSdkPreviewOptions {
  blueprintPath: string | null;
  catalogRoot?: string | null;
  inputs: Record<string, unknown>;
  modelSelections: Array<{
    producerId: string;
    provider: string;
    model: string;
  }>;
  enabled?: boolean;
}

export interface UseProducerSdkPreviewResult {
  sdkPreviewByProducer: Record<string, ProducerSdkPreviewEntry>;
  isLoading: boolean;
  error: string | null;
}

export function useProducerSdkPreview(
  options: UseProducerSdkPreviewOptions
): UseProducerSdkPreviewResult {
  const {
    blueprintPath,
    catalogRoot,
    inputs,
    modelSelections,
    enabled = true,
  } = options;

  const [sdkPreviewByProducer, setSdkPreviewByProducer] = useState<
    Record<string, ProducerSdkPreviewEntry>
  >({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestModels = useMemo(
    () =>
      modelSelections.map((selection) => ({
        producerId: selection.producerId,
        provider: selection.provider,
        model: selection.model,
      })),
    [modelSelections]
  );

  const requestKey = useMemo(
    () =>
      JSON.stringify({
        blueprintPath,
        catalogRoot,
        inputs,
        requestModels,
        enabled,
      }),
    [blueprintPath, catalogRoot, enabled, inputs, requestModels]
  );

  useEffect(() => {
    if (!enabled || !blueprintPath || requestModels.length === 0) {
      setSdkPreviewByProducer({});
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    const loadPreview = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetchProducerSdkPreview({
          blueprintPath,
          catalogRoot,
          inputs,
          models: requestModels,
        });
        if (!cancelled) {
          setSdkPreviewByProducer(response.producers);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          setSdkPreviewByProducer({});
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  return {
    sdkPreviewByProducer,
    isLoading,
    error,
  };
}
