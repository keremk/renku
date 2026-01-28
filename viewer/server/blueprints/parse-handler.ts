/**
 * Blueprint parsing handler.
 */

import { loadYamlBlueprintTree } from "@gorenku/core";
import type { BlueprintGraphData } from "../types.js";
import { convertTreeToGraph } from "./graph-converter.js";

/**
 * Parses a blueprint file and converts it to graph data.
 */
export async function parseBlueprintToGraph(
  blueprintPath: string,
  catalogRoot?: string,
): Promise<BlueprintGraphData> {
  const { root } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });
  return convertTreeToGraph(root);
}
