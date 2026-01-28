/**
 * Tests for build creation handler.
 */

import { describe, it, expect } from "vitest";
import { generateMovieId } from "./create-handler.js";

describe("generateMovieId", () => {
  it("generates movie-prefixed IDs", () => {
    const id = generateMovieId();
    expect(id).toMatch(/^movie-[a-z0-9]{6}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateMovieId());
    }
    // Should have high probability of all being unique
    expect(ids.size).toBeGreaterThan(95);
  });

  it("uses only lowercase letters and numbers", () => {
    for (let i = 0; i < 50; i++) {
      const id = generateMovieId();
      const suffix = id.slice(6); // Remove "movie-" prefix
      expect(suffix).toMatch(/^[a-z0-9]+$/);
    }
  });
});
