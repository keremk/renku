/**
 * Build inputs handling - get and save.
 */

import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  loadYamlBlueprintTree,
  loadInputsFromYaml,
  serializeInputsToYaml,
  toSerializableModelSelection,
  type SerializableModelSelection,
} from "@gorenku/core";
import type { BuildInputsResponse } from "./types.js";

/**
 * Gets the inputs.yaml content for a build, parsed using core's loadInputsFromYaml.
 * Returns structured JSON instead of raw YAML content.
 */
export async function getBuildInputs(
  blueprintFolder: string,
  movieId: string,
  blueprintPath: string,
  catalogRoot?: string,
): Promise<BuildInputsResponse> {
  const inputsPath = path.join(blueprintFolder, "builds", movieId, "inputs.yaml");

  // Return empty response if no inputs file exists
  if (!existsSync(inputsPath)) {
    return { inputs: {}, models: [], inputsPath };
  }

  try {
    // Load blueprint tree for validation context
    const { root: blueprint } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });

    // Parse inputs using core's loader
    const loaded = await loadInputsFromYaml(inputsPath, blueprint);

    // Convert model selections to serializable form (strip runtime fields)
    const models = loaded.modelSelections.map(toSerializableModelSelection);

    // Strip "Input:" prefix from keys for client consumption
    const inputs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(loaded.values)) {
      const cleanKey = key.startsWith("Input:") ? key.slice(6) : key;
      inputs[cleanKey] = value;
    }

    return {
      inputs,
      models,
      inputsPath,
    };
  } catch (error) {
    // If parsing fails, return empty data
    console.error("[builds] Failed to parse build inputs:", error);
    return { inputs: {}, models: [], inputsPath };
  }
}

/**
 * Saves inputs.yaml content for a build using core's serialization.
 * Accepts structured JSON and serializes to YAML.
 */
export async function saveBuildInputs(
  blueprintFolder: string,
  movieId: string,
  inputs: Record<string, unknown>,
  models: SerializableModelSelection[],
): Promise<void> {
  const buildDir = path.join(blueprintFolder, "builds", movieId);
  await fs.mkdir(buildDir, { recursive: true });
  const inputsPath = path.join(buildDir, "inputs.yaml");

  // Serialize to YAML using core's serializer
  const content = serializeInputsToYaml({ inputs, models });
  await fs.writeFile(inputsPath, content, "utf8");
}
