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

// --- Producer mode YAML writing ---

/**
 * Data structure for producer input YAML file.
 * Uses the same format as blueprint input files for consistency.
 */
export interface ProducerInputsYamlData {
  /** Selected provider */
  provider: string;
  /** Selected model */
  model: string;
  /** Producer ID (alias) */
  producerId: string;
  /** Producer input values (go into top-level inputs section) */
  inputs: Record<string, unknown>;
  /** Config values (schema fields not in producer inputs, go into models[].config) */
  config: Record<string, unknown>;
}

/**
 * Options for generating the producer inputs file.
 */
export interface ProducerInputsFileOptions {
  /** Producer ID (used for filename and producerId in models array) */
  producerId: string;
  /** Producer name (used in header) */
  producerName: string;
  /** Output directory (defaults to current working directory) */
  outputDir?: string;
  /** Field configurations for identifying file fields */
  inputFields?: FormFieldConfig[];
}

/**
 * Format a file value with the file: prefix.
 */
export function formatFileValue(value: string): string {
  // Don't add prefix if already has it
  if (value.startsWith('file:')) {
    return value;
  }
  return `file:${value}`;
}

/**
 * Format input values, adding file: prefix to file field values.
 *
 * @param inputs - Input values from the form
 * @param fields - Field configurations to identify file types
 * @returns Formatted input values with file: prefix for file fields
 */
export function formatInputsWithFilePrefix(
  inputs: Record<string, unknown>,
  fields?: FormFieldConfig[]
): Record<string, unknown> {
  if (!fields || fields.length === 0) {
    return inputs;
  }

  // Create a set of file field names
  const fileFieldNames = new Set(
    fields
      .filter((f) => f.type === 'file' || f.type === 'file-collection')
      .map((f) => f.name)
  );

  const formatted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(inputs)) {
    if (fileFieldNames.has(key) && value !== undefined && value !== '') {
      // Format file values with file: prefix
      if (Array.isArray(value)) {
        formatted[key] = value.map((v) =>
          typeof v === 'string' ? formatFileValue(v) : v
        );
      } else if (typeof value === 'string') {
        formatted[key] = formatFileValue(value);
      } else {
        formatted[key] = value;
      }
    } else {
      formatted[key] = value;
    }
  }

  return formatted;
}

/**
 * Generate a filename for the producer inputs YAML.
 *
 * @param producerId - The producer's meta.id
 * @returns Sanitized filename like "text-to-video-producer-inputs.yaml"
 */
export function generateProducerInputsFileName(producerId: string): string {
  // Sanitize: lowercase, replace spaces/underscores with hyphens, remove special chars
  let name = producerId
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

  // Ensure non-empty
  if (!name) {
    name = 'producer';
  }

  return `${name}-inputs.yaml`;
}

/**
 * Write the producer inputs YAML file to disk.
 * Uses the same format as blueprint input files:
 * - inputs: at top level with field values
 * - models: array with model selection and config
 *
 * @param data - The producer inputs data
 * @param options - File options
 * @returns The full path to the written file
 */
export async function writeProducerInputsYaml(
  data: ProducerInputsYamlData,
  options: ProducerInputsFileOptions,
): Promise<string> {
  const outputDir = options.outputDir ?? process.cwd();
  const filename = generateProducerInputsFileName(options.producerId);
  const filepath = resolve(outputDir, filename);

  // Build the YAML structure matching blueprint input format
  const yamlData: Record<string, unknown> = {};

  // Format inputs, adding file: prefix for file fields
  const formattedInputs = formatInputsWithFilePrefix(data.inputs, options.inputFields);

  // Add inputs section at top level (if any)
  if (Object.keys(formattedInputs).length > 0) {
    yamlData.inputs = formattedInputs;
  }

  // Add models array with the selected model
  const modelEntry: Record<string, unknown> = {
    model: data.model,
    provider: data.provider,
    producerId: options.producerId,
  };

  // Add config only if there are config values
  if (Object.keys(data.config).length > 0) {
    modelEntry.config = data.config;
  }

  yamlData.models = [modelEntry];

  // Convert to YAML string with nice formatting
  const content = stringify(yamlData, {
    indent: 2,
    lineWidth: 0, // Don't wrap lines
    defaultKeyType: 'PLAIN',
    defaultStringType: 'QUOTE_DOUBLE',
  });

  // Add header comment
  const header = [
    `# Producer input template for: ${options.producerName}`,
    `# Model: ${data.provider}/${data.model}`,
    `# Generated at: ${new Date().toISOString()}`,
    '',
    '',
  ].join('\n');

  await writeFile(filepath, header + content, 'utf8');

  return filepath;
}

/**
 * Format a preview of the producer inputs YAML content.
 */
export function formatProducerInputsPreview(
  data: ProducerInputsYamlData,
  producerId: string,
  inputFields?: FormFieldConfig[],
): string {
  const yamlData: Record<string, unknown> = {};

  // Format inputs, adding file: prefix for file fields
  const formattedInputs = formatInputsWithFilePrefix(data.inputs, inputFields);

  if (Object.keys(formattedInputs).length > 0) {
    yamlData.inputs = formattedInputs;
  }

  const modelEntry: Record<string, unknown> = {
    model: data.model,
    provider: data.provider,
    producerId,
  };

  if (Object.keys(data.config).length > 0) {
    modelEntry.config = data.config;
  }

  yamlData.models = [modelEntry];

  return stringify(yamlData, {
    indent: 2,
    lineWidth: 0,
    defaultKeyType: 'PLAIN',
    defaultStringType: 'QUOTE_DOUBLE',
  });
}
