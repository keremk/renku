/**
 * Tests for stream utilities.
 */

import { describe, it, expect } from "vitest";
import {
  formatBlobFileName,
  inferExtension,
  resolveMovieDir,
} from "./stream-utils.js";

describe("inferExtension", () => {
  it("returns known extensions for common MIME types", () => {
    expect(inferExtension("audio/mpeg")).toBe("mp3");
    expect(inferExtension("audio/wav")).toBe("wav");
    expect(inferExtension("video/mp4")).toBe("mp4");
    expect(inferExtension("image/png")).toBe("png");
    expect(inferExtension("image/jpeg")).toBe("jpg");
    expect(inferExtension("application/json")).toBe("json");
  });

  it("handles case-insensitive MIME types", () => {
    expect(inferExtension("Audio/MPEG")).toBe("mp3");
    expect(inferExtension("VIDEO/MP4")).toBe("mp4");
  });

  it("extracts extension from unknown audio/video/image types", () => {
    expect(inferExtension("audio/aiff")).toBe("aiff");
    expect(inferExtension("video/avi")).toBe("avi");
    expect(inferExtension("image/bmp")).toBe("bmp");
  });

  it("returns null for undefined or octet-stream", () => {
    expect(inferExtension(undefined)).toBeNull();
    expect(inferExtension("application/octet-stream")).toBeNull();
  });

  it("returns null for unknown types without media prefix", () => {
    expect(inferExtension("text/html")).toBeNull();
    expect(inferExtension("application/pdf")).toBeNull();
  });
});

describe("formatBlobFileName", () => {
  it("returns hash alone when no extension", () => {
    expect(formatBlobFileName("abc123")).toBe("abc123");
    expect(formatBlobFileName("abc123", undefined)).toBe("abc123");
  });

  it("appends extension based on MIME type", () => {
    expect(formatBlobFileName("abc123", "image/png")).toBe("abc123.png");
    expect(formatBlobFileName("abc123", "video/mp4")).toBe("abc123.mp4");
  });

  it("does not double-append extension", () => {
    expect(formatBlobFileName("abc123.png", "image/png")).toBe("abc123.png");
  });

  it("sanitizes hash by removing non-hex characters", () => {
    expect(formatBlobFileName("abc123!@#$def", "image/png")).toBe("abc123def.png");
  });
});

describe("resolveMovieDir", () => {
  it("resolves movie directory path", () => {
    const result = resolveMovieDir("/root/builds", "movie-abc123");
    expect(result).toBe("/root/builds/movie-abc123");
  });

  it("throws on path traversal attempt", () => {
    expect(() => resolveMovieDir("/root/builds", "../etc/passwd")).toThrow("Invalid movie path");
  });
});

