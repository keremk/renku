import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import type {
  ProducerDocument,
  ProducerModelOption,
  ProducerInputDefinition,
  ProducerArtifactDefinition,
} from '../types/producer-mode.js';

// Re-export types for convenience
export type { ProducerDocument, ProducerModelOption } from '../types/producer-mode.js';

/**
 * Raw YAML structure from a producer file.
 */
interface RawProducerYaml {
  meta?: {
    id?: string;
    name?: string;
    kind?: string;
    version?: string;
    description?: string;
    author?: string;
    license?: string;
  };
  inputs?: Array<{
    name?: string;
    description?: string;
    type?: string;
  }>;
  artifacts?: Array<{
    name?: string;
    description?: string;
    type?: string;
  }>;
  mappings?: Record<string, Record<string, unknown>>;
}

/**
 * Check if a parsed YAML document represents a producer (not a blueprint).
 *
 * @param parsed - Parsed YAML document
 * @returns True if this is a producer YAML (meta.kind === 'producer')
 */
export function isProducerYaml(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null) {
    return false;
  }
  const doc = parsed as Record<string, unknown>;
  const meta = doc.meta as Record<string, unknown> | undefined;
  return meta?.kind === 'producer';
}

/**
 * Load and parse a producer YAML file.
 *
 * @param filePath - Absolute path to the producer YAML file
 * @returns Parsed producer document
 * @throws If file cannot be read or parsed, or if not a producer YAML
 */
export async function loadProducerDocument(filePath: string): Promise<ProducerDocument> {
  const content = await readFile(filePath, 'utf8');
  const parsed = parseYaml(content) as RawProducerYaml;

  if (!isProducerYaml(parsed)) {
    throw new Error(`File is not a producer YAML (meta.kind !== 'producer'): ${filePath}`);
  }

  if (!parsed.meta?.id || !parsed.meta?.name) {
    throw new Error(`Producer YAML missing required meta fields (id, name): ${filePath}`);
  }

  // Parse inputs
  const inputs: ProducerInputDefinition[] = (parsed.inputs ?? [])
    .filter((input): input is { name: string; description?: string; type?: string } =>
      typeof input?.name === 'string'
    )
    .map((input) => ({
      name: input.name,
      description: input.description,
      type: input.type,
    }));

  // Parse artifacts
  const artifacts: ProducerArtifactDefinition[] = (parsed.artifacts ?? [])
    .filter((artifact): artifact is { name: string; description?: string; type?: string } =>
      typeof artifact?.name === 'string'
    )
    .map((artifact) => ({
      name: artifact.name,
      description: artifact.description,
      type: artifact.type,
    }));

  return {
    meta: {
      id: parsed.meta.id,
      name: parsed.meta.name,
      kind: 'producer',
      version: parsed.meta.version,
      description: parsed.meta.description,
      author: parsed.meta.author,
      license: parsed.meta.license,
    },
    inputs,
    artifacts,
    mappings: parsed.mappings ?? {},
  };
}

/**
 * Extract all provider/model pairs from producer mappings.
 *
 * @param mappings - Producer mappings section (provider -> model -> field mappings)
 * @returns Array of provider/model options
 */
export function extractModelsFromMappings(
  mappings: Record<string, Record<string, unknown>>
): ProducerModelOption[] {
  const models: ProducerModelOption[] = [];

  for (const [provider, modelMappings] of Object.entries(mappings)) {
    if (typeof modelMappings !== 'object' || modelMappings === null) {
      continue;
    }

    for (const model of Object.keys(modelMappings)) {
      models.push({ provider, model });
    }
  }

  return models;
}

/**
 * Group models by provider for UI display.
 *
 * @param models - Array of provider/model options
 * @returns Map of provider -> models
 */
export function groupModelsByProvider(
  models: ProducerModelOption[]
): Map<string, ProducerModelOption[]> {
  const grouped = new Map<string, ProducerModelOption[]>();

  for (const model of models) {
    const existing = grouped.get(model.provider) ?? [];
    existing.push(model);
    grouped.set(model.provider, existing);
  }

  return grouped;
}

/**
 * Filter models to only those with available providers.
 *
 * @param models - All producer model options
 * @param availableProviders - Set of provider names with API keys configured
 * @returns Filtered model options
 */
export function filterAvailableModels(
  models: ProducerModelOption[],
  availableProviders: Set<string>
): ProducerModelOption[] {
  return models.filter((model) => availableProviders.has(model.provider));
}

/**
 * Get the set of input names from a producer document.
 *
 * @param producer - Parsed producer document
 * @returns Set of input names
 */
export function getProducerInputNames(producer: ProducerDocument): Set<string> {
  return new Set(producer.inputs.map((input) => input.name));
}
