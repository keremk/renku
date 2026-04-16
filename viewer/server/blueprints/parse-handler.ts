/**
 * Blueprint parsing handler.
 */

import {
  loadYamlBlueprintTree,
  buildBlueprintParseGraphProjection,
  prepareBlueprintResolutionContext,
} from "@gorenku/core";
import type { BlueprintGraphData } from "../types.js";

/**
 * Parses a blueprint file and converts it to graph data.
 */
export async function parseBlueprintToGraph(
  blueprintPath: string,
  catalogRoot?: string,
): Promise<BlueprintGraphData> {
  const { root } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });
  const context = await prepareBlueprintResolutionContext({
    root,
    schemaSource: { kind: 'producer-metadata' },
  });
  return buildBlueprintParseGraphProjection(context.root) as BlueprintGraphData;
}
