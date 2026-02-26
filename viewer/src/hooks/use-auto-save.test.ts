/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoSave } from './use-auto-save';

describe('useAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not save immediately on mount', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useAutoSave({
        data: { foo: 'bar' },
        onSave,
        initialData: { foo: 'bar' },
      })
    );

    expect(onSave).not.toHaveBeenCalledWith({ value: 'edited' });
  });

  it('does not save when data equals initialData', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useAutoSave({
        data: { foo: 'bar' },
        onSave,
        initialData: { foo: 'bar' },
      })
    );

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves after debounce period when data changes', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const initialData = { foo: 'bar' };

    const { rerender } = renderHook(
      ({ data }) =>
        useAutoSave({
          data,
          onSave,
          debounceMs: 1000,
          initialData,
        }),
      { initialProps: { data: initialData } }
    );

    // Change the data
    rerender({ data: { foo: 'baz' } });

    // Should not save immediately
    expect(onSave).not.toHaveBeenCalled();

    // Advance past debounce time
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(onSave).toHaveBeenCalledWith({ foo: 'baz' });
  });

  it('cancels pending save on new change', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const initialData = { foo: 'bar' };

    const { rerender } = renderHook(
      ({ data }) =>
        useAutoSave({
          data,
          onSave,
          debounceMs: 1000,
          initialData,
        }),
      { initialProps: { data: initialData } }
    );

    // First change
    rerender({ data: { foo: 'change1' } });

    // Advance partially
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    // Second change before debounce completes
    rerender({ data: { foo: 'change2' } });

    // Advance past first debounce would have fired
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    // Should not have saved yet (debounce restarted)
    expect(onSave).not.toHaveBeenCalled();

    // Advance to complete second debounce
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ foo: 'change2' });
  });

  it('tracks isSaving state during save', async () => {
    let resolvePromise: () => void;
    const savePromise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    const onSave = vi.fn().mockReturnValue(savePromise);
    const initialData = { foo: 'bar' };

    const { result, rerender } = renderHook(
      ({ data }) =>
        useAutoSave({
          data,
          onSave,
          debounceMs: 100,
          initialData,
        }),
      { initialProps: { data: initialData } }
    );

    expect(result.current.isSaving).toBe(false);

    // Change data to trigger save
    rerender({ data: { foo: 'baz' } });

    // Advance past debounce
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.isSaving).toBe(true);

    // Resolve the save
    await act(async () => {
      resolvePromise!();
    });

    expect(result.current.isSaving).toBe(false);
  });

  it('captures save errors in lastError', async () => {
    const saveError = new Error('Save failed');
    const onSave = vi.fn().mockRejectedValue(saveError);
    const initialData = { foo: 'bar' };

    const { result, rerender } = renderHook(
      ({ data }) =>
        useAutoSave({
          data,
          onSave,
          debounceMs: 100,
          initialData,
        }),
      { initialProps: { data: initialData } }
    );

    expect(result.current.lastError).toBeNull();

    // Change data to trigger save
    rerender({ data: { foo: 'baz' } });

    // Advance and wait for save to fail
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.lastError).toBe(saveError);
  });

  it('respects enabled flag', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const initialData = { foo: 'bar' };

    const { rerender } = renderHook(
      ({ data, enabled }) =>
        useAutoSave({
          data,
          onSave,
          debounceMs: 100,
          initialData,
          enabled,
        }),
      { initialProps: { data: initialData, enabled: false } }
    );

    // Change data with enabled=false
    rerender({ data: { foo: 'baz' }, enabled: false });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('forceSave bypasses debounce', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const initialData = { foo: 'bar' };

    const { result, rerender } = renderHook(
      ({ data }) =>
        useAutoSave({
          data,
          onSave,
          debounceMs: 10000, // Long debounce
          initialData,
        }),
      { initialProps: { data: initialData } }
    );

    // Change data
    rerender({ data: { foo: 'baz' } });

    // Force save immediately
    await act(async () => {
      await result.current.forceSave();
    });

    expect(onSave).toHaveBeenCalledWith({ foo: 'baz' });
  });

  it('reports isDirty correctly', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const initialData = { foo: 'bar' };

    const { result, rerender } = renderHook(
      ({ data }) =>
        useAutoSave({
          data,
          onSave,
          initialData,
        }),
      { initialProps: { data: initialData } }
    );

    expect(result.current.isDirty).toBe(false);

    // Change data
    rerender({ data: { foo: 'baz' } });

    expect(result.current.isDirty).toBe(true);
  });

  it('saves dirty data on unmount', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const initialData = { foo: 'bar' };

    const { rerender, unmount } = renderHook(
      ({ data }) =>
        useAutoSave({
          data,
          onSave,
          debounceMs: 10000, // Long debounce so it won't auto-save before unmount
          initialData,
        }),
      { initialProps: { data: initialData } }
    );

    // Change data
    rerender({ data: { foo: 'baz' } });

    // Unmount before debounce completes
    unmount();

    // Should trigger save on unmount
    expect(onSave).toHaveBeenCalledWith({ foo: 'baz' });
  });

  it('logs error when unmount save fails', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const saveError = new Error('Unmount save failed');
    const onSave = vi.fn().mockRejectedValue(saveError);
    const initialData = { foo: 'bar' };

    const { rerender, unmount } = renderHook(
      ({ data }) =>
        useAutoSave({
          data,
          onSave,
          debounceMs: 10000,
          initialData,
        }),
      { initialProps: { data: initialData } }
    );

    // Change data
    rerender({ data: { foo: 'baz' } });

    // Unmount
    unmount();

    // Wait for the promise rejection to be handled
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Should have logged the error
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[useAutoSave] Error during unmount save:',
      saveError
    );

    consoleErrorSpy.mockRestore();
  });

  it('does not save on unmount when data is not dirty', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const initialData = { foo: 'bar' };

    const { unmount } = renderHook(() =>
      useAutoSave({
        data: initialData,
        onSave,
        initialData,
      })
    );

    // Unmount without changing data
    unmount();

    // Should not trigger save
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not save on unmount when saveOnUnmount is false', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const initialData = { foo: 'bar' };

    const { rerender, unmount } = renderHook(
      ({ data }) =>
        useAutoSave({
          data,
          onSave,
          initialData,
          saveOnUnmount: false,
        }),
      { initialProps: { data: initialData } }
    );

    rerender({ data: { foo: 'baz' } });
    unmount();

    expect(onSave).not.toHaveBeenCalled();
  });

  it('re-baselines when initialData changes', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    const { result, rerender } = renderHook(
      ({ data, initialData }) =>
        useAutoSave({
          data,
          onSave,
          initialData,
          debounceMs: 100,
        }),
      {
        initialProps: {
          data: { value: 'a' },
          initialData: { value: 'a' },
        },
      }
    );

    expect(result.current.isDirty).toBe(false);

    rerender({ data: { value: 'a' }, initialData: { value: 'a' } });
    expect(result.current.isDirty).toBe(false);

    rerender({ data: { value: 'b' }, initialData: { value: 'b' } });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.isDirty).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(onSave).not.toHaveBeenCalledWith({ value: 'edited' });
  });

  it('cancels pending save when resetKey changes', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({ data, initialData, resetKey }) =>
        useAutoSave({
          data,
          onSave,
          debounceMs: 1000,
          initialData,
          resetKey,
        }),
      {
        initialProps: {
          data: { value: 'a' },
          initialData: { value: 'a' },
          resetKey: 'build-1',
        },
      }
    );

    rerender({
      data: { value: 'edited' },
      initialData: { value: 'a' },
      resetKey: 'build-1',
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    rerender({
      data: { value: 'template' },
      initialData: { value: 'template' },
      resetKey: 'build-2',
    });

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('handles non-Error thrown values during save', async () => {
    const onSave = vi.fn().mockRejectedValue('string error');
    const initialData = { foo: 'bar' };

    const { result, rerender } = renderHook(
      ({ data }) =>
        useAutoSave({
          data,
          onSave,
          debounceMs: 100,
          initialData,
        }),
      { initialProps: { data: initialData } }
    );

    // Change data to trigger save
    rerender({ data: { foo: 'baz' } });

    // Advance and wait for save to fail
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    // Should convert non-Error to Error
    expect(result.current.lastError).toBeInstanceOf(Error);
    expect(result.current.lastError?.message).toBe('string error');
  });
});
