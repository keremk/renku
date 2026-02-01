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
});
