/**
 * Unified input loader that combines YAML inputs and TOML prompt configs.
 *
 * Both CLI and viewer call this single function so that:
 * 1. TOML prompt values are tracked as inputs → planner detects changes
 * 2. selectionToVariant uses the same resolved TOML source (builds > template)
 * 3. Duplicate loading logic is eliminated
 */

import { dirname } from 'node:path';
import { loadInputsFromYaml, type InputMap, type ModelSelection, type ArtifactOverride } from '../parsing/input-loader.js';
import { resolveAllPromptPaths, loadProducerPromptInputs } from '../parsing/prompt-input-loader.js';
import { buildProducerOptionsFromBlueprint, type ProducerOptionsMap } from './producer-options.js';
import type { BlueprintTreeNode } from '../types.js';

export interface LoadInputsParams {
  /** Path to inputs YAML file */
  yamlPath: string;
  /** Loaded blueprint tree */
  blueprintTree: BlueprintTreeNode;
  /** Path to the movie's builds directory (e.g., .../builds/movie-123/) */
  buildsDir?: string;
  /** Allow ambiguous default model selection */
  allowAmbiguousDefault?: boolean;
}

export interface LoadInputsResult {
  /** Complete input values (YAML + TOML merged) */
  values: InputMap;
  /** Model selections from YAML */
  modelSelections: ModelSelection[];
  /** Producer options built with correct TOML paths */
  providerOptions: ProducerOptionsMap;
  /** Artifact overrides from YAML */
  artifactOverrides: ArtifactOverride[];
}

/**
 * Load all inputs from YAML and TOML sources.
 *
 * 1. Parse YAML inputs (model selections, user inputs, artifact overrides)
 * 2. Resolve TOML prompt paths (builds folder > blueprint template)
 * 3. Build producer options using resolved TOML paths
 * 4. Load TOML prompt configs as canonical input values
 * 5. Merge: YAML values take precedence over TOML values
 */
export async function loadInputs(params: LoadInputsParams): Promise<LoadInputsResult> {
  const { yamlPath, blueprintTree, buildsDir, allowAmbiguousDefault = false } = params;
  const baseDir = dirname(yamlPath);

  // 1. Load YAML inputs
  const yamlInputs = await loadInputsFromYaml(yamlPath, blueprintTree);

  // 2. Resolve TOML prompt paths (builds > blueprint template)
  const resolvedPromptPaths = await resolveAllPromptPaths(blueprintTree, buildsDir);

  // 3. Build producer options with resolved TOML paths
  const providerOptions = await buildProducerOptionsFromBlueprint(
    blueprintTree,
    yamlInputs.modelSelections,
    allowAmbiguousDefault,
    { baseDir, resolvedPromptPaths },
  );

  // 4. Load TOML prompt configs as input values (reuse already-resolved paths)
  const promptInputs = await loadProducerPromptInputs(blueprintTree, { buildsDir }, resolvedPromptPaths);

  // 5. Merge: YAML values take precedence over TOML prompt values
  const values = { ...promptInputs, ...yamlInputs.values };

  return {
    values,
    modelSelections: yamlInputs.modelSelections,
    providerOptions,
    artifactOverrides: yamlInputs.artifactOverrides,
  };
}
