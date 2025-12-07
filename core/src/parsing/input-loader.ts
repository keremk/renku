import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  createInputIdResolver,
  type CanonicalInputEntry,
  formatCanonicalProducerName,
  formatProducerScopedInputId,
  isCanonicalInputId,
  parseQualifiedProducerName,
} from './canonical-ids.js';
import type {
  BlueprintTreeNode,
  ProducerModelVariant,
} from '../types.js';

export type InputMap = Record<string, unknown>;

interface RawInputsFile {
  inputs?: unknown;
  models?: unknown;
}

export interface ModelSelection {
  producerId: string;
  provider: string;
  model: string;
  config?: Record<string, unknown>;
  namespacePath?: string[];
}

export interface LoadedInputs {
  values: InputMap;
  modelSelections: ModelSelection[];
}

export async function loadInputsFromYaml(
  filePath: string,
  blueprint: BlueprintTreeNode,
): Promise<LoadedInputs> {
  validateYamlExtension(filePath);
  const contents = await readFile(filePath, 'utf8');
  const parsed = parseYaml(contents) as RawInputsFile;
  const rawInputs = resolveInputSection(parsed);
  const producerIndex = indexProducers(blueprint);
  const modelSelections = resolveModelSelections(parsed.models, producerIndex, rawInputs);
  const selectionEntries = collectSelectionEntries(modelSelections);
  const syntheticInputs = [
    ...collectProducerScopedInputs(blueprint),
    ...selectionEntries,
  ];
  const resolver = createInputIdResolver(blueprint, syntheticInputs);
  const values = canonicalizeInputs(rawInputs, resolver);

  const missingRequired = resolver.entries
    .filter((entry) => entry.namespacePath.length === 0 && entry.definition.required)
    .filter((entry) => values[entry.canonicalId] === undefined)
    .map((entry) => entry.canonicalId);

  if (missingRequired.length > 0) {
    throw new Error(`Input file missing required fields: ${missingRequired.join(', ')}`);
  }

  for (const entry of resolver.entries) {
    const { canonicalId, definition } = entry;
    if (values[canonicalId] === undefined && definition.defaultValue !== undefined) {
      values[canonicalId] = definition.defaultValue;
    }
  }

  applyModelSelectionsToInputs(values, modelSelections);

  return { values, modelSelections };
}

function validateYamlExtension(filePath: string): void {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.yaml' || extension === '.yml') {
    return;
  }
  throw new Error(`Input files must be YAML (*.yaml or *.yml). Received: ${filePath}`);
}

function resolveInputSection(raw: RawInputsFile): Record<string, unknown> {
  if (raw && typeof raw === 'object' && raw.inputs && typeof raw.inputs === 'object') {
    return { ...(raw.inputs as Record<string, unknown>) };
  }
  if (raw && typeof raw === 'object') {
    return { ...(raw as Record<string, unknown>) };
  }
  throw new Error('Input file must define an inputs mapping with key/value pairs.');
}

function canonicalizeInputs(
  raw: Record<string, unknown>,
  resolver: ReturnType<typeof createInputIdResolver>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    // Convert to canonical form (accepts both canonical IDs and qualified names)
    const canonical = resolver.toCanonical(key);
    if (resolved[canonical] !== undefined) {
      throw new Error(`Duplicate input value for "${canonical}".`);
    }
    resolved[canonical] = value;
  }
  return resolved;
}

interface ProducerIndex {
  byQualified: Map<string, { namespacePath: string[]; producerName: string; qualifiedName: string }>;
}

function indexProducers(tree: BlueprintTreeNode): ProducerIndex {
  const byQualified = new Map<string, { namespacePath: string[]; producerName: string; qualifiedName: string }>();

  const visit = (node: BlueprintTreeNode) => {
    for (const producer of node.document.producers) {
      const qualifiedName = formatCanonicalProducerName(node.namespacePath, producer.name);
      byQualified.set(qualifiedName, {
        namespacePath: node.namespacePath,
        producerName: producer.name,
        qualifiedName,
      });
    }
    for (const child of node.children.values()) {
      visit(child);
    }
  };

  visit(tree);
  return { byQualified };
}

function resolveProducerName(
  authored: string,
  index: ProducerIndex,
): { namespacePath: string[]; qualifiedName: string; producerName: string } {
  const direct = index.byQualified.get(authored);
  if (direct) {
    return direct;
  }
  throw new Error(`Unknown producer "${authored}" in models selection.`);
}

function applyModelSelectionsToInputs(values: Record<string, unknown>, selections: ModelSelection[]): void {
  for (const selection of selections) {
    const namespacePath = selection.namespacePath ?? [];
    const { producerName } = parseQualifiedProducerName(selection.producerId);
    const providerId = formatProducerScopedInputId(namespacePath, producerName, 'provider');
    const modelId = formatProducerScopedInputId(namespacePath, producerName, 'model');
    values[providerId] = selection.provider;
    values[modelId] = selection.model;
    if (selection.config && typeof selection.config === 'object') {
      const flattened = flattenConfig(selection.config);
      for (const [key, value] of Object.entries(flattened)) {
        const canonicalKey = formatProducerScopedInputId(namespacePath, producerName, key);
        values[canonicalKey] = value;
      }
    }
  }
}

function flattenConfig(source: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenConfig(value as Record<string, unknown>, nextKey));
    } else {
      result[nextKey] = value;
    }
  }
  return result;
}

function collectProducerScopedInputs(
  tree: BlueprintTreeNode,
): CanonicalInputEntry[] {
  const entries: Map<string, CanonicalInputEntry> = new Map();

  const addEntry = (namespacePath: string[], producerName: string, name: string) => {
    const canonicalId = formatProducerScopedInputId(namespacePath, producerName, name);
    if (!entries.has(canonicalId)) {
      entries.set(canonicalId, {
        canonicalId,
        name,
        namespacePath,
        definition: {
          name,
          type: 'unknown',
          required: false,
        },
      });
    }
  };

  const visit = (node: BlueprintTreeNode) => {
    for (const producer of node.document.producers) {
      const namespacePath = node.namespacePath;
      const producerName = producer.name;

      addEntry(namespacePath, producerName, 'provider');
      addEntry(namespacePath, producerName, 'model');

      const variants: ProducerModelVariant[] = Array.isArray(producer.models)
        ? producer.models
        : producer.provider && producer.model
          ? [{
            provider: producer.provider,
            model: producer.model,
            config: producer.config,
            settings: producer.settings,
            systemPrompt: producer.systemPrompt,
            userPrompt: producer.userPrompt,
            textFormat: producer.textFormat,
            variables: producer.variables,
          }]
          : [];

      const addFlattenedConfig = (variant: ProducerModelVariant) => {
        const flattened = flattenConfig(variant.config ?? {});
        for (const key of Object.keys(flattened)) {
          addEntry(namespacePath, producerName, key);
        }
        if (variant.systemPrompt) {
          addEntry(namespacePath, producerName, 'systemPrompt');
        }
        if (variant.userPrompt) {
          addEntry(namespacePath, producerName, 'userPrompt');
        }
        if (variant.variables) {
          addEntry(namespacePath, producerName, 'variables');
        }
        const legacyFormat = (variant as unknown as Record<string, unknown>).text_format;
        if (variant.textFormat || legacyFormat) {
          addEntry(namespacePath, producerName, 'text_format');
          addEntry(namespacePath, producerName, 'textFormat');
        }
        if (variant.outputSchema) {
          addEntry(namespacePath, producerName, 'responseFormat');
        }
      };

      for (const variant of variants) {
        addFlattenedConfig(variant);
      }
    }
    for (const child of node.children.values()) {
      visit(child);
    }
  };

  visit(tree);
  return Array.from(entries.values());
}

function resolveModelSelections(
  raw: unknown,
  index: ProducerIndex,
  rawInputs?: Record<string, unknown>,
): ModelSelection[] {
  const selections = new Map<string, ModelSelection>();

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') {
        throw new Error(`Invalid model entry in inputs file: ${JSON.stringify(entry)}`);
      }
      const record = entry as Record<string, unknown>;
      const producerId = readString(record, 'producerId');
      const provider = readString(record, 'provider');
      const model = readString(record, 'model');
      const config =
        record.config && typeof record.config === 'object' ? (record.config as Record<string, unknown>) : undefined;
      const resolved = resolveProducerName(producerId, index);
      selections.set(resolved.qualifiedName, {
        producerId: resolved.qualifiedName,
        provider,
        model,
        config,
        namespacePath: resolved.namespacePath,
      });
    }
  }

    if (rawInputs && typeof rawInputs === 'object') {
      mergeSelectionsFromInputs(rawInputs as Record<string, unknown>, index, selections);
    }

  return Array.from(selections.values());
}

function mergeSelectionsFromInputs(
  rawInputs: Record<string, unknown>,
  index: ProducerIndex,
  selections: Map<string, ModelSelection>,
): void {
  const pending = new Map<string, {
    producerId: string;
    namespacePath: string[];
    provider?: string;
    model?: string;
    config?: Record<string, unknown>;
  }>();

  for (const [rawKey, value] of Object.entries(rawInputs)) {
    const body = isCanonicalInputId(rawKey) ? rawKey.slice('Input:'.length) : rawKey;
    const match = matchProducerScopedKey(body, index);
    if (!match) {
      continue;
    }
    const existing = selections.get(match.producerId);
    if (existing) {
      continue;
    }
    const entry = pending.get(match.producerId) ?? {
      producerId: match.producerId,
      namespacePath: match.namespacePath,
      config: {},
    };
    if (match.keyPath === 'provider') {
      if (typeof value !== 'string') {
        continue;
      }
      entry.provider = value;
    } else if (match.keyPath === 'model') {
      if (typeof value !== 'string') {
        continue;
      }
      entry.model = value;
    } else {
      assignNestedConfig(entry.config as Record<string, unknown>, match.keyPath, value);
    }
    pending.set(match.producerId, entry);
  }

  for (const entry of pending.values()) {
    if (!entry.provider || !entry.model) {
      continue;
    }
    selections.set(entry.producerId, {
      producerId: entry.producerId,
      namespacePath: entry.namespacePath,
      provider: entry.provider,
      model: entry.model,
      config: Object.keys(entry.config ?? {}).length > 0 ? entry.config : undefined,
    });
  }
}

function matchProducerScopedKey(
  body: string,
  index: ProducerIndex,
): { producerId: string; namespacePath: string[]; keyPath: string } | null {
  for (const [qualified, entry] of index.byQualified) {
    if (body.startsWith(`${qualified}.`)) {
      return {
        producerId: qualified,
        namespacePath: entry.namespacePath,
        keyPath: body.slice(qualified.length + 1),
      };
    }
  }
  return null;
}

function assignNestedConfig(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return;
  }
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < segments.length; i += 1) {
    const key = segments[i]!;
    if (i === segments.length - 1) {
      cursor[key] = value;
      return;
    }
    const next = cursor[key];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
}

function collectSelectionEntries(selections: ModelSelection[]): CanonicalInputEntry[] {
  const entries: Map<string, CanonicalInputEntry> = new Map();
  for (const selection of selections) {
    const namespacePath = selection.namespacePath ?? [];
    const { producerName: producer } = parseQualifiedProducerName(selection.producerId);
    const flattened = flattenConfig(selection.config ?? {});
    for (const key of Object.keys(flattened)) {
      const canonicalId = formatProducerScopedInputId(namespacePath, producer, key);
      if (!entries.has(canonicalId)) {
        entries.set(canonicalId, {
          canonicalId,
          name: key,
          namespacePath,
          definition: {
            name: key,
            type: 'unknown',
            required: false,
          },
        });
      }
    }
  }
  return Array.from(entries.values());
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  throw new Error(`Expected string for "${key}" in models entry`);
}
