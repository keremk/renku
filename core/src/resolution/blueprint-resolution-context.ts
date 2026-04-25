import type { BlueprintTreeNode } from '../types.js';
import { loadYamlBlueprintTree } from '../parsing/blueprint-loader/index.js';
import {
  createInputIdResolver,
  formatCanonicalInputId,
  isCanonicalInputId,
  parseCanonicalInputId,
  isSystemInput,
} from '../parsing/canonical-ids.js';
import {
  createParserError,
  createRuntimeError,
  ParserErrorCode,
  RuntimeErrorCode,
} from '../errors/index.js';
import {
  applyOutputSchemasToBlueprintTree,
  buildOutputSchemaMapFromProviderOptions,
  loadOutputSchemasFromProducerMetadata,
  type OutputSchemaProviderOption,
} from '../orchestration/output-schema-hydration.js';
import {
  buildBlueprintGraph,
  type BlueprintGraph,
} from './canonical-graph.js';
import {
  expandBlueprintGraph,
  type CanonicalBlueprint,
} from './canonical-expander.js';
import {
  buildInputSourceMapFromCanonical,
  normalizeInputValues,
  type InputSourceMap,
} from './input-sources.js';

export type ResolutionSchemaSource =
  | { kind: 'producer-metadata' }
  | {
      kind: 'provider-options';
      providerOptions: ReadonlyMap<string, OutputSchemaProviderOption>;
    };

export interface BlueprintResolutionContext {
  root: BlueprintTreeNode;
  graph: BlueprintGraph;
  inputSources: InputSourceMap;
}

export interface ExpandedBlueprintResolution {
  context: BlueprintResolutionContext;
  normalizedInputs: Record<string, unknown>;
  canonical: CanonicalBlueprint;
}

export async function loadBlueprintResolutionContext(args: {
  blueprintPath: string;
  catalogRoot?: string;
  schemaSource: ResolutionSchemaSource;
}): Promise<BlueprintResolutionContext> {
  const { root } = await loadYamlBlueprintTree(args.blueprintPath, {
    catalogRoot: args.catalogRoot,
  });
  return prepareBlueprintResolutionContext({
    root,
    schemaSource: args.schemaSource,
  });
}

export async function prepareBlueprintResolutionContext(args: {
  root: BlueprintTreeNode;
  schemaSource: ResolutionSchemaSource;
}): Promise<BlueprintResolutionContext> {
  const preparedRoot = cloneBlueprintTreeNode(args.root);
  const schemasByProducerAlias =
    args.schemaSource.kind === 'producer-metadata'
      ? await loadOutputSchemasFromProducerMetadata(preparedRoot)
      : buildOutputSchemaMapFromProviderOptions(
          args.schemaSource.providerOptions
        );

  applyOutputSchemasToBlueprintTree(preparedRoot, schemasByProducerAlias);

  const graph = buildBlueprintGraph(preparedRoot);
  const inputSources = buildInputSourceMapFromCanonical(graph);

  return {
    root: preparedRoot,
    graph,
    inputSources,
  };
}

export function normalizeBlueprintResolutionInputs(
  context: BlueprintResolutionContext,
  inputValues: Record<string, unknown>,
  options: {
    requireCanonicalIds?: boolean;
    additionalCanonicalIds?: Iterable<string>;
  } = {}
): Record<string, unknown> {
  const resolver = createInputIdResolver(context.root);
  const canonicalInputs: Record<string, unknown> = {};
  const additionalCanonicalIds = new Set(options.additionalCanonicalIds ?? []);

  for (const [key, value] of Object.entries(inputValues)) {
    if (value === undefined) {
      continue;
    }

    let canonicalKey: string;
    if (isCanonicalInputId(key)) {
      const parsed = parseCanonicalInputId(key);
      const declaredInContext =
        context.inputSources.has(key) ||
        resolver.has(key) ||
        additionalCanonicalIds.has(key);
      const isKnownSystemInput =
        parsed.path.length === 0 && isSystemInput(parsed.name);
      if (!declaredInContext && !isKnownSystemInput) {
        throw createParserError(
          ParserErrorCode.UNKNOWN_CANONICAL_ID,
          `Unknown canonical input id "${key}".`
        );
      }
      canonicalKey = key;
    } else {
      if (options.requireCanonicalIds) {
        throw createRuntimeError(
          RuntimeErrorCode.NON_CANONICAL_INPUT_ID,
          `Input "${key}" is not a canonical input id. Expected to start with "Input:".`,
          { context: key }
        );
      }
      canonicalKey = resolver.toCanonical(key);
    }

    if (canonicalKey in canonicalInputs) {
      throw createRuntimeError(
        RuntimeErrorCode.INVALID_INPUT_BINDING,
        `Duplicate canonical input key "${canonicalKey}" while normalizing blueprint resolution inputs.`
      );
    }
    canonicalInputs[canonicalKey] = value;
  }

  return normalizeInputValues(canonicalInputs, context.inputSources);
}

export function selectBlueprintResolutionInputs(
  context: BlueprintResolutionContext,
  inputValues: Record<string, unknown>
): Record<string, unknown> {
  const canonicalInputs: Record<string, unknown> = {};

  for (const node of context.graph.nodes) {
    if (node.type !== 'InputSource') {
      continue;
    }

    const canonicalKey = formatCanonicalInputId(node.namespacePath, node.name);
    const scopedKey = [...node.namespacePath, node.name].join('.');
    const value =
      inputValues[canonicalKey] ??
      inputValues[scopedKey] ??
      inputValues[node.name];

    if (value !== undefined) {
      canonicalInputs[canonicalKey] = value;
    }
  }

  return normalizeInputValues(canonicalInputs, context.inputSources);
}

export function expandBlueprintResolutionContext(
  context: BlueprintResolutionContext,
  canonicalInputs: Record<string, unknown>
): ExpandedBlueprintResolution {
  return {
    context,
    normalizedInputs: canonicalInputs,
    canonical: expandBlueprintGraph(
      context.graph,
      canonicalInputs,
      context.inputSources
    ),
  };
}

export function cloneBlueprintTreeNode(
  node: BlueprintTreeNode
): BlueprintTreeNode {
  return {
    id: node.id,
    namespacePath: [...node.namespacePath],
    document: clonePlainValue(node.document),
    children: new Map(
      Array.from(node.children.entries(), ([key, child]) => [
        key,
        cloneBlueprintTreeNode(child),
      ])
    ),
    sourcePath: node.sourcePath,
    importConditions: clonePlainValue(node.importConditions),
  };
}

function clonePlainValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => clonePlainValue(entry)) as T;
  }

  if (value && typeof value === 'object') {
    const clonedEntries = Object.entries(value).map(([key, entry]) => [
      key,
      clonePlainValue(entry),
    ]);
    return Object.fromEntries(clonedEntries) as T;
  }

  return value;
}
