/**
 * Handler for producer prompts (TOML files).
 * Supports reading, editing, and restoring prompts for prompt-type producers.
 * Thin REST wrappers that delegate to core package for all operations.
 */

import path from "node:path";
import {
  decanonicalizeProducerId,
  findLeafProducerReferenceByCanonicalId,
  loadYamlBlueprintTree,
  loadPromptFile,
  promptFileExists,
  saveProducerPrompts as coreSaveProducerPrompts,
  restoreProducerPrompts as coreRestoreProducerPrompts,
  getBuildPromptPath as coreGetBuildPromptPath,
  type PromptFileData,
} from "@gorenku/core";

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
  catalogRoot?: string;
  producerId: string;
  prompts: PromptFileData;
}

/**
 * Request for POST /blueprints/builds/prompts/restore
 */
export interface RestorePromptsRequest {
  blueprintFolder: string;
  movieId: string;
  blueprintPath: string;
  catalogRoot?: string;
  producerId: string;
}

/**
 * Compute the movie-specific builds directory from blueprint folder and movie ID.
 */
function resolveBuildsDir(blueprintFolder: string, movieId: string): string {
  return path.join(blueprintFolder, "builds", movieId);
}

/**
 * Finds the prompt file path for a producer from the blueprint tree.
 */
async function findProducerPromptPath(
  blueprintPath: string,
  producerId: string,
  catalogRoot?: string,
): Promise<
  | {
      promptPath: string;
      producerSourcePath: string;
      authoredProducerId: string;
    }
  | null
> {
  const { root } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });
  const producerReference = findLeafProducerReferenceByCanonicalId(
    root,
    producerId
  );
  if (!producerReference || !producerReference.node.document.meta.promptFile) {
    return null;
  }

  const producerDir = path.dirname(producerReference.node.sourcePath);
  const promptPath = path.resolve(
    producerDir,
    producerReference.node.document.meta.promptFile
  );

  return {
    promptPath,
    producerSourcePath: producerReference.node.sourcePath,
    authoredProducerId: producerReference.authoredProducerId,
  };
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
  const buildsDir = resolveBuildsDir(blueprintFolder, movieId);
  const buildPromptPath = coreGetBuildPromptPath(
    buildsDir,
    templateInfo.authoredProducerId
  );

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
 * Delegates to core's saveProducerPrompts.
 */
export async function saveProducerPrompts(
  blueprintFolder: string,
  movieId: string,
  blueprintPath: string,
  producerId: string,
  prompts: PromptFileData,
  catalogRoot?: string,
): Promise<void> {
  const buildsDir = resolveBuildsDir(blueprintFolder, movieId);
  const { root } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });
  const authoredProducerId = decanonicalizeProducerId(root, producerId);
  if (!authoredProducerId) {
    throw new Error(`Unknown canonical producer "${producerId}" for prompt save.`);
  }
  await coreSaveProducerPrompts(buildsDir, authoredProducerId, prompts);
}

/**
 * Restores prompts to the template version by deleting the build copy.
 * Delegates to core's restoreProducerPrompts.
 */
export async function restoreProducerPrompts(
  blueprintFolder: string,
  movieId: string,
  blueprintPath: string,
  producerId: string,
  catalogRoot?: string,
): Promise<void> {
  const buildsDir = resolveBuildsDir(blueprintFolder, movieId);
  const { root } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });
  const authoredProducerId = decanonicalizeProducerId(root, producerId);
  if (!authoredProducerId) {
    throw new Error(
      `Unknown canonical producer "${producerId}" for prompt restore.`
    );
  }
  await coreRestoreProducerPrompts(buildsDir, authoredProducerId);
}
