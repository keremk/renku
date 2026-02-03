/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useModelSelectionEditor } from "./use-model-selection-editor";
import type { ModelSelectionValue } from "@/types/blueprint-graph";

// Test data factory
function makeSelection(
  producerId: string,
  provider = "openai",
  model = "gpt-4",
  config?: Record<string, unknown>
): ModelSelectionValue {
  return { producerId, provider, model, config };
}

describe("useModelSelectionEditor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("initial state", () => {
    it("returns savedSelections as currentSelections initially", () => {
      const saved = [makeSelection("producer1"), makeSelection("producer2")];
      const onSave = vi.fn();

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave })
      );

      expect(result.current.currentSelections).toEqual(saved);
      expect(result.current.isDirty).toBe(false);
      expect(result.current.isSaving).toBe(false);
      expect(result.current.lastError).toBeNull();
    });

    it("starts with isDirty false", () => {
      const saved = [makeSelection("producer1")];
      const onSave = vi.fn();

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave })
      );

      expect(result.current.isDirty).toBe(false);
    });
  });

  describe("updateSelection", () => {
    it("updates currentSelections immediately", () => {
      const saved = [makeSelection("producer1", "openai", "gpt-4")];
      const onSave = vi.fn();

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave })
      );

      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      expect(result.current.currentSelections[0].provider).toBe("anthropic");
      expect(result.current.currentSelections[0].model).toBe("claude-3");
    });

    it("sets isDirty to true after update", () => {
      const saved = [makeSelection("producer1")];
      const onSave = vi.fn();

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave })
      );

      expect(result.current.isDirty).toBe(false);

      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      expect(result.current.isDirty).toBe(true);
    });

    it("preserves other selections when updating one", () => {
      const saved = [
        makeSelection("producer1", "openai", "gpt-4"),
        makeSelection("producer2", "replicate", "llama"),
      ];
      const onSave = vi.fn();

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave })
      );

      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      expect(result.current.currentSelections[0].provider).toBe("anthropic");
      expect(result.current.currentSelections[1].provider).toBe("replicate");
    });

    it("clears config when model changes", () => {
      const saved = [
        makeSelection("producer1", "openai", "dall-e-3", { quality: "hd" }),
      ];
      const onSave = vi.fn();

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave })
      );

      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "replicate", "sdxl", {})
        );
      });

      expect(result.current.currentSelections[0].config).toEqual({});
    });
  });

  describe("updateConfig", () => {
    it("updates config property in currentSelections", () => {
      const saved = [makeSelection("producer1", "openai", "dall-e-3")];
      const onSave = vi.fn();

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave })
      );

      act(() => {
        result.current.updateConfig("producer1", "quality", "hd");
      });

      expect(result.current.currentSelections[0].config?.quality).toBe("hd");
    });

    it("preserves other config properties", () => {
      const saved = [
        makeSelection("producer1", "openai", "dall-e-3", {
          quality: "standard",
          size: "1024x1024",
        }),
      ];
      const onSave = vi.fn();

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave })
      );

      act(() => {
        result.current.updateConfig("producer1", "quality", "hd");
      });

      expect(result.current.currentSelections[0].config).toEqual({
        quality: "hd",
        size: "1024x1024",
      });
    });

    it("sets isDirty to true after config change", () => {
      const saved = [makeSelection("producer1")];
      const onSave = vi.fn();

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave })
      );

      act(() => {
        result.current.updateConfig("producer1", "temperature", 0.7);
      });

      expect(result.current.isDirty).toBe(true);
    });

    it("works when producer has existing edits", () => {
      const saved = [makeSelection("producer1", "openai", "gpt-4")];
      const onSave = vi.fn();

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave })
      );

      // First update model
      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      // Then update config
      act(() => {
        result.current.updateConfig("producer1", "temperature", 0.5);
      });

      expect(result.current.currentSelections[0].provider).toBe("anthropic");
      expect(result.current.currentSelections[0].config?.temperature).toBe(0.5);
    });

    it("ignores update for unknown producer", () => {
      const saved = [makeSelection("producer1")];
      const onSave = vi.fn();

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave })
      );

      act(() => {
        result.current.updateConfig("unknown", "key", "value");
      });

      // Should not crash, selections unchanged
      expect(result.current.currentSelections).toEqual(saved);
      expect(result.current.isDirty).toBe(false);
    });
  });

  describe("save", () => {
    it("calls onSave with merged selections", async () => {
      const saved = [makeSelection("producer1", "openai", "gpt-4")];
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave })
      );

      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      await act(async () => {
        await result.current.save();
      });

      expect(onSave).toHaveBeenCalledWith([
        expect.objectContaining({ provider: "anthropic", model: "claude-3" }),
      ]);
    });

    it("sets isSaving during save", async () => {
      let resolvePromise: () => void;
      const savePromise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
      const onSave = vi.fn().mockReturnValue(savePromise);
      const saved = [makeSelection("producer1")];

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave })
      );

      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      // Start save
      let savePromiseResult: Promise<void>;
      act(() => {
        savePromiseResult = result.current.save();
      });

      expect(result.current.isSaving).toBe(true);

      // Complete save
      await act(async () => {
        resolvePromise!();
        await savePromiseResult;
      });

      expect(result.current.isSaving).toBe(false);
    });

    it("clears edits after successful save", async () => {
      const saved = [makeSelection("producer1", "openai", "gpt-4")];
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave })
      );

      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      expect(result.current.isDirty).toBe(true);

      await act(async () => {
        await result.current.save();
      });

      expect(result.current.isDirty).toBe(false);
    });

    it("sets lastError on save failure", async () => {
      const saveError = new Error("Save failed");
      const onSave = vi.fn().mockRejectedValue(saveError);
      const saved = [makeSelection("producer1")];

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave })
      );

      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      await act(async () => {
        await result.current.save();
      });

      expect(result.current.lastError).toBe(saveError);
      expect(result.current.isDirty).toBe(true); // Still dirty after failure
    });

    it("handles non-Error thrown values", async () => {
      const onSave = vi.fn().mockRejectedValue("string error");
      const saved = [makeSelection("producer1")];

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave })
      );

      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      await act(async () => {
        await result.current.save();
      });

      expect(result.current.lastError).toBeInstanceOf(Error);
      expect(result.current.lastError?.message).toBe("string error");
    });
  });

  describe("reset", () => {
    it("clears all edits", () => {
      const saved = [makeSelection("producer1", "openai", "gpt-4")];
      const onSave = vi.fn();

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave })
      );

      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      expect(result.current.isDirty).toBe(true);

      act(() => {
        result.current.reset();
      });

      expect(result.current.isDirty).toBe(false);
      expect(result.current.currentSelections).toEqual(saved);
    });

    it("clears lastError", async () => {
      const onSave = vi.fn().mockRejectedValue(new Error("fail"));
      const saved = [makeSelection("producer1")];

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave })
      );

      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      // Trigger save failure
      await act(async () => {
        await result.current.save();
      });

      expect(result.current.lastError).not.toBeNull();

      act(() => {
        result.current.reset();
      });

      expect(result.current.lastError).toBeNull();
    });
  });

  describe("savedSelections change", () => {
    it("resets edits when savedSelections changes", () => {
      const saved1 = [makeSelection("producer1", "openai", "gpt-4")];
      const saved2 = [makeSelection("producer1", "replicate", "llama")];
      const onSave = vi.fn();

      const { result, rerender } = renderHook(
        ({ saved }) => useModelSelectionEditor({ savedSelections: saved, onSave }),
        { initialProps: { saved: saved1 } }
      );

      // Make an edit
      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      expect(result.current.isDirty).toBe(true);

      // Change savedSelections (simulating build change)
      rerender({ saved: saved2 });

      expect(result.current.isDirty).toBe(false);
      expect(result.current.currentSelections).toEqual(saved2);
    });

    it("does not reset edits when savedSelections is same value", () => {
      const saved = [makeSelection("producer1", "openai", "gpt-4")];
      const onSave = vi.fn();

      const { result, rerender } = renderHook(
        ({ saved }) => useModelSelectionEditor({ savedSelections: saved, onSave }),
        { initialProps: { saved } }
      );

      // Make an edit
      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      // Rerender with same value (new array reference but same content)
      rerender({ saved: [...saved] });

      // Edit should still be preserved
      expect(result.current.isDirty).toBe(true);
      expect(result.current.currentSelections[0].provider).toBe("anthropic");
    });
  });

  describe("unmount behavior", () => {
    it("does not update state after unmount", async () => {
      let resolvePromise: () => void;
      const savePromise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
      const onSave = vi.fn().mockReturnValue(savePromise);
      const saved = [makeSelection("producer1")];

      const { result, unmount } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave })
      );

      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      // Start save
      act(() => {
        result.current.save();
      });

      // Unmount before save completes
      unmount();

      // Complete save - should not crash
      await act(async () => {
        resolvePromise!();
      });

      // Test passes if no error thrown
    });
  });

  describe("isDirty edge cases", () => {
    it("isDirty is false after editing back to original value", () => {
      const saved = [makeSelection("producer1", "openai", "gpt-4")];
      const onSave = vi.fn();

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave })
      );

      // Edit to different value
      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      expect(result.current.isDirty).toBe(true);

      // Edit back to original
      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "openai", "gpt-4")
        );
      });

      expect(result.current.isDirty).toBe(false);
    });
  });

  describe("auto-save", () => {
    it("triggers save after debounce period", async () => {
      const saved = [makeSelection("producer1", "openai", "gpt-4")];
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave, debounceMs: 500 })
      );

      // Make an edit
      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      // onSave should not be called immediately
      expect(onSave).not.toHaveBeenCalled();

      // Advance time by less than debounce
      await act(async () => {
        vi.advanceTimersByTime(400);
      });

      expect(onSave).not.toHaveBeenCalled();

      // Advance time past debounce
      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith([
        expect.objectContaining({ provider: "anthropic", model: "claude-3" }),
      ]);
    });

    it("uses default debounceMs of 1000", async () => {
      const saved = [makeSelection("producer1", "openai", "gpt-4")];
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave })
      );

      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      // Advance time by 900ms (less than default 1000ms)
      await act(async () => {
        vi.advanceTimersByTime(900);
      });

      expect(onSave).not.toHaveBeenCalled();

      // Advance past default debounce
      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it("debounces multiple rapid updates into single save", async () => {
      const saved = [makeSelection("producer1", "openai", "gpt-4")];
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave, debounceMs: 500 })
      );

      // Make multiple rapid edits
      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "replicate", "llama")
        );
      });

      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "openai", "gpt-4o")
        );
      });

      // No save yet
      expect(onSave).not.toHaveBeenCalled();

      // Advance past debounce from last edit
      await act(async () => {
        vi.advanceTimersByTime(600);
      });

      // Only one save call with final value
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith([
        expect.objectContaining({ provider: "openai", model: "gpt-4o" }),
      ]);
    });

    it("manual save() cancels pending auto-save", async () => {
      const saved = [makeSelection("producer1", "openai", "gpt-4")];
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave, debounceMs: 500 })
      );

      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      // Call manual save before debounce expires
      await act(async () => {
        vi.advanceTimersByTime(200);
        await result.current.save();
      });

      expect(onSave).toHaveBeenCalledTimes(1);

      // Advance past original debounce time
      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      // Should not trigger another save
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it("reset() cancels pending auto-save", async () => {
      const saved = [makeSelection("producer1", "openai", "gpt-4")];
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave, debounceMs: 500 })
      );

      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      // Reset before debounce expires
      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      act(() => {
        result.current.reset();
      });

      // Advance past original debounce time
      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      // Should not trigger save
      expect(onSave).not.toHaveBeenCalled();
    });

    it("cancels pending auto-save when savedSelections changes", async () => {
      const saved1 = [makeSelection("producer1", "openai", "gpt-4")];
      const saved2 = [makeSelection("producer1", "replicate", "llama")];
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { result, rerender } = renderHook(
        ({ saved }) =>
          useModelSelectionEditor({ savedSelections: saved, onSave, debounceMs: 500 }),
        { initialProps: { saved: saved1 } }
      );

      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      // Advance partway through debounce
      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      // Change savedSelections (simulating build change)
      rerender({ saved: saved2 });

      // Advance past original debounce time
      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      // Should not trigger save for the cancelled edit
      expect(onSave).not.toHaveBeenCalled();
    });

    it("cancels pending auto-save on unmount", async () => {
      const saved = [makeSelection("producer1", "openai", "gpt-4")];
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { result, unmount } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave, debounceMs: 500 })
      );

      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      // Advance partway through debounce
      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      // Unmount
      unmount();

      // Advance past debounce time
      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      // Should not trigger save
      expect(onSave).not.toHaveBeenCalled();
    });

    it("does not auto-save when editing back to original value", async () => {
      const saved = [makeSelection("producer1", "openai", "gpt-4")];
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave, debounceMs: 500 })
      );

      // Edit to different value
      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      // Edit back to original before debounce
      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "openai", "gpt-4")
        );
      });

      // Advance past debounce time
      await act(async () => {
        vi.advanceTimersByTime(600);
      });

      // Should not trigger save since isDirty is false
      expect(onSave).not.toHaveBeenCalled();
    });

    it("clears edits after successful auto-save", async () => {
      const saved = [makeSelection("producer1", "openai", "gpt-4")];
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave, debounceMs: 500 })
      );

      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      expect(result.current.isDirty).toBe(true);

      // Trigger auto-save
      await act(async () => {
        vi.advanceTimersByTime(600);
      });

      expect(result.current.isDirty).toBe(false);
    });

    it("sets lastError on auto-save failure", async () => {
      const saved = [makeSelection("producer1", "openai", "gpt-4")];
      const saveError = new Error("Auto-save failed");
      const onSave = vi.fn().mockRejectedValue(saveError);

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave, debounceMs: 500 })
      );

      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      // Trigger auto-save
      await act(async () => {
        vi.advanceTimersByTime(600);
      });

      expect(result.current.lastError).toBe(saveError);
      expect(result.current.isDirty).toBe(true); // Still dirty after failure
    });

    it("sets isSaving during auto-save", async () => {
      let resolvePromise: () => void;
      const savePromise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
      const onSave = vi.fn().mockReturnValue(savePromise);
      const saved = [makeSelection("producer1", "openai", "gpt-4")];

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave, debounceMs: 500 })
      );

      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      // Trigger auto-save but don't resolve yet
      await act(async () => {
        vi.advanceTimersByTime(600);
      });

      expect(result.current.isSaving).toBe(true);

      // Resolve save
      await act(async () => {
        resolvePromise!();
      });

      expect(result.current.isSaving).toBe(false);
    });

    it("auto-saves config changes", async () => {
      const saved = [makeSelection("producer1", "openai", "gpt-4")];
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave, debounceMs: 500 })
      );

      act(() => {
        result.current.updateConfig("producer1", "temperature", 0.7);
      });

      // Trigger auto-save
      await act(async () => {
        vi.advanceTimersByTime(600);
      });

      expect(onSave).toHaveBeenCalledWith([
        expect.objectContaining({
          producerId: "producer1",
          config: { temperature: 0.7 },
        }),
      ]);
    });
  });

  describe("custom isEqual", () => {
    it("uses custom equality function for dirty check", () => {
      const saved = [makeSelection("producer1", "openai", "gpt-4")];
      const onSave = vi.fn();

      // Custom equality that only checks provider
      const customIsEqual = (a: ModelSelectionValue[], b: ModelSelectionValue[]) => {
        if (a.length !== b.length) return false;
        return a.every((sel, i) => sel.provider === b[i].provider);
      };

      const { result } = renderHook(() =>
        useModelSelectionEditor({
          savedSelections: saved,
          onSave,
          isEqual: customIsEqual,
        })
      );

      // Change model but keep provider - should not be dirty with custom equality
      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "openai", "gpt-4-turbo")
        );
      });

      expect(result.current.isDirty).toBe(false);

      // Change provider - should be dirty
      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      expect(result.current.isDirty).toBe(true);
    });

    it("uses custom equality function for savedSelections change detection", () => {
      const saved1 = [makeSelection("producer1", "openai", "gpt-4")];
      const saved2 = [makeSelection("producer1", "openai", "gpt-4-turbo")];
      const onSave = vi.fn();

      // Custom equality that only checks provider
      const customIsEqual = (a: ModelSelectionValue[], b: ModelSelectionValue[]) => {
        if (a.length !== b.length) return false;
        return a.every((sel, i) => sel.provider === b[i].provider);
      };

      const { result, rerender } = renderHook(
        ({ saved }) =>
          useModelSelectionEditor({
            savedSelections: saved,
            onSave,
            isEqual: customIsEqual,
          }),
        { initialProps: { saved: saved1 } }
      );

      // Make an edit
      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
      });

      expect(result.current.isDirty).toBe(true);

      // Change savedSelections but only model (same provider)
      // With custom equality, this should NOT reset edits
      rerender({ saved: saved2 });

      // Edit should still be preserved
      expect(result.current.isDirty).toBe(true);
      expect(result.current.currentSelections[0].provider).toBe("anthropic");
    });
  });

  describe("multiple producers", () => {
    it("handles edits to multiple producers correctly", async () => {
      const saved = [
        makeSelection("producer1", "openai", "gpt-4"),
        makeSelection("producer2", "replicate", "llama"),
        makeSelection("producer3", "anthropic", "claude-3"),
      ];
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave, debounceMs: 500 })
      );

      // Edit two producers
      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3.5")
        );
      });

      act(() => {
        result.current.updateConfig("producer2", "max_tokens", 1000);
      });

      // Trigger auto-save
      await act(async () => {
        vi.advanceTimersByTime(600);
      });

      expect(onSave).toHaveBeenCalledWith([
        expect.objectContaining({ producerId: "producer1", provider: "anthropic" }),
        expect.objectContaining({ producerId: "producer2", config: { max_tokens: 1000 } }),
        expect.objectContaining({ producerId: "producer3", provider: "anthropic" }),
      ]);
    });

    it("reset clears edits for all producers", () => {
      const saved = [
        makeSelection("producer1", "openai", "gpt-4"),
        makeSelection("producer2", "replicate", "llama"),
      ];
      const onSave = vi.fn();

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: saved, onSave })
      );

      // Edit both producers
      act(() => {
        result.current.updateSelection(
          makeSelection("producer1", "anthropic", "claude-3")
        );
        result.current.updateSelection(
          makeSelection("producer2", "openai", "dall-e-3")
        );
      });

      expect(result.current.isDirty).toBe(true);

      act(() => {
        result.current.reset();
      });

      expect(result.current.isDirty).toBe(false);
      expect(result.current.currentSelections).toEqual(saved);
    });
  });

  describe("empty selections", () => {
    it("handles empty savedSelections array", () => {
      const onSave = vi.fn();

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: [], onSave })
      );

      expect(result.current.currentSelections).toEqual([]);
      expect(result.current.isDirty).toBe(false);
    });

    it("updateConfig does nothing with empty savedSelections", () => {
      const onSave = vi.fn();

      const { result } = renderHook(() =>
        useModelSelectionEditor({ savedSelections: [], onSave })
      );

      act(() => {
        result.current.updateConfig("nonexistent", "key", "value");
      });

      expect(result.current.currentSelections).toEqual([]);
      expect(result.current.isDirty).toBe(false);
    });
  });
});
