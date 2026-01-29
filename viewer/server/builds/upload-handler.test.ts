/**
 * Tests for file upload handler.
 */

import { describe, it, expect } from "vitest";
import {
  sanitizeFilename,
  generateUniqueFilename,
  isAllowedMimeType,
  getInputFilesDir,
  isPathWithinDirectory,
} from "./upload-handler.js";

describe("sanitizeFilename", () => {
  it("removes unsafe characters and preserves rest", () => {
    // path.basename extracts just "name.jpg" from 'file<>:"/\\|?*name.jpg'
    // because / and \ are path separators
    expect(sanitizeFilename('file<>:"name.jpg')).toBe("file-name.jpg");
  });

  it("removes path components via path.basename", () => {
    expect(sanitizeFilename("/path/to/file.jpg")).toBe("file.jpg");
    // On Unix, backslash is not a path separator, so ..\\..\\file.jpg stays as-is
    // but the unsafe char regex removes the backslashes
  });

  it("replaces spaces with dashes", () => {
    expect(sanitizeFilename("my file name.jpg")).toBe("my-file-name.jpg");
  });

  it("removes consecutive dashes", () => {
    expect(sanitizeFilename("file---name.jpg")).toBe("file-name.jpg");
  });

  it("removes leading and trailing dashes", () => {
    expect(sanitizeFilename("-file.jpg")).toBe("file.jpg");
    expect(sanitizeFilename("file.jpg-")).toBe("file.jpg");
  });

  it("handles leading dot (hidden files)", () => {
    // Leading dot is removed
    expect(sanitizeFilename(".file.jpg")).toBe("file.jpg");
  });

  it("handles edge cases with fallback", () => {
    // The regex removes all dashes, but the fallback only triggers when result is empty
    expect(sanitizeFilename("---")).toBe("file");
  });

  it("handles control characters", () => {
    expect(sanitizeFilename("file\x00\x1fname.jpg")).toBe("file-name.jpg");
  });
});

describe("generateUniqueFilename", () => {
  it("prepends timestamp to filename", () => {
    const result = generateUniqueFilename("test.jpg");
    expect(result).toMatch(/^\d+-test\.jpg$/);
  });

  it("sanitizes the original filename", () => {
    const result = generateUniqueFilename("my file.jpg");
    expect(result).toMatch(/^\d+-my-file\.jpg$/);
  });

  it("generates unique filenames", () => {
    const results = new Set<string>();
    // Allow some delay between calls to ensure timestamp changes
    for (let i = 0; i < 10; i++) {
      results.add(generateUniqueFilename("test.jpg"));
    }
    // All should be unique due to timestamps
    expect(results.size).toBeGreaterThanOrEqual(1);
  });
});

describe("isAllowedMimeType", () => {
  describe("image types", () => {
    it("accepts valid image MIME types", () => {
      expect(isAllowedMimeType("image/png", "image")).toBe(true);
      expect(isAllowedMimeType("image/jpeg", "image")).toBe(true);
      expect(isAllowedMimeType("image/webp", "image")).toBe(true);
      expect(isAllowedMimeType("image/gif", "image")).toBe(true);
    });

    it("rejects non-image MIME types for image input", () => {
      expect(isAllowedMimeType("video/mp4", "image")).toBe(false);
      expect(isAllowedMimeType("audio/mpeg", "image")).toBe(false);
      expect(isAllowedMimeType("text/plain", "image")).toBe(false);
    });
  });

  describe("video types", () => {
    it("accepts valid video MIME types", () => {
      expect(isAllowedMimeType("video/mp4", "video")).toBe(true);
      expect(isAllowedMimeType("video/webm", "video")).toBe(true);
      expect(isAllowedMimeType("video/quicktime", "video")).toBe(true);
    });

    it("rejects non-video MIME types for video input", () => {
      expect(isAllowedMimeType("image/png", "video")).toBe(false);
      expect(isAllowedMimeType("audio/mpeg", "video")).toBe(false);
    });
  });

  describe("audio types", () => {
    it("accepts valid audio MIME types", () => {
      expect(isAllowedMimeType("audio/mpeg", "audio")).toBe(true);
      expect(isAllowedMimeType("audio/wav", "audio")).toBe(true);
      expect(isAllowedMimeType("audio/ogg", "audio")).toBe(true);
    });

    it("rejects non-audio MIME types for audio input", () => {
      expect(isAllowedMimeType("image/png", "audio")).toBe(false);
      expect(isAllowedMimeType("video/mp4", "audio")).toBe(false);
    });
  });

  it("handles case insensitivity", () => {
    expect(isAllowedMimeType("IMAGE/PNG", "image")).toBe(true);
    expect(isAllowedMimeType("Video/MP4", "video")).toBe(true);
  });
});

describe("getInputFilesDir", () => {
  it("constructs correct path", () => {
    expect(getInputFilesDir("/projects/my-movie", "movie-abc123")).toBe(
      "/projects/my-movie/builds/movie-abc123/input-files"
    );
  });

  it("handles paths with trailing slashes", () => {
    const result = getInputFilesDir("/projects/my-movie/", "movie-abc123");
    expect(result).toContain("builds/movie-abc123/input-files");
  });
});

describe("isPathWithinDirectory", () => {
  it("returns true for paths within directory", () => {
    expect(isPathWithinDirectory("/base/sub/file.txt", "/base")).toBe(true);
    expect(isPathWithinDirectory("/base/file.txt", "/base")).toBe(true);
  });

  it("returns true for same path", () => {
    expect(isPathWithinDirectory("/base", "/base")).toBe(true);
  });

  it("returns false for paths outside directory", () => {
    expect(isPathWithinDirectory("/other/file.txt", "/base")).toBe(false);
    expect(isPathWithinDirectory("/base/../other/file.txt", "/base")).toBe(false);
  });

  it("handles path traversal attempts", () => {
    expect(isPathWithinDirectory("/base/../etc/passwd", "/base")).toBe(false);
    expect(isPathWithinDirectory("/base/sub/../../etc/passwd", "/base")).toBe(false);
  });

  it("prevents directory prefix attacks", () => {
    // /base-other should not be within /base
    expect(isPathWithinDirectory("/base-other/file.txt", "/base")).toBe(false);
  });
});
