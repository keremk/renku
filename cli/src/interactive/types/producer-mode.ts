import type { FormFieldConfig } from '../utils/schema-to-fields.js';

/**
 * A provider/model pair extracted from producer mappings.
 */
export interface ProducerModelOption {
  /** Provider name (e.g., 'fal-ai', 'replicate') */
  provider: string;
  /** Model identifier (e.g., 'wan/v2.6/text-to-video') */
  model: string;
}

/**
 * Schema fields categorized into producer inputs vs config.
 * Producer inputs are fields that map to the producer's declared inputs.
 * Config fields are schema fields that don't correspond to producer inputs.
 */
export interface CategorizedSchemaFields {
  /** Fields that match producer input names */
  inputFields: FormFieldConfig[];
  /** Fields from schema that are not in producer inputs (config parameters) */
  configFields: FormFieldConfig[];
}

/**
 * Output YAML structure for producer mode.
 * Matches the blueprint input file format with models array.
 */
export interface ProducerInputsYamlData {
  /** Selected provider */
  provider: string;
  /** Selected model */
  model: string;
  /** Producer ID (alias used in models array) */
  producerId: string;
  /** Producer input values (go into top-level inputs section) */
  inputs: Record<string, unknown>;
  /** Config values (schema fields not in producer inputs, go into models[].config) */
  config: Record<string, unknown>;
  /** Input field configurations for type-aware formatting (e.g., file: prefix) */
  inputFields?: FormFieldConfig[];
}

/**
 * Producer document metadata.
 */
export interface ProducerDocumentMeta {
  id: string;
  name: string;
  kind: 'producer';
  version?: string;
  description?: string;
  author?: string;
  license?: string;
}

/**
 * Producer input definition from the YAML file.
 */
export interface ProducerInputDefinition {
  name: string;
  description?: string;
  type?: string;
  /** For collection types: the item type (image, audio, video) */
  itemType?: string;
}

/**
 * Producer artifact definition from the YAML file.
 */
export interface ProducerArtifactDefinition {
  name: string;
  description?: string;
  type?: string;
}

/**
 * Parsed producer document from YAML.
 */
export interface ProducerDocument {
  meta: ProducerDocumentMeta;
  inputs: ProducerInputDefinition[];
  artifacts?: ProducerArtifactDefinition[];
  /** Provider -> Model -> InputMappings */
  mappings: Record<string, Record<string, unknown>>;
}

/**
 * Steps in the producer interactive flow.
 */
export type ProducerInteractiveStep =
  | 'model-selection'
  | 'input-editing'
  | 'config-editing'
  | 'confirmation'
  | 'saving';

/**
 * State for the producer interactive app.
 */
export interface ProducerAppState {
  step: ProducerInteractiveStep;
  selectedProvider?: string;
  selectedModel?: string;
  inputValues: Record<string, unknown>;
  configValues: Record<string, unknown>;
  error?: string;
}
