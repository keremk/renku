import { useRef, useState, useCallback, useEffect } from 'react';

export interface UseAutoSaveOptions<T> {
  /** The data to save */
  data: T;
  /** Callback to perform the save */
  onSave: (data: T) => Promise<void>;
  /** Debounce delay in milliseconds (default: 1000) */
  debounceMs?: number;
  /** Whether auto-save is enabled (default: true) */
  enabled?: boolean;
  /** Function to compare if data has changed from initial state */
  isEqual?: (a: T, b: T) => boolean;
  /** Initial data for comparison (to determine if dirty) */
  initialData?: T;
  /** Optional key that defines save scope (e.g. blueprint+build). */
  resetKey?: string;
  /** Save pending data during unmount (default: true). */
  saveOnUnmount?: boolean;
}

export interface UseAutoSaveResult {
  /** Whether a save is in progress */
  isSaving: boolean;
  /** Last error that occurred during save */
  lastError: Error | null;
  /** Force an immediate save */
  forceSave: () => Promise<void>;
  /** Whether there are unsaved changes */
  isDirty: boolean;
}

/**
 * Hook for automatic debounced saving of data.
 * Saves on change (debounced) and optionally on unmount.
 */
export function useAutoSave<T>({
  data,
  onSave,
  debounceMs = 1000,
  enabled = true,
  isEqual = defaultIsEqual,
  initialData,
  resetKey,
  saveOnUnmount = true,
}: UseAutoSaveOptions<T>): UseAutoSaveResult {
  const [isSaving, setIsSaving] = useState(false);
  const [lastError, setLastError] = useState<Error | null>(null);
  const [, bumpDirtyRevision] = useState(0);

  // Track the data that needs to be saved
  const pendingDataRef = useRef<T>(data);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  const isMountedRef = useRef(true);
  const enabledRef = useRef(enabled);
  const saveOnUnmountRef = useRef(saveOnUnmount);
  const resetKeyRef = useRef(resetKey);

  // Track the last saved data to determine if dirty
  const lastSavedDataRef = useRef<T>(initialData ?? data);

  // Update refs on each render
  onSaveRef.current = onSave;
  pendingDataRef.current = data;
  enabledRef.current = enabled;
  saveOnUnmountRef.current = saveOnUnmount;

  // Determine if data has changed from last saved state
  const isDirty = !isEqual(data, lastSavedDataRef.current);

  // Re-baseline when caller provides a new initialData snapshot.
  useEffect(() => {
    if (initialData === undefined) {
      return;
    }
    if (!isEqual(initialData, lastSavedDataRef.current)) {
      lastSavedDataRef.current = initialData;
      setLastError(null);
      bumpDirtyRevision((prev) => prev + 1);
    }
  }, [initialData, isEqual]);

  // Reset pending save state when the save scope changes.
  useEffect(() => {
    if (resetKeyRef.current === resetKey) {
      return;
    }
    resetKeyRef.current = resetKey;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    lastSavedDataRef.current =
      initialData !== undefined ? initialData : pendingDataRef.current;
    setLastError(null);
    bumpDirtyRevision((prev) => prev + 1);
  }, [resetKey, initialData]);

  // Core save function
  const doSave = useCallback(async (dataToSave: T) => {
    if (!isMountedRef.current) return;

    setIsSaving(true);
    setLastError(null);

    try {
      await onSaveRef.current(dataToSave);
      if (isMountedRef.current) {
        lastSavedDataRef.current = dataToSave;
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
  }, []);

  // Force immediate save
  const forceSave = useCallback(async () => {
    // Cancel any pending debounced save
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    await doSave(pendingDataRef.current);
  }, [doSave]);

  // Schedule debounced save when data changes
  useEffect(() => {
    if (!enabled || !isDirty) return;

    // Cancel previous timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Schedule new save
    timeoutRef.current = setTimeout(() => {
      doSave(pendingDataRef.current);
    }, debounceMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [data, enabled, isDirty, debounceMs, doSave, onSave]);

  // Save on unmount if dirty
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;

      // Cancel pending timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      if (!saveOnUnmountRef.current || !enabledRef.current) {
        return;
      }

      // Save if dirty (fire and forget since we're unmounting)
      const currentData = pendingDataRef.current;
      const lastSaved = lastSavedDataRef.current;
      if (!isEqual(currentData, lastSaved)) {
        const result = onSaveRef.current(currentData);
        // Handle both Promise and non-Promise returns
        if (result && typeof result.catch === 'function') {
          result.catch((error: unknown) => {
            // Log error on unmount save for debugging purposes
            // We can't update state since component is unmounted
            console.error('[useAutoSave] Error during unmount save:', error);
          });
        }
      }
    };
  }, [isEqual]);

  return {
    isSaving,
    lastError,
    forceSave,
    isDirty,
  };
}

/**
 * Default equality check using JSON.stringify.
 */
function defaultIsEqual<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
