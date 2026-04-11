import { useEffect, useMemo, useState } from 'react';
import { fetchProducerFieldPreview } from '@/data/blueprint-client';
import type {
  ProducerContractError,
  ProducerFieldPreviewEntry,
} from '@/types/blueprint-graph';

export interface UseProducerFieldPreviewOptions {
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

export interface UseProducerFieldPreviewResult {
  fieldPreviewByProducer: Record<string, ProducerFieldPreviewEntry>;
  fieldPreviewErrorsByProducer: Record<string, ProducerContractError>;
  isLoading: boolean;
  error: string | null;
}

export function useProducerFieldPreview(
  options: UseProducerFieldPreviewOptions
): UseProducerFieldPreviewResult {
  const {
    blueprintPath,
    catalogRoot,
    inputs,
    modelSelections,
    enabled = true,
  } = options;

  const [fieldPreviewByProducer, setFieldPreviewByProducer] = useState<
    Record<string, ProducerFieldPreviewEntry>
  >({});
  const [fieldPreviewErrorsByProducer, setFieldPreviewErrorsByProducer] =
    useState<
      Record<string, ProducerContractError>
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
      setFieldPreviewByProducer({});
      setFieldPreviewErrorsByProducer({});
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    const loadPreview = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetchProducerFieldPreview({
          blueprintPath,
          catalogRoot,
          inputs,
          models: requestModels,
        });
        if (!cancelled) {
          setFieldPreviewByProducer(response.producers);
          setFieldPreviewErrorsByProducer(response.errorsByProducer ?? {});
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          setFieldPreviewByProducer({});
          setFieldPreviewErrorsByProducer({});
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
  }, [requestKey]); // eslint-disable-line react-hooks/exhaustive-deps -- requestKey intentionally collapses the request payload.

  return {
    fieldPreviewByProducer,
    fieldPreviewErrorsByProducer,
    isLoading,
    error,
  };
}
