import { describe, it, expect } from "vitest";
import {
  categorizeInputs,
  isMediaType,
  getMediaTypeFromInput,
  getInputCategory,
  groupMediaInputsByName,
} from "./input-utils";
import type { BlueprintInputDef } from "@/types/blueprint-graph";

const makeInput = (
  name: string,
  type: string,
  itemType?: string
): BlueprintInputDef => ({
  name,
  type,
  required: false,
  itemType,
});

describe("isMediaType", () => {
  it("returns true for image type", () => {
    expect(isMediaType("image")).toBe(true);
  });

  it("returns true for video type", () => {
    expect(isMediaType("video")).toBe(true);
  });

  it("returns true for audio type", () => {
    expect(isMediaType("audio")).toBe(true);
  });

  it("returns false for string type", () => {
    expect(isMediaType("string")).toBe(false);
  });

  it("returns false for int type", () => {
    expect(isMediaType("int")).toBe(false);
  });

  it("returns false for text type", () => {
    expect(isMediaType("text")).toBe(false);
  });

  it("uses itemType when provided", () => {
    expect(isMediaType("array", "image")).toBe(true);
    expect(isMediaType("array", "string")).toBe(false);
  });
});

describe("getMediaTypeFromInput", () => {
  it("returns image for image type", () => {
    expect(getMediaTypeFromInput("image")).toBe("image");
  });

  it("returns video for video type", () => {
    expect(getMediaTypeFromInput("video")).toBe("video");
  });

  it("returns audio for audio type", () => {
    expect(getMediaTypeFromInput("audio")).toBe("audio");
  });

  it("returns null for non-media types", () => {
    expect(getMediaTypeFromInput("string")).toBeNull();
    expect(getMediaTypeFromInput("text")).toBeNull();
    expect(getMediaTypeFromInput("int")).toBeNull();
  });

  it("uses itemType when provided", () => {
    expect(getMediaTypeFromInput("array", "image")).toBe("image");
    expect(getMediaTypeFromInput("array", "video")).toBe("video");
    expect(getMediaTypeFromInput("array", "audio")).toBe("audio");
    expect(getMediaTypeFromInput("array", "string")).toBeNull();
  });
});

describe("getInputCategory", () => {
  it("returns media for image type", () => {
    expect(getInputCategory(makeInput("test", "image"))).toBe("media");
  });

  it("returns media for video type", () => {
    expect(getInputCategory(makeInput("test", "video"))).toBe("media");
  });

  it("returns media for audio type", () => {
    expect(getInputCategory(makeInput("test", "audio"))).toBe("media");
  });

  it("returns media for array with image itemType", () => {
    expect(getInputCategory(makeInput("test", "array", "image"))).toBe("media");
  });

  it("returns text for text type", () => {
    expect(getInputCategory(makeInput("test", "text"))).toBe("text");
  });

  it("returns other for string type", () => {
    expect(getInputCategory(makeInput("test", "string"))).toBe("other");
  });

  it("returns other for int type", () => {
    expect(getInputCategory(makeInput("test", "int"))).toBe("other");
  });

  it("returns other for enum type", () => {
    expect(getInputCategory(makeInput("test", "enum"))).toBe("other");
  });

  it("returns other for boolean type", () => {
    expect(getInputCategory(makeInput("test", "boolean"))).toBe("other");
  });
});

describe("categorizeInputs", () => {
  it("categorizes image/video/audio as media", () => {
    const inputs = [
      makeInput("image1", "image"),
      makeInput("video1", "video"),
      makeInput("audio1", "audio"),
    ];

    const result = categorizeInputs(inputs);

    expect(result.media).toHaveLength(3);
    expect(result.text).toHaveLength(0);
    expect(result.other).toHaveLength(0);
  });

  it("categorizes array with image itemType as media", () => {
    const inputs = [
      makeInput("images", "array", "image"),
      makeInput("videos", "array", "video"),
    ];

    const result = categorizeInputs(inputs);

    expect(result.media).toHaveLength(2);
    expect(result.media.map((i) => i.name)).toEqual(["images", "videos"]);
  });

  it("categorizes type=text as text", () => {
    const inputs = [
      makeInput("prompt", "text"),
      makeInput("description", "text"),
    ];

    const result = categorizeInputs(inputs);

    expect(result.text).toHaveLength(2);
    expect(result.media).toHaveLength(0);
    expect(result.other).toHaveLength(0);
  });

  it("categorizes string/int/enum/boolean as other", () => {
    const inputs = [
      makeInput("name", "string"),
      makeInput("count", "int"),
      makeInput("style", "enum"),
      makeInput("enabled", "boolean"),
    ];

    const result = categorizeInputs(inputs);

    expect(result.other).toHaveLength(4);
    expect(result.media).toHaveLength(0);
    expect(result.text).toHaveLength(0);
  });

  it("handles empty inputs array", () => {
    const result = categorizeInputs([]);

    expect(result.media).toHaveLength(0);
    expect(result.text).toHaveLength(0);
    expect(result.other).toHaveLength(0);
  });

  it("handles mixed input types", () => {
    const inputs = [
      makeInput("profileImage", "image"),
      makeInput("bio", "text"),
      makeInput("username", "string"),
      makeInput("photos", "array", "image"),
      makeInput("age", "int"),
    ];

    const result = categorizeInputs(inputs);

    expect(result.media).toHaveLength(2);
    expect(result.media.map((i) => i.name)).toEqual(["profileImage", "photos"]);
    expect(result.text).toHaveLength(1);
    expect(result.text[0].name).toBe("bio");
    expect(result.other).toHaveLength(2);
    expect(result.other.map((i) => i.name)).toEqual(["username", "age"]);
  });
});

describe("groupMediaInputsByName", () => {
  it("creates a map with input name as key", () => {
    const inputs = [
      makeInput("image1", "image"),
      makeInput("image2", "image"),
    ];

    const result = groupMediaInputsByName(inputs);

    expect(result.size).toBe(2);
    expect(result.get("image1")).toBeDefined();
    expect(result.get("image2")).toBeDefined();
  });

  it("handles empty array", () => {
    const result = groupMediaInputsByName([]);
    expect(result.size).toBe(0);
  });
});
