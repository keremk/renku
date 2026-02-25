/**
 * Tests for the blueprint list handler.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the generation config module
vi.mock("../generation/index.js", () => ({
  readCliConfig: vi.fn(),
}));

// Mock node:fs/promises
vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  access: vi.fn(),
}));

import { readCliConfig } from "../generation/index.js";
import { readdir, access } from "node:fs/promises";
import { listBlueprints } from "./list-handler.js";

function makeDirent(name: string, isDir: boolean) {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    parentPath: "/storage",
    path: "/storage",
  };
}

describe("listBlueprints", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when CLI config is missing", async () => {
    vi.mocked(readCliConfig).mockResolvedValue(null);

    await expect(listBlueprints()).rejects.toThrow(
      'Renku CLI is not initialized'
    );
  });

  it("returns blueprint directories sorted alphabetically", async () => {
    vi.mocked(readCliConfig).mockResolvedValue({
      storage: { root: "/storage", basePath: "/storage" },
    });
    vi.mocked(readdir).mockResolvedValue([
      makeDirent("zebra-video", true),
      makeDirent("alpha-movie", true),
      makeDirent("mid-project", true),
    ] as never);
    // All have matching YAML files
    vi.mocked(access).mockResolvedValue(undefined);

    const result = await listBlueprints();

    expect(result.blueprints).toEqual([
      { name: "alpha-movie" },
      { name: "mid-project" },
      { name: "zebra-video" },
    ]);
  });

  it("excludes non-directory entries", async () => {
    vi.mocked(readCliConfig).mockResolvedValue({
      storage: { root: "/storage", basePath: "/storage" },
    });
    vi.mocked(readdir).mockResolvedValue([
      makeDirent("my-blueprint", true),
      makeDirent("some-file.txt", false),
    ] as never);
    vi.mocked(access).mockResolvedValue(undefined);

    const result = await listBlueprints();

    expect(result.blueprints).toEqual([{ name: "my-blueprint" }]);
  });

  it("excludes directories without matching YAML file", async () => {
    vi.mocked(readCliConfig).mockResolvedValue({
      storage: { root: "/storage", basePath: "/storage" },
    });
    vi.mocked(readdir).mockResolvedValue([
      makeDirent("valid-bp", true),
      makeDirent("no-yaml-dir", true),
    ] as never);
    // First call succeeds (valid-bp), second throws (no-yaml-dir)
    vi.mocked(access)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("ENOENT"));

    const result = await listBlueprints();

    expect(result.blueprints).toEqual([{ name: "valid-bp" }]);
  });

  it("returns empty list when no blueprints exist", async () => {
    vi.mocked(readCliConfig).mockResolvedValue({
      storage: { root: "/storage", basePath: "/storage" },
    });
    vi.mocked(readdir).mockResolvedValue([] as never);

    const result = await listBlueprints();

    expect(result.blueprints).toEqual([]);
  });
});
