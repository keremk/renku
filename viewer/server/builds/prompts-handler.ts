/**
 * Handler for producer prompts (TOML files).
 * Supports reading, editing, and restoring prompts for prompt-type producers.
 * Uses core package for all TOML file operations.
 */

import path from "node:path";
import {
  loadYamlBlueprintTree,
  loadPromptFile,
  savePromptFile,
  deletePromptFile,
  promptFileExists,
  type BlueprintTreeNode,
  type PromptFileData,
} from "@gorenku/core";
import { detectProducerCategory } from "../blueprints/producer-models.js";

/**
 * Response from GET /blueprints/builds/prompts
 */
export interface ProducerPromptsResponse {
  producerId: string;
  /** Source of the prompt data: 'build' if edited, 'template' if original */
  source: "build" | "template";
  /** The prompt data */
  prompts: PromptFileData;
  /** Path to the prompt file (for reference) */
  promptPath: string;
}

/**
 * Request for PUT /blueprints/builds/prompts
 */
export interface SavePromptsRequest {
  blueprintFolder: string;
  movieId: string;
  blueprintPath: string;
  producerId: string;
  prompts: PromptFileData;
}

/**
 * Request for POST /blueprints/builds/prompts/restore
 */
export interface RestorePromptsRequest {
  blueprintFolder: string;
  movieId: string;
  producerId: string;
}

/**
 * Finds the prompt file path for a producer from the blueprint tree.
 */
async function findProducerPromptPath(
  blueprintPath: string,
  producerId: string,
  catalogRoot?: string,
): Promise<{ promptPath: string; producerSourcePath: string } | null> {
  const { root } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });

  // Find the producer in the tree
  const findProducer = (
    node: BlueprintTreeNode,
  ): { promptFile: string; sourcePath: string } | null => {
    for (const producerImport of node.document.producerImports) {
      if (producerImport.name !== producerId) continue;

      const childNode = producerImport.path ? node.children.get(producerId) : undefined;
      const category = detectProducerCategory(producerImport, childNode);

      // Only prompt producers have prompt files
      if (category !== "prompt") {
        return null;
      }

      // Get promptFile from the producer's meta
      if (childNode?.document.meta.promptFile) {
        return {
          promptFile: childNode.document.meta.promptFile,
          sourcePath: childNode.sourcePath,
        };
      }

      return null;
    }

    // Search children
    for (const child of node.children.values()) {
      const result = findProducer(child);
      if (result) return result;
    }

    return null;
  };

  const result = findProducer(root);
  if (!result) {
    return null;
  }

  // Resolve the prompt file path relative to the producer's source path
  const producerDir = path.dirname(result.sourcePath);
  const promptPath = path.resolve(producerDir, result.promptFile);

  return { promptPath, producerSourcePath: result.sourcePath };
}

/**
 * Gets the build folder path for prompts.
 */
function getBuildPromptsDir(blueprintFolder: string, movieId: string): string {
  return path.join(blueprintFolder, "builds", movieId, "prompts");
}

/**
 * Gets the build prompt file path for a producer.
 */
function getBuildPromptPath(blueprintFolder: string, movieId: string, producerId: string): string {
  return path.join(getBuildPromptsDir(blueprintFolder, movieId), `${producerId}.toml`);
}

/**
 * Gets prompt data for a producer.
 * Checks build folder first, falls back to template.
 */
export async function getProducerPrompts(
  blueprintFolder: string,
  movieId: string,
  blueprintPath: string,
  producerId: string,
  catalogRoot?: string,
): Promise<ProducerPromptsResponse> {
  // Find the template prompt path
  const templateInfo = await findProducerPromptPath(blueprintPath, producerId, catalogRoot);
  if (!templateInfo) {
    throw new Error(`Producer "${producerId}" is not a prompt producer or has no prompt file`);
  }

  // Check if there's an edited version in the build folder
  const buildPromptPath = getBuildPromptPath(blueprintFolder, movieId, producerId);

  if (promptFileExists(buildPromptPath)) {
    // Return the edited version
    const prompts = await loadPromptFile(buildPromptPath);
    return {
      producerId,
      source: "build",
      prompts,
      promptPath: buildPromptPath,
    };
  }

  // Return the template version
  if (!promptFileExists(templateInfo.promptPath)) {
    throw new Error(`Prompt file not found: ${templateInfo.promptPath}`);
  }

  const prompts = await loadPromptFile(templateInfo.promptPath);
  return {
    producerId,
    source: "template",
    prompts,
    promptPath: templateInfo.promptPath,
  };
}

/**
 * Saves edited prompts to the build folder.
 */
export async function saveProducerPrompts(
  blueprintFolder: string,
  movieId: string,
  producerId: string,
  prompts: PromptFileData,
): Promise<void> {
  const promptPath = getBuildPromptPath(blueprintFolder, movieId, producerId);
  await savePromptFile(promptPath, prompts);
}

/**
 * Restores prompts to the template version by deleting the build copy.
 */
export async function restoreProducerPrompts(
  blueprintFolder: string,
  movieId: string,
  producerId: string,
): Promise<void> {
  const buildPromptPath = getBuildPromptPath(blueprintFolder, movieId, producerId);
  await deletePromptFile(buildPromptPath);
}
