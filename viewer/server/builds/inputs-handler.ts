/**
 * Build inputs handling - get and save.
 */

import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  parseInputsForDisplay,
  serializeInputsToYaml,
  type SerializableModelSelection,
} from '@gorenku/core';
import type { BuildInputsResponse } from './types.js';

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
  _catalogRoot?: string
): Promise<BuildInputsResponse> {
  const inputsPath = path.join(
    blueprintFolder,
    'builds',
    movieId,
    'inputs.yaml'
  );

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
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to parse build inputs at "${inputsPath}": ${message}`
    );
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
  models: SerializableModelSelection[]
): Promise<void> {
  const buildDir = path.join(blueprintFolder, 'builds', movieId);
  await fs.mkdir(buildDir, { recursive: true });
  const inputsPath = path.join(buildDir, 'inputs.yaml');

  let nextInputs = inputs;
  let nextModels = models;

  if (existsSync(inputsPath)) {
    const existing = await parseInputsForDisplay(inputsPath);
    nextInputs = mergeInputValues(existing.inputs, inputs);
    nextModels = mergeModelSelections(existing.models, models, inputsPath);
  }

  // Serialize to YAML using core's serializer
  const content = serializeInputsToYaml({ inputs: nextInputs, models: nextModels });
  const tempPath = `${inputsPath}.tmp-${Date.now()}`;
  await fs.writeFile(tempPath, content, 'utf8');
  await fs.rename(tempPath, inputsPath);
}

function mergeInputValues(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...existing,
    ...incoming,
  };
}

function mergeModelSelections(
  existing: SerializableModelSelection[],
  incoming: SerializableModelSelection[],
  inputsPath: string
): SerializableModelSelection[] {
  if (existing.length > 0 && incoming.length === 0) {
    throw new Error(
      `Refusing to overwrite "${inputsPath}" with empty model selections. ` +
        `Existing file contains ${existing.length} model entries.`
    );
  }

  const incomingByProducer = new Map<string, SerializableModelSelection>();
  for (const model of incoming) {
    if (incomingByProducer.has(model.producerId)) {
      throw new Error(
        `Refusing to save "${inputsPath}" because models payload contains duplicate producer "${model.producerId}".`
      );
    }
    incomingByProducer.set(model.producerId, model);
  }

  const merged: SerializableModelSelection[] = [];
  const consumedProducerIds = new Set<string>();

  for (const existingModel of existing) {
    const incomingModel = incomingByProducer.get(existingModel.producerId);
    if (!incomingModel) {
      merged.push(existingModel);
      continue;
    }

    consumedProducerIds.add(existingModel.producerId);

    if (
      existingModel.provider === incomingModel.provider &&
      existingModel.model === incomingModel.model
    ) {
      const normalizedIncoming = normalizeSelectionConfig(incomingModel);

      if (
        !hasConfigField(incomingModel) &&
        existingModel.config !== undefined
      ) {
        merged.push({
          ...normalizedIncoming,
          config: existingModel.config,
        });
        continue;
      }

      merged.push(normalizedIncoming);
      continue;
    }

    merged.push(normalizeSelectionConfig(incomingModel));
  }

  for (const incomingModel of incoming) {
    if (!consumedProducerIds.has(incomingModel.producerId)) {
      merged.push(normalizeSelectionConfig(incomingModel));
    }
  }

  return merged;
}

function hasConfigField(selection: SerializableModelSelection): boolean {
  return Object.prototype.hasOwnProperty.call(selection, 'config');
}

function normalizeSelectionConfig(
  selection: SerializableModelSelection
): SerializableModelSelection {
  if (selection.config === undefined) {
    return selection;
  }
  if (Object.keys(selection.config).length > 0) {
    return selection;
  }

  return {
    producerId: selection.producerId,
    provider: selection.provider,
    model: selection.model,
  };
}
