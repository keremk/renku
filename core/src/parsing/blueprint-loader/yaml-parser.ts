import { parse as parseYaml } from 'yaml';
import { promises as fs } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import type { FileStorage } from '@flystorage/file-storage';
import type {
  ArrayDimensionMapping,
  BlueprintArtefactDefinition,
  BlueprintConditionDefinitions,
  BlueprintDocument,
  BlueprintEdgeDefinition,
  BlueprintInputDefinition,
  BlueprintProducerOutputDefinition,
  BlueprintProducerSdkMappingField,
  BlueprintTreeNode,
  EdgeConditionClause,
  EdgeConditionDefinition,
  EdgeConditionGroup,
  JsonSchemaDefinition,
  JsonSchemaProperty,
  NamedConditionDefinition,
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
  const meta = parseMeta(raw.meta, filePath);

  const inputs = Array.isArray(raw.inputs) ? raw.inputs.map((entry) => parseInput(entry)) : [];
  const loops = Array.isArray(raw.loops) ? parseLoops(raw.loops) : [];
  const loopSymbols = new Set(loops.map((loop) => loop.name));
  const conditionDefs = parseConditionDefinitions(raw.conditions, loopSymbols);
  const artefactSource = Array.isArray(raw.artifacts)
    ? raw.artifacts
    : Array.isArray(raw.artefacts)
      ? raw.artefacts
      : [];
  if (artefactSource.length === 0) {
    throw new Error(`Blueprint YAML at ${filePath} must declare at least one artifact.`);
  }
  const artefacts = artefactSource.map((entry) => parseArtefact(entry));
  // Accept `producers:` section, with fallback to deprecated `modules:` for backwards compatibility
  const rawProducerImports = Array.isArray(raw.producers)
    ? raw.producers
    : Array.isArray(raw.modules)
      ? raw.modules
      : [];
  const producerImports = rawProducerImports.map((entry) => parseProducerImport(entry));
  let edges = Array.isArray(raw.connections)
    ? raw.connections.map((entry) => parseEdge(entry, loopSymbols, conditionDefs))
    : [];
  const producers: ProducerConfig[] = [];
  const isProducerBlueprint = producerImports.length === 0;
  if (isProducerBlueprint) {
    // Interface-only producer - models will be provided in input template
    // Just create a producer entry with the name from meta
    producers.push({
      name: meta.id,
      // No provider, model, or models - these come from input template's model selection
    });
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
    conditions: Object.keys(conditionDefs).length > 0 ? conditionDefs : undefined,
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
  /** Named condition definitions for reuse across edges */
  conditions?: Record<string, unknown>;
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
  // Note: default values are no longer parsed here - model JSON schemas are the source of truth
  return {
    name,
    type,
    required,
    description,
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

function parseEdge(
  raw: unknown,
  allowedDimensions: Set<string>,
  conditionDefs: BlueprintConditionDefinitions,
): BlueprintEdgeDefinition {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid connection entry: ${JSON.stringify(raw)}`);
  }
  const edge = raw as Record<string, unknown>;
  const from = normalizeReference(readString(edge, 'from'));
  const to = normalizeReference(readString(edge, 'to'));
  validateDimensions(from, allowedDimensions, 'from');
  validateDimensions(to, allowedDimensions, 'to');

  // Handle `if:` reference to named condition
  let conditions: EdgeConditionDefinition | undefined;
  const ifRef = edge.if;
  if (ifRef !== undefined) {
    if (typeof ifRef !== 'string' || ifRef.trim().length === 0) {
      throw new Error(`Invalid 'if' reference in connection: expected string, got ${typeof ifRef}`);
    }
    const conditionName = ifRef.trim();
    const def = conditionDefs[conditionName];
    if (!def) {
      throw new Error(`Unknown condition "${conditionName}" in connection. Define it under conditions[].`);
    }
    // Convert named condition to inline condition
    conditions = def;
  }

  // Handle inline `conditions:`
  if (edge.conditions !== undefined) {
    if (conditions !== undefined) {
      throw new Error(`Connection cannot have both 'if' and 'conditions'. Use one or the other.`);
    }
    conditions = parseEdgeConditions(edge.conditions, allowedDimensions);
  }

  return {
    from,
    to,
    note: typeof edge.note === 'string' ? edge.note : undefined,
    if: typeof ifRef === 'string' ? ifRef.trim() : undefined,
    conditions,
  };
}

/**
 * Parses inline edge conditions from YAML.
 */
function parseEdgeConditions(raw: unknown, allowedDimensions: Set<string>): EdgeConditionDefinition {
  if (Array.isArray(raw)) {
    // Array of clauses or groups (implicit AND)
    return raw.map((item) => parseConditionItem(item, allowedDimensions));
  }
  // Single clause or group
  return parseConditionItem(raw, allowedDimensions);
}

/**
 * Parses a single condition item (clause or group).
 */
function parseConditionItem(raw: unknown, allowedDimensions: Set<string>): EdgeConditionClause | EdgeConditionGroup {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid condition entry: ${JSON.stringify(raw)}`);
  }
  const obj = raw as Record<string, unknown>;

  // Check if it's a group (has 'all' or 'any')
  if ('all' in obj || 'any' in obj) {
    return parseConditionGroup(obj, allowedDimensions);
  }

  // It's a clause
  return parseConditionClause(obj, allowedDimensions);
}

/**
 * Parses a condition group (AND/OR).
 */
function parseConditionGroup(obj: Record<string, unknown>, allowedDimensions: Set<string>): EdgeConditionGroup {
  const group: EdgeConditionGroup = {};

  if ('all' in obj) {
    if (!Array.isArray(obj.all)) {
      throw new Error(`Condition 'all' must be an array.`);
    }
    group.all = obj.all.map((item) => parseConditionClause(item as Record<string, unknown>, allowedDimensions));
  }

  if ('any' in obj) {
    if (!Array.isArray(obj.any)) {
      throw new Error(`Condition 'any' must be an array.`);
    }
    group.any = obj.any.map((item) => parseConditionClause(item as Record<string, unknown>, allowedDimensions));
  }

  if (!group.all && !group.any) {
    throw new Error(`Condition group must have 'all' or 'any'.`);
  }

  return group;
}

/**
 * Parses a single condition clause.
 */
function parseConditionClause(obj: Record<string, unknown>, allowedDimensions: Set<string>): EdgeConditionClause {
  if (!obj || typeof obj !== 'object') {
    throw new Error(`Invalid condition clause: ${JSON.stringify(obj)}`);
  }

  const when = obj.when;
  if (typeof when !== 'string' || when.trim().length === 0) {
    throw new Error(`Condition clause must have a 'when' field with a path.`);
  }

  // Validate dimensions in the 'when' path
  validateDimensions(when, allowedDimensions, 'when' as 'from');

  const clause: EdgeConditionClause = { when: when.trim() };

  // Parse operators
  if ('is' in obj) {
    clause.is = obj.is;
  }
  if ('isNot' in obj) {
    clause.isNot = obj.isNot;
  }
  if ('contains' in obj) {
    clause.contains = obj.contains;
  }
  if ('greaterThan' in obj) {
    if (typeof obj.greaterThan !== 'number') {
      throw new Error(`Condition 'greaterThan' must be a number.`);
    }
    clause.greaterThan = obj.greaterThan;
  }
  if ('lessThan' in obj) {
    if (typeof obj.lessThan !== 'number') {
      throw new Error(`Condition 'lessThan' must be a number.`);
    }
    clause.lessThan = obj.lessThan;
  }
  if ('greaterOrEqual' in obj) {
    if (typeof obj.greaterOrEqual !== 'number') {
      throw new Error(`Condition 'greaterOrEqual' must be a number.`);
    }
    clause.greaterOrEqual = obj.greaterOrEqual;
  }
  if ('lessOrEqual' in obj) {
    if (typeof obj.lessOrEqual !== 'number') {
      throw new Error(`Condition 'lessOrEqual' must be a number.`);
    }
    clause.lessOrEqual = obj.lessOrEqual;
  }
  if ('exists' in obj) {
    if (typeof obj.exists !== 'boolean') {
      throw new Error(`Condition 'exists' must be a boolean.`);
    }
    clause.exists = obj.exists;
  }
  if ('matches' in obj) {
    if (typeof obj.matches !== 'string') {
      throw new Error(`Condition 'matches' must be a string (regex pattern).`);
    }
    clause.matches = obj.matches;
  }

  // Validate that at least one operator is present
  const hasOperator = clause.is !== undefined ||
    clause.isNot !== undefined ||
    clause.contains !== undefined ||
    clause.greaterThan !== undefined ||
    clause.lessThan !== undefined ||
    clause.greaterOrEqual !== undefined ||
    clause.lessOrEqual !== undefined ||
    clause.exists !== undefined ||
    clause.matches !== undefined;

  if (!hasOperator) {
    throw new Error(`Condition clause must have at least one operator (is, isNot, contains, etc.).`);
  }

  return clause;
}

/**
 * Parses named condition definitions from the blueprint-level conditions block.
 */
function parseConditionDefinitions(
  raw: Record<string, unknown> | undefined,
  allowedDimensions: Set<string>,
): BlueprintConditionDefinitions {
  if (!raw) {
    return {};
  }

  const definitions: BlueprintConditionDefinitions = {};

  for (const [name, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') {
      throw new Error(`Invalid condition definition "${name}": expected object.`);
    }
    definitions[name] = parseNamedConditionDefinition(value as Record<string, unknown>, allowedDimensions, name);
  }

  return definitions;
}

/**
 * Parses a named condition definition (can be a clause or group).
 */
function parseNamedConditionDefinition(
  obj: Record<string, unknown>,
  allowedDimensions: Set<string>,
  name: string,
): NamedConditionDefinition {
  // Check if it's a group (has 'all' or 'any')
  if ('all' in obj || 'any' in obj) {
    return parseConditionGroup(obj, allowedDimensions);
  }

  // It's a clause - must have 'when'
  if (!('when' in obj)) {
    throw new Error(`Condition definition "${name}" must have 'when', 'all', or 'any'.`);
  }

  return parseConditionClause(obj, allowedDimensions);
}

/**
 * Parses a transform mapping from YAML.
 * Transform maps input values to model-specific values.
 */
function parseTransform(raw: unknown): Record<string, unknown> | undefined {
  if (!raw) {
    return undefined;
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Invalid transform entry: expected object, got ${typeof raw}`);
  }
  // Transform is a simple key-value mapping where keys are input values
  // and values are what to send to the model (can be any type)
  return raw as Record<string, unknown>;
}

export function parseSdkMapping(raw: unknown): Record<string, BlueprintProducerSdkMappingField> | undefined {
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
    const isExpand = fieldConfig.expand === true;
    const field =
      typeof fieldConfig.field === 'string' && fieldConfig.field.trim().length > 0
        ? fieldConfig.field
        : typeof fieldConfig.name === 'string'
          ? fieldConfig.name
          : isExpand
            ? '' // Allow empty field for expand mappings
            : undefined;
    if (field === undefined) {
      throw new Error(`Invalid sdkMapping field for ${key}.`);
    }
    mapping[key] = {
      field,
      type: typeof fieldConfig.type === 'string' ? fieldConfig.type : undefined,
      transform: parseTransform(fieldConfig.transform),
      expand: isExpand ? true : undefined,
    };
  }
  return Object.keys(mapping).length ? mapping : undefined;
}

export function parseOutputs(raw: unknown): Record<string, BlueprintProducerOutputDefinition> | undefined {
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

