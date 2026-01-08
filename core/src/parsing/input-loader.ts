import { readFile } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { resolveFileReferences } from './file-input-resolver.js';
import {
  parseOutputs,
} from './blueprint-loader/yaml-parser.js';
import {
  createInputIdResolver,
  type CanonicalInputEntry,
  formatProducerAlias,
  formatProducerScopedInputId,
  isCanonicalInputId,
  parseQualifiedProducerName,
} from './canonical-ids.js';
import { createParserError, ParserErrorCode } from '../errors/index.js';
import type {
  BlobInput,
  BlueprintProducerOutputDefinition,
  BlueprintTreeNode,
  ProducerModelVariant,
} from '../types.js';
import { isBlobInput } from '../types.js';

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
  /** Output definitions for the model */
  outputs?: Record<string, BlueprintProducerOutputDefinition>;
  /** Inline system prompt for LLM models */
  systemPrompt?: string;
  /** Inline user prompt for LLM models */
  userPrompt?: string;
  /** Text format for LLM output (e.g., 'json_schema') */
  textFormat?: string;
  /** Variables to extract from prompt template */
  variables?: string[];
}

/** Artifact override from inputs.yaml with file: prefix */
export interface ArtifactOverride {
  /** Canonical artifact ID, e.g., "Artifact:ScriptProducer.NarrationScript[0]" */
  artifactId: string;
  /** The blob data loaded from the file */
  blob: BlobInput;
}

export interface LoadedInputs {
  values: InputMap;
  modelSelections: ModelSelection[];
  /** Artifact overrides detected from inputs (keys like ProducerName.ArtifactName[index]: file:...) */
  artifactOverrides: ArtifactOverride[];
}

export async function loadInputsFromYaml(
  filePath: string,
  blueprint: BlueprintTreeNode,
): Promise<LoadedInputs> {
  validateYamlExtension(filePath);
  const contents = await readFile(filePath, 'utf8');
  const parsed = parseYaml(contents) as RawInputsFile;
  const rawInputs = resolveInputSection(parsed);

  // Extract potential artifact override keys BEFORE canonicalization
  // (they would fail validation since they're not inputs)
  const { regularInputs, potentialArtifactOverrides } = separateArtifactOverrideKeys(rawInputs);

  const producerIndex = indexProducers(blueprint);
  const modelSelections = resolveModelSelections(parsed.models, producerIndex, regularInputs);
  const selectionEntries = collectSelectionEntries(modelSelections);
  const syntheticInputs = [
    ...collectProducerScopedInputs(blueprint),
    ...selectionEntries,
  ];
  const resolver = createInputIdResolver(blueprint, syntheticInputs);
  const values = canonicalizeInputs(regularInputs, resolver);

  const missingRequired = resolver.entries
    .filter((entry) => entry.namespacePath.length === 0 && entry.definition.required)
    .filter((entry) => values[entry.canonicalId] === undefined)
    .map((entry) => entry.canonicalId);

  if (missingRequired.length > 0) {
    throw createParserError(
      ParserErrorCode.MISSING_INPUTS_MAPPING,
      `Input file missing required fields: ${missingRequired.join(', ')}`,
      { filePath },
    );
  }

  // Note: Blueprint defaults are no longer applied here - model JSON schemas are the source of truth
  // Provider APIs will use their own defaults for optional fields not provided by the user

  applyModelSelectionsToInputs(values, modelSelections);

  // Resolve file: references to BlobInput objects (for regular inputs)
  const fileContext = { baseDir: dirname(filePath) };
  const resolvedValues = await resolveAllFileReferences(values, fileContext);

  // Resolve file: references in artifact override values and convert to ArtifactOverride[]
  const artifactOverrides = await resolveArtifactOverrides(potentialArtifactOverrides, fileContext);

  return { values: resolvedValues, modelSelections, artifactOverrides };
}

function validateYamlExtension(filePath: string): void {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.yaml' || extension === '.yml') {
    return;
  }
  throw createParserError(
    ParserErrorCode.INVALID_INPUT_FILE_EXTENSION,
    `Input files must be YAML (*.yaml or *.yml). Received: ${filePath}`,
    { filePath },
  );
}

function resolveInputSection(raw: RawInputsFile): Record<string, unknown> {
  if (raw && typeof raw === 'object' && raw.inputs && typeof raw.inputs === 'object') {
    return { ...(raw.inputs as Record<string, unknown>) };
  }
  if (raw && typeof raw === 'object') {
    return { ...(raw as Record<string, unknown>) };
  }
  throw createParserError(
    ParserErrorCode.MISSING_INPUTS_MAPPING,
    'Input file must define an inputs mapping with key/value pairs.',
  );
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
      throw createParserError(
        ParserErrorCode.DUPLICATE_INPUT_KEY,
        `Duplicate input value for "${canonical}".`,
      );
    }
    resolved[canonical] = value;
  }
  return resolved;
}

interface ProducerIndex {
  byAlias: Map<string, { namespacePath: string[]; producerName: string; producerAlias: string }>;
}

function indexProducers(tree: BlueprintTreeNode): ProducerIndex {
  const byAlias = new Map<string, { namespacePath: string[]; producerName: string; producerAlias: string }>();

  const visit = (node: BlueprintTreeNode) => {
    for (const producer of node.document.producers) {
      const producerAlias = formatProducerAlias(node.namespacePath, producer.name);
      byAlias.set(producerAlias, {
        namespacePath: node.namespacePath,
        producerName: producer.name,
        producerAlias,
      });
    }
    for (const child of node.children.values()) {
      visit(child);
    }
  };

  visit(tree);
  return { byAlias };
}

function resolveProducerName(
  authored: string,
  index: ProducerIndex,
): { namespacePath: string[]; producerAlias: string; producerName: string } {
  const direct = index.byAlias.get(authored);
  if (direct) {
    return direct;
  }
  throw createParserError(
    ParserErrorCode.UNKNOWN_PRODUCER_IN_MODELS,
    `Unknown producer "${authored}" in models selection.`,
  );
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
        throw createParserError(
          ParserErrorCode.INVALID_MODEL_ENTRY,
          `Invalid model entry in inputs file: ${JSON.stringify(entry)}`,
        );
      }
      const record = entry as Record<string, unknown>;
      const producerId = readString(record, 'producerId');
      const provider = readString(record, 'provider');
      const model = readString(record, 'model');
      const config =
        record.config && typeof record.config === 'object' ? (record.config as Record<string, unknown>) : undefined;

      // Parse outputs (SDK mappings now come from producer YAML, not input YAML)
      const outputs = parseOutputs(record.outputs);

      // Parse inline LLM config (promptFile/outputSchema are now in producer meta, not here)
      const systemPrompt = typeof record.systemPrompt === 'string' ? record.systemPrompt : undefined;
      const userPrompt = typeof record.userPrompt === 'string' ? record.userPrompt : undefined;
      const textFormat = typeof record.textFormat === 'string' ? record.textFormat : undefined;
      const variables = Array.isArray(record.variables) ? record.variables.map(String) : undefined;

      const resolved = resolveProducerName(producerId, index);
      selections.set(resolved.producerAlias, {
        producerId: resolved.producerAlias,
        provider,
        model,
        config,
        namespacePath: resolved.namespacePath,
        outputs,
        systemPrompt,
        userPrompt,
        textFormat,
        variables,
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
  for (const [alias, entry] of index.byAlias) {
    if (body.startsWith(`${alias}.`)) {
      return {
        producerId: alias,
        namespacePath: entry.namespacePath,
        keyPath: body.slice(alias.length + 1),
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
  throw createParserError(
    ParserErrorCode.MISSING_REQUIRED_FIELD,
    `Expected string for "${key}" in models entry`,
  );
}

async function resolveAllFileReferences(
  values: Record<string, unknown>,
  context: { baseDir: string },
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    resolved[key] = await resolveFileReferences(value, context);
  }
  return resolved;
}

/**
 * Check if a key looks like an artifact override.
 * Matches paths with numeric indices like:
 *   - ScriptProducer.NarrationScript[0]
 *   - ImageProducer.SegmentImage[0][1]
 *   - DocProducer.VideoScript.Segments[0].ImagePrompts[0] (decomposed artifacts)
 *   - Artifact:ScriptProducer.NarrationScript[0] (canonical form)
 */
function isArtifactOverrideKey(key: string): boolean {
  // Strip the "Artifact:" prefix if present
  const body = key.startsWith('Artifact:') ? key.slice('Artifact:'.length) : key;

  // Must have at least one numeric index like [0], [1], etc.
  if (!/\[\d+\]/.test(body)) {
    return false;
  }

  // Must have at least one dot (ProducerName.ArtifactName at minimum)
  if (!body.includes('.')) {
    return false;
  }

  // Must start with an identifier (letter followed by alphanumerics)
  if (!/^[A-Za-z][A-Za-z0-9]*/.test(body)) {
    return false;
  }

  return true;
}

/**
 * Convert an artifact override key to canonical artifact ID format.
 * E.g., "ScriptProducer.NarrationScript[0]" -> "Artifact:ScriptProducer.NarrationScript[0]"
 */
function toCanonicalArtifactId(key: string): string {
  // If already prefixed with "Artifact:", return as-is
  if (key.startsWith('Artifact:')) {
    return key;
  }
  return `Artifact:${key}`;
}

/**
 * Separate artifact override keys from regular input keys.
 * Artifact overrides have the pattern ProducerName.ArtifactName[index].
 */
function separateArtifactOverrideKeys(
  rawInputs: Record<string, unknown>,
): { regularInputs: Record<string, unknown>; potentialArtifactOverrides: Record<string, unknown> } {
  const regularInputs: Record<string, unknown> = {};
  const potentialArtifactOverrides: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(rawInputs)) {
    if (isArtifactOverrideKey(key)) {
      potentialArtifactOverrides[key] = value;
    } else {
      regularInputs[key] = value;
    }
  }

  return { regularInputs, potentialArtifactOverrides };
}

/**
 * Resolve file references in artifact override values and convert to ArtifactOverride[].
 * Only values that are file references (file:...) and resolve to BlobInput are included.
 */
async function resolveArtifactOverrides(
  potentialOverrides: Record<string, unknown>,
  fileContext: { baseDir: string },
): Promise<ArtifactOverride[]> {
  const overrides: ArtifactOverride[] = [];

  for (const [key, value] of Object.entries(potentialOverrides)) {
    // Resolve file reference if present
    const resolved = await resolveFileReferences(value, fileContext);

    // Only include if the resolved value is a BlobInput
    if (isBlobInput(resolved)) {
      overrides.push({
        artifactId: toCanonicalArtifactId(key),
        blob: resolved,
      });
    } else {
      // Non-blob artifact overrides are currently not supported
      throw createParserError(
        ParserErrorCode.INVALID_ARTIFACT_OVERRIDE,
        `Artifact override "${key}" must be a file reference (file:...). ` +
        `Got: ${typeof resolved === 'string' ? resolved : typeof resolved}`,
      );
    }
  }

  return overrides;
}
