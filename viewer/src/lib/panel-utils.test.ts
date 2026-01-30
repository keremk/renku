import { describe, it, expect } from "vitest";
import {
  parseNodeId,
  getInputNameFromNodeId,
  getOutputNameFromNodeId,
  getSelectionStyles,
  getSectionHighlightStyles,
  UploadContextError,
  UploadEmptyError,
  validateUploadContext,
  isMediaInputType,
  toMediaInputType,
  isValidFileRef,
  extractFilenameFromRef,
} from "./panel-utils";
import type { UploadFilesResponse } from "@/data/blueprint-client";

describe("parseNodeId", () => {
  it("parses Input node ID correctly", () => {
    const result = parseNodeId("Input:Root.images");

    expect(result).toEqual({
      type: "Input",
      path: "Root.images",
      name: "images",
      raw: "Input:Root.images",
    });
  });

  it("parses Output node ID correctly", () => {
    const result = parseNodeId("Output:Root.Child.video");

    expect(result).toEqual({
      type: "Output",
      path: "Root.Child.video",
      name: "video",
      raw: "Output:Root.Child.video",
    });
  });

  it("parses Producer node ID correctly", () => {
    const result = parseNodeId("Producer:Root.ImageGen");

    expect(result).toEqual({
      type: "Producer",
      path: "Root.ImageGen",
      name: "ImageGen",
      raw: "Producer:Root.ImageGen",
    });
  });

  it("handles node ID without colon as Unknown type", () => {
    const result = parseNodeId("SomeUnknownFormat");

    expect(result).toEqual({
      type: "Unknown",
      path: "SomeUnknownFormat",
      name: "SomeUnknownFormat",
      raw: "SomeUnknownFormat",
    });
  });

  it("handles unknown type prefix", () => {
    const result = parseNodeId("Custom:Root.thing");

    expect(result).toEqual({
      type: "Unknown",
      path: "Root.thing",
      name: "thing",
      raw: "Custom:Root.thing",
    });
  });

  it("returns null for null input", () => {
    expect(parseNodeId(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parseNodeId(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseNodeId("")).toBeNull();
  });

  it("handles single-segment path", () => {
    const result = parseNodeId("Input:images");

    expect(result).toEqual({
      type: "Input",
      path: "images",
      name: "images",
      raw: "Input:images",
    });
  });

  it("handles deeply nested path", () => {
    const result = parseNodeId("Output:Root.A.B.C.D.name");

    expect(result?.name).toBe("name");
    expect(result?.path).toBe("Root.A.B.C.D.name");
  });
});

describe("getInputNameFromNodeId", () => {
  it("returns name for Input node", () => {
    expect(getInputNameFromNodeId("Input:Root.images")).toBe("images");
  });

  it("returns null for Output node", () => {
    expect(getInputNameFromNodeId("Output:Root.video")).toBeNull();
  });

  it("returns null for Producer node", () => {
    expect(getInputNameFromNodeId("Producer:Root.Gen")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(getInputNameFromNodeId(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(getInputNameFromNodeId(undefined)).toBeNull();
  });
});

describe("getOutputNameFromNodeId", () => {
  it("returns name for Output node", () => {
    expect(getOutputNameFromNodeId("Output:Root.video")).toBe("video");
  });

  it("returns null for Input node", () => {
    expect(getOutputNameFromNodeId("Input:Root.images")).toBeNull();
  });

  it("returns null for Producer node", () => {
    expect(getOutputNameFromNodeId("Producer:Root.Gen")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(getOutputNameFromNodeId(null)).toBeNull();
  });
});

describe("getSelectionStyles", () => {
  it("returns selected styles when isSelected is true", () => {
    const result = getSelectionStyles(true, "blue");
    expect(result).toContain("border-blue-400");
    expect(result).toContain("bg-blue-500/10");
    expect(result).toContain("ring-1");
  });

  it("returns default styles when isSelected is false", () => {
    const result = getSelectionStyles(false, "blue");
    expect(result).toContain("border-border/40");
    expect(result).toContain("bg-muted/30");
  });

  it("uses blue as default color", () => {
    const result = getSelectionStyles(true);
    expect(result).toContain("blue");
  });

  it("supports purple color", () => {
    const result = getSelectionStyles(true, "purple");
    expect(result).toContain("purple");
  });

  it("supports green color", () => {
    const result = getSelectionStyles(true, "green");
    expect(result).toContain("green");
  });

  it("supports amber color", () => {
    const result = getSelectionStyles(true, "amber");
    expect(result).toContain("amber");
  });
});

describe("getSectionHighlightStyles", () => {
  it("returns undefined when not selected", () => {
    expect(getSectionHighlightStyles(false)).toBeUndefined();
  });

  it("returns highlight styles when selected", () => {
    const result = getSectionHighlightStyles(true, "blue");
    expect(result).toContain("ring-1");
    expect(result).toContain("blue");
    expect(result).toContain("rounded-lg");
  });

  it("supports all colors", () => {
    expect(getSectionHighlightStyles(true, "purple")).toContain("purple");
    expect(getSectionHighlightStyles(true, "green")).toContain("green");
    expect(getSectionHighlightStyles(true, "amber")).toContain("amber");
  });
});

describe("UploadContextError", () => {
  it("has correct name", () => {
    const error = new UploadContextError();
    expect(error.name).toBe("UploadContextError");
  });

  it("has default message", () => {
    const error = new UploadContextError();
    expect(error.message).toBe("Missing required context for upload");
  });

  it("accepts custom message", () => {
    const error = new UploadContextError("Custom message");
    expect(error.message).toBe("Custom message");
  });
});

describe("UploadEmptyError", () => {
  it("has correct name", () => {
    const response: UploadFilesResponse = { files: [] };
    const error = new UploadEmptyError(response);
    expect(error.name).toBe("UploadEmptyError");
  });

  it("uses default message when no errors", () => {
    const response: UploadFilesResponse = { files: [] };
    const error = new UploadEmptyError(response);
    expect(error.message).toBe("No files were uploaded");
  });

  it("uses errors from response when available", () => {
    const response: UploadFilesResponse = {
      files: [],
      errors: ["File too large", "Invalid format"],
    };
    const error = new UploadEmptyError(response);
    expect(error.message).toBe("Upload failed: File too large; Invalid format");
  });

  it("preserves upload errors", () => {
    const response: UploadFilesResponse = {
      files: [],
      errors: ["Error 1", "Error 2"],
    };
    const error = new UploadEmptyError(response);
    expect(error.uploadErrors).toEqual(["Error 1", "Error 2"]);
  });
});

describe("validateUploadContext", () => {
  it("throws when blueprintFolder is null", () => {
    expect(() =>
      validateUploadContext({ blueprintFolder: null, movieId: "123" })
    ).toThrow(UploadContextError);
  });

  it("throws when movieId is null", () => {
    expect(() =>
      validateUploadContext({ blueprintFolder: "/path", movieId: null })
    ).toThrow(UploadContextError);
  });

  it("throws when both are null", () => {
    expect(() =>
      validateUploadContext({ blueprintFolder: null, movieId: null })
    ).toThrow(UploadContextError);
  });

  it("does not throw when both are valid", () => {
    expect(() =>
      validateUploadContext({ blueprintFolder: "/path", movieId: "123" })
    ).not.toThrow();
  });
});

// ============================================================================
// Type Guard Tests
// ============================================================================

describe("isMediaInputType", () => {
  it("returns true for 'image'", () => {
    expect(isMediaInputType("image")).toBe(true);
  });

  it("returns true for 'video'", () => {
    expect(isMediaInputType("video")).toBe(true);
  });

  it("returns true for 'audio'", () => {
    expect(isMediaInputType("audio")).toBe(true);
  });

  it("returns false for unknown string", () => {
    expect(isMediaInputType("document")).toBe(false);
  });

  it("returns false for non-string values", () => {
    expect(isMediaInputType(123)).toBe(false);
    expect(isMediaInputType(null)).toBe(false);
    expect(isMediaInputType(undefined)).toBe(false);
    expect(isMediaInputType({})).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isMediaInputType("")).toBe(false);
  });
});

describe("toMediaInputType", () => {
  it("converts 'image' MediaType to MediaInputType", () => {
    expect(toMediaInputType("image")).toBe("image");
  });

  it("converts 'video' MediaType to MediaInputType", () => {
    expect(toMediaInputType("video")).toBe("video");
  });

  it("converts 'audio' MediaType to MediaInputType", () => {
    expect(toMediaInputType("audio")).toBe("audio");
  });
});

// ============================================================================
// File Reference Tests
// ============================================================================

describe("isValidFileRef", () => {
  it("returns true for valid file reference", () => {
    expect(isValidFileRef("file:./input-files/image.png")).toBe(true);
  });

  it("returns true for file ref with nested path", () => {
    expect(isValidFileRef("file:./input-files/path/to/file.jpg")).toBe(true);
  });

  it("returns false for invalid prefix", () => {
    expect(isValidFileRef("./input-files/image.png")).toBe(false);
  });

  it("returns false for different directory", () => {
    expect(isValidFileRef("file:./other-dir/image.png")).toBe(false);
  });

  it("returns false for missing filename", () => {
    expect(isValidFileRef("file:./input-files/")).toBe(false);
  });

  it("returns false for non-string values", () => {
    expect(isValidFileRef(123)).toBe(false);
    expect(isValidFileRef(null)).toBe(false);
    expect(isValidFileRef(undefined)).toBe(false);
    expect(isValidFileRef({})).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isValidFileRef("")).toBe(false);
  });
});

describe("extractFilenameFromRef", () => {
  it("extracts filename from valid file reference", () => {
    expect(extractFilenameFromRef("file:./input-files/image.png")).toBe(
      "image.png"
    );
  });

  it("extracts filename with path from nested reference", () => {
    expect(extractFilenameFromRef("file:./input-files/path/to/file.jpg")).toBe(
      "path/to/file.jpg"
    );
  });

  it("returns null for invalid file reference", () => {
    expect(extractFilenameFromRef("not-a-file-ref")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(extractFilenameFromRef(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(extractFilenameFromRef(undefined)).toBeNull();
  });

  it("returns null for non-string values", () => {
    expect(extractFilenameFromRef(123)).toBeNull();
    expect(extractFilenameFromRef({})).toBeNull();
  });
});
