/**
 * Blueprint name resolution handler.
 */

import { readCliConfig, resolveBlueprintPaths } from "../generation/index.js";
import type { ResolvedBlueprintInfo } from "./types.js";

/**
 * Resolves a blueprint name to full paths using CLI config.
 */
export async function resolveBlueprintName(name: string): Promise<ResolvedBlueprintInfo> {
  const cliConfig = await readCliConfig();
  if (!cliConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }
  const paths = await resolveBlueprintPaths(name, undefined, cliConfig);
  return {
    blueprintPath: paths.blueprintPath,
    blueprintFolder: paths.blueprintFolder,
    inputsPath: paths.inputsPath,
    buildsFolder: paths.buildsFolder,
    catalogRoot: cliConfig.catalog?.root,
  };
}
