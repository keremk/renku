import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import { promises as fs } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import type { FileStorage } from '@flystorage/file-storage';
import type {
  ArrayDimensionMapping,
  BlueprintArtefactDefinition,
  BlueprintDocument,
  BlueprintEdgeDefinition,
  BlueprintInputDefinition,
  BlueprintProducerOutputDefinition,
  BlueprintProducerSdkMappingField,
  BlueprintTreeNode,
  JsonSchemaDefinition,
  JsonSchemaProperty,
  ProducerModelVariant,
  ProducerConfig,
  ProducerImportDefinition,
} from '../../types.js';
import { parseDimensionSelector } from '../dimension-selectors.js';

export interface BlueprintResourceReader {
  // eslint-disable-next-line no-unused-vars
  readFile(filePath: string): Promise<string>;
}

export interface BlueprintParseOptions {
  reader?: BlueprintResourceReader;
}

export interface BlueprintLoadOptions extends BlueprintParseOptions {}

class NodeFilesystemReader implements BlueprintResourceReader {
  async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf8');
  }
}

const defaultReader = new NodeFilesystemReader();

export function createFlyStorageBlueprintReader(
  storage: FileStorage,
  rootDir: string,
): BlueprintResourceReader {
  const normalizedRoot = resolve(rootDir);
  return {
    async readFile(target: string): Promise<string> {
      const absolute = resolve(target);
      if (!absolute.startsWith(normalizedRoot)) {
        throw new Error(
          `Blueprint path "${target}" is outside configured root "${normalizedRoot}".`,
        );
      }
      const relativePath = relativePosix(normalizedRoot, absolute);
      return storage.readToString(relativePath);
    },
  };
}

export async function parseYamlBlueprintFile(
  filePath: string,
  options: BlueprintParseOptions = {},
): Promise<BlueprintDocument> {
  const reader = options.reader ?? defaultReader;
  const absolute = resolve(filePath);
  const contents = await reader.readFile(absolute);
  const raw = parseYaml(contents) as RawBlueprint;
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Blueprint YAML at ${filePath} must be a YAML document.`);
  }
  const baseDir = dirname(absolute);
  const meta = parseMeta(raw.meta, filePath);

  const inputs = Array.isArray(raw.inputs) ? raw.inputs.map((entry) => parseInput(entry)) : [];
  const loops = Array.isArray(raw.loops) ? parseLoops(raw.loops) : [];
  const loopSymbols = new Set(loops.map((loop) => loop.name));
  const artefactSource = Array.isArray(raw.artifacts)
    ? raw.artifacts
    : Array.isArray(raw.artefacts)
      ? raw.artefacts
      : [];
  if (artefactSource.length === 0) {
    throw new Error(`Blueprint YAML at ${filePath} must declare at least one artifact.`);
  }
  let artefacts = artefactSource.map((entry) => parseArtefact(entry));
  // Accept `producers:` section, with fallback to deprecated `modules:` for backwards compatibility
  const rawProducerImports = Array.isArray(raw.producers)
    ? raw.producers
    : Array.isArray(raw.modules)
      ? raw.modules
      : [];
  const producerImports = rawProducerImports.map((entry) => parseProducerImport(entry));
  let edges = Array.isArray(raw.connections)
    ? raw.connections.map((entry) => parseEdge(entry, loopSymbols))
    : [];
  const producers: ProducerConfig[] = [];
  const isProducerBlueprint = producerImports.length === 0;
  if (isProducerBlueprint) {
    if (!Array.isArray(raw.models) || raw.models.length === 0) {
      throw new Error(`Blueprint YAML at ${filePath} must declare a models array with at least one entry for the producer.`);
    }
    const modelVariants = await parseModelVariants(raw.models, baseDir, reader);
    const primary = modelVariants[0];
    producers.push({
      name: meta.id,
      provider: primary?.provider,
      model: primary?.model,
      models: modelVariants,
      sdkMapping: primary?.inputs,
      outputs: primary?.outputs,
      systemPrompt: primary?.systemPrompt,
      userPrompt: primary?.userPrompt,
      textFormat: primary?.textFormat,
      variables: primary?.variables,
      config: primary?.config,
    });
    // Copy the output schema from the primary model variant to JSON artifacts with arrays
    // This enables schema decomposition for these artifacts
    if (primary?.outputSchemaParsed) {
      artefacts = artefacts.map((art) => {
        if (art.type === 'json' && art.arrays && art.arrays.length > 0) {
          return { ...art, schema: primary.outputSchemaParsed };
        }
        return art;
      });
    }
    if (edges.length === 0) {
      edges = inferProducerEdges(inputs, artefacts, meta.id);
    }
  } else if (Array.isArray(raw.models) && raw.models.length > 0) {
    throw new Error(`Blueprint YAML at ${filePath} defines producers and models. Only producer leaf blueprints should declare models.`);
  }
  const collectors = Array.isArray(raw.collectors)
    ? parseCollectors(raw.collectors, loopSymbols)
    : [];

  return {
    meta,
    inputs,
    artefacts,
    producers,
    producerImports,
    edges,
    collectors,
    loops: loops.length > 0 ? loops : undefined,
  };
}

export async function loadYamlBlueprintTree(
  entryPath: string,
  options: BlueprintLoadOptions = {},
): Promise<{ root: BlueprintTreeNode }> {
  const reader = options.reader ?? defaultReader;
  const absolute = resolve(entryPath);
  const visiting = new Set<string>();
  const root = await loadNode(absolute, [], reader, visiting);
  return { root };
}

async function loadNode(
  filePath: string,
  namespacePath: string[],
  reader: BlueprintResourceReader,
  visiting: Set<string>,
): Promise<BlueprintTreeNode> {
  const absolute = resolve(filePath);
  if (visiting.has(absolute)) {
    throw new Error(`Detected circular blueprint reference at ${absolute}`);
  }
  visiting.add(absolute);
  const document = await parseYamlBlueprintFile(absolute, { reader });
  const node: BlueprintTreeNode = {
    id: document.meta.id,
    namespacePath,
    document,
    children: new Map(),
  };

  // Producer imports use the alias as a scope for their internal nodes.
  // This is NOT a hierarchical namespace - it's producer aliasing to avoid conflicts.
  for (const producerImport of document.producerImports) {
    const childPath = resolveProducerImportPath(absolute, producerImport);
    // Use the producer alias as a scope for the producer's nodes
    const aliasPath = [...namespacePath, producerImport.name];
    const child = await loadNode(childPath, aliasPath, reader, visiting);
    node.children.set(producerImport.name, child);
  }

  visiting.delete(absolute);
  return node;
}

function resolveProducerImportPath(parentFile: string, producerImport: ProducerImportDefinition): string {
  const directory = dirname(parentFile);
  if (producerImport.path) {
    return resolve(directory, producerImport.path);
  }
  return resolve(directory, `${producerImport.name}.yaml`);
}

interface RawBlueprint {
  meta?: unknown;
  inputs?: unknown[];
  artifacts?: unknown[];
  artefacts?: unknown[];
  loops?: unknown[];
  /** New: producer imports section */
  producers?: unknown[];
  /** @deprecated Use `producers:` instead. Kept for backwards compatibility. */
  modules?: unknown[];
  connections?: unknown[];
  collectors?: unknown[];
  models?: unknown[];
}

function parseMeta(raw: unknown, filePath: string): BlueprintDocument['meta'] {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Blueprint YAML at ${filePath} must include a meta section.`);
  }
  const meta = raw as Record<string, unknown>;
  const id = readString(meta, 'id');
  const name = readString(meta, 'name');
  return {
    id,
    name,
    version: meta.version ? String(meta.version) : undefined,
    description: meta.description ? String(meta.description) : undefined,
    author: meta.author ? String(meta.author) : undefined,
    license: meta.license ? String(meta.license) : undefined,
  };
}

function parseLoops(rawLoops: unknown[]): Array<{ name: string; parent?: string; countInput: string; countInputOffset?: number }> {
  const loops: Array<{ name: string; parent?: string; countInput: string; countInputOffset?: number }> = [];
  const seen = new Set<string>();
  for (const raw of rawLoops) {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`Invalid loop entry: ${JSON.stringify(raw)}`);
    }
    const loop = raw as Record<string, unknown>;
    const name = readString(loop, 'name');
    if (seen.has(name)) {
      throw new Error(`Duplicate loop name "${name}".`);
    }
    const parent = loop.parent ? readString(loop, 'parent') : undefined;
    const countInput = readString(loop, 'countInput');
    const countInputOffset = readOptionalNonNegativeInteger(loop, 'countInputOffset');
    loops.push({ name, parent, countInput, countInputOffset });
    seen.add(name);
  }
  return loops;
}

function parseInput(raw: unknown): BlueprintInputDefinition {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid input entry: ${JSON.stringify(raw)}`);
  }
  const input = raw as Record<string, unknown>;
  const name = readString(input, 'name');
  const type = readString(input, 'type');
  const required = input.required === false ? false : true;
  const description = typeof input.description === 'string' ? input.description : undefined;
  const defaultValue = input.default ?? input.defaultValue;
  if (!required && defaultValue === undefined) {
    throw new Error(`Optional input "${name}" must declare a default value.`);
  }
  return {
    name,
    type,
    required,
    description,
    defaultValue,
    fanIn: input.fanIn === true,
  };
}

function parseArtefact(raw: unknown): BlueprintArtefactDefinition {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid artifact entry: ${JSON.stringify(raw)}`);
  }
  const artefact = raw as Record<string, unknown>;
  const name = readString(artefact, 'name');
  const type = readString(artefact, 'type');
  const countInput = typeof artefact.countInput === 'string' ? artefact.countInput : undefined;
  const countInputOffset = readOptionalNonNegativeInteger(artefact, 'countInputOffset');
  if (countInputOffset !== undefined && !countInput) {
    throw new Error(`Artifact "${name}" declares countInputOffset but is missing countInput.`);
  }
  const arrays = parseArraysMetadata(artefact.arrays);
  return {
    name,
    type,
    description: typeof artefact.description === 'string' ? artefact.description : undefined,
    itemType: typeof artefact.itemType === 'string' ? artefact.itemType : undefined,
    countInput,
    countInputOffset,
    required: artefact.required === false ? false : true,
    arrays,
  };
}

function parseArraysMetadata(raw: unknown): ArrayDimensionMapping[] | undefined {
  if (!raw || !Array.isArray(raw)) {
    return undefined;
  }
  return raw.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Invalid arrays entry: ${JSON.stringify(entry)}`);
    }
    const obj = entry as Record<string, unknown>;
    const path = readString(obj, 'path');
    const countInput = readString(obj, 'countInput');
    const countInputOffset = readOptionalNonNegativeInteger(obj, 'countInputOffset');
    return { path, countInput, countInputOffset };
  });
}

function parseProducerImport(raw: unknown): ProducerImportDefinition {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid producer import entry: ${JSON.stringify(raw)}`);
  }
  const entry = raw as Record<string, unknown>;
  const name = readString(entry, 'name');
  return {
    name,
    path: typeof entry.path === 'string' ? entry.path : undefined,
    description: typeof entry.description === 'string' ? entry.description : undefined,
    loop: typeof entry.loop === 'string' ? entry.loop.trim() : undefined,
  };
}

function parseCollectors(
  rawCollectors: unknown[],
  loopSymbols: Set<string>,
): BlueprintDocument['collectors'] {
  const collectors: BlueprintDocument['collectors'] = [];
  const seenTargets = new Set<string>();
  for (const raw of rawCollectors) {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`Invalid collector entry: ${JSON.stringify(raw)}`);
    }
    const entry = raw as Record<string, unknown>;
    const name = readString(entry, 'name');
    const from = readString(entry, 'from');
    const into = readString(entry, 'into');
    const groupBy = readString(entry, 'groupBy');
    if (!loopSymbols.has(groupBy)) {
      throw new Error(`Collector "${name}" references unknown loop "${groupBy}". Declare it under loops[].`);
    }
    const orderByRaw = entry.orderBy;
    const orderBy =
      typeof orderByRaw === 'string' && orderByRaw.trim().length > 0
        ? orderByRaw.trim()
        : undefined;
    if (orderBy && !loopSymbols.has(orderBy)) {
      throw new Error(`Collector "${name}" references unknown orderBy loop "${orderBy}".`);
    }
    const targetKey = `${into}:${groupBy}`;
    if (seenTargets.has(targetKey)) {
      throw new Error(`Collector "${name}" duplicates collection for target "${into}" and group "${groupBy}".`);
    }
    seenTargets.add(targetKey);
    collectors.push({
      name,
      from,
      into,
      groupBy,
      orderBy,
    });
  }
  return collectors;
}

function parseEdge(raw: unknown, allowedDimensions: Set<string>): BlueprintEdgeDefinition {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid connection entry: ${JSON.stringify(raw)}`);
  }
  const edge = raw as Record<string, unknown>;
  const from = normalizeReference(readString(edge, 'from'));
  const to = normalizeReference(readString(edge, 'to'));
  validateDimensions(from, allowedDimensions, 'from');
  validateDimensions(to, allowedDimensions, 'to');
  return {
    from,
    to,
    note: typeof edge.note === 'string' ? edge.note : undefined,
  };
}

async function parseModelVariants(
  rawModels: unknown[],
  baseDir: string,
  reader: BlueprintResourceReader,
): Promise<ProducerModelVariant[]> {
  const variants: ProducerModelVariant[] = [];
  for (const raw of rawModels) {
    variants.push(await parseModelVariant(raw, baseDir, reader));
  }
  return variants;
}

async function parseModelVariant(
  raw: unknown,
  baseDir: string,
  reader: BlueprintResourceReader,
): Promise<ProducerModelVariant> {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid model entry: ${JSON.stringify(raw)}`);
  }
  const entry = raw as Record<string, unknown>;
  const provider = readString(entry, 'provider').toLowerCase();
  const promptFile = typeof entry.promptFile === 'string' ? entry.promptFile : undefined;
  const promptConfig = promptFile
    ? await loadPromptConfig(resolve(baseDir, promptFile), reader)
    : {};
  const model = typeof entry.model === 'string' ? entry.model : promptConfig.model;
  if (!model) {
    throw new Error('Model entry must specify a model (directly or in promptFile).');
  }
  const textFormat = typeof entry.textFormat === 'string' ? entry.textFormat : promptConfig.textFormat;
  const variables = Array.isArray(entry.variables)
    ? entry.variables.map(String)
    : promptConfig.variables;
  const systemPrompt = typeof entry.systemPrompt === 'string'
    ? entry.systemPrompt
    : promptConfig.systemPrompt;
  const userPrompt = typeof entry.userPrompt === 'string' ? entry.userPrompt : promptConfig.userPrompt;
  const inputSchemaSource = entry.inputSchema;
  const outputSchemaSource = entry.outputSchema;
  const inputSchema = await loadJsonSchema(inputSchemaSource, baseDir, reader);
  const outputSchema = await loadJsonSchema(outputSchemaSource, baseDir, reader);
  const outputSchemaParsed = outputSchema ? parseJsonSchemaDefinition(outputSchema) : undefined;
  const inputs = parseSdkMapping(entry.inputs);
  const outputs = parseOutputs(entry.outputs ?? promptConfig.outputs);
  const config =
    entry.config && typeof entry.config === 'object'
      ? (entry.config as Record<string, unknown>)
      : promptConfig.config;

  return {
    provider: provider as ProducerModelVariant['provider'],
    model,
    promptFile,
    inputSchema,
    outputSchema,
    outputSchemaParsed,
    inputs,
    outputs,
    config,
    systemPrompt,
    userPrompt,
    textFormat,
    variables,
  };
}

function parseSdkMapping(raw: unknown): Record<string, BlueprintProducerSdkMappingField> | undefined {
  if (!raw) {
    return undefined;
  }
  if (typeof raw !== 'object') {
    throw new Error(`Invalid sdkMapping entry: ${JSON.stringify(raw)}`);
  }
  const table = raw as Record<string, unknown>;
  const mapping: Record<string, BlueprintProducerSdkMappingField> = {};
  for (const [key, value] of Object.entries(table)) {
    if (typeof value === 'string') {
      mapping[key] = { field: value };
      continue;
    }
    if (!value || typeof value !== 'object') {
      throw new Error(`Invalid sdkMapping field for ${key}.`);
    }
    const fieldConfig = value as Record<string, unknown>;
    const field =
      typeof fieldConfig.field === 'string' && fieldConfig.field.trim().length > 0
        ? fieldConfig.field
        : typeof fieldConfig.name === 'string'
          ? fieldConfig.name
          : undefined;
    if (!field) {
      throw new Error(`Invalid sdkMapping field for ${key}.`);
    }
    mapping[key] = {
      field,
      type: typeof fieldConfig.type === 'string' ? fieldConfig.type : undefined,
      required: fieldConfig.required === true ? true : fieldConfig.required === false ? false : undefined,
    };
  }
  return Object.keys(mapping).length ? mapping : undefined;
}

function parseOutputs(raw: unknown): Record<string, BlueprintProducerOutputDefinition> | undefined {
  if (!raw) {
    return undefined;
  }
  if (typeof raw !== 'object') {
    throw new Error(`Invalid outputs entry: ${JSON.stringify(raw)}`);
  }
  const table = raw as Record<string, unknown>;
  const outputs: Record<string, BlueprintProducerOutputDefinition> = {};
  for (const [key, value] of Object.entries(table)) {
    if (!value || typeof value !== 'object') {
      throw new Error(`Invalid producer output entry for ${key}.`);
    }
    const output = value as Record<string, unknown>;
    outputs[key] = {
      type: readString(output, 'type'),
      mimeType: typeof output.mimeType === 'string' ? output.mimeType : undefined,
    };
  }
  return Object.keys(outputs).length ? outputs : undefined;
}

async function loadPromptConfig(
  promptPath: string,
  reader: BlueprintResourceReader,
): Promise<PromptConfig> {
  const contents = await reader.readFile(promptPath);
  const parsed = parseToml(contents) as Record<string, unknown>;
  const baseDir = dirname(promptPath);
  const prompt: PromptConfig = {};
  if (typeof parsed.model === 'string') {
    prompt.model = parsed.model;
  }
  if (typeof parsed.textFormat === 'string') {
    prompt.textFormat = parsed.textFormat;
  }
  if (Array.isArray(parsed.variables)) {
    prompt.variables = parsed.variables.map(String);
  }
  if (typeof parsed.systemPrompt === 'string') {
    prompt.systemPrompt = parsed.systemPrompt;
  }
  if (typeof parsed.userPrompt === 'string') {
    prompt.userPrompt = parsed.userPrompt;
  }
  if (parsed.config && typeof parsed.config === 'object') {
    prompt.config = parsed.config as Record<string, unknown>;
  }
  if (parsed.jsonSchema !== undefined) {
    prompt.jsonSchema = await loadJsonSchema(parsed.jsonSchema, baseDir, reader);
  }
  return prompt;
}

async function loadJsonSchema(
  source: unknown,
  baseDir: string,
  reader: BlueprintResourceReader,
): Promise<string | undefined> {
  if (source === undefined || source === null) {
    return undefined;
  }
  if (typeof source === 'object') {
    return JSON.stringify(source, null, 2);
  }
  const raw = String(source).trim();
  if (!raw) {
    return undefined;
  }
  if (raw.startsWith('{') || raw.startsWith('[')) {
    return JSON.stringify(JSON.parse(raw), null, 2);
  }
  const absolute = resolve(baseDir, raw);
  const contents = await reader.readFile(absolute);
  return JSON.stringify(JSON.parse(contents), null, 2);
}

/**
 * Parses a JSON schema string into a typed JsonSchemaDefinition.
 */
function parseJsonSchemaDefinition(schemaJson: string): JsonSchemaDefinition {
  const parsed = JSON.parse(schemaJson);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid JSON schema: expected an object');
  }
  const name = typeof parsed.name === 'string' ? parsed.name : 'Schema';
  const strict = typeof parsed.strict === 'boolean' ? parsed.strict : undefined;
  const schema = parsed.schema ?? parsed;
  return { name, strict, schema };
}

function validateDimensions(reference: string, allowed: Set<string>, label: 'from' | 'to'): void {
  parseReference(reference, allowed, label);
}

function parseReference(reference: string, allowed: Set<string>, label: 'from' | 'to'): void {
  if (typeof reference !== 'string' || reference.trim().length === 0) {
    throw new Error(`Invalid ${label} reference "${reference}".`);
  }
  for (const segment of reference.split('.')) {
    const match = segment.match(/^[A-Za-z0-9_]+/);
    if (!match) {
      throw new Error(`Invalid ${label} reference "${reference}".`);
    }
    let remainder = segment.slice(match[0].length);
    while (remainder.length > 0) {
      if (!remainder.startsWith('[')) {
        throw new Error(`Invalid dimension syntax in ${label} reference "${reference}".`);
      }
      const closeIndex = remainder.indexOf(']');
      if (closeIndex === -1) {
        throw new Error(`Unclosed dimension in ${label} reference "${reference}".`);
      }
      const symbol = remainder.slice(1, closeIndex).trim();
      if (!symbol) {
        throw new Error(`Empty dimension in ${label} reference "${reference}".`);
      }
      const selector = parseDimensionSelector(symbol);
      if (selector.kind === 'loop' && !allowed.has(selector.symbol)) {
        throw new Error(
          `Unknown dimension "${selector.symbol}" in ${label} reference "${reference}". Declare it under loops[].`,
        );
      }
      remainder = remainder.slice(closeIndex + 1);
    }
  }
}

function normalizeReference(raw: string): string {
  return raw;
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  throw new Error(`Expected string for "${key}"`);
}

function readOptionalNonNegativeInteger(source: Record<string, unknown>, key: string): number | undefined {
  const raw = source[key];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw === 'number' && Number.isFinite(raw) && Number.isInteger(raw)) {
    if (raw < 0) {
      throw new Error(`Expected "${key}" to be a non-negative integer.`);
    }
    return raw;
  }
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const trimmed = raw.trim();
    if (!/^[0-9]+$/.test(trimmed)) {
      throw new Error(`Expected "${key}" to be a non-negative integer.`);
    }
    return parseInt(trimmed, 10);
  }
  throw new Error(`Expected "${key}" to be a non-negative integer.`);
}

function inferProducerEdges(
  inputs: BlueprintInputDefinition[],
  artefacts: BlueprintArtefactDefinition[],
  producerName: string,
): BlueprintEdgeDefinition[] {
  const edges: BlueprintEdgeDefinition[] = [];
  for (const input of inputs) {
    edges.push({ from: input.name, to: producerName });
  }
  for (const artefact of artefacts) {
    // For JSON artifacts with schema decomposition, create edges to all decomposed fields
    if (artefact.type === 'json' && artefact.schema && artefact.arrays && artefact.arrays.length > 0) {
      const decomposed = decomposeJsonSchemaForEdges(artefact.schema, artefact.name, artefact.arrays);
      for (const field of decomposed) {
        edges.push({ from: producerName, to: field.path });
      }
    } else {
      edges.push({ from: producerName, to: artefact.name });
    }
  }
  return edges;
}

/**
 * Simplified schema decomposition for edge creation.
 * Returns just the paths needed for creating edges.
 */
function decomposeJsonSchemaForEdges(
  schema: JsonSchemaDefinition,
  artifactName: string,
  arrayMappings: ArrayDimensionMapping[],
): Array<{ path: string }> {
  const artifacts: Array<{ path: string }> = [];
  const arrayMap = new Map(arrayMappings.map((m) => [m.path, m.countInput]));

  function walk(
    pathSegments: string[],
    barePath: string[],
    prop: JsonSchemaProperty,
  ): void {
    if (prop.type === 'object' && prop.properties) {
      for (const [key, childProp] of Object.entries(prop.properties)) {
        walk([...pathSegments, key], [...barePath, key], childProp);
      }
    } else if (prop.type === 'array' && prop.items) {
      const currentBarePath = barePath.join('.');
      const countInput = arrayMap.get(currentBarePath);

      if (!countInput) {
        return; // Not decomposed
      }

      const dimName = deriveDimensionNameForEdges(countInput);
      const newPathSegments = pathSegments.length > 0
        ? [...pathSegments.slice(0, -1), `${pathSegments[pathSegments.length - 1]}[${dimName}]`]
        : [`[${dimName}]`];

      if (prop.items.type === 'object' && prop.items.properties) {
        for (const [key, childProp] of Object.entries(prop.items.properties)) {
          walk([...newPathSegments, key], [...barePath, key], childProp);
        }
      } else if (isLeafTypeForEdges(prop.items.type)) {
        const path = `${artifactName}.${newPathSegments.join('.')}`;
        artifacts.push({ path });
      }
    } else if (isLeafTypeForEdges(prop.type)) {
      const path = pathSegments.length > 0
        ? `${artifactName}.${pathSegments.join('.')}`
        : artifactName;
      artifacts.push({ path });
    }
  }

  if (schema.schema.type === 'object' && schema.schema.properties) {
    for (const [key, prop] of Object.entries(schema.schema.properties)) {
      walk([key], [key], prop);
    }
  }

  return artifacts;
}

function isLeafTypeForEdges(type: string): boolean {
  return type === 'string' || type === 'number' || type === 'integer' || type === 'boolean';
}

function deriveDimensionNameForEdges(countInput: string): string {
  let name = countInput;
  const prefixes = ['NumOf', 'NumberOf', 'CountOf', 'Num'];
  for (const prefix of prefixes) {
    if (name.startsWith(prefix)) {
      name = name.slice(prefix.length);
      break;
    }
  }
  const suffixes = ['Count', 'Number', 'Num'];
  for (const suffix of suffixes) {
    if (name.endsWith(suffix)) {
      name = name.slice(0, -suffix.length);
      break;
    }
  }
  const perMatch = name.match(/^(.+)Per\w+$/);
  if (perMatch) {
    name = perMatch[1]!;
  }
  name = name.toLowerCase();
  if (name.endsWith('s') && name.length > 1) {
    name = name.slice(0, -1);
  }
  return name || 'item';
}

function relativePosix(root: string, target: string): string {
  const rel = relative(root, target);
  if (rel.startsWith('..')) {
    throw new Error(`Path "${target}" escapes root "${root}".`);
  }
  return rel.split(sep).join('/');
}

interface PromptConfig {
  model?: string;
  textFormat?: string;
  jsonSchema?: string;
  variables?: string[];
  systemPrompt?: string;
  userPrompt?: string;
  config?: Record<string, unknown>;
  sdkMapping?: Record<string, BlueprintProducerSdkMappingField>;
  outputs?: Record<string, BlueprintProducerOutputDefinition>;
}
