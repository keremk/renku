/**
 * Build creation handler.
 */

import { createBlueprintBuild } from '@gorenku/core';
import type { CreateBuildResponse } from './types.js';

/**
 * Creates a new build with inputs.yaml copied from input-template.yaml.
 */
export async function createBuild(
  blueprintFolder: string,
  displayName?: string,
): Promise<CreateBuildResponse> {
  const result = await createBlueprintBuild({
    blueprintFolder,
    displayName,
  });
  return { movieId: result.movieId, inputsPath: result.inputsPath };
}
