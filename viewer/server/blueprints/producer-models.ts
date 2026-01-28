/**
 * Producer models extraction from blueprints.
 */

import path from "node:path";
import {
  loadYamlBlueprintTree,
  getProducerMappings,
  type BlueprintTreeNode,
  type ProducerImportDefinition,
  type ProducerMappings,
} from "@gorenku/core";
import { loadModelCatalog, type LoadedModelCatalog } from "@gorenku/providers";
import type {
  AvailableModelOption,
  ProducerCategory,
  ProducerModelInfo,
  ProducerModelsResponse,
} from "./types.js";

/**
 * Detects the producer category based on producer import data.
 * - 'composition': Producer name starts with 'composition/'
 * - 'asset': Producer name starts with 'asset/'
 * - 'prompt': Custom blueprints with path or promptFile
 */
export function detectProducerCategory(
  producerImport: ProducerImportDefinition,
  childNode: BlueprintTreeNode | undefined,
): ProducerCategory {
  // Check for composition producers (e.g., composition/timeline, composition/video-exporter)
  if (producerImport.producer?.startsWith("composition/")) {
    return "composition";
  }
  // Check for asset producers (e.g., asset/text-to-image, asset/text-to-speech)
  if (producerImport.producer?.startsWith("asset/")) {
    return "asset";
  }
  // Custom blueprints with path or promptFile are prompt producers
  if (producerImport.path || childNode?.document.meta.promptFile) {
    return "prompt";
  }
  // Default fallback to asset
  return "asset";
}

/**
 * Extracts LLM models (type: 'text' or 'llm') from the model catalog.
 */
export function getLlmModelsFromCatalog(catalog: LoadedModelCatalog): AvailableModelOption[] {
  const llmModels: AvailableModelOption[] = [];
  for (const [provider, models] of catalog.providers) {
    for (const [modelName, modelDef] of models) {
      if (modelDef.type === "text" || modelDef.type === "llm") {
        llmModels.push({ provider, model: modelName });
      }
    }
  }
  return llmModels;
}

/**
 * Extracts available models from each producer in the blueprint tree.
 * Models are extracted based on producer category:
 * - Asset producers: Models from producer mappings
 * - Prompt producers: LLM models from catalog
 * - Composition producers: No models (empty array)
 */
export async function getProducerModelsFromBlueprint(
  blueprintPath: string,
  catalogRoot?: string,
): Promise<ProducerModelsResponse> {
  const { root } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });
  const producers: Record<string, ProducerModelInfo> = {};

  // Load model catalog for prompt producers
  let llmModels: AvailableModelOption[] = [];
  if (catalogRoot) {
    const catalogModelsDir = path.join(catalogRoot, "models");
    const catalog = await loadModelCatalog(catalogModelsDir);
    llmModels = getLlmModelsFromCatalog(catalog);
  }

  // Visit all producer imports in the blueprint
  const visitNode = (node: BlueprintTreeNode) => {
    for (const producerImport of node.document.producerImports) {
      const producerId = producerImport.name;

      // Find child node if this is a path-based import
      const childNode = producerImport.path ? node.children.get(producerId) : undefined;

      // Detect producer category
      const category = detectProducerCategory(producerImport, childNode);

      // Get available models based on category
      let availableModels: AvailableModelOption[] = [];

      if (category === "asset") {
        // Asset producers: Extract models from mappings
        const mappings: ProducerMappings | undefined = getProducerMappings(root, producerId);
        if (mappings) {
          for (const [provider, modelMappings] of Object.entries(mappings)) {
            for (const model of Object.keys(modelMappings)) {
              availableModels.push({ provider, model });
            }
          }
        }
      } else if (category === "prompt") {
        // Prompt producers: Use LLM models from catalog
        availableModels = llmModels;
      }
      // Composition producers: Leave availableModels empty

      producers[producerId] = {
        description: producerImport.description,
        producerType: producerImport.producer,
        category,
        availableModels,
      };
    }

    // Visit children
    for (const child of node.children.values()) {
      visitNode(child);
    }
  };

  visitNode(root);
  return { producers };
}
