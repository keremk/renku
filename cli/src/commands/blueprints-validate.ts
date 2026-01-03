import { resolve } from 'node:path';
import { loadBlueprintBundle } from '../lib/blueprint-loader/index.js';
import { expandPath } from '../lib/path.js';
import { buildBlueprintGraph } from '@gorenku/core';
import { getDefaultCliConfigPath, readCliConfig } from '../lib/cli-config.js';

export interface BlueprintsValidateOptions {
  blueprintPath: string;
}

export interface BlueprintsValidateResult {
  valid: boolean;
  path: string;
  name?: string;
  error?: string;
  nodeCount?: number;
  edgeCount?: number;
}

export async function runBlueprintsValidate(
  options: BlueprintsValidateOptions,
): Promise<BlueprintsValidateResult> {
  try {
    const expandedPath = resolve(expandPath(options.blueprintPath));
    const cliConfig = await readCliConfig(getDefaultCliConfigPath());
    const catalogRoot = cliConfig?.catalog?.root ?? undefined;
    const { root } = await loadBlueprintBundle(expandedPath, { catalogRoot });
    const graph = buildBlueprintGraph(root);
    return {
      valid: true,
      path: expandedPath,
      name: root.document.meta.name,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
    };
  } catch (error) {
    return {
      valid: false,
      path: resolve(options.blueprintPath),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
