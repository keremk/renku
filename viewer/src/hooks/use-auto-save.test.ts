/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutoSave } from "./use-auto-save";

describe("useAutoSave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not save immediately on mount", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useAutoSave({
        data: { foo: "bar" },
        onSave,
        initialData: { foo: "bar" },
      })
    );

    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not save when data equals initialData", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useAutoSave({
        data: { foo: "bar" },
        onSave,
        initialData: { foo: "bar" },
      })
    );

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves after debounce period when data changes", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const initialData = { foo: "bar" };

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
    rerender({ data: { foo: "baz" } });

    // Should not save immediately
    expect(onSave).not.toHaveBeenCalled();

    // Advance past debounce time
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(onSave).toHaveBeenCalledWith({ foo: "baz" });
  });

  it("cancels pending save on new change", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const initialData = { foo: "bar" };

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
    rerender({ data: { foo: "change1" } });

    // Advance partially
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    // Second change before debounce completes
    rerender({ data: { foo: "change2" } });

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
    expect(onSave).toHaveBeenCalledWith({ foo: "change2" });
  });

  it("tracks isSaving state during save", async () => {
    let resolvePromise: () => void;
    const savePromise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    const onSave = vi.fn().mockReturnValue(savePromise);
    const initialData = { foo: "bar" };

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
    rerender({ data: { foo: "baz" } });

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

  it("captures save errors in lastError", async () => {
    const saveError = new Error("Save failed");
    const onSave = vi.fn().mockRejectedValue(saveError);
    const initialData = { foo: "bar" };

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
    rerender({ data: { foo: "baz" } });

    // Advance and wait for save to fail
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.lastError).toBe(saveError);
  });

  it("respects enabled flag", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const initialData = { foo: "bar" };

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
    rerender({ data: { foo: "baz" }, enabled: false });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(onSave).not.toHaveBeenCalled();
  });

  it("forceSave bypasses debounce", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const initialData = { foo: "bar" };

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
    rerender({ data: { foo: "baz" } });

    // Force save immediately
    await act(async () => {
      await result.current.forceSave();
    });

    expect(onSave).toHaveBeenCalledWith({ foo: "baz" });
  });

  it("reports isDirty correctly", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const initialData = { foo: "bar" };

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
    rerender({ data: { foo: "baz" } });

    expect(result.current.isDirty).toBe(true);
  });
});
