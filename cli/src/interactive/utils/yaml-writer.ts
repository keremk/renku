import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringify } from 'yaml';
import type { FormFieldConfig } from './schema-to-fields.js';

/**
 * Model selection to be written to the inputs YAML.
 */
export interface ModelSelectionInput {
  producerId: string;
  provider: string;
  model: string;
  config?: Record<string, unknown>;
}

/**
 * Composition producer model entry with timeline config template.
 */
export interface CompositionModelInput {
  producerId: string;
  model: string;
  provider: string;
  config: Record<string, unknown>;
}

/**
 * Complete inputs data structure for the YAML file.
 */
export interface InputsYamlData {
  /** Blueprint input values */
  inputs: Record<string, unknown>;
  /** Model selections for producers */
  models: ModelSelectionInput[];
  /** Composition producer entries with timeline config templates */
  compositionModels?: CompositionModelInput[];
}

/**
 * Options for generating the inputs file name.
 */
export interface InputsFileNameOptions {
  /** Blueprint ID used for filename (e.g., "Documentary" → "documentary-inputs.yaml") */
  blueprintId: string;
  /** Blueprint name used in header comment */
  blueprintName: string;
  /** Output directory (defaults to current working directory) */
  outputDir?: string;
  /** All blueprint field definitions - ensures all fields appear in template */
  blueprintFields?: FormFieldConfig[];
}

/**
 * Generate a filename for the inputs YAML based on the blueprint ID.
 *
 * @param blueprintId - The blueprint's meta.id (e.g., "Documentary")
 * @returns Sanitized filename like "documentary-inputs.yaml"
 */
export function generateInputsFileName(blueprintId: string): string {
  // Sanitize: lowercase, replace spaces/underscores with hyphens, remove special chars
  let name = blueprintId
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

  // Ensure non-empty
  if (!name) {
    name = 'inputs';
  }

  return `${name}-inputs.yaml`;
}

/**
 * Write the inputs YAML file to disk.
 *
 * @param data - The inputs data to write
 * @param options - File naming options
 * @returns The full path to the written file
 */
export async function writeInputsYaml(
  data: InputsYamlData,
  options: InputsFileNameOptions,
): Promise<string> {
  const outputDir = options.outputDir ?? process.cwd();
  const filename = generateInputsFileName(options.blueprintId);
  const filepath = resolve(outputDir, filename);

  // Build the YAML structure
  const yamlData: Record<string, unknown> = {};

  // Build inputs section - include ALL fields (this is a template)
  const inputs: Record<string, unknown> = {};

  if (options.blueprintFields && options.blueprintFields.length > 0) {
    // Initialize all fields with their values or empty defaults
    for (const field of options.blueprintFields) {
      const value = data.inputs[field.name];
      // Use the value if set, otherwise use empty string for template
      inputs[field.name] = value !== undefined ? value : '';
    }
  } else {
    // Fallback to original behavior - only include fields with values
    Object.assign(inputs, data.inputs);
  }

  // Always include inputs section in template (even if all empty)
  if (Object.keys(inputs).length > 0) {
    yamlData.inputs = inputs;
  }

  // Add models section
  const allModels: Record<string, unknown>[] = [];

  // Add regular models
  for (const selection of data.models) {
    const entry: Record<string, unknown> = {
      producerId: selection.producerId,
      provider: selection.provider,
      model: selection.model,
    };
    if (selection.config && Object.keys(selection.config).length > 0) {
      entry.config = selection.config;
    }
    allModels.push(entry);
  }

  // Add composition models with timeline config templates
  if (data.compositionModels) {
    for (const composition of data.compositionModels) {
      allModels.push({
        model: composition.model,
        provider: composition.provider,
        producerId: composition.producerId,
        config: composition.config,
      });
    }
  }

  if (allModels.length > 0) {
    yamlData.models = allModels;
  }

  // Convert to YAML string with nice formatting
  const content = stringify(yamlData, {
    indent: 2,
    lineWidth: 0, // Don't wrap lines
    defaultKeyType: 'PLAIN',
    defaultStringType: 'QUOTE_DOUBLE',
  });

  // Add header comment
  const header = `# Generated inputs file for blueprint: ${options.blueprintName}\n# Generated at: ${new Date().toISOString()}\n\n`;

  await writeFile(filepath, header + content, 'utf8');

  return filepath;
}

/**
 * Generate a blank timeline configuration template.
 * Users need to fill in artifact names based on their blueprint outputs.
 */
export function generateTimelineConfigTemplate(): Record<string, unknown> {
  return {
    masterTracks: [],
    videoClip: {
      artifact: '',
    },
    audioClip: {
      artifact: '',
    },
    musicClip: {
      artifact: '',
      volume: 0.5,
    },
    tracks: [],
  };
}

/**
 * Format a preview of the YAML content without writing to disk.
 * Useful for showing confirmation before saving.
 */
export function formatInputsPreview(
  data: InputsYamlData,
  blueprintFields?: FormFieldConfig[],
): string {
  const yamlData: Record<string, unknown> = {};

  // Build inputs section - include ALL fields (this is a template)
  const inputs: Record<string, unknown> = {};

  if (blueprintFields && blueprintFields.length > 0) {
    for (const field of blueprintFields) {
      const value = data.inputs[field.name];
      inputs[field.name] = value !== undefined ? value : '';
    }
  } else {
    Object.assign(inputs, data.inputs);
  }

  if (Object.keys(inputs).length > 0) {
    yamlData.inputs = inputs;
  }

  const allModels: Record<string, unknown>[] = [];

  for (const selection of data.models) {
    const entry: Record<string, unknown> = {
      producerId: selection.producerId,
      provider: selection.provider,
      model: selection.model,
    };
    if (selection.config && Object.keys(selection.config).length > 0) {
      entry.config = selection.config;
    }
    allModels.push(entry);
  }

  if (data.compositionModels) {
    for (const composition of data.compositionModels) {
      allModels.push({
        model: composition.model,
        provider: composition.provider,
        producerId: composition.producerId,
        config: composition.config,
      });
    }
  }

  if (allModels.length > 0) {
    yamlData.models = allModels;
  }

  return stringify(yamlData, {
    indent: 2,
    lineWidth: 0,
    defaultKeyType: 'PLAIN',
    defaultStringType: 'QUOTE_DOUBLE',
  });
}
