import { parse as parseYaml } from 'yaml';
import { existsSync, promises as fs } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import type { FileStorage } from '@flystorage/file-storage';
import { createParserError, ParserErrorCode } from '../../errors/index.js';
import { isRenkuError } from '../../errors/types.js';
import type {
  ArrayDimensionMapping,
  BlueprintImportDefinition,
  BlueprintConditionDefinitions,
  BlueprintDocument,
  BlueprintEdgeDefinition,
  BlueprintInputDefinition,
  BlueprintOutputDefinition,
  BlueprintProducerOutputDefinition,
  BlueprintProducerSdkMappingField,
  BlueprintTreeNode,
  CombineTransform,
  ConditionalTransform,
  EdgeConditionClause,
  EdgeConditionDefinition,
  EdgeConditionGroup,
  InputMappings,
  MappingCondition,
  MappingFieldDefinition,
  MappingValue,
  NamedConditionDefinition,
  ProducerConfig,
  ProducerMappings,
  BlueprintValidationMetadata,
  ResolutionObjectFieldConfig,
  ResolutionProjectionMode,
  ResolutionTransformConfig,
} from '../../types.js';
import {
  isCanonicalArtifactId,
  isCanonicalInputId,
  isCanonicalOutputId,
} from '../canonical-ids.js';
import { parseDimensionSelector } from '../dimension-selectors.js';

export interface BlueprintResourceReader {
  // eslint-disable-next-line no-unused-vars
  readFile(filePath: string): Promise<string>;
}

export interface BlueprintParseOptions {
  reader?: BlueprintResourceReader;
}

export interface BlueprintLoadOptions extends BlueprintParseOptions {
  /** Root directory for producer resolution (e.g., {cliRoot}/catalog) */
  catalogRoot?: string;
}

class NodeFilesystemReader implements BlueprintResourceReader {
  async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf8');
  }
}

const defaultReader = new NodeFilesystemReader();

const ALLOWED_TOP_LEVEL_BLUEPRINT_SECTIONS = new Set([
  'meta',
  'inputs',
  'outputs',
  'imports',
  'loops',
  'connections',
  'collectors',
  'conditions',
  'validation',
  'mappings',
]);

export function createFlyStorageBlueprintReader(
  storage: FileStorage,
  rootDir: string
): BlueprintResourceReader {
  const normalizedRoot = resolve(rootDir);
  return {
    async readFile(target: string): Promise<string> {
      const absolute = resolve(target);
      if (!absolute.startsWith(normalizedRoot)) {
        throw createParserError(
          ParserErrorCode.INVALID_YAML_DOCUMENT,
          `Blueprint path "${target}" is outside configured root "${normalizedRoot}".`,
          { filePath: target }
        );
      }
      const relativePath = relativePosix(normalizedRoot, absolute);
      return storage.readToString(relativePath);
    },
  };
}

export async function parseYamlBlueprintFile(
  filePath: string,
  options: BlueprintParseOptions = {}
): Promise<BlueprintDocument> {
  const reader = options.reader ?? defaultReader;
  const absolute = resolve(filePath);
  let contents: string;
  try {
    contents = await reader.readFile(absolute);
  } catch (error) {
    if (isRenkuError(error)) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw createParserError(
      ParserErrorCode.FILE_LOAD_FAILED,
      `Failed to load blueprint file "${filePath}": ${message}`,
      { filePath }
    );
  }
  const raw = parseYaml(contents) as RawBlueprint;
  if (!raw || typeof raw !== 'object') {
    throw createParserError(
      ParserErrorCode.INVALID_YAML_DOCUMENT,
      `Blueprint YAML at ${filePath} must be a YAML document.`,
      { filePath }
    );
  }
  assertKnownTopLevelSections(raw as Record<string, unknown>, filePath);
  if (raw.artifacts !== undefined) {
    throw createParserError(
      ParserErrorCode.INVALID_YAML_DOCUMENT,
      `Blueprint YAML at ${filePath} uses "artifacts". Rename that section to "outputs".`,
      { filePath }
    );
  }
  if (raw.producers !== undefined) {
    throw createParserError(
      ParserErrorCode.INVALID_YAML_DOCUMENT,
      `Blueprint YAML at ${filePath} uses "producers" for child blueprint references. Rename that section to "imports".`,
      { filePath }
    );
  }
  const meta = parseMeta(raw.meta, filePath);
  const rawImports = Array.isArray(raw.imports) ? raw.imports : [];
  const isProducerBlueprint = meta.kind === 'producer';
  assertProducerBlueprintKind(raw.meta, filePath, isProducerBlueprint);

  const inputs = Array.isArray(raw.inputs)
    ? raw.inputs.map((entry) => parseInput(entry, isProducerBlueprint))
    : [];
  validateStoryboardInputMetadata(inputs, absolute, isProducerBlueprint);
  const loops = Array.isArray(raw.loops) ? parseLoops(raw.loops) : [];
  const loopSymbols = new Set(loops.map((loop) => loop.name));
  const conditionDefs = parseConditionDefinitions(raw.conditions, loopSymbols);
  const outputSource = Array.isArray(raw.outputs) ? raw.outputs : [];
  if (outputSource.length === 0) {
    throw createParserError(
      ParserErrorCode.MISSING_REQUIRED_SECTION,
      `Blueprint YAML at ${filePath} must declare at least one output.`,
      { filePath }
    );
  }
  const outputs = outputSource.map((entry) => parseOutput(entry, filePath));
  const imports = rawImports.map((entry) => parseBlueprintImport(entry));
  if (!isProducerBlueprint && imports.length === 0) {
    throw createParserError(
      ParserErrorCode.INVALID_PRODUCER_BLUEPRINT_KIND,
      `Leaf producer blueprint at ${filePath} must declare meta.kind: producer.`,
      { filePath }
    );
  }
  if (isProducerBlueprint && imports.length > 0) {
    throw createParserError(
      ParserErrorCode.INVALID_YAML_DOCUMENT,
      `Producer blueprint at ${filePath} must be a leaf and cannot declare "imports".`,
      { filePath }
    );
  }
  const edges = Array.isArray(raw.connections)
    ? raw.connections.map((entry) =>
        parseEdge(entry, loopSymbols, conditionDefs)
      )
    : [];
  const producers: ProducerConfig[] = [];
  if (isProducerBlueprint) {
    // Producer blueprint/module: model selection comes from inputs.yaml.
    producers.push({
      name: meta.id,
    });
  }
  if (raw.collectors !== undefined) {
    throw createParserError(
      ParserErrorCode.COLLECTORS_SECTION_REMOVED,
      `Blueprint YAML at ${filePath} uses "collectors", which is no longer supported. Move fan-in metadata onto "connections" entries (groupBy/orderBy).`,
      { filePath }
    );
  }
  const mappings = parseMappingsSection(raw.mappings);
  const validation = parseValidationMetadata(raw.validation, conditionDefs, filePath);

  return {
    meta,
    inputs,
    outputs,
    producers,
    imports,
    edges,
    loops: loops.length > 0 ? loops : undefined,
    conditions:
      Object.keys(conditionDefs).length > 0 ? conditionDefs : undefined,
    validation,
    mappings,
  };
}

export async function loadYamlBlueprintTree(
  entryPath: string,
  options: BlueprintLoadOptions = {}
): Promise<{ root: BlueprintTreeNode }> {
  const reader = options.reader ?? defaultReader;
  const absolute = resolve(entryPath);
  const visiting = new Set<string>();
  const root = await loadNode(absolute, [], reader, visiting, options);
  return { root };
}

async function loadNode(
  filePath: string,
  namespacePath: string[],
  reader: BlueprintResourceReader,
  visiting: Set<string>,
  options: BlueprintLoadOptions = {}
): Promise<BlueprintTreeNode> {
  const absolute = resolve(filePath);
  if (visiting.has(absolute)) {
    throw createParserError(
      ParserErrorCode.CIRCULAR_BLUEPRINT_REFERENCE,
      `Detected circular blueprint reference at ${absolute}`,
      { filePath: absolute }
    );
  }
  visiting.add(absolute);
  const document = await parseYamlBlueprintFile(absolute, { reader });
  const node: BlueprintTreeNode = {
    id: document.meta.id,
    namespacePath,
    document,
    children: new Map(),
    sourcePath: absolute,
  };

  // Imported blueprints use the authored alias as a scope for their internal nodes.
  for (const blueprintImport of document.imports) {
    const childPath = resolveBlueprintImportPath(
      absolute,
      blueprintImport,
      options
    );
    const aliasPath = [...namespacePath, blueprintImport.name];
    const child = await loadNode(
      childPath,
      aliasPath,
      reader,
      visiting,
      options
    );
    node.children.set(blueprintImport.name, child);
  }

  visiting.delete(absolute);
  return node;
}

function resolveBlueprintImportPath(
  parentFile: string,
  blueprintImport: BlueprintImportDefinition,
  options: BlueprintLoadOptions = {}
): string {
  if (blueprintImport.path) {
    return resolve(dirname(parentFile), blueprintImport.path);
  }

  if (blueprintImport.producer && options.catalogRoot) {
    const producersRoot = resolve(options.catalogRoot, 'producers');
    const resolved = findProducerByQualifiedName(
      producersRoot,
      blueprintImport.producer
    );
    if (resolved) {
      return resolved;
    }
    throw createParserError(
      ParserErrorCode.UNKNOWN_PRODUCER_REFERENCE,
      `Producer "${blueprintImport.producer}" not found in ${producersRoot}. ` +
        `Tried: ${producersRoot}/${blueprintImport.producer}.yaml and ` +
        `${producersRoot}/${blueprintImport.producer}/${blueprintImport.producer.split('/').pop()}.yaml`,
      { filePath: parentFile }
    );
  }

  // If producer is specified but no catalogRoot, give a helpful error
  if (blueprintImport.producer && !options.catalogRoot) {
    throw createParserError(
      ParserErrorCode.MISSING_CATALOG_ROOT,
      `Producer "${blueprintImport.producer}" uses qualified name syntax but no catalogRoot was provided. ` +
        `Either use path: for relative paths or ensure catalogRoot is configured.`,
      { filePath: parentFile }
    );
  }

  throw createParserError(
    ParserErrorCode.MISSING_PRODUCER_IMPORT_SOURCE,
    `Blueprint import "${blueprintImport.name}" must declare exactly one import source: "path" or "producer".`,
    { filePath: parentFile }
  );
}

/**
 * Finds a producer by qualified name in the producers directory.
 * Tries two patterns:
 * 1. {producersRoot}/{qualifiedName}.yaml (e.g., producers/audio/text-to-speech.yaml)
 * 2. {producersRoot}/{qualifiedName}/{name}.yaml (e.g., producers/prompt/script/script.yaml)
 */
function findProducerByQualifiedName(
  producersRoot: string,
  qualifiedName: string
): string | null {
  // Try: producers/audio/text-to-speech.yaml
  const directPath = resolve(producersRoot, `${qualifiedName}.yaml`);
  if (existsSync(directPath)) {
    return directPath;
  }

  // Try: producers/prompt/script/script.yaml (nested with same name as last segment)
  const parts = qualifiedName.split('/');
  const name = parts[parts.length - 1];
  const nestedPath = resolve(producersRoot, qualifiedName, `${name}.yaml`);
  if (existsSync(nestedPath)) {
    return nestedPath;
  }

  return null;
}

interface RawBlueprint {
  meta?: unknown;
  inputs?: unknown[];
  outputs?: unknown[];
  imports?: unknown[];
  loops?: unknown[];
  producers?: unknown[];
  artifacts?: unknown[];
  connections?: unknown[];
  collectors?: unknown[];
  /** Named condition definitions for reuse across edges */
  conditions?: Record<string, unknown>;
  /** Optional authored validation assertions for advanced blueprints */
  validation?: unknown;
  /** Provider/model-specific SDK mappings */
  mappings?: unknown;
}

function assertKnownTopLevelSections(
  raw: Record<string, unknown>,
  filePath: string
): void {
  const unknownSections = Object.keys(raw).filter(
    (key) => !ALLOWED_TOP_LEVEL_BLUEPRINT_SECTIONS.has(key)
  );
  if (unknownSections.length === 0) {
    return;
  }

  throw createParserError(
    ParserErrorCode.INVALID_YAML_DOCUMENT,
    `Blueprint YAML at ${filePath} contains unknown top-level section(s): ${unknownSections.join(', ')}.`,
    {
      filePath,
      suggestion: `Allowed sections: ${Array.from(ALLOWED_TOP_LEVEL_BLUEPRINT_SECTIONS).join(', ')}`,
    }
  );
}

function parseValidationMetadata(
  raw: unknown,
  conditionDefs: BlueprintConditionDefinitions,
  filePath: string
): BlueprintValidationMetadata | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw createParserError(
      ParserErrorCode.INVALID_YAML_DOCUMENT,
      `Blueprint YAML at ${filePath} field "validation" must be an object.`,
      { filePath }
    );
  }

  const source = raw as Record<string, unknown>;
  const metadata: BlueprintValidationMetadata = {};

  if (source.semanticRules !== undefined) {
    if (!Array.isArray(source.semanticRules)) {
      throw createParserError(
        ParserErrorCode.INVALID_YAML_DOCUMENT,
        `Blueprint YAML at ${filePath} field "validation.semanticRules" must be an array.`,
        { filePath }
      );
    }
    metadata.semanticRules = source.semanticRules.map((entry, index) =>
      parseSemanticValidationRule(entry, index, conditionDefs, filePath)
    );
  }

  if (source.coverage !== undefined) {
    metadata.coverage = parseCoverageMetadata(source.coverage, filePath);
  }

  return metadata;
}

function parseSemanticValidationRule(
  raw: unknown,
  index: number,
  conditionDefs: BlueprintConditionDefinitions,
  filePath: string
): NonNullable<BlueprintValidationMetadata['semanticRules']>[number] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw createParserError(
      ParserErrorCode.INVALID_YAML_DOCUMENT,
      `Blueprint YAML at ${filePath} validation.semanticRules[${index}] must be an object.`,
      { filePath }
    );
  }
  const source = raw as Record<string, unknown>;
  const name = readString(source, 'name');
  const condition = readString(source, 'condition');
  if (!conditionDefs[condition]) {
    throw createParserError(
      ParserErrorCode.INVALID_CONDITION_ENTRY,
      `Blueprint YAML at ${filePath} validation semantic rule "${name}" references unknown condition "${condition}".`,
      { filePath }
    );
  }

  const requireGuardedConnections =
    source.requireGuardedConnections === undefined
      ? undefined
      : parseRequiredGuardedConnections(
          source.requireGuardedConnections,
          index,
          filePath
        );

  return {
    name,
    condition,
    requireGuardedConnections,
  };
}

function parseRequiredGuardedConnections(
  raw: unknown,
  ruleIndex: number,
  filePath: string
): NonNullable<
  NonNullable<BlueprintValidationMetadata['semanticRules']>[number]['requireGuardedConnections']
> {
  if (!Array.isArray(raw)) {
    throw createParserError(
      ParserErrorCode.INVALID_YAML_DOCUMENT,
      `Blueprint YAML at ${filePath} validation.semanticRules[${ruleIndex}].requireGuardedConnections must be an array.`,
      { filePath }
    );
  }

  return raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw createParserError(
        ParserErrorCode.INVALID_YAML_DOCUMENT,
        `Blueprint YAML at ${filePath} validation.semanticRules[${ruleIndex}].requireGuardedConnections[${index}] must be an object.`,
        { filePath }
      );
    }
    const source = entry as Record<string, unknown>;
    const from = source.from;
    const to = source.to;
    if (from !== undefined && typeof from !== 'string') {
      throw createParserError(
        ParserErrorCode.INVALID_YAML_DOCUMENT,
        `Blueprint YAML at ${filePath} guarded connection "from" must be a string.`,
        { filePath }
      );
    }
    if (to !== undefined && typeof to !== 'string') {
      throw createParserError(
        ParserErrorCode.INVALID_YAML_DOCUMENT,
        `Blueprint YAML at ${filePath} guarded connection "to" must be a string.`,
        { filePath }
      );
    }
    if (from === undefined && to === undefined) {
      throw createParserError(
        ParserErrorCode.INVALID_YAML_DOCUMENT,
        `Blueprint YAML at ${filePath} guarded connection must declare "from" or "to".`,
        { filePath }
      );
    }
    return {
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
    };
  });
}

function parseCoverageMetadata(
  raw: unknown,
  filePath: string
): NonNullable<BlueprintValidationMetadata['coverage']> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw createParserError(
      ParserErrorCode.INVALID_YAML_DOCUMENT,
      `Blueprint YAML at ${filePath} field "validation.coverage" must be an object.`,
      { filePath }
    );
  }
  const source = raw as Record<string, unknown>;
  if (source.requiredBranches === undefined) {
    return {};
  }
  if (!Array.isArray(source.requiredBranches)) {
    throw createParserError(
      ParserErrorCode.INVALID_YAML_DOCUMENT,
      `Blueprint YAML at ${filePath} field "validation.coverage.requiredBranches" must be an array.`,
      { filePath }
    );
  }
  return {
    requiredBranches: source.requiredBranches.map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw createParserError(
          ParserErrorCode.INVALID_YAML_DOCUMENT,
          `Blueprint YAML at ${filePath} validation.coverage.requiredBranches[${index}] must be an object.`,
          { filePath }
        );
      }
      const branch = entry as Record<string, unknown>;
      const field = readString(branch, 'field');
      const values = branch.values;
      if (!Array.isArray(values) || values.length === 0) {
        throw createParserError(
          ParserErrorCode.INVALID_YAML_DOCUMENT,
          `Blueprint YAML at ${filePath} validation.coverage.requiredBranches[${index}].values must be a non-empty array.`,
          { filePath }
        );
      }
      return { field, values };
    }),
  };
}

function parseMeta(raw: unknown, filePath: string): BlueprintDocument['meta'] {
  if (!raw || typeof raw !== 'object') {
    throw createParserError(
      ParserErrorCode.MISSING_REQUIRED_SECTION,
      `Blueprint YAML at ${filePath} must include a meta section.`,
      { filePath }
    );
  }
  const meta = raw as Record<string, unknown>;
  const id = readString(meta, 'id');
  const name = readString(meta, 'name');
  return {
    id,
    name,
    kind: meta.kind === 'producer' ? 'producer' : 'blueprint',
    version: meta.version ? String(meta.version) : undefined,
    description: meta.description ? String(meta.description) : undefined,
    author: meta.author ? String(meta.author) : undefined,
    license: meta.license ? String(meta.license) : undefined,
    promptFile:
      typeof meta.promptFile === 'string' ? meta.promptFile : undefined,
    outputSchema:
      typeof meta.outputSchema === 'string' ? meta.outputSchema : undefined,
  };
}

function assertProducerBlueprintKind(
  rawMeta: unknown,
  filePath: string,
  isProducerBlueprint: boolean
): void {
  if (!isProducerBlueprint) {
    return;
  }

  if (!rawMeta || typeof rawMeta !== 'object') {
    throw createParserError(
      ParserErrorCode.MISSING_REQUIRED_SECTION,
      `Blueprint YAML at ${filePath} must include a meta section.`,
      { filePath }
    );
  }

  const meta = rawMeta as Record<string, unknown>;
  if (meta.kind === 'producer') {
    return;
  }

  throw createParserError(
    ParserErrorCode.INVALID_PRODUCER_BLUEPRINT_KIND,
    `Leaf producer blueprint at ${filePath} must declare meta.kind: producer.`,
    {
      filePath,
      suggestion: 'Set meta.kind to "producer" for leaf producer blueprints.',
    }
  );
}

function parseLoops(rawLoops: unknown[]): Array<{
  name: string;
  parent?: string;
  countInput: string;
  countInputOffset?: number;
}> {
  const loops: Array<{
    name: string;
    parent?: string;
    countInput: string;
    countInputOffset?: number;
  }> = [];
  const seen = new Set<string>();
  for (const raw of rawLoops) {
    if (!raw || typeof raw !== 'object') {
      throw createParserError(
        ParserErrorCode.INVALID_LOOP_ENTRY,
        `Invalid loop entry: ${JSON.stringify(raw)}`
      );
    }
    const loop = raw as Record<string, unknown>;
    const name = readString(loop, 'name');
    if (seen.has(name)) {
      throw createParserError(
        ParserErrorCode.DUPLICATE_LOOP_NAME,
        `Duplicate loop name "${name}".`
      );
    }
    const parent = loop.parent ? readString(loop, 'parent') : undefined;
    const countInput = readString(loop, 'countInput');
    const countInputOffset = readOptionalNonNegativeInteger(
      loop,
      'countInputOffset'
    );
    loops.push({ name, parent, countInput, countInputOffset });
    seen.add(name);
  }
  return loops;
}

function parseInput(
  raw: unknown,
  allowStoryboardMetadata: boolean
): BlueprintInputDefinition {
  if (!raw || typeof raw !== 'object') {
    throw createParserError(
      ParserErrorCode.INVALID_INPUT_ENTRY,
      `Invalid input entry: ${JSON.stringify(raw)}`
    );
  }
  const input = raw as Record<string, unknown>;
  const name = readString(input, 'name');
  const type = readString(input, 'type');
  if (type === 'collection') {
    throw createParserError(
      ParserErrorCode.INVALID_INPUT_ENTRY,
      `Input "${name}" uses deprecated type "collection". Use type "array" and set itemType explicitly.`
    );
  }
  const required = input.required === false ? false : true;
  const description =
    typeof input.description === 'string' ? input.description : undefined;
  const storyboard = parseStoryboardRole(input.storyboard, name, allowStoryboardMetadata);
  const itemType =
    typeof input.itemType === 'string' ? input.itemType : undefined;
  const countInput =
    typeof input.countInput === 'string' ? input.countInput : undefined;
  if (countInput && type !== 'array') {
    throw createParserError(
      ParserErrorCode.INVALID_COUNTINPUT_CONFIG,
      `Input "${name}" declares countInput but is not an array.`
    );
  }
  // Note: default values are no longer parsed here - model JSON schemas are the source of truth
  return {
    name,
    type,
    required,
    description,
    fanIn: input.fanIn === true,
    storyboard,
    itemType,
    countInput,
  };
}

function parseStoryboardRole(
  raw: unknown,
  inputName: string,
  allowStoryboardMetadata: boolean
): BlueprintInputDefinition['storyboard'] {
  if (raw === undefined) {
    return undefined;
  }
  if (!allowStoryboardMetadata) {
    throw createParserError(
      ParserErrorCode.INVALID_INPUT_ENTRY,
      `Input "${inputName}" declares storyboard metadata, but storyboard roles are only allowed on producer inputs.`
    );
  }
  if (raw === 'main' || raw === 'secondary') {
    return raw;
  }
  throw createParserError(
    ParserErrorCode.INVALID_INPUT_ENTRY,
    `Input "${inputName}" declares invalid storyboard metadata "${String(raw)}". Expected "main" or "secondary".`
  );
}

function validateStoryboardInputMetadata(
  inputs: BlueprintInputDefinition[],
  filePath: string,
  isProducerBlueprint: boolean
): void {
  if (!isProducerBlueprint) {
    return;
  }

  const mainInputs = inputs.filter((input) => input.storyboard === 'main');
  if (mainInputs.length > 1) {
    throw createParserError(
      ParserErrorCode.INVALID_INPUT_ENTRY,
      `Producer YAML at ${filePath} declares multiple storyboard: main inputs (${mainInputs.map((input) => input.name).join(', ')}).`
    );
  }

  const secondaryInputs = inputs.filter(
    (input) => input.storyboard === 'secondary'
  );
  if (secondaryInputs.length > 1) {
    throw createParserError(
      ParserErrorCode.INVALID_INPUT_ENTRY,
      `Producer YAML at ${filePath} declares multiple storyboard: secondary inputs (${secondaryInputs.map((input) => input.name).join(', ')}).`
    );
  }
}

function parseOutput(
  raw: unknown,
  filePath: string
): BlueprintOutputDefinition {
  if (!raw || typeof raw !== 'object') {
    throw createParserError(
      ParserErrorCode.INVALID_ARTIFACT_ENTRY,
      `Invalid artifact entry: ${JSON.stringify(raw)}`
    );
  }
  const output = raw as Record<string, unknown>;
  const name = readString(output, 'name');
  if (output.schema !== undefined) {
    throw createParserError(
      ParserErrorCode.INVALID_ARTIFACT_ENTRY,
      `Output "${name}" in ${filePath} declares unsupported "schema" metadata. Use meta.outputSchema on the producer blueprint instead.`
    );
  }
  const type = readString(output, 'type');
  const countInput =
    typeof output.countInput === 'string' ? output.countInput : undefined;
  const countInputOffset = readOptionalNonNegativeInteger(
    output,
    'countInputOffset'
  );
  if (countInputOffset !== undefined && !countInput) {
    throw createParserError(
      ParserErrorCode.INVALID_COUNTINPUT_CONFIG,
      `Output "${name}" declares countInputOffset but is missing countInput.`
    );
  }
  const arrays = parseArraysMetadata(output.arrays);
  return {
    name,
    type,
    description:
      typeof output.description === 'string'
        ? output.description
        : undefined,
    itemType:
      typeof output.itemType === 'string' ? output.itemType : undefined,
    countInput,
    countInputOffset,
    required: output.required === false ? false : true,
    arrays,
  };
}

function parseArraysMetadata(
  raw: unknown
): ArrayDimensionMapping[] | undefined {
  if (!raw || !Array.isArray(raw)) {
    return undefined;
  }
  return raw.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw createParserError(
        ParserErrorCode.INVALID_ARRAYS_CONFIG,
        `Invalid arrays entry: ${JSON.stringify(entry)}`
      );
    }
    const obj = entry as Record<string, unknown>;
    const path = readString(obj, 'path');
    const countInput = readString(obj, 'countInput');
    const countInputOffset = readOptionalNonNegativeInteger(
      obj,
      'countInputOffset'
    );
    return { path, countInput, countInputOffset };
  });
}

function parseBlueprintImport(raw: unknown): BlueprintImportDefinition {
  if (!raw || typeof raw !== 'object') {
    throw createParserError(
      ParserErrorCode.INVALID_PRODUCER_ENTRY,
      `Invalid producer import entry: ${JSON.stringify(raw)}`
    );
  }
  const entry = raw as Record<string, unknown>;
  const name = readString(entry, 'name');
  const path = typeof entry.path === 'string' ? entry.path : undefined;
  const producer =
    typeof entry.producer === 'string' ? entry.producer : undefined;

  // Validate: can't have both path and producer
  if (path && producer) {
    throw createParserError(
      ParserErrorCode.PRODUCER_PATH_AND_NAME_CONFLICT,
      `Blueprint import "${name}" cannot have both "path" and "producer" fields. Use one or the other.`
    );
  }

  if (!path && !producer) {
    throw createParserError(
      ParserErrorCode.MISSING_PRODUCER_IMPORT_SOURCE,
      `Blueprint import "${name}" must declare exactly one import source: "path" or "producer".`
    );
  }

  return {
    name,
    path,
    producer,
    description:
      typeof entry.description === 'string' ? entry.description : undefined,
    loop: typeof entry.loop === 'string' ? entry.loop.trim() : undefined,
  };
}

function parseEdge(
  raw: unknown,
  allowedDimensions: Set<string>,
  conditionDefs: BlueprintConditionDefinitions
): BlueprintEdgeDefinition {
  if (!raw || typeof raw !== 'object') {
    throw createParserError(
      ParserErrorCode.INVALID_CONNECTION_ENTRY,
      `Invalid connection entry: ${JSON.stringify(raw)}`
    );
  }
  const edge = raw as Record<string, unknown>;
  const from = readString(edge, 'from');
  const to = readString(edge, 'to');
  const groupBy = readOptionalLoopSymbol(edge, 'groupBy', allowedDimensions);
  const orderBy = readOptionalLoopSymbol(edge, 'orderBy', allowedDimensions);
  if (orderBy && !groupBy) {
    throw createParserError(
      ParserErrorCode.INVALID_CONNECTION_ENTRY,
      'Connection cannot declare orderBy without groupBy.'
    );
  }
  validateDimensions(from, allowedDimensions, 'from');
  validateDimensions(to, allowedDimensions, 'to');

  // Handle `if:` reference to named condition
  let conditions: EdgeConditionDefinition | undefined;
  const ifRef = edge.if;
  if (ifRef !== undefined) {
    if (typeof ifRef !== 'string' || ifRef.trim().length === 0) {
      throw createParserError(
        ParserErrorCode.INVALID_CONDITION_ENTRY,
        `Invalid 'if' reference in connection: expected string, got ${typeof ifRef}`
      );
    }
    const conditionName = ifRef.trim();
    const def = conditionDefs[conditionName];
    if (!def) {
      throw createParserError(
        ParserErrorCode.INVALID_CONDITION_ENTRY,
        `Unknown condition "${conditionName}" in connection. Define it under conditions[].`
      );
    }
    // Convert named condition to inline condition
    conditions = def;
  }

  // Handle inline `conditions:`
  if (edge.conditions !== undefined) {
    if (conditions !== undefined) {
      throw createParserError(
        ParserErrorCode.INVALID_CONNECTION_ENTRY,
        `Connection cannot have both 'if' and 'conditions'. Use one or the other.`
      );
    }
    conditions = parseEdgeConditions(edge.conditions, allowedDimensions);
  }

  return {
    from,
    to,
    note: typeof edge.note === 'string' ? edge.note : undefined,
    groupBy,
    orderBy,
    if: typeof ifRef === 'string' ? ifRef.trim() : undefined,
    conditions,
  };
}

function readOptionalLoopSymbol(
  edge: Record<string, unknown>,
  key: 'groupBy' | 'orderBy',
  allowedDimensions: Set<string>
): string | undefined {
  const raw = edge[key];
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw createParserError(
      ParserErrorCode.INVALID_CONNECTION_ENTRY,
      `Connection field "${key}" must be a non-empty string when provided.`
    );
  }
  const value = raw.trim();
  if (key === 'groupBy' && value === 'singleton') {
    return value;
  }
  if (!allowedDimensions.has(value)) {
    throw createParserError(
      ParserErrorCode.INVALID_CONNECTION_ENTRY,
      `Connection field "${key}" references unknown loop "${value}". Declare it under loops[].`
    );
  }
  return value;
}

/**
 * Parses inline edge conditions from YAML.
 */
function parseEdgeConditions(
  raw: unknown,
  allowedDimensions: Set<string>
): EdgeConditionDefinition {
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
function parseConditionItem(
  raw: unknown,
  allowedDimensions: Set<string>
): EdgeConditionClause | EdgeConditionGroup {
  if (!raw || typeof raw !== 'object') {
    throw createParserError(
      ParserErrorCode.INVALID_CONDITION_ENTRY,
      `Invalid condition entry: ${JSON.stringify(raw)}`
    );
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
function parseConditionGroup(
  obj: Record<string, unknown>,
  allowedDimensions: Set<string>
): EdgeConditionGroup {
  const group: EdgeConditionGroup = {};

  if ('all' in obj) {
    if (!Array.isArray(obj.all)) {
      throw createParserError(
        ParserErrorCode.INVALID_CONDITION_GROUP,
        `Condition 'all' must be an array.`
      );
    }
    group.all = obj.all.map((item) =>
      parseConditionClause(item as Record<string, unknown>, allowedDimensions)
    );
  }

  if ('any' in obj) {
    if (!Array.isArray(obj.any)) {
      throw createParserError(
        ParserErrorCode.INVALID_CONDITION_GROUP,
        `Condition 'any' must be an array.`
      );
    }
    group.any = obj.any.map((item) =>
      parseConditionClause(item as Record<string, unknown>, allowedDimensions)
    );
  }

  if (!group.all && !group.any) {
    throw createParserError(
      ParserErrorCode.INVALID_CONDITION_GROUP,
      `Condition group must have 'all' or 'any'.`
    );
  }

  return group;
}

/**
 * Parses a single condition clause.
 */
function parseConditionClause(
  obj: Record<string, unknown>,
  allowedDimensions: Set<string>
): EdgeConditionClause {
  if (!obj || typeof obj !== 'object') {
    throw createParserError(
      ParserErrorCode.INVALID_CONDITION_ENTRY,
      `Invalid condition clause: ${JSON.stringify(obj)}`
    );
  }

  const when = obj.when;
  if (typeof when !== 'string' || when.trim().length === 0) {
    throw createParserError(
      ParserErrorCode.MISSING_CONDITION_OPERATOR,
      `Condition clause must have a 'when' field with a path.`
    );
  }

  const trimmedWhenPath = when.trim();

  // Validate dimensions in the 'when' path
  validateDimensions(trimmedWhenPath, allowedDimensions, 'when' as 'from');

  const normalizedWhenPath = canonicalizeConditionWhenPath(trimmedWhenPath);

  const clause: EdgeConditionClause = { when: normalizedWhenPath };

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
      throw createParserError(
        ParserErrorCode.INVALID_CONDITION_VALUE_TYPE,
        `Condition 'greaterThan' must be a number.`
      );
    }
    clause.greaterThan = obj.greaterThan;
  }
  if ('lessThan' in obj) {
    if (typeof obj.lessThan !== 'number') {
      throw createParserError(
        ParserErrorCode.INVALID_CONDITION_VALUE_TYPE,
        `Condition 'lessThan' must be a number.`
      );
    }
    clause.lessThan = obj.lessThan;
  }
  if ('greaterOrEqual' in obj) {
    if (typeof obj.greaterOrEqual !== 'number') {
      throw createParserError(
        ParserErrorCode.INVALID_CONDITION_VALUE_TYPE,
        `Condition 'greaterOrEqual' must be a number.`
      );
    }
    clause.greaterOrEqual = obj.greaterOrEqual;
  }
  if ('lessOrEqual' in obj) {
    if (typeof obj.lessOrEqual !== 'number') {
      throw createParserError(
        ParserErrorCode.INVALID_CONDITION_VALUE_TYPE,
        `Condition 'lessOrEqual' must be a number.`
      );
    }
    clause.lessOrEqual = obj.lessOrEqual;
  }
  if ('exists' in obj) {
    if (typeof obj.exists !== 'boolean') {
      throw createParserError(
        ParserErrorCode.INVALID_CONDITION_VALUE_TYPE,
        `Condition 'exists' must be a boolean.`
      );
    }
    clause.exists = obj.exists;
  }
  if ('matches' in obj) {
    if (typeof obj.matches !== 'string') {
      throw createParserError(
        ParserErrorCode.INVALID_CONDITION_VALUE_TYPE,
        `Condition 'matches' must be a string (regex pattern).`
      );
    }
    clause.matches = obj.matches;
  }

  // Validate that at least one operator is present
  const hasOperator =
    clause.is !== undefined ||
    clause.isNot !== undefined ||
    clause.contains !== undefined ||
    clause.greaterThan !== undefined ||
    clause.lessThan !== undefined ||
    clause.greaterOrEqual !== undefined ||
    clause.lessOrEqual !== undefined ||
    clause.exists !== undefined ||
    clause.matches !== undefined;

  if (!hasOperator) {
    throw createParserError(
      ParserErrorCode.MISSING_CONDITION_OPERATOR,
      `Condition clause must have at least one operator (is, isNot, contains, etc.).`
    );
  }

  return clause;
}

function canonicalizeConditionWhenPath(whenPath: string): string {
  const trimmed = whenPath.trim();
  if (
    isCanonicalArtifactId(trimmed) ||
    isCanonicalInputId(trimmed) ||
    isCanonicalOutputId(trimmed)
  ) {
    return trimmed;
  }
  return `Artifact:${trimmed}`;
}

/**
 * Parses named condition definitions from the blueprint-level conditions block.
 */
function parseConditionDefinitions(
  raw: Record<string, unknown> | undefined,
  allowedDimensions: Set<string>
): BlueprintConditionDefinitions {
  if (!raw) {
    return {};
  }

  const definitions: BlueprintConditionDefinitions = {};

  for (const [name, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') {
      throw createParserError(
        ParserErrorCode.INVALID_CONDITION_ENTRY,
        `Invalid condition definition "${name}": expected object.`
      );
    }
    definitions[name] = parseNamedConditionDefinition(
      value as Record<string, unknown>,
      allowedDimensions,
      name
    );
  }

  return definitions;
}

/**
 * Parses a named condition definition (can be a clause or group).
 */
function parseNamedConditionDefinition(
  obj: Record<string, unknown>,
  allowedDimensions: Set<string>,
  name: string
): NamedConditionDefinition {
  // Check if it's a group (has 'all' or 'any')
  if ('all' in obj || 'any' in obj) {
    return parseConditionGroup(obj, allowedDimensions);
  }

  // It's a clause - must have 'when'
  if (!('when' in obj)) {
    throw createParserError(
      ParserErrorCode.MISSING_CONDITION_OPERATOR,
      `Condition definition "${name}" must have 'when', 'all', or 'any'.`
    );
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
    throw createParserError(
      ParserErrorCode.INVALID_MAPPING_TRANSFORM,
      `Invalid transform entry: expected object, got ${typeof raw}`
    );
  }
  // Transform is a simple key-value mapping where keys are input values
  // and values are what to send to the model (can be any type)
  return raw as Record<string, unknown>;
}

export function parseSdkMapping(
  raw: unknown
): Record<string, BlueprintProducerSdkMappingField> | undefined {
  if (!raw) {
    return undefined;
  }
  if (typeof raw !== 'object') {
    throw createParserError(
      ParserErrorCode.INVALID_SDK_MAPPING,
      `Invalid sdkMapping entry: ${JSON.stringify(raw)}`
    );
  }
  const table = raw as Record<string, unknown>;
  const mapping: Record<string, BlueprintProducerSdkMappingField> = {};
  for (const [key, value] of Object.entries(table)) {
    if (typeof value === 'string') {
      mapping[key] = { field: value };
      continue;
    }
    if (!value || typeof value !== 'object') {
      throw createParserError(
        ParserErrorCode.INVALID_SDK_MAPPING,
        `Invalid sdkMapping field for ${key}.`
      );
    }
    const fieldConfig = value as Record<string, unknown>;
    const isExpand = fieldConfig.expand === true;
    const field =
      typeof fieldConfig.field === 'string' &&
      fieldConfig.field.trim().length > 0
        ? fieldConfig.field
        : typeof fieldConfig.name === 'string'
          ? fieldConfig.name
          : isExpand
            ? '' // Allow empty field for expand mappings
            : undefined;
    if (field === undefined) {
      throw createParserError(
        ParserErrorCode.INVALID_SDK_MAPPING,
        `Invalid sdkMapping field for ${key}: missing 'field' or 'name' property.`
      );
    }
    mapping[key] = {
      input:
        typeof fieldConfig.input === 'string' ? fieldConfig.input : undefined,
      field,
      type: typeof fieldConfig.type === 'string' ? fieldConfig.type : undefined,
      transform: parseTransform(fieldConfig.transform),
      expand: isExpand ? true : undefined,
      firstOf: fieldConfig.firstOf === true ? true : undefined,
      asArray: fieldConfig.asArray === true ? true : undefined,
      resolution: parseResolutionTransform(fieldConfig.resolution, key),
    };
  }
  return Object.keys(mapping).length ? mapping : undefined;
}

export function parseOutputs(
  raw: unknown
): Record<string, BlueprintProducerOutputDefinition> | undefined {
  if (!raw) {
    return undefined;
  }
  if (typeof raw !== 'object') {
    throw createParserError(
      ParserErrorCode.INVALID_OUTPUT_ENTRY,
      `Invalid outputs entry: ${JSON.stringify(raw)}`
    );
  }
  const table = raw as Record<string, unknown>;
  const outputs: Record<string, BlueprintProducerOutputDefinition> = {};
  for (const [key, value] of Object.entries(table)) {
    if (!value || typeof value !== 'object') {
      throw createParserError(
        ParserErrorCode.INVALID_OUTPUT_ENTRY,
        `Invalid producer output entry for ${key}.`
      );
    }
    const output = value as Record<string, unknown>;
    outputs[key] = {
      type: readString(output, 'type'),
      mimeType:
        typeof output.mimeType === 'string' ? output.mimeType : undefined,
    };
  }
  return Object.keys(outputs).length ? outputs : undefined;
}

function validateDimensions(
  reference: string,
  allowed: Set<string>,
  label: 'from' | 'to'
): void {
  parseReference(reference, allowed, label);
}

function parseReference(
  reference: string,
  allowed: Set<string>,
  label: 'from' | 'to'
): void {
  if (typeof reference !== 'string' || reference.trim().length === 0) {
    throw createParserError(
      ParserErrorCode.INVALID_ENDPOINT_REFERENCE,
      `Invalid ${label} reference "${reference}".`
    );
  }
  const normalizedReference =
    reference.startsWith('Input:') ||
    reference.startsWith('Artifact:') ||
    reference.startsWith('Output:')
      ? reference.slice(reference.indexOf(':') + 1)
      : reference;
  for (const segment of normalizedReference.split('.')) {
    const match = segment.match(/^[A-Za-z0-9_]+/);
    if (!match) {
      throw createParserError(
        ParserErrorCode.INVALID_ENDPOINT_REFERENCE,
        `Invalid ${label} reference "${reference}".`
      );
    }
    let remainder = segment.slice(match[0].length);
    while (remainder.length > 0) {
      if (!remainder.startsWith('[')) {
        throw createParserError(
          ParserErrorCode.INVALID_DIMENSION_SELECTOR,
          `Invalid dimension syntax in ${label} reference "${reference}".`
        );
      }
      const closeIndex = remainder.indexOf(']');
      if (closeIndex === -1) {
        throw createParserError(
          ParserErrorCode.INVALID_DIMENSION_SELECTOR,
          `Unclosed dimension in ${label} reference "${reference}".`
        );
      }
      const symbol = remainder.slice(1, closeIndex).trim();
      if (!symbol) {
        throw createParserError(
          ParserErrorCode.INVALID_DIMENSION_SELECTOR,
          `Empty dimension in ${label} reference "${reference}".`
        );
      }
      const selector = parseDimensionSelector(symbol);
      if (selector.kind === 'loop' && !allowed.has(selector.symbol)) {
        throw createParserError(
          ParserErrorCode.INVALID_DIMENSION_SELECTOR,
          `Unknown dimension "${selector.symbol}" in ${label} reference "${reference}". Declare it under loops[].`
        );
      }
      remainder = remainder.slice(closeIndex + 1);
    }
  }
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  throw createParserError(
    ParserErrorCode.MISSING_REQUIRED_FIELD,
    `Expected string for "${key}"`
  );
}

function readOptionalNonNegativeInteger(
  source: Record<string, unknown>,
  key: string
): number | undefined {
  const raw = source[key];
  if (raw === undefined) {
    return undefined;
  }
  if (
    typeof raw === 'number' &&
    Number.isFinite(raw) &&
    Number.isInteger(raw)
  ) {
    if (raw < 0) {
      throw createParserError(
        ParserErrorCode.MISSING_REQUIRED_FIELD,
        `Expected "${key}" to be a non-negative integer.`
      );
    }
    return raw;
  }
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const trimmed = raw.trim();
    if (!/^[0-9]+$/.test(trimmed)) {
      throw createParserError(
        ParserErrorCode.MISSING_REQUIRED_FIELD,
        `Expected "${key}" to be a non-negative integer.`
      );
    }
    return parseInt(trimmed, 10);
  }
  throw createParserError(
    ParserErrorCode.MISSING_REQUIRED_FIELD,
    `Expected "${key}" to be a non-negative integer.`
  );
}

function relativePosix(root: string, target: string): string {
  const rel = relative(root, target);
  if (rel.startsWith('..')) {
    throw createParserError(
      ParserErrorCode.PATH_ESCAPES_ROOT,
      `Path "${target}" escapes root "${root}".`,
      { filePath: target }
    );
  }
  return rel.split(sep).join('/');
}

// === Producer Mapping Parsing ===

/**
 * Parses the mappings section from producer YAML.
 * Structure: mappings: { [provider]: { [model]: { [input]: Mapping } } }
 */
export function parseMappingsSection(
  raw: unknown
): ProducerMappings | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const mappings: ProducerMappings = {};
  const providers = raw as Record<string, unknown>;

  for (const [provider, models] of Object.entries(providers)) {
    if (!models || typeof models !== 'object') {
      throw createParserError(
        ParserErrorCode.INVALID_MAPPING_VALUE,
        `Invalid mappings for provider "${provider}": expected object.`
      );
    }

    mappings[provider] = {};
    const modelMap = models as Record<string, unknown>;

    for (const [model, inputMappings] of Object.entries(modelMap)) {
      if (!inputMappings || typeof inputMappings !== 'object') {
        throw createParserError(
          ParserErrorCode.INVALID_MAPPING_VALUE,
          `Invalid mappings for model "${provider}/${model}": expected object.`
        );
      }

      mappings[provider][model] = parseMappingFields(
        inputMappings as Record<string, unknown>,
        `${provider}/${model}`
      );
    }
  }

  return Object.keys(mappings).length > 0 ? mappings : undefined;
}

/**
 * Parses individual mapping fields for a model.
 */
function parseMappingFields(
  raw: Record<string, unknown>,
  context: string
): InputMappings {
  const result: InputMappings = {};

  for (const [inputName, value] of Object.entries(raw)) {
    result[inputName] = parseMappingValue(value, `${context}.${inputName}`);
  }

  return result;
}

/**
 * Parses a single mapping value (string or object).
 */
function parseMappingValue(raw: unknown, context: string): MappingValue {
  // Simple string mapping: "Prompt: prompt"
  if (typeof raw === 'string') {
    return raw;
  }

  if (!raw || typeof raw !== 'object') {
    throw createParserError(
      ParserErrorCode.INVALID_MAPPING_VALUE,
      `Invalid mapping value at "${context}": expected string or object.`
    );
  }

  const obj = raw as Record<string, unknown>;
  const result: MappingFieldDefinition = {};

  // Parse field (supports dot notation)
  if (typeof obj.field === 'string') {
    result.field = obj.field;
  }

  if (typeof obj.input === 'string') {
    result.input = obj.input;
  }

  // Parse transform (value lookup table)
  if (obj.transform !== undefined) {
    if (typeof obj.transform !== 'object' || obj.transform === null) {
      throw createParserError(
        ParserErrorCode.INVALID_MAPPING_TRANSFORM,
        `Invalid transform at "${context}": expected object.`
      );
    }
    result.transform = obj.transform as Record<string, unknown>;
  }

  // Parse combine
  if (obj.combine !== undefined) {
    result.combine = parseCombineTransform(obj.combine, context);
  }

  // Parse conditional
  if (obj.conditional !== undefined) {
    result.conditional = parseConditionalTransform(obj.conditional, context);
  }

  // Parse boolean flags
  if (obj.firstOf === true) {
    result.firstOf = true;
  }
  if (obj.asArray === true) {
    result.asArray = true;
  }
  if (obj.invert === true) {
    result.invert = true;
  }
  if (obj.intToString === true) {
    result.intToString = true;
  }
  if (obj.intToSecondsString === true) {
    result.intToSecondsString = true;
  }
  if (obj.expand === true) {
    result.expand = true;
  }

  // Parse durationToFrames
  if (obj.durationToFrames !== undefined) {
    if (
      typeof obj.durationToFrames !== 'object' ||
      obj.durationToFrames === null
    ) {
      throw createParserError(
        ParserErrorCode.INVALID_DURATION_TO_FRAMES,
        `Invalid durationToFrames at "${context}": expected object with fps.`
      );
    }
    const dtf = obj.durationToFrames as Record<string, unknown>;
    if (typeof dtf.fps !== 'number') {
      throw createParserError(
        ParserErrorCode.INVALID_DURATION_TO_FRAMES,
        `durationToFrames.fps must be a number at "${context}".`
      );
    }
    result.durationToFrames = { fps: dtf.fps };
  }

  if (obj.resolution !== undefined) {
    result.resolution = parseResolutionTransform(obj.resolution, context);
  }

  // Validate: mapping must have at least one of: field, expand, combine, or conditional
  // (combine and conditional implicitly provide output targets)
  const hasOutputTarget =
    result.field !== undefined ||
    result.expand === true ||
    result.combine !== undefined ||
    result.conditional !== undefined;

  if (!hasOutputTarget) {
    throw createParserError(
      ParserErrorCode.INVALID_MAPPING_VALUE,
      `Invalid mapping at "${context}": must specify "field", "expand", "combine", or "conditional".`
    );
  }

  return result;
}

function parseResolutionTransform(
  raw: unknown,
  context: string
): ResolutionTransformConfig | undefined {
  if (raw === undefined) {
    return undefined;
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw createParserError(
      ParserErrorCode.INVALID_MAPPING_VALUE,
      `Invalid resolution transform at "${context}": expected object with mode.`
    );
  }

  const value = raw as Record<string, unknown>;
  const mode = value.mode;
  if (typeof mode !== 'string') {
    throw createParserError(
      ParserErrorCode.INVALID_MAPPING_VALUE,
      `Invalid resolution transform at "${context}": missing string mode.`
    );
  }

  const validModes = new Set([
    'aspectRatio',
    'preset',
    'sizeToken',
    'sizeTokenNearest',
    'aspectRatioAndPreset',
    'megapixelsNearest',
    'aspectRatioAndPresetObject',
    'aspectRatioAndSizeTokenObject',
    'object',
    'width',
    'height',
  ]);

  if (!validModes.has(mode)) {
    throw createParserError(
      ParserErrorCode.INVALID_MAPPING_VALUE,
      `Invalid resolution transform mode "${mode}" at "${context}".`
    );
  }

  const parsed: ResolutionTransformConfig = {
    mode: mode as ResolutionTransformConfig['mode'],
  };

  if (value.aspectRatioField !== undefined) {
    if (typeof value.aspectRatioField !== 'string') {
      throw createParserError(
        ParserErrorCode.INVALID_MAPPING_VALUE,
        `Invalid resolution transform at "${context}": aspectRatioField must be a string.`
      );
    }
    parsed.aspectRatioField = value.aspectRatioField;
  }

  if (value.presetField !== undefined) {
    if (typeof value.presetField !== 'string') {
      throw createParserError(
        ParserErrorCode.INVALID_MAPPING_VALUE,
        `Invalid resolution transform at "${context}": presetField must be a string.`
      );
    }
    parsed.presetField = value.presetField;
  }

  if (value.sizeTokenField !== undefined) {
    if (typeof value.sizeTokenField !== 'string') {
      throw createParserError(
        ParserErrorCode.INVALID_MAPPING_VALUE,
        `Invalid resolution transform at "${context}": sizeTokenField must be a string.`
      );
    }
    parsed.sizeTokenField = value.sizeTokenField;
  }

  if (value.fields !== undefined) {
    parsed.fields = parseResolutionObjectFields(value.fields, context);
  }

  if (value.megapixelCandidates !== undefined) {
    parsed.megapixelCandidates = parseMegapixelCandidates(
      value.megapixelCandidates,
      context
    );
  }

  if (value.megapixelSuffix !== undefined) {
    if (typeof value.megapixelSuffix !== 'string') {
      throw createParserError(
        ParserErrorCode.INVALID_MAPPING_VALUE,
        `Invalid resolution transform at "${context}": megapixelSuffix must be a string.`
      );
    }
    parsed.megapixelSuffix = value.megapixelSuffix;
  }

  if (parsed.mode === 'aspectRatioAndPresetObject') {
    if (!parsed.aspectRatioField || !parsed.presetField) {
      throw createParserError(
        ParserErrorCode.INVALID_MAPPING_VALUE,
        `Invalid resolution transform at "${context}": aspectRatioAndPresetObject requires aspectRatioField and presetField.`
      );
    }
  }

  if (parsed.mode === 'aspectRatioAndSizeTokenObject') {
    if (!parsed.aspectRatioField || !parsed.sizeTokenField) {
      throw createParserError(
        ParserErrorCode.INVALID_MAPPING_VALUE,
        `Invalid resolution transform at "${context}": aspectRatioAndSizeTokenObject requires aspectRatioField and sizeTokenField.`
      );
    }
  }

  if (parsed.mode === 'megapixelsNearest') {
    if (
      !parsed.megapixelCandidates ||
      parsed.megapixelCandidates.length === 0
    ) {
      throw createParserError(
        ParserErrorCode.INVALID_MAPPING_VALUE,
        `Invalid resolution transform at "${context}": megapixelsNearest requires megapixelCandidates.`
      );
    }
  }

  if (parsed.mode === 'object') {
    if (!parsed.fields || Object.keys(parsed.fields).length === 0) {
      throw createParserError(
        ParserErrorCode.INVALID_MAPPING_VALUE,
        `Invalid resolution transform at "${context}": object mode requires a non-empty fields map.`
      );
    }
  }

  if (parsed.mode !== 'object' && parsed.fields !== undefined) {
    throw createParserError(
      ParserErrorCode.INVALID_MAPPING_VALUE,
      `Invalid resolution transform at "${context}": fields is only supported when mode is object.`
    );
  }

  if (parsed.mode !== 'megapixelsNearest') {
    if (parsed.megapixelCandidates !== undefined) {
      throw createParserError(
        ParserErrorCode.INVALID_MAPPING_VALUE,
        `Invalid resolution transform at "${context}": megapixelCandidates is only supported when mode is megapixelsNearest.`
      );
    }
    if (parsed.megapixelSuffix !== undefined) {
      throw createParserError(
        ParserErrorCode.INVALID_MAPPING_VALUE,
        `Invalid resolution transform at "${context}": megapixelSuffix is only supported when mode is megapixelsNearest.`
      );
    }
  }

  return parsed;
}

function parseResolutionObjectFields(
  raw: unknown,
  context: string
): Record<string, ResolutionObjectFieldConfig> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw createParserError(
      ParserErrorCode.INVALID_MAPPING_VALUE,
      `Invalid resolution transform at "${context}": fields must be an object.`
    );
  }

  const value = raw as Record<string, unknown>;
  const result: Record<string, ResolutionObjectFieldConfig> = {};
  const validModes = new Set<ResolutionProjectionMode>([
    'aspectRatio',
    'preset',
    'sizeToken',
    'sizeTokenNearest',
    'aspectRatioAndPreset',
    'width',
    'height',
    'megapixelsNearest',
  ]);

  for (const [field, fieldRaw] of Object.entries(value)) {
    const fieldContext = `${context}.fields.${field}`;
    let mode: ResolutionProjectionMode;
    let transform: Record<string, unknown> | undefined;
    let megapixelCandidates: number[] | undefined;
    let megapixelSuffix: string | undefined;

    if (typeof fieldRaw === 'string') {
      mode = fieldRaw as ResolutionProjectionMode;
    } else if (
      fieldRaw &&
      typeof fieldRaw === 'object' &&
      !Array.isArray(fieldRaw)
    ) {
      const fieldObject = fieldRaw as Record<string, unknown>;
      if (typeof fieldObject.mode !== 'string') {
        throw createParserError(
          ParserErrorCode.INVALID_MAPPING_VALUE,
          `Invalid resolution object field at "${fieldContext}": missing string mode.`
        );
      }
      mode = fieldObject.mode as ResolutionProjectionMode;

      if (fieldObject.transform !== undefined) {
        if (
          typeof fieldObject.transform !== 'object' ||
          fieldObject.transform === null ||
          Array.isArray(fieldObject.transform)
        ) {
          throw createParserError(
            ParserErrorCode.INVALID_MAPPING_TRANSFORM,
            `Invalid resolution object field transform at "${fieldContext}": expected object.`
          );
        }
        transform = fieldObject.transform as Record<string, unknown>;
      }

      if (fieldObject.megapixelCandidates !== undefined) {
        megapixelCandidates = parseMegapixelCandidates(
          fieldObject.megapixelCandidates,
          fieldContext
        );
      }

      if (fieldObject.megapixelSuffix !== undefined) {
        if (typeof fieldObject.megapixelSuffix !== 'string') {
          throw createParserError(
            ParserErrorCode.INVALID_MAPPING_VALUE,
            `Invalid resolution object field at "${fieldContext}": megapixelSuffix must be a string.`
          );
        }
        megapixelSuffix = fieldObject.megapixelSuffix;
      }
    } else {
      throw createParserError(
        ParserErrorCode.INVALID_MAPPING_VALUE,
        `Invalid resolution object field at "${fieldContext}": expected string mode or object.`
      );
    }

    if (!validModes.has(mode)) {
      throw createParserError(
        ParserErrorCode.INVALID_MAPPING_VALUE,
        `Invalid resolution object field mode "${mode}" at "${fieldContext}".`
      );
    }

    if (mode === 'megapixelsNearest') {
      if (!megapixelCandidates || megapixelCandidates.length === 0) {
        throw createParserError(
          ParserErrorCode.INVALID_MAPPING_VALUE,
          `Invalid resolution object field at "${fieldContext}": megapixelsNearest requires megapixelCandidates.`
        );
      }
    } else {
      if (megapixelCandidates !== undefined) {
        throw createParserError(
          ParserErrorCode.INVALID_MAPPING_VALUE,
          `Invalid resolution object field at "${fieldContext}": megapixelCandidates is only supported for mode megapixelsNearest.`
        );
      }
      if (megapixelSuffix !== undefined) {
        throw createParserError(
          ParserErrorCode.INVALID_MAPPING_VALUE,
          `Invalid resolution object field at "${fieldContext}": megapixelSuffix is only supported for mode megapixelsNearest.`
        );
      }
    }

    result[field] = {
      mode,
      transform,
      megapixelCandidates,
      megapixelSuffix,
    };
  }

  return result;
}

function parseMegapixelCandidates(raw: unknown, context: string): number[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw createParserError(
      ParserErrorCode.INVALID_MAPPING_VALUE,
      `Invalid resolution transform at "${context}": megapixelCandidates must be a non-empty number array.`
    );
  }

  const values = raw.map((candidate) => Number(candidate));
  for (const candidate of values) {
    if (!Number.isFinite(candidate) || candidate <= 0) {
      throw createParserError(
        ParserErrorCode.INVALID_MAPPING_VALUE,
        `Invalid resolution transform at "${context}": megapixelCandidates must contain only positive numbers.`
      );
    }
  }

  return values;
}

/**
 * Parses a combine transform definition.
 */
function parseCombineTransform(
  raw: unknown,
  context: string
): CombineTransform {
  if (!raw || typeof raw !== 'object') {
    throw createParserError(
      ParserErrorCode.INVALID_COMBINE_TRANSFORM,
      `Invalid combine transform at "${context}": expected object.`
    );
  }

  const obj = raw as Record<string, unknown>;

  if (!Array.isArray(obj.inputs) || obj.inputs.length < 1) {
    throw createParserError(
      ParserErrorCode.INVALID_COMBINE_TRANSFORM,
      `combine.inputs must be array of 1+ inputs at "${context}".`
    );
  }

  if (!obj.table || typeof obj.table !== 'object') {
    throw createParserError(
      ParserErrorCode.INVALID_COMBINE_TRANSFORM,
      `combine.table is required at "${context}".`
    );
  }

  return {
    inputs: obj.inputs.map(String),
    table: obj.table as Record<string, unknown>,
  };
}

/**
 * Parses a conditional transform definition.
 */
function parseConditionalTransform(
  raw: unknown,
  context: string
): ConditionalTransform {
  if (!raw || typeof raw !== 'object') {
    throw createParserError(
      ParserErrorCode.INVALID_CONDITIONAL_MAPPING,
      `Invalid conditional transform at "${context}": expected object.`
    );
  }

  const obj = raw as Record<string, unknown>;

  if (!obj.when || typeof obj.when !== 'object') {
    throw createParserError(
      ParserErrorCode.INVALID_CONDITIONAL_MAPPING,
      `conditional.when is required at "${context}".`
    );
  }

  if (obj.then === undefined) {
    throw createParserError(
      ParserErrorCode.INVALID_CONDITIONAL_MAPPING,
      `conditional.then is required at "${context}".`
    );
  }

  const when = obj.when as Record<string, unknown>;
  if (typeof when.input !== 'string') {
    throw createParserError(
      ParserErrorCode.INVALID_CONDITIONAL_MAPPING,
      `conditional.when.input is required at "${context}".`
    );
  }

  const condition: MappingCondition = {
    input: when.input,
  };

  if (when.equals !== undefined) {
    condition.equals = when.equals;
  }
  if (when.notEmpty === true) {
    condition.notEmpty = true;
  }
  if (when.empty === true) {
    condition.empty = true;
  }

  // Parse the 'then' clause - can be a string (simple field) or object (complex mapping)
  const thenValue = parseMappingValue(obj.then, `${context}.then`);
  const thenDef: MappingFieldDefinition =
    typeof thenValue === 'string' ? { field: thenValue } : thenValue;

  return {
    when: condition,
    then: thenDef,
  };
}
