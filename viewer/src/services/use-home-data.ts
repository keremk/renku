import { useCallback, useEffect, useState } from 'react';
import {
  fetchBlueprintsList,
  fetchCatalogTemplates,
  type BlueprintListItem,
  type CatalogTemplateItem,
} from '@/data/blueprint-client';

export interface HomeListState {
  isLoading: boolean;
  error: string | null;
}

interface HomeDataResult {
  blueprints: BlueprintListItem[];
  templates: CatalogTemplateItem[];
  blueprintsState: HomeListState;
  templatesState: HomeListState;
  refreshAll: () => Promise<void>;
}

export function useHomeData(): HomeDataResult {
  const [blueprints, setBlueprints] = useState<BlueprintListItem[]>([]);
  const [templates, setTemplates] = useState<CatalogTemplateItem[]>([]);
  const [blueprintsState, setBlueprintsState] = useState<HomeListState>({
    isLoading: true,
    error: null,
  });
  const [templatesState, setTemplatesState] = useState<HomeListState>({
    isLoading: true,
    error: null,
  });

  const loadBlueprints = useCallback(async () => {
    setBlueprintsState({ isLoading: true, error: null });
    try {
      const response = await fetchBlueprintsList();
      setBlueprints(response.blueprints);
      setBlueprintsState({ isLoading: false, error: null });
    } catch (error) {
      setBlueprintsState({
        isLoading: false,
        error:
          error instanceof Error ? error.message : 'Failed to load blueprints',
      });
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    setTemplatesState({ isLoading: true, error: null });
    try {
      const response = await fetchCatalogTemplates();
      setTemplates(response.templates);
      setTemplatesState({ isLoading: false, error: null });
    } catch (error) {
      setTemplatesState({
        isLoading: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to load catalog templates',
      });
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadBlueprints(), loadTemplates()]);
  }, [loadBlueprints, loadTemplates]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void refreshAll();
    }, 0);

    return () => {
      clearTimeout(timeout);
    };
  }, [refreshAll]);

  return {
    blueprints,
    templates,
    blueprintsState,
    templatesState,
    refreshAll,
  };
}
