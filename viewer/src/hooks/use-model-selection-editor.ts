import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { ModelSelectionValue } from '@/types/blueprint-graph';

const LEGACY_TIMELINE_CONFIG_KEYS = [
  'tracks',
  'masterTracks',
  'imageClip',
  'videoClip',
  'audioClip',
  'musicClip',
  'transcriptionClip',
  'textClip',
] as const;

export interface UseModelSelectionEditorOptions {
  /** The saved/persisted model selections (from API) */
  savedSelections: ModelSelectionValue[];
  /** Callback to save changes */
  onSave: (selections: ModelSelectionValue[]) => Promise<void>;
  /** Optional equality function */
  isEqual?: (a: ModelSelectionValue[], b: ModelSelectionValue[]) => boolean;
  /** Debounce delay in milliseconds for auto-save (default: 1000) */
  debounceMs?: number;
}

export interface UseModelSelectionEditorResult {
  /** Current selections (saved + edits merged) */
  currentSelections: ModelSelectionValue[];
  /** Whether there are unsaved changes */
  isDirty: boolean;
  /** Whether a save is in progress */
  isSaving: boolean;
  /** Last save error, if any */
  lastError: Error | null;
  /** Update a model selection */
  updateSelection: (selection: ModelSelectionValue) => void;
  /** Update a config property for a producer */
  updateConfig: (producerId: string, key: string, value: unknown) => void;
  /** Save all changes immediately */
  save: () => Promise<void>;
  /** Reset edits (discard unsaved changes) */
  reset: () => void;
}

/**
 * Hook for editing model selections with draft state management and auto-save.
 *
 * Features:
 * - Single source of truth for edit state
 * - Tracks isDirty by comparing against saved state
 * - Handles both model selection and config changes
 * - Resets edits on savedSelections prop change
 * - Auto-saves with debounce when changes occur
 * - Explicit save() method for immediate saves
 */
export function useModelSelectionEditor({
  savedSelections,
  onSave,
  isEqual = defaultIsEqual,
  debounceMs = 1000,
}: UseModelSelectionEditorOptions): UseModelSelectionEditorResult {
  // Edit state - Map for O(1) lookups
  const [edits, setEdits] = useState<Map<string, ModelSelectionValue>>(
    () => new Map()
  );
  const [isSaving, setIsSaving] = useState(false);
  const [lastError, setLastError] = useState<Error | null>(null);

  // Track saved selections for dirty comparison
  const lastSavedRef = useRef<ModelSelectionValue[]>(savedSelections);
  const onSaveRef = useRef(onSave);
  const isMountedRef = useRef(true);
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Update refs on render
  onSaveRef.current = onSave;

  // Reset edits when savedSelections changes (build change, reload)
  // Use JSON comparison to avoid false positives from array reference changes
  useEffect(() => {
    if (!isEqual(savedSelections, lastSavedRef.current)) {
      lastSavedRef.current = savedSelections;
      setEdits(new Map());
      setLastError(null);
      // Cancel any pending debounced save
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
        debounceTimeoutRef.current = null;
      }
    }
  }, [savedSelections, isEqual]);

  // Mount/unmount tracking
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Cancel any pending debounced save on unmount
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
        debounceTimeoutRef.current = null;
      }
    };
  }, []);

  // Compute current selections by merging edits onto saved
  const currentSelections = useMemo<ModelSelectionValue[]>(() => {
    return savedSelections.map((saved) => {
      const edit = edits.get(saved.producerId);
      return edit ?? saved;
    });
  }, [savedSelections, edits]);

  // Compute isDirty
  const isDirty = useMemo(() => {
    return !isEqual(currentSelections, lastSavedRef.current);
  }, [currentSelections, isEqual]);

  // Update a model selection
  const updateSelection = useCallback((selection: ModelSelectionValue) => {
    setEdits((prev) => {
      const next = new Map(prev);
      next.set(selection.producerId, selection);
      return next;
    });
  }, []);

  // Update a config property
  const updateConfig = useCallback(
    (producerId: string, key: string, value: unknown) => {
      setEdits((prev) => {
        // Get current state (from edits or saved)
        const existing =
          prev.get(producerId) ??
          savedSelections.find((s) => s.producerId === producerId);

        if (!existing) return prev;

        const existingConfig = {
          ...(existing.config ?? {}),
        };

        if (key === 'timeline') {
          for (const legacyKey of LEGACY_TIMELINE_CONFIG_KEYS) {
            delete existingConfig[legacyKey];
          }
        }

        const updated: ModelSelectionValue = {
          ...existing,
          config: {
            ...existingConfig,
            [key]: value,
          },
        };

        const next = new Map(prev);
        next.set(producerId, updated);
        return next;
      });
    },
    [savedSelections]
  );

  // Core save logic (shared by auto-save and manual save)
  const doSave = useCallback(async () => {
    if (!isMountedRef.current) return;

    setIsSaving(true);
    setLastError(null);

    try {
      // Build final array - edits merged onto saved
      const selectionsToSave: ModelSelectionValue[] = savedSelections.map(
        (saved) => {
          const edit = edits.get(saved.producerId);
          return edit ?? saved;
        }
      );

      await onSaveRef.current(selectionsToSave);

      if (isMountedRef.current) {
        // Clear edits after successful save
        // Note: We keep lastSavedRef as-is (pointing to savedSelections)
        // so that after clearing edits, currentSelections = savedSelections = lastSavedRef
        // which makes isDirty = false
        // When savedSelections prop eventually updates with the saved values,
        // the effect will reset lastSavedRef appropriately
        setEdits(new Map());
      }
    } catch (error) {
      if (isMountedRef.current) {
        setLastError(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      if (isMountedRef.current) {
        setIsSaving(false);
      }
    }
  }, [savedSelections, edits]);

  // Manual save handler (immediate, no debounce)
  const save = useCallback(async () => {
    // Cancel any pending debounced save
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }
    await doSave();
  }, [doSave]);

  // Auto-save effect - triggers debounced save when edits change
  useEffect(() => {
    if (!isDirty || edits.size === 0) return;

    // Cancel previous timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Schedule new save
    debounceTimeoutRef.current = setTimeout(() => {
      doSave();
    }, debounceMs);

    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [edits, isDirty, debounceMs, doSave]);

  // Reset handler
  const reset = useCallback(() => {
    // Cancel any pending debounced save
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }
    setEdits(new Map());
    setLastError(null);
  }, []);

  return {
    currentSelections,
    isDirty,
    isSaving,
    lastError,
    updateSelection,
    updateConfig,
    save,
    reset,
  };
}

/**
 * Default equality check using JSON.stringify.
 */
function defaultIsEqual(
  a: ModelSelectionValue[],
  b: ModelSelectionValue[]
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
