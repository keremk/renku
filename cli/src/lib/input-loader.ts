import {
  loadInputs,
  type LoadInputsResult,
  type BlueprintTreeNode,
  type InputMap,
  type ModelSelection,
  type ArtifactOverride,
} from '@gorenku/core';

export type LoadedInputs = LoadInputsResult;

export type { InputMap, ModelSelection, ArtifactOverride };

export async function loadInputsFromYaml(
  filePath: string,
  blueprint: BlueprintTreeNode,
  allowAmbiguousDefault = false,
  buildsDir?: string,
): Promise<LoadedInputs> {
  return loadInputs({
    yamlPath: filePath,
    blueprintTree: blueprint,
    buildsDir,
    allowAmbiguousDefault,
  });
}
