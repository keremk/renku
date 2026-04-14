/**
 * Producer models extraction from blueprints.
 */

import path from "node:path";
import {
  formatCanonicalProducerId,
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
 * Detects the producer category for a resolved leaf producer import.
 */
export function detectProducerCategory(
  producerImport: ProducerImportDefinition,
  childNode: BlueprintTreeNode | undefined,
): ProducerCategory {
  if (producerImport.producer?.startsWith("composition/")) {
    return "composition";
  }
  if (producerImport.producer?.startsWith("asset/")) {
    return "asset";
  }
  if (childNode?.document.meta.promptFile) {
    return "prompt";
  }
  return "asset";
}

export interface LeafProducerImportEntry {
  canonicalProducerId: string;
  description?: string;
  producerType?: string;
  category: ProducerCategory;
}

export function collectLeafProducerImports(
  root: BlueprintTreeNode
): LeafProducerImportEntry[] {
  const entries: LeafProducerImportEntry[] = [];

  const visit = (node: BlueprintTreeNode): void => {
    for (const producerImport of node.document.producerImports) {
      const childNode = node.children.get(producerImport.name);
      if (!childNode) {
        throw new Error(
          `Missing child blueprint node for producer import "${producerImport.name}".`
        );
      }

      if (childNode.document.producerImports.length > 0) {
        visit(childNode);
        continue;
      }

      const leafProducer = childNode.document.producers[0];
      if (!leafProducer) {
        throw new Error(
          `Resolved producer import "${producerImport.name}" does not declare a leaf producer entry.`
        );
      }

      entries.push({
        canonicalProducerId: formatCanonicalProducerId(
          childNode.namespacePath,
          leafProducer.name
        ),
        description: producerImport.description,
        producerType: producerImport.producer,
        category: detectProducerCategory(producerImport, childNode),
      });
    }
  };

  visit(root);
  return entries;
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

  for (const entry of collectLeafProducerImports(root)) {
    let availableModels: AvailableModelOption[] = [];

    if (entry.category === "asset") {
      const mappings: ProducerMappings | undefined = getProducerMappings(
        root,
        entry.canonicalProducerId
      );
      if (mappings) {
        for (const [provider, modelMappings] of Object.entries(mappings)) {
          for (const model of Object.keys(modelMappings)) {
            availableModels.push({ provider, model });
          }
        }
      }
    } else if (entry.category === "prompt") {
      availableModels = llmModels;
    }

    producers[entry.canonicalProducerId] = {
      description: entry.description,
      producerType: entry.producerType,
      category: entry.category,
      availableModels,
    };
  }

  return { producers };
}
