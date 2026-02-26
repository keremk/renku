import { useState, useEffect, useCallback } from 'react';
import { fetchBuildInputs, saveBuildInputs } from '@/data/blueprint-client';
import type { ModelSelectionValue } from '@/types/blueprint-graph';

export interface UseBuildInputsOptions {
  blueprintFolder: string | null;
  blueprintPath: string | null;
  selectedBuildId: string | null;
  hasInputsFile: boolean;
  catalogRoot?: string | null;
}

export interface UseBuildInputsResult {
  inputs: Record<string, unknown> | null;
  models: ModelSelectionValue[];
  isLoading: boolean;
  hasLoadedInputs: boolean;
  saveInputs: (values: Record<string, unknown>) => Promise<void>;
  saveModels: (models: ModelSelectionValue[]) => Promise<void>;
}

/**
 * Hook for fetching and saving build inputs.
 * Handles the API communication with the server which parses/serializes YAML.
 */
export function useBuildInputs(
  options: UseBuildInputsOptions
): UseBuildInputsResult {
  const {
    blueprintFolder,
    blueprintPath,
    selectedBuildId,
    hasInputsFile,
    catalogRoot,
  } = options;

  const [inputs, setInputs] = useState<Record<string, unknown> | null>(null);
  const [models, setModels] = useState<ModelSelectionValue[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoadedInputs, setHasLoadedInputs] = useState(false);

  // Fetch build inputs when conditions are met
  useEffect(() => {
    const shouldFetch =
      blueprintFolder && blueprintPath && selectedBuildId && hasInputsFile;
    if (!shouldFetch) {
      // Reset state via microtask to avoid synchronous setState warning
      queueMicrotask(() => {
        setInputs(null);
        setModels([]);
        setHasLoadedInputs(false);
      });
      return;
    }

    let cancelled = false;

    const loadInputs = async () => {
      setInputs(null);
      setModels([]);
      setHasLoadedInputs(false);
      setIsLoading(true);
      try {
        const response = await fetchBuildInputs(
          blueprintFolder,
          selectedBuildId,
          blueprintPath,
          catalogRoot
        );
        if (!cancelled) {
          setInputs(response.inputs);
          setModels(response.models);
          setHasLoadedInputs(true);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to fetch build inputs:', error);
          setInputs(null);
          setModels([]);
          setHasLoadedInputs(false);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadInputs();

    return () => {
      cancelled = true;
    };
  }, [
    blueprintFolder,
    blueprintPath,
    selectedBuildId,
    hasInputsFile,
    catalogRoot,
  ]);

  // Save inputs handler
  const saveInputs = useCallback(
    async (values: Record<string, unknown>) => {
      if (!blueprintFolder || !blueprintPath || !selectedBuildId) {
        throw new Error(
          'Cannot save build inputs without blueprint folder, blueprint path, and build id.'
        );
      }
      if (!hasLoadedInputs) {
        throw new Error(
          `Cannot save inputs for build "${selectedBuildId}" before loading its inputs.yaml.`
        );
      }

      // Merge updated values with existing inputs
      const newInputs = { ...(inputs ?? {}), ...values };

      // Server serializes to YAML
      await saveBuildInputs(
        blueprintFolder,
        blueprintPath,
        selectedBuildId,
        newInputs,
        models
      );

      // Update local state
      setInputs(newInputs);
    },
    [
      blueprintFolder,
      blueprintPath,
      selectedBuildId,
      hasLoadedInputs,
      inputs,
      models,
    ]
  );

  // Save models handler
  const saveModels = useCallback(
    async (newModels: ModelSelectionValue[]) => {
      if (!blueprintFolder || !blueprintPath || !selectedBuildId) {
        throw new Error(
          'Cannot save model selections without blueprint folder, blueprint path, and build id.'
        );
      }
      if (!hasLoadedInputs) {
        throw new Error(
          `Cannot save models for build "${selectedBuildId}" before loading its inputs.yaml.`
        );
      }

      // Server serializes to YAML
      await saveBuildInputs(
        blueprintFolder,
        blueprintPath,
        selectedBuildId,
        inputs ?? {},
        newModels
      );

      // Update local state
      setModels(newModels);
    },
    [blueprintFolder, blueprintPath, selectedBuildId, hasLoadedInputs, inputs]
  );

  return {
    inputs,
    models,
    isLoading,
    hasLoadedInputs,
    saveInputs,
    saveModels,
  };
}
