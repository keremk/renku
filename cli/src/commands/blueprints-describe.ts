import { resolve } from 'node:path';
import { parseBlueprintDocument } from '../lib/blueprint-loader/index.js';
import type { BlueprintInputDefinition, BlueprintArtefactDefinition } from '@gorenku/core';

export interface BlueprintsDescribeOptions {
  blueprintPath: string;
}

export interface BlueprintsDescribeResult {
  path: string;
  name: string;
  description?: string;
  version?: string;
  inputs: {
    name: string;
    type: string;
    required: boolean;
    description?: string;
    defaultValue?: unknown;
  }[];
  outputs: {
    name: string;
    type: string;
    required: boolean;
    description?: string;
    countInput?: string;
  }[];
  nodeCount: number;
  edgeCount: number;
}

export async function runBlueprintsDescribe(
  options: BlueprintsDescribeOptions,
): Promise<BlueprintsDescribeResult> {
  const targetPath = resolve(options.blueprintPath);
  const blueprint = await parseBlueprintDocument(targetPath);

  return {
    path: targetPath,
    name: blueprint.meta.name,
    description: blueprint.meta.description,
    version: blueprint.meta.version,
    inputs: blueprint.inputs.map((input: BlueprintInputDefinition) => ({
      name: input.name,
      type: input.type,
      required: input.required,
      description: input.description,
      defaultValue: input.defaultValue,
    })),
    outputs: blueprint.artefacts.map((output: BlueprintArtefactDefinition) => ({
      name: output.name,
      type: output.type,
      required: output.required !== false,
      description: output.description,
      countInput: output.countInput,
    })),
    nodeCount: blueprint.inputs.length + blueprint.artefacts.length + blueprint.producers.length,
    edgeCount: blueprint.edges.length,
  };
}
