/**
 * Tests for blueprint inputs file parsing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseInputsFile } from "./inputs-handler.js";

// Mock the fs module for existsSync
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

// Mock the core parseInputsForDisplay function
vi.mock("@gorenku/core", () => ({
  parseInputsForDisplay: vi.fn(),
}));

import { existsSync } from "node:fs";
import { parseInputsForDisplay } from "@gorenku/core";

describe("parseInputsFile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty inputs for non-existent file", async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await parseInputsFile("/path/to/missing.yaml");

    expect(result).toEqual({ inputs: [] });
    // Should not call core parser when file doesn't exist
    expect(parseInputsForDisplay).not.toHaveBeenCalled();
  });

  it("parses simple key-value pairs", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(parseInputsForDisplay).mockResolvedValue({
      inputs: { title: "Hello World", count: 42 },
      models: [],
    });

    const result = await parseInputsFile("/path/to/inputs.yaml");

    expect(result.inputs).toHaveLength(2);
    expect(result.inputs).toContainEqual({ name: "title", value: "Hello World" });
    expect(result.inputs).toContainEqual({ name: "count", value: 42 });
  });

  it("parses boolean values", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(parseInputsForDisplay).mockResolvedValue({
      inputs: { enabled: true, disabled: false },
      models: [],
    });

    const result = await parseInputsFile("/path/to/inputs.yaml");

    expect(result.inputs).toContainEqual({ name: "enabled", value: true });
    expect(result.inputs).toContainEqual({ name: "disabled", value: false });
  });

  it("handles double-quoted strings with escapes", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(parseInputsForDisplay).mockResolvedValue({
      inputs: { message: "Hello\nWorld" },
      models: [],
    });

    const result = await parseInputsFile("/path/to/inputs.yaml");

    expect(result.inputs[0]).toEqual({ name: "message", value: "Hello\nWorld" });
  });

  it("handles file references preserved as strings", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(parseInputsForDisplay).mockResolvedValue({
      inputs: { image: "file:./input-files/photo.png" },
      models: [],
    });

    const result = await parseInputsFile("/path/to/inputs.yaml");

    // File references should be preserved as strings, not resolved
    expect(result.inputs[0]).toEqual({ name: "image", value: "file:./input-files/photo.png" });
  });

  it("handles array values", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(parseInputsForDisplay).mockResolvedValue({
      inputs: {
        tags: ["tag1", "tag2", "tag3"],
        images: ["file:./input-files/a.png", "file:./input-files/b.png"],
      },
      models: [],
    });

    const result = await parseInputsFile("/path/to/inputs.yaml");

    expect(result.inputs).toContainEqual({ name: "tags", value: ["tag1", "tag2", "tag3"] });
    expect(result.inputs).toContainEqual({
      name: "images",
      value: ["file:./input-files/a.png", "file:./input-files/b.png"],
    });
  });

  it("handles nested objects", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(parseInputsForDisplay).mockResolvedValue({
      inputs: {
        config: { width: 1920, height: 1080 },
      },
      models: [],
    });

    const result = await parseInputsFile("/path/to/inputs.yaml");

    expect(result.inputs[0]).toEqual({
      name: "config",
      value: { width: 1920, height: 1080 },
    });
  });

  it("returns empty on parse error", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(parseInputsForDisplay).mockRejectedValue(new Error("Parse error"));

    const result = await parseInputsFile("/path/to/inputs.yaml");

    expect(result).toEqual({ inputs: [] });
  });
});
