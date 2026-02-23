import type {
  BlueprintArtefactDefinition,
  BlueprintDocument,
  BlueprintInputDefinition,
  BlueprintLoopDefinition,
  BlueprintTreeNode,
  EdgeConditionDefinition,
  NodeKind,
  ProducerConfig,
} from '../types.js';
import { SYSTEM_INPUTS } from '../types.js';
import {
  parseDimensionSelector,
  type DimensionSelector,
} from '../parsing/dimension-selectors.js';
import { decomposeJsonSchema } from './schema-decomposition.js';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';

/**
 * Well-known system input names that are automatically recognized.
 * These don't need to be declared in blueprint YAML.
 */
const SYSTEM_INPUT_NAMES = new Set<string>([
  SYSTEM_INPUTS.DURATION,
  SYSTEM_INPUTS.NUM_OF_SEGMENTS,
  SYSTEM_INPUTS.SEGMENT_DURATION,
  SYSTEM_INPUTS.MOVIE_ID,
  SYSTEM_INPUTS.STORAGE_ROOT,
  SYSTEM_INPUTS.STORAGE_BASE_PATH,
]);

export interface BlueprintGraphNode {
  id: string;
  type: NodeKind;
  namespacePath: string[];
  name: string;
  dimensions: string[];
  input?: BlueprintInputDefinition;
  artefact?: BlueprintArtefactDefinition;
  producer?: ProducerConfig;
}

export interface BlueprintGraphEdgeEndpoint {
  nodeId: string;
  dimensions: string[];
  selectors?: Array<DimensionSelector | undefined>;
  /**
   * Additional selectors that target collection elements on the endpoint node.
   *
   * Example:
   * - Reference: "SceneVideoProducer[scene].ReferenceImages[character]"
   * - Node dimensions: [scene]
   * - selectors: [scene]
   * - collectionSelectors: [character]
   */
  collectionSelectors?: DimensionSelector[];
}

export interface BlueprintGraphEdge {
  from: BlueprintGraphEdgeEndpoint;
  to: BlueprintGraphEdgeEndpoint;
  note?: string;
  groupBy?: string;
  orderBy?: string;
  /** Conditions that must be satisfied for this edge to be active */
  conditions?: EdgeConditionDefinition;
}

export interface BlueprintGraph {
  meta: BlueprintDocument['meta'];
  nodes: BlueprintGraphNode[];
  edges: BlueprintGraphEdge[];
  namespaceDimensions: Map<string, DimensionSymbol[]>;
  dimensionLineage: Map<string, string | null>;
  /** Loop definitions from all blueprints, keyed by namespace path */
  loops: Map<string, BlueprintLoopDefinition[]>;
}

interface ParsedSegment {
  name: string;
  dimensions: string[];
}

interface ParsedReference {
  namespaceSegments: ParsedSegment[];
  node: ParsedSegment;
}

interface DimensionSymbol {
  raw: string;
  ordinal: number;
}

interface DimensionSlot {
  scope: 'namespace' | 'local';
  scopeKey: string;
  ordinal: number;
  raw: string;
}

interface NamespaceDimensionEntry extends DimensionSymbol {
  namespaceKey: string;
}

type LocalNodeDims = Map<string, DimensionSymbol[]>;

export function buildBlueprintGraph(root: BlueprintTreeNode): BlueprintGraph {
  // Inject synthetic input declarations for system inputs referenced in edges
  injectSystemInputsFromEdges(root);

  const namespaceDims = new Map<string, DimensionSymbol[]>();
  namespaceDims.set('', []);
  collectNamespaceDimensions(root, namespaceDims);
  const localDimsMap = new Map<BlueprintTreeNode, LocalNodeDims>();
  collectLocalNodeDimensions(root, localDimsMap);

  // Collect constant-indexed input references from edges
  // This needs to be done AFTER localDims are collected but BEFORE nodes are created
  collectConstantIndexedInputs(root, localDimsMap);

  const namespaceParents = initializeNamespaceParentMap(namespaceDims);
  const namespaceMembership = new Map<string, string>();

  const nodes: BlueprintGraphNode[] = [];
  collectGraphNodes(
    root,
    namespaceDims,
    localDimsMap,
    nodes,
    namespaceMembership
  );

  const edges: BlueprintGraphEdge[] = [];
  collectGraphEdges(root, namespaceDims, localDimsMap, edges, root);

  resolveNamespaceDimensionParents(
    edges,
    namespaceMembership,
    namespaceParents
  );
  const dimensionLineage = buildDimensionLineage(
    nodes,
    namespaceMembership,
    namespaceParents
  );

  // Collect loop definitions from all tree nodes
  const loops = new Map<string, BlueprintLoopDefinition[]>();
  collectLoopDefinitions(root, loops);

  return {
    meta: root.document.meta,
    nodes,
    edges,
    namespaceDimensions: namespaceDims,
    dimensionLineage,
    loops,
  };
}

function collectNamespaceDimensions(
  tree: BlueprintTreeNode,
  namespaceDims: Map<string, DimensionSymbol[]>
): void {
  for (const edge of tree.document.edges) {
    registerNamespaceDims(edge.from, tree.namespacePath, namespaceDims);
    registerNamespaceDims(edge.to, tree.namespacePath, namespaceDims);
  }
  for (const child of tree.children.values()) {
    collectNamespaceDimensions(child, namespaceDims);
  }
}

function registerNamespaceDims(
  reference: string,
  currentNamespace: string[],
  namespaceDims: Map<string, DimensionSymbol[]>
): void {
  const parsed = parseReference(reference);
  let path: string[] = [...currentNamespace];
  for (const segment of parsed.namespaceSegments) {
    path = [...path, segment.name];
    if (segment.dimensions.length === 0) {
      continue;
    }
    const key = namespaceKey(path);
    const existing = namespaceDims.get(key);
    if (!existing) {
      namespaceDims.set(
        key,
        createDimensionSymbols(
          segment.dimensions,
          `Namespace "${path.join('.')}"`
        )
      );
      continue;
    }
    if (existing.length !== segment.dimensions.length) {
      throw createRuntimeError(
        RuntimeErrorCode.GRAPH_BUILD_ERROR,
        `Namespace "${path.join('.')}" referenced with conflicting dimension counts (${existing.length} vs ${segment.dimensions.length}).`
      );
    }
    for (let index = 0; index < existing.length; index += 1) {
      const raw = segment.dimensions[index] ?? '';
      const selector = parseDimensionSelector(raw);
      if (
        selector.kind === 'loop' &&
        existing[index]?.raw !== selector.symbol
      ) {
        throw createRuntimeError(
          RuntimeErrorCode.GRAPH_BUILD_ERROR,
          `Namespace "${path.join('.')}" referenced with conflicting dimensions (${existing.map((entry) => entry.raw).join(', ')} vs ${segment.dimensions
            .map((entry) => {
              const parsedSelector = parseDimensionSelector(entry);
              return parsedSelector.kind === 'loop'
                ? parsedSelector.symbol
                : entry;
            })
            .join(', ')}).`
        );
      }
    }
  }
}

function collectLocalNodeDimensions(
  tree: BlueprintTreeNode,
  map: Map<BlueprintTreeNode, LocalNodeDims>
): void {
  const localDims = new Map<string, DimensionSymbol[]>();
  for (const edge of tree.document.edges) {
    registerLocalDims(edge.from, localDims);
    registerLocalDims(edge.to, localDims);
  }
  for (const artefact of tree.document.artefacts) {
    // Handle JSON artifacts with schema decomposition
    if (artefact.type === 'json' && artefact.schema && artefact.arrays) {
      const decomposed = decomposeJsonSchema(
        artefact.schema,
        artefact.name,
        artefact.arrays
      );
      for (const field of decomposed) {
        if (field.dimensions.length === 0) {
          continue;
        }
        const existing = localDims.get(field.path);
        if (!existing || existing.length === 0) {
          // Use derived dimension names (e.g., "segment", "image") as dimension symbols
          localDims.set(
            field.path,
            createDimensionSymbolsFromDerived(field.dimensions)
          );
        }
      }
    } else if (artefact.countInput) {
      // Handle regular artifacts with countInput
      const existing = localDims.get(artefact.name);
      if (!existing || existing.length === 0) {
        localDims.set(
          artefact.name,
          createDimensionSymbols(
            [artefact.countInput],
            `Artefact "${artefact.name}"`
          )
        );
      }
    }
  }
  map.set(tree, localDims);
  for (const child of tree.children.values()) {
    collectLocalNodeDimensions(child, map);
  }
}

function registerLocalDims(reference: string, dimsMap: LocalNodeDims): void {
  if (reference.includes('.')) {
    return;
  }
  const parsed = parseReference(reference);
  const identifier = parsed.node.name;
  const dims = parsed.node.dimensions;
  const existing = dimsMap.get(identifier);
  if (!existing) {
    dimsMap.set(
      identifier,
      createDimensionSymbols(dims, `Node "${identifier}"`)
    );
    return;
  }
  if (existing.length !== dims.length) {
    throw createRuntimeError(
      RuntimeErrorCode.GRAPH_BUILD_ERROR,
      `Node "${identifier}" referenced with inconsistent dimension counts (${existing.length} vs ${dims.length}).`
    );
  }
  for (let index = 0; index < existing.length; index += 1) {
    const raw = dims[index] ?? '';
    const selector = parseDimensionSelector(raw);
    if (selector.kind === 'loop' && existing[index]?.raw !== selector.symbol) {
      throw createRuntimeError(
        RuntimeErrorCode.GRAPH_BUILD_ERROR,
        `Node "${identifier}" referenced with inconsistent dimensions (${existing.map((entry) => entry.raw).join(', ')} vs ${dims
          .map((entry) => {
            const parsedSelector = parseDimensionSelector(entry);
            return parsedSelector.kind === 'loop'
              ? parsedSelector.symbol
              : entry;
          })
          .join(', ')}).`
      );
    }
  }
}

/**
 * Collects constant-indexed input references from edges across the tree.
 * For example, if an edge targets "VideoProducer[clip].ReferenceImages[0]",
 * this function will register "ReferenceImages[0]" in the VideoProducer's
 * local dims so that an Input node is created for it.
 *
 * This must be called AFTER collectLocalNodeDimensions to ensure the
 * localDimsMap is populated for all trees.
 */
function collectConstantIndexedInputs(
  tree: BlueprintTreeNode,
  localDimsMap: Map<BlueprintTreeNode, LocalNodeDims>
): void {
  // Process edges in this tree
  for (const edge of tree.document.edges) {
    registerConstantIndexedInput(edge.to, tree, localDimsMap);
  }

  // Recursively process child trees
  for (const child of tree.children.values()) {
    collectConstantIndexedInputs(child, localDimsMap);
  }
}

/**
 * Registers a single constant-indexed input reference if applicable.
 */
function registerConstantIndexedInput(
  reference: string,
  currentTree: BlueprintTreeNode,
  localDimsMap: Map<BlueprintTreeNode, LocalNodeDims>
): void {
  // Only process cross-namespace references (those with dots)
  if (!reference.includes('.')) {
    return;
  }

  const parsed = parseReference(reference);
  const finalSegment = parsed.node;

  // Check if the final segment has any constant index selectors
  const constIndices = finalSegment.dimensions.filter((d) => {
    const selector = parseDimensionSelector(d);
    return selector.kind === 'const';
  });

  if (constIndices.length === 0) {
    return;
  }

  // Build the constant-indexed node name (e.g., "ReferenceImages[0]")
  const constIndexSuffix = constIndices.map((d) => `[${d}]`).join('');
  const constantIndexedName = `${finalSegment.name}${constIndexSuffix}`;

  // Get the namespace path for the target (the namespace segments leading to the input)
  const namespacePath = parsed.namespaceSegments.map((seg) => seg.name);

  // Find the child tree that owns this input
  let targetTree: BlueprintTreeNode | undefined = currentTree;
  for (const segment of namespacePath) {
    targetTree = targetTree?.children.get(segment);
    if (!targetTree) {
      return; // Namespace not found, skip
    }
  }

  // Check if the base input exists in the target tree
  const baseInputExists = targetTree.document.inputs.some(
    (input) => input.name === finalSegment.name
  );

  if (!baseInputExists) {
    return; // Not an input reference, skip
  }

  // Get the target tree's local dims
  const targetLocalDims = localDimsMap.get(targetTree);
  if (!targetLocalDims) {
    return; // Target tree's local dims not found (shouldn't happen)
  }

  // Only register if not already present
  if (!targetLocalDims.has(constantIndexedName)) {
    // Constant-indexed inputs have no loop dimensions (the [0] is a selector, not a dimension)
    targetLocalDims.set(constantIndexedName, []);
  }
}

function createDimensionSymbols(
  dims: string[],
  context: string
): DimensionSymbol[] {
  return dims.map((raw, ordinal) => {
    const selector = parseDimensionSelector(raw);
    if (selector.kind === 'const') {
      throw createRuntimeError(
        RuntimeErrorCode.INVALID_DIMENSION_SELECTOR,
        `${context} uses a numeric index selector "[${raw}]" to declare a dimension. ` +
          'Declare the dimension using a loop symbol (for example: "[segment]") and use numeric indices only when selecting an existing dimension.'
      );
    }
    return { raw: selector.symbol, ordinal };
  });
}

/**
 * Creates dimension symbols from already-derived dimension names.
 * Used for JSON schema decomposition where dimension names are derived from countInput names.
 */
function createDimensionSymbolsFromDerived(dims: string[]): DimensionSymbol[] {
  return dims.map((raw, ordinal) => ({ raw, ordinal }));
}

/**
 * Normalize a node path to its "dimension source key" by extracting the path
 * up to and including the last indexed segment (e.g., `[segment]`).
 *
 * This ensures that sibling fields from the same array element share the same
 * dimension source, preventing false conflicts like:
 * - `Segments[segment].TalkingHeadText` vs `Segments[segment].TalkingHeadPrompt`
 *
 * Examples:
 * - `DocProducer.VideoScript.Segments[segment].TalkingHeadText` → `DocProducer.VideoScript.Segments[segment]`
 * - `DocProducer.VideoScript.Segments[segment]` → `DocProducer.VideoScript.Segments[segment]`
 * - `ImageProducer.SegmentImage` → `ImageProducer.SegmentImage` (no index, unchanged)
 */
function normalizeDimensionSourceKey(nodeId: string): string {
  // Find the last occurrence of a bracket-enclosed index like [segment] or [0]
  const lastIndexMatch = nodeId.match(/^(.*\[[^\]]+\])/);
  if (lastIndexMatch) {
    return lastIndexMatch[1];
  }
  // No indexed segment found, return as-is
  return nodeId;
}

/**
 * Extract the dimension source key from a fully qualified dimension symbol.
 *
 * Dimension symbols have the format: `<nodeId>::<scope>:<scopeKey>:<ordinal>:<raw>`
 * This function extracts the `<scope>:<scopeKey>:<ordinal>:<raw>` portion,
 * which represents the actual dimension source independent of the specific field.
 *
 * Example:
 * - Input: `DocProducer.VideoScript.Segments[segment].TalkingHeadText::local:DocProducer.VideoScript.Segments[segment]:0:segment`
 * - Output: `local:DocProducer.VideoScript.Segments[segment]:0:segment`
 */
function extractDimensionSourceKey(dimensionSymbol: string): string {
  const separatorIndex = dimensionSymbol.indexOf('::');
  if (separatorIndex === -1) {
    return dimensionSymbol;
  }
  return dimensionSymbol.slice(separatorIndex + 2);
}

function toLocalSlots(
  nodeId: string,
  symbols: DimensionSymbol[]
): DimensionSlot[] {
  const normalizedKey = normalizeDimensionSourceKey(nodeId);
  return symbols.map((symbol) => ({
    scope: 'local',
    scopeKey: normalizedKey,
    ordinal: symbol.ordinal,
    raw: symbol.raw,
  }));
}

function qualifyDimensionSlots(
  nodeId: string,
  slots: DimensionSlot[]
): string[] {
  return slots.map((slot) => formatDimensionSlot(nodeId, slot));
}

function formatDimensionSlot(nodeId: string, slot: DimensionSlot): string {
  const scopeLabel =
    slot.scope === 'namespace'
      ? `ns:${slot.scopeKey || '__root__'}`
      : `local:${slot.scopeKey}`;
  return `${nodeId}::${scopeLabel}:${slot.ordinal}:${slot.raw}`;
}

function makeNamespaceSlot(entry: NamespaceDimensionEntry): DimensionSlot {
  return {
    scope: 'namespace',
    scopeKey: entry.namespaceKey,
    ordinal: entry.ordinal,
    raw: entry.raw,
  };
}

function registerNamespaceSymbol(
  symbol: string,
  slot: DimensionSlot,
  namespaceMembership: Map<string, string>
): void {
  if (slot.scope === 'namespace') {
    namespaceMembership.set(
      symbol,
      formatNamespaceParentKey(slot.scopeKey, slot.ordinal)
    );
  }
}

function collectGraphNodes(
  tree: BlueprintTreeNode,
  namespaceDims: Map<string, DimensionSymbol[]>,
  localDims: Map<BlueprintTreeNode, LocalNodeDims>,
  output: BlueprintGraphNode[],
  namespaceMembership: Map<string, string>
): void {
  const namespaceSlots = collectNamespacePrefixDims(
    tree.namespacePath,
    namespaceDims
  );
  const local = localDims.get(tree) ?? new Map();
  // Create Input nodes from input definitions
  const inputNames = new Set(tree.document.inputs.map((input) => input.name));
  for (const input of tree.document.inputs) {
    const nodeKey = nodeId(tree.namespacePath, input.name);
    const namespaceQualified = qualifyDimensionSlots(nodeKey, namespaceSlots);
    namespaceQualified.forEach((symbol, index) => {
      registerNamespaceSymbol(
        symbol,
        namespaceSlots[index]!,
        namespaceMembership
      );
    });
    const localSymbols = toLocalSlots(nodeKey, local.get(input.name) ?? []);
    const localQualified = qualifyDimensionSlots(nodeKey, localSymbols);
    output.push({
      id: nodeKey,
      type: 'InputSource',
      namespacePath: tree.namespacePath,
      name: input.name,
      dimensions: [...namespaceQualified, ...localQualified],
      input,
    });
  }

  // Create Input nodes for constant-indexed input references (e.g., ReferenceImages[0])
  // These are registered in local dims by collectConstantIndexedInputs
  for (const [localName] of local) {
    // Check if this is a constant-indexed input reference
    const match = localName.match(/^([A-Za-z_][A-Za-z0-9_]*)(\[\d+\]+)$/);
    if (!match) {
      continue;
    }
    const baseName = match[1];
    // Only create if the base input exists
    if (!inputNames.has(baseName)) {
      continue;
    }
    // Find the base input definition
    const baseInput = tree.document.inputs.find(
      (input) => input.name === baseName
    );
    if (!baseInput) {
      continue;
    }
    const nodeKey = nodeId(tree.namespacePath, localName);
    const namespaceQualified = qualifyDimensionSlots(nodeKey, namespaceSlots);
    namespaceQualified.forEach((symbol, index) => {
      registerNamespaceSymbol(
        symbol,
        namespaceSlots[index]!,
        namespaceMembership
      );
    });
    const localSymbols = toLocalSlots(nodeKey, local.get(localName) ?? []);
    const localQualified = qualifyDimensionSlots(nodeKey, localSymbols);
    output.push({
      id: nodeKey,
      type: 'InputSource',
      namespacePath: tree.namespacePath,
      name: localName,
      dimensions: [...namespaceQualified, ...localQualified],
      input: baseInput, // Use the base input's definition
    });
  }
  for (const artefact of tree.document.artefacts) {
    // Handle JSON artifacts with schema decomposition
    if (artefact.type === 'json' && artefact.schema && artefact.arrays) {
      const decomposed = decomposeJsonSchema(
        artefact.schema,
        artefact.name,
        artefact.arrays
      );
      for (const field of decomposed) {
        const fieldNodeKey = nodeId(tree.namespacePath, field.path);
        const namespaceQualified = qualifyDimensionSlots(
          fieldNodeKey,
          namespaceSlots
        );
        namespaceQualified.forEach((symbol, index) => {
          registerNamespaceSymbol(
            symbol,
            namespaceSlots[index]!,
            namespaceMembership
          );
        });
        // Use decomposed field's dimensions
        const localSymbols = toLocalSlots(
          fieldNodeKey,
          local.get(field.path) ?? []
        );
        const localQualified = qualifyDimensionSlots(
          fieldNodeKey,
          localSymbols
        );
        // Create artefact definition for this decomposed field
        const fieldArtefact: BlueprintArtefactDefinition = {
          name: field.path,
          type: field.type,
          required: artefact.required,
          description: artefact.description,
        };
        output.push({
          id: fieldNodeKey,
          type: 'Artifact',
          namespacePath: tree.namespacePath,
          name: field.path,
          dimensions: [...namespaceQualified, ...localQualified],
          artefact: fieldArtefact,
        });
      }
    } else {
      // Handle regular artifacts
      const nodeKey = nodeId(tree.namespacePath, artefact.name);
      const namespaceQualified = qualifyDimensionSlots(nodeKey, namespaceSlots);
      namespaceQualified.forEach((symbol, index) => {
        registerNamespaceSymbol(
          symbol,
          namespaceSlots[index]!,
          namespaceMembership
        );
      });
      const localSymbols = toLocalSlots(
        nodeKey,
        local.get(artefact.name) ?? []
      );
      const localQualified = qualifyDimensionSlots(nodeKey, localSymbols);
      output.push({
        id: nodeKey,
        type: 'Artifact',
        namespacePath: tree.namespacePath,
        name: artefact.name,
        dimensions: [...namespaceQualified, ...localQualified],
        artefact,
      });
    }
  }
  for (const producer of tree.document.producers) {
    const nodeKey = nodeId(tree.namespacePath, producer.name);
    const namespaceQualified = qualifyDimensionSlots(nodeKey, namespaceSlots);
    namespaceQualified.forEach((symbol, index) => {
      registerNamespaceSymbol(
        symbol,
        namespaceSlots[index]!,
        namespaceMembership
      );
    });
    const localSymbols = toLocalSlots(nodeKey, local.get(producer.name) ?? []);
    const localQualified = qualifyDimensionSlots(nodeKey, localSymbols);
    output.push({
      id: nodeKey,
      type: 'Producer',
      namespacePath: tree.namespacePath,
      name: producer.name,
      dimensions: [...namespaceQualified, ...localQualified],
      producer,
    });
  }
  for (const child of tree.children.values()) {
    collectGraphNodes(
      child,
      namespaceDims,
      localDims,
      output,
      namespaceMembership
    );
  }
}

function collectGraphEdges(
  tree: BlueprintTreeNode,
  namespaceDims: Map<string, DimensionSymbol[]>,
  localDims: Map<BlueprintTreeNode, LocalNodeDims>,
  output: BlueprintGraphEdge[],
  root: BlueprintTreeNode
): void {
  for (const edge of tree.document.edges) {
    output.push({
      from: resolveEdgeEndpoint(
        edge.from,
        tree,
        namespaceDims,
        localDims,
        root
      ),
      to: resolveEdgeEndpoint(edge.to, tree, namespaceDims, localDims, root),
      note: edge.note,
      groupBy: edge.groupBy,
      orderBy: edge.orderBy,
      conditions: edge.conditions,
    });
  }
  for (const child of tree.children.values()) {
    collectGraphEdges(child, namespaceDims, localDims, output, root);
  }
}

function initializeNamespaceParentMap(
  namespaceDims: Map<string, DimensionSymbol[]>
): Map<string, string | null> {
  const parents = new Map<string, string | null>();
  for (const [key, dims] of namespaceDims.entries()) {
    if (!dims) {
      continue;
    }
    for (const symbol of dims) {
      parents.set(formatNamespaceParentKey(key, symbol.ordinal), null);
    }
  }
  return parents;
}

function resolveNamespaceDimensionParents(
  edges: BlueprintGraphEdge[],
  namespaceMembership: Map<string, string>,
  namespaceParents: Map<string, string | null>
): void {
  for (const edge of edges) {
    const limit = Math.min(
      edge.from.dimensions.length,
      edge.to.dimensions.length
    );
    for (let index = 0; index < limit; index += 1) {
      const targetSymbol = edge.to.dimensions[index];
      const namespaceKey = namespaceMembership.get(targetSymbol);
      if (!namespaceKey) {
        continue;
      }
      const targetSelector = edge.to.selectors?.[index];
      const sourceSelector = edge.from.selectors?.[index];
      const hasExplicitSelector =
        targetSelector !== undefined || sourceSelector !== undefined;
      if (hasExplicitSelector) {
        if (!targetSelector || !sourceSelector) {
          continue;
        }
        if (targetSelector.kind !== 'loop' || sourceSelector.kind !== 'loop') {
          continue;
        }
        if (targetSelector.offset !== 0 || sourceSelector.offset !== 0) {
          continue;
        }
        if (targetSelector.symbol !== sourceSelector.symbol) {
          continue;
        }
      }
      const sourceSymbol = edge.from.dimensions[index];
      if (!sourceSymbol) {
        continue;
      }
      const sourceNamespace = namespaceMembership.get(sourceSymbol);
      if (sourceNamespace === namespaceKey) {
        continue;
      }
      // Extract the dimension source key (scope:scopeKey:ordinal:raw) for comparison
      // This allows sibling fields from the same array to share the same parent
      const sourceDimKey = extractDimensionSourceKey(sourceSymbol);
      const existing = namespaceParents.get(namespaceKey);
      if (!existing) {
        // First parent - set it for lineage tracking
        namespaceParents.set(namespaceKey, sourceSymbol);
      } else {
        // Check if this new source is compatible with the existing parent
        const existingDimKey = extractDimensionSourceKey(existing);
        // Extract loop symbol names (the "raw" part after the final colon)
        // Format: scope:scopeKey:ordinal:raw
        const sourceLoopSymbol = sourceDimKey.split(':').pop() ?? '';
        const existingLoopSymbol = existingDimKey.split(':').pop() ?? '';
        // If loop symbols match, they refer to the same conceptual loop and are compatible
        // If they differ, we have a real conflict
        if (sourceLoopSymbol !== existingLoopSymbol) {
          throw createRuntimeError(
            RuntimeErrorCode.GRAPH_BUILD_ERROR,
            `Namespace dimension "${namespaceKey}" derives from conflicting parents (${existing} vs ${sourceSymbol}).`
          );
        }
        // Same loop symbol - compatible, keep the first parent for lineage
      }
    }
  }
}

function buildDimensionLineage(
  nodes: BlueprintGraphNode[],
  namespaceMembership: Map<string, string>,
  namespaceParents: Map<string, string | null>
): Map<string, string | null> {
  const lineage = new Map<string, string | null>();
  for (const node of nodes) {
    for (const symbol of node.dimensions) {
      const namespaceKey = namespaceMembership.get(symbol);
      if (namespaceKey) {
        lineage.set(symbol, namespaceParents.get(namespaceKey) ?? null);
      } else {
        lineage.set(symbol, null);
      }
    }
  }
  return lineage;
}

function resolveEdgeEndpoint(
  reference: string,
  context: BlueprintTreeNode,
  namespaceDims: Map<string, DimensionSymbol[]>,
  localDims: Map<BlueprintTreeNode, LocalNodeDims>,
  root: BlueprintTreeNode
): BlueprintGraphEdgeEndpoint {
  const parsed = parseReference(reference);
  const allSegments = [...parsed.namespaceSegments, parsed.node];

  // Try progressively shorter namespace paths to handle decomposed artifact references
  // e.g., "DocProducer.VideoScript.Segments[segment].Script" should resolve to:
  // - namespace: ["DocProducer"]
  // - nodeName: "VideoScript.Segments[segment].Script"
  let owner: BlueprintTreeNode | undefined;
  let targetPath: string[] = [];
  let nodeNameSegments: ParsedSegment[] = [];

  for (let splitIndex = allSegments.length - 1; splitIndex >= 0; splitIndex--) {
    const candidatePath = [
      ...context.namespacePath,
      ...allSegments.slice(0, splitIndex).map((s) => s.name),
    ];
    try {
      owner = findNodeByNamespace(root, candidatePath);
      targetPath = candidatePath;
      nodeNameSegments = allSegments.slice(splitIndex);
      break;
    } catch {
      // Namespace not found, try shorter path
    }
  }

  if (!owner) {
    // Fallback to current namespace
    owner = findNodeByNamespace(root, context.namespacePath);
    targetPath = context.namespacePath;
    nodeNameSegments = allSegments;
  }

  const prefixDims = collectNamespacePrefixDims(targetPath, namespaceDims);
  const ownerLocalDims = localDims.get(owner) ?? new Map();

  // Reconstruct node name from remaining segments
  // First try with all dimensions included (for decomposed artifacts)
  // Then fall back to excluding final segment dimensions (for regular nodes)
  const fullNodeName = nodeNameSegments
    .map((seg) => {
      const dims =
        seg.dimensions.length > 0 ? `[${seg.dimensions.join('][')}]` : '';
      return `${seg.name}${dims}`;
    })
    .join('.');

  const strippedNodeName = nodeNameSegments
    .map((seg, index) => {
      if (index < nodeNameSegments.length - 1) {
        const dims =
          seg.dimensions.length > 0 ? `[${seg.dimensions.join('][')}]` : '';
        return `${seg.name}${dims}`;
      }
      // For the last segment, only strip loop dimensions - keep constant indices
      // This ensures ReferenceImages[0] and ReferenceImages[1] remain distinct
      const constDims = seg.dimensions
        .filter((d) => parseDimensionSelector(d).kind === 'const')
        .map((d) => `[${d}]`)
        .join('');
      return `${seg.name}${constDims}`;
    })
    .join('.');

  // Check if the full node name exists (for decomposed artifacts)
  let nodeName: string;
  if (ownerLocalDims.has(fullNodeName)) {
    nodeName = fullNodeName;
  } else {
    nodeName = strippedNodeName;
  }

  const targetNodeId = nodeId(targetPath, nodeName);

  // For decomposed artifacts, look up dimensions by the full path
  const nodeDims = toLocalSlots(
    targetNodeId,
    ownerLocalDims.get(nodeName) ?? []
  );
  const dimensions = qualifyDimensionSlots(targetNodeId, [
    ...prefixDims,
    ...nodeDims,
  ]);

  // Collect all selectors from all segments
  // For the final segment, exclude constant indices as they are part of the node name
  const allSelectors: string[] = [];
  for (let i = 0; i < allSegments.length; i++) {
    const seg = allSegments[i];
    if (i === allSegments.length - 1) {
      // Final segment: only include loop dimension selectors, not constant indices
      // Constant indices like [0] are part of the node name, not dimensions to expand
      for (const dim of seg.dimensions) {
        const selector = parseDimensionSelector(dim);
        if (selector.kind === 'loop') {
          allSelectors.push(dim);
        }
      }
    } else {
      allSelectors.push(...seg.dimensions);
    }
  }

  const parsedSelectors =
    allSelectors.length > 0
      ? parseAllSelectors(
          reference,
          allSelectors,
          prefixDims.length + nodeDims.length
        )
      : undefined;

  return {
    nodeId: targetNodeId,
    dimensions,
    selectors: parsedSelectors?.selectors,
    collectionSelectors: parsedSelectors?.collectionSelectors,
  };
}

function parseAllSelectors(
  reference: string,
  rawSelectors: string[],
  totalDimensions: number
):
  | {
      selectors?: Array<DimensionSelector | undefined>;
      collectionSelectors?: DimensionSelector[];
    }
  | undefined {
  if (rawSelectors.length === 0) {
    return undefined;
  }

  const selectors: Array<DimensionSelector | undefined> = new Array(
    totalDimensions
  ).fill(undefined);
  const collectionSelectors: DimensionSelector[] = [];

  for (let index = 0; index < rawSelectors.length; index++) {
    const raw = rawSelectors[index];
    if (!raw) {
      continue;
    }
    try {
      const parsed = parseDimensionSelector(raw);
      if (index < totalDimensions) {
        selectors[index] = parsed;
      } else {
        collectionSelectors.push(parsed);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw createRuntimeError(
        RuntimeErrorCode.INVALID_DIMENSION_SELECTOR,
        `Invalid dimension selector in reference "${reference}": ${message}`
      );
    }
  }

  return {
    selectors,
    collectionSelectors:
      collectionSelectors.length > 0 ? collectionSelectors : undefined,
  };
}

function findNodeByNamespace(
  tree: BlueprintTreeNode,
  namespacePath: string[]
): BlueprintTreeNode {
  if (namespacePath.length === 0) {
    return tree;
  }
  let current: BlueprintTreeNode | undefined = tree;
  for (const segment of namespacePath) {
    current = current?.children.get(segment);
    if (!current) {
      throw createRuntimeError(
        RuntimeErrorCode.UNKNOWN_NAMESPACE,
        `Unknown sub-blueprint namespace "${namespacePath.join('.')}".`
      );
    }
  }
  return current;
}

function parseReference(reference: string): ParsedReference {
  if (typeof reference !== 'string' || reference.trim().length === 0) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_REFERENCE,
      `Invalid reference: "${reference}"`
    );
  }
  const parts = reference.split('.');
  const segments = parts.map(parseSegment);
  const node = segments.pop();
  if (!node) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_REFERENCE,
      `Malformed reference: "${reference}"`
    );
  }
  return {
    namespaceSegments: segments,
    node,
  };
}

function parseSegment(segment: string): ParsedSegment {
  const dims: string[] = [];
  const nameMatch = segment.match(/^[^[]+/);
  const name = nameMatch ? nameMatch[0] : '';
  if (!name) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_REFERENCE,
      `Invalid segment "${segment}"`
    );
  }
  const dimMatches = segment.slice(name.length).match(/\[[^\]]*]/g) ?? [];
  for (const match of dimMatches) {
    const symbol = match.slice(1, -1).trim();
    if (!symbol) {
      throw createRuntimeError(
        RuntimeErrorCode.INVALID_DIMENSION_SELECTOR,
        `Invalid dimension in "${segment}"`
      );
    }
    dims.push(symbol);
  }
  return { name, dimensions: dims };
}

function collectNamespacePrefixDims(
  namespacePath: string[],
  namespaceDims: Map<string, DimensionSymbol[]>
): DimensionSlot[] {
  const slots: DimensionSlot[] = [];
  for (let i = 1; i <= namespacePath.length; i += 1) {
    const key = namespaceKey(namespacePath.slice(0, i));
    const dims = namespaceDims.get(key);
    if (!dims) {
      continue;
    }
    for (const symbol of dims) {
      slots.push(
        makeNamespaceSlot({
          namespaceKey: key,
          raw: symbol.raw,
          ordinal: symbol.ordinal,
        })
      );
    }
  }
  return slots;
}

function namespaceKey(path: string[]): string {
  return path.join('.');
}

function formatNamespaceParentKey(
  namespacePathKey: string,
  ordinal: number
): string {
  const normalized = namespacePathKey === '' ? '__root__' : namespacePathKey;
  return `namespace:${normalized}#${ordinal}`;
}

function nodeId(namespacePath: string[], name: string): string {
  if (namespacePath.length === 0) {
    return name;
  }
  return `${namespacePath.join('.')}.${name}`;
}

/**
 * Collects loop definitions from all tree nodes.
 * Keys are namespace paths joined by '.'.
 */
function collectLoopDefinitions(
  tree: BlueprintTreeNode,
  loops: Map<string, BlueprintLoopDefinition[]>
): void {
  const key = tree.namespacePath.join('.');
  if (tree.document.loops && tree.document.loops.length > 0) {
    loops.set(key, tree.document.loops);
  }
  for (const child of tree.children.values()) {
    collectLoopDefinitions(child, loops);
  }
}

/**
 * Injects synthetic input declarations for system inputs that are referenced
 * in edges but not explicitly declared in the blueprint.
 *
 * This allows blueprints to use system inputs like SegmentDuration without
 * having to declare them in the inputs section.
 */
function injectSystemInputsFromEdges(root: BlueprintTreeNode): void {
  // Collect all system input references from edges in the root blueprint
  const referencedSystemInputs = new Set<string>();

  for (const edge of root.document.edges) {
    // Check the 'from' field for system input references
    const fromName = extractSimpleInputName(edge.from);
    if (fromName && SYSTEM_INPUT_NAMES.has(fromName)) {
      referencedSystemInputs.add(fromName);
    }
  }

  // Get existing input names
  const existingInputNames = new Set(
    root.document.inputs.map((input) => input.name)
  );

  // Add synthetic input declarations for system inputs not already declared
  for (const systemInputName of referencedSystemInputs) {
    if (!existingInputNames.has(systemInputName)) {
      const syntheticInput: BlueprintInputDefinition = {
        name: systemInputName,
        type: getSystemInputType(systemInputName),
        description: `System input: ${systemInputName}`,
        required: false, // System inputs are optional (auto-computed or injected)
      };
      root.document.inputs.push(syntheticInput);
    }
  }
}

/**
 * Extracts a simple input name from an edge reference.
 * Returns the name only if it's a simple reference (no dots, no dimensions).
 * For example:
 * - "SegmentDuration" -> "SegmentDuration"
 * - "Duration" -> "Duration"
 * - "StoryProducer.Script" -> undefined (not a simple input reference)
 */
function extractSimpleInputName(reference: string): string | undefined {
  // Simple references don't contain dots
  if (reference.includes('.')) {
    return undefined;
  }
  // Extract the name before any dimension brackets
  const match = reference.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
  return match ? match[1] : undefined;
}

/**
 * Returns the appropriate type for a system input.
 */
function getSystemInputType(name: string): string {
  switch (name) {
    case SYSTEM_INPUTS.DURATION:
    case SYSTEM_INPUTS.NUM_OF_SEGMENTS:
    case SYSTEM_INPUTS.SEGMENT_DURATION:
      return 'number';
    case SYSTEM_INPUTS.MOVIE_ID:
    case SYSTEM_INPUTS.STORAGE_ROOT:
    case SYSTEM_INPUTS.STORAGE_BASE_PATH:
      return 'string';
    default:
      return 'any';
  }
}
