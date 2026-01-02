import { dirname } from 'node:path';
import {
  loadInputsFromYaml as coreLoadInputsFromYaml,
  buildProducerOptionsFromBlueprint,
  type BlueprintTreeNode,
  type InputMap,
  type ModelSelection,
  type ArtifactOverride,
  type ProducerOptionsMap,
} from '@gorenku/core';

export interface LoadedInputs {
  values: InputMap;
  modelSelections: ModelSelection[];
  providerOptions: ProducerOptionsMap;
  /** Artifact overrides detected from inputs (keys like ProducerName.ArtifactName[index]: file:...) */
  artifactOverrides: ArtifactOverride[];
}

export type { InputMap, ModelSelection, ArtifactOverride };

export async function loadInputsFromYaml(
  filePath: string,
  blueprint: BlueprintTreeNode,
  allowAmbiguousDefault = false,
): Promise<LoadedInputs> {
  const base = await coreLoadInputsFromYaml(filePath, blueprint);
  // Use the input file's directory as base for resolving relative paths (promptFile, outputSchema)
  const baseDir = dirname(filePath);
  const providerOptions = await buildProducerOptionsFromBlueprint(
    blueprint,
    base.modelSelections,
    allowAmbiguousDefault,
    { baseDir },
  );
  return {
    ...base,
    providerOptions,
  };
}
