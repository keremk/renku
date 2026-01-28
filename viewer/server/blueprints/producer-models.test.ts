/**
 * Tests for producer models extraction.
 */

import { describe, it, expect } from "vitest";
import { detectProducerCategory, getLlmModelsFromCatalog } from "./producer-models.js";
import type { ProducerImportDefinition, BlueprintTreeNode } from "@gorenku/core";
import type { LoadedModelCatalog } from "@gorenku/providers";

describe("detectProducerCategory", () => {
  it("detects composition producers", () => {
    const producerImport: ProducerImportDefinition = {
      name: "Timeline",
      producer: "composition/timeline",
    };
    expect(detectProducerCategory(producerImport, undefined)).toBe("composition");
  });

  it("detects asset producers", () => {
    const producerImport: ProducerImportDefinition = {
      name: "ImageGen",
      producer: "asset/text-to-image",
    };
    expect(detectProducerCategory(producerImport, undefined)).toBe("asset");
  });

  it("detects prompt producers with path", () => {
    const producerImport: ProducerImportDefinition = {
      name: "ScriptWriter",
      path: "./script-writer.yaml",
    };
    expect(detectProducerCategory(producerImport, undefined)).toBe("prompt");
  });

  it("detects prompt producers with promptFile in child node", () => {
    const producerImport: ProducerImportDefinition = {
      name: "ScriptWriter",
    };
    const childNode = {
      document: {
        meta: {
          id: "script-writer",
          name: "Script Writer",
          promptFile: "script.md",
        },
      },
    } as BlueprintTreeNode;
    expect(detectProducerCategory(producerImport, childNode)).toBe("prompt");
  });

  it("defaults to asset for unknown producers", () => {
    const producerImport: ProducerImportDefinition = {
      name: "Unknown",
    };
    expect(detectProducerCategory(producerImport, undefined)).toBe("asset");
  });
});

describe("getLlmModelsFromCatalog", () => {
  it("extracts text and llm type models", () => {
    const catalog: LoadedModelCatalog = {
      providers: new Map([
        [
          "openai",
          new Map([
            ["gpt-4", { type: "text" }],
            ["gpt-3.5-turbo", { type: "llm" }],
            ["dall-e-3", { type: "image" }],
          ]),
        ],
        [
          "anthropic",
          new Map([
            ["claude-3", { type: "text" }],
          ]),
        ],
      ]),
    } as LoadedModelCatalog;

    const result = getLlmModelsFromCatalog(catalog);

    expect(result).toHaveLength(3);
    expect(result).toContainEqual({ provider: "openai", model: "gpt-4" });
    expect(result).toContainEqual({ provider: "openai", model: "gpt-3.5-turbo" });
    expect(result).toContainEqual({ provider: "anthropic", model: "claude-3" });
    expect(result).not.toContainEqual({ provider: "openai", model: "dall-e-3" });
  });

  it("returns empty array for catalog with no LLM models", () => {
    const catalog: LoadedModelCatalog = {
      providers: new Map([
        [
          "replicate",
          new Map([
            ["stable-diffusion", { type: "image" }],
          ]),
        ],
      ]),
    } as LoadedModelCatalog;

    const result = getLlmModelsFromCatalog(catalog);

    expect(result).toHaveLength(0);
  });
});
