import type {
  BlueprintTreeNode,
  MappingFieldDefinition,
  MappingValue,
  ProducerMappings,
} from '../types.js';
import { findLeafProducerReferenceByCanonicalId } from './producer-id-resolver.js';

/**
 * Context for resolving mappings for a specific model selection.
 */
export interface ResolvedMappingContext {
  /** Provider name (e.g., "fal-ai", "replicate") */
  provider: string;
  /** Model identifier (e.g., "bytedance/seedream/v4/text-to-image") */
  model: string;
  /** Canonical producer ID (e.g., "Producer:TextToImageProducer") */
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
  const producerNode = findLeafProducerReferenceByCanonicalId(
    blueprintTree,
    context.producerId
  )?.node;
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
  return findLeafProducerReferenceByCanonicalId(blueprintTree, producerId)?.node
    .document.mappings;
}
