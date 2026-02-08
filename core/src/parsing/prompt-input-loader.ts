/**
 * Loads TOML prompt configs as canonical input values for dirty detection.
 *
 * When a producer has a promptFile in its meta, the TOML content (systemPrompt,
 * userPrompt, variables, model, textFormat, and nested config) are tracked as
 * input values so that the planner can detect changes and trigger re-runs.
 */

import type { BlueprintTreeNode } from '../types.js';
import { formatProducerAlias } from './canonical-ids.js';
import { loadPromptFile, resolvePromptPath } from '../orchestration/prompt-file.js';
import { flattenConfigValues } from '../orchestration/config-utils.js';

export interface PromptInputsContext {
  /** Path to the movie's builds directory (e.g., .../builds/movie-123/) */
  buildsDir?: string;
}

/**
 * Walk the blueprint tree and resolve TOML paths for all prompt producers.
 * Returns a map of producerAlias → absolute TOML path.
 *
 * Used by both loadProducerPromptInputs and buildProducerOptionsFromBlueprint.
 */
export async function resolveAllPromptPaths(
  tree: BlueprintTreeNode,
  buildsDir?: string,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  walkTree(tree, result, buildsDir);
  return result;
}

function walkTree(
  node: BlueprintTreeNode,
  result: Map<string, string>,
  buildsDir?: string,
): void {
  for (const producer of node.document.producers) {
    const alias = formatProducerAlias(node.namespacePath, producer.name);

    // Only producers from child nodes have meta with promptFile
    const childNode = node.children.get(producer.name);
    const meta = childNode?.document.meta ?? node.document.meta;
    const sourcePath = childNode?.sourcePath ?? node.sourcePath;

    if (!meta.promptFile) {
      continue;
    }

    const resolved = resolvePromptPath(meta, sourcePath, buildsDir, alias);
    if (resolved) {
      result.set(alias, resolved);
    }
  }

  for (const child of node.children.values()) {
    walkTree(child, result, buildsDir);
  }
}

/**
 * Load TOML prompt configs as canonical input values for dirty detection.
 *
 * For each producer with a resolved prompt path:
 * 1. Load TOML and flatten all fields into canonical input IDs
 *
 * Initial case: If no TOML exists in the builds folder (user hasn't edited yet),
 * the blueprint template TOML is used. These values are tracked from the first run,
 * so any later edit (via viewer or directly) will be detected as a dirty input.
 *
 * @param resolvedPromptPaths - Pre-resolved map of producerAlias → absolute TOML path.
 *   If not provided, paths will be resolved by walking the tree.
 * @returns Record of canonical input IDs → values
 */
export async function loadProducerPromptInputs(
  tree: BlueprintTreeNode,
  context?: PromptInputsContext,
  resolvedPromptPaths?: Map<string, string>,
): Promise<Record<string, unknown>> {
  const promptPaths = resolvedPromptPaths ?? await resolveAllPromptPaths(tree, context?.buildsDir);
  const result: Record<string, unknown> = {};

  for (const [alias, promptPath] of promptPaths) {
    const data = await loadPromptFile(promptPath);

    // Flatten all PromptFileData fields generically into canonical input IDs.
    // Top-level fields (systemPrompt, userPrompt, variables, model, textFormat)
    // become direct keys; nested config section is dot-separated.
    // Skip 'outputs' since it's not an input value.
    const flat: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === 'outputs' || value === undefined) {
        continue;
      }
      if (key === 'config' && value && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(flat, flattenConfigValues(value as Record<string, unknown>));
      } else {
        flat[key] = value;
      }
    }

    for (const [key, value] of Object.entries(flat)) {
      const canonicalId = `Input:${alias}.${key}`;
      result[canonicalId] = value;
    }
  }

  return result;
}

