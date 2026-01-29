/**
 * Build inputs handling - get and save.
 */

import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  parseInputsForDisplay,
  serializeInputsToYaml,
  type SerializableModelSelection,
} from "@gorenku/core";
import type { BuildInputsResponse } from "./types.js";

/**
 * Gets the inputs.yaml content for a build using core's parseInputsForDisplay.
 * Returns structured JSON with file references preserved as strings for UI display.
 * The frontend uses these strings to build streaming URLs for actual file content.
 *
 * Note: _blueprintPath and _catalogRoot are kept for API compatibility but no longer
 * used since parseInputsForDisplay doesn't require blueprint validation context.
 */
export async function getBuildInputs(
  blueprintFolder: string,
  movieId: string,
  _blueprintPath: string,
  _catalogRoot?: string,
): Promise<BuildInputsResponse> {
  const inputsPath = path.join(blueprintFolder, "builds", movieId, "inputs.yaml");

  // Return empty response if no inputs file exists
  if (!existsSync(inputsPath)) {
    return { inputs: {}, models: [], inputsPath };
  }

  try {
    // Parse inputs using core's display parser (preserves file references as strings)
    const { inputs, models } = await parseInputsForDisplay(inputsPath);

    return {
      inputs,
      models,
      inputsPath,
    };
  } catch (error) {
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
