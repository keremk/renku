import { stringify as stringifyYaml } from 'yaml';
import type { ModelSelection } from './input-loader.js';

/**
 * Shape of raw data to serialize.
 * This is the structure the API will receive and pass to serialization.
 */
export interface RawInputsData {
  inputs: Record<string, unknown>;
  models: SerializableModelSelection[];
}

/**
 * Serializable model selection (subset of ModelSelection for input YAML).
 * Only includes fields that should be persisted to inputs.yaml.
 */
export interface SerializableModelSelection {
  producerId: string;
  provider: string;
  model: string;
  config?: Record<string, unknown>;
  systemPrompt?: string;
  userPrompt?: string;
  textFormat?: string;
  variables?: string[];
}

/**
 * Converts a full ModelSelection to serializable form.
 * Strips out runtime-only fields like namespacePath, outputs.
 */
export function toSerializableModelSelection(selection: ModelSelection): SerializableModelSelection {
  const result: SerializableModelSelection = {
    producerId: selection.producerId,
    provider: selection.provider,
    model: selection.model,
  };

  if (selection.config && Object.keys(selection.config).length > 0) {
    result.config = selection.config;
  }
  if (selection.systemPrompt) {
    result.systemPrompt = selection.systemPrompt;
  }
  if (selection.userPrompt) {
    result.userPrompt = selection.userPrompt;
  }
  if (selection.textFormat) {
    result.textFormat = selection.textFormat;
  }
  if (selection.variables && selection.variables.length > 0) {
    result.variables = selection.variables;
  }

  return result;
}

/**
 * Serializes inputs and model selections to YAML format for inputs.yaml.
 *
 * Uses the yaml library for proper YAML generation with correct quoting.
 *
 * @param data - The inputs and model selections to serialize
 * @returns Valid YAML string
 */
export function serializeInputsToYaml(data: RawInputsData): string {
  // Build the YAML structure
  const yamlObj: Record<string, unknown> = {};

  // Add inputs section if there are any
  if (Object.keys(data.inputs).length > 0) {
    // Strip canonical "Input:" prefix from keys for cleaner YAML
    const cleanedInputs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data.inputs)) {
      const cleanKey = key.startsWith('Input:') ? key.slice('Input:'.length) : key;
      cleanedInputs[cleanKey] = value;
    }
    yamlObj.inputs = cleanedInputs;
  } else {
    yamlObj.inputs = {};
  }

  // Add models section if there are any
  if (data.models.length > 0) {
    yamlObj.models = data.models.map((m) => {
      const entry: Record<string, unknown> = {
        producerId: m.producerId,
        provider: m.provider,
        model: m.model,
      };

      if (m.config && Object.keys(m.config).length > 0) {
        entry.config = m.config;
      }
      if (m.systemPrompt) {
        entry.systemPrompt = m.systemPrompt;
      }
      if (m.userPrompt) {
        entry.userPrompt = m.userPrompt;
      }
      if (m.textFormat) {
        entry.textFormat = m.textFormat;
      }
      if (m.variables && m.variables.length > 0) {
        entry.variables = m.variables;
      }

      return entry;
    });
  }

  // Use yaml library for proper serialization
  return stringifyYaml(yamlObj, {
    indent: 2,
    lineWidth: 0, // No line wrapping
    defaultKeyType: 'PLAIN',
    defaultStringType: 'QUOTE_DOUBLE',
    // Only quote strings when necessary
    doubleQuotedAsJSON: false,
  });
}

/**
 * Merges new input values into existing inputs.
 * Preserves keys not being updated.
 *
 * @param existing - Existing input values
 * @param updates - New values to merge
 * @returns Merged input values
 */
export function mergeInputValues(
  existing: Record<string, unknown>,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...existing };
  for (const [key, value] of Object.entries(updates)) {
    // Normalize key to match existing (add Input: prefix if needed)
    const canonicalKey = key.startsWith('Input:') ? key : `Input:${key}`;
    const cleanKey = key.startsWith('Input:') ? key.slice('Input:'.length) : key;

    // Try to match by either form
    if (canonicalKey in result) {
      result[canonicalKey] = value;
    } else if (cleanKey in result) {
      result[cleanKey] = value;
    } else {
      // New key - add without prefix for cleaner output
      result[cleanKey] = value;
    }
  }
  return result;
}
