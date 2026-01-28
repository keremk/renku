/**
 * Tests for blueprint inputs file parsing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseInputsFile } from "./inputs-handler.js";

// Mock the fs module
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    existsSync: vi.fn(),
    promises: {
      readFile: vi.fn(),
    },
  };
});

import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";

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
  });

  it("parses simple key-value pairs", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(fs.readFile).mockResolvedValue("title: Hello World\ncount: 42");

    const result = await parseInputsFile("/path/to/inputs.yaml");

    expect(result.inputs).toHaveLength(2);
    expect(result.inputs[0]).toEqual({ name: "title", value: "Hello World" });
    expect(result.inputs[1]).toEqual({ name: "count", value: 42 });
  });

  it("parses boolean values", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(fs.readFile).mockResolvedValue("enabled: true\ndisabled: false");

    const result = await parseInputsFile("/path/to/inputs.yaml");

    expect(result.inputs).toContainEqual({ name: "enabled", value: true });
    expect(result.inputs).toContainEqual({ name: "disabled", value: false });
  });

  it("handles double-quoted strings with escapes", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(fs.readFile).mockResolvedValue('message: "Hello\\nWorld"');

    const result = await parseInputsFile("/path/to/inputs.yaml");

    expect(result.inputs[0]).toEqual({ name: "message", value: "Hello\nWorld" });
  });

  it("handles single-quoted strings without escapes", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(fs.readFile).mockResolvedValue("message: 'Hello\\nWorld'");

    const result = await parseInputsFile("/path/to/inputs.yaml");

    expect(result.inputs[0]).toEqual({ name: "message", value: "Hello\\nWorld" });
  });

  it("skips comments and empty lines", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(fs.readFile).mockResolvedValue("# This is a comment\n\ntitle: Test\n  # Another comment");

    const result = await parseInputsFile("/path/to/inputs.yaml");

    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0]).toEqual({ name: "title", value: "Test" });
  });

  it("returns empty on parse error", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(fs.readFile).mockRejectedValue(new Error("Read error"));

    const result = await parseInputsFile("/path/to/inputs.yaml");

    expect(result).toEqual({ inputs: [] });
  });
});
