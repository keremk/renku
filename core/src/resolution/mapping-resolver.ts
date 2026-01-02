import type {
  BlueprintTreeNode,
  MappingFieldDefinition,
  MappingValue,
  ProducerMappings,
} from '../types.js';

/**
 * Context for resolving mappings for a specific model selection.
 */
export interface ResolvedMappingContext {
  /** Provider name (e.g., "fal-ai", "replicate") */
  provider: string;
  /** Model identifier (e.g., "bytedance/seedream/v4/text-to-image") */
  model: string;
  /** Producer ID (e.g., "TextToImageProducer") */
  producerId: string;
}

/**
 * Resolves SDK mappings for a producer based on selected provider/model.
 * Looks up mappings from the producer's blueprint document.
 *
 * @param blueprintTree - The blueprint tree containing all producer documents
 * @param context - The provider, model, and producerId to look up
 * @returns Normalized mappings or undefined if not found
 */
export function resolveMappingsForModel(
  blueprintTree: BlueprintTreeNode,
  context: ResolvedMappingContext,
): Record<string, MappingFieldDefinition> | undefined {
  // Find the producer blueprint in the tree
  const producerNode = findProducerNode(blueprintTree, context.producerId);
  if (!producerNode) {
    return undefined;
  }

  const mappings = producerNode.document.mappings;
  if (!mappings) {
    return undefined;
  }

  // Look up provider -> model -> field mappings
  const providerMappings = mappings[context.provider];
  if (!providerMappings) {
    return undefined;
  }

  const modelMappings = providerMappings[context.model];
  if (!modelMappings) {
    return undefined;
  }

  // Normalize all mappings to MappingFieldDefinition
  return normalizeMappings(modelMappings);
}

/**
 * Finds a producer node in the blueprint tree by producer name.
 * The producerId is the name used in the blueprint's producers section.
 * Children are keyed by producer name, so we can look up directly.
 */
function findProducerNode(
  tree: BlueprintTreeNode,
  producerId: string,
): BlueprintTreeNode | undefined {
  // Check if this node's meta.id matches
  // (for when looking up by the YAML's own ID)
  if (tree.document.meta.id === producerId) {
    return tree;
  }

  // Check if we have a direct child with this producer name
  // Children are keyed by the producer name used in the blueprint
  const directChild = tree.children.get(producerId);
  if (directChild) {
    return directChild;
  }

  // Check if any of this node's producers match
  // (for inline producer definitions with mappings in the same file)
  for (const producer of tree.document.producers) {
    if (producer.name === producerId) {
      // The producer is defined in this node's producers list
      // If mappings are defined in this document, return this node
      if (tree.document.mappings) {
        return tree;
      }
    }
  }

  // Recursively search children
  for (const child of tree.children.values()) {
    const found = findProducerNode(child, producerId);
    if (found) {
      return found;
    }
  }

  return undefined;
}

/**
 * Normalizes mapping values to MappingFieldDefinition.
 * Converts simple strings to { field: value }.
 */
function normalizeMappings(
  mappings: Record<string, MappingValue>,
): Record<string, MappingFieldDefinition> {
  const result: Record<string, MappingFieldDefinition> = {};

  for (const [key, value] of Object.entries(mappings)) {
    if (typeof value === 'string') {
      result[key] = { field: value };
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Gets all available mappings from a producer YAML.
 * Returns the full ProducerMappings structure if present.
 */
export function getProducerMappings(
  blueprintTree: BlueprintTreeNode,
  producerId: string,
): ProducerMappings | undefined {
  const producerNode = findProducerNode(blueprintTree, producerId);
  return producerNode?.document.mappings;
}
