import { formatCanonicalInputId, formatCanonicalProducerName, formatQualifiedName } from './canonical-ids.js';
import type { BlueprintTreeNode } from '../types.js';

export interface ParsedNodeInventory {
  inputs: string[];
  artefacts: string[];
  producers: string[];
}

/**
 * Parse-only inventory of blueprint nodes (no connections resolved).
 * Produces canonical ids for every input/artefact/producer across the tree.
 */
export function collectNodeInventory(root: BlueprintTreeNode): ParsedNodeInventory {
  const inputs: string[] = [];
  const artefacts: string[] = [];
  const producers: string[] = [];

  const visit = (node: BlueprintTreeNode): void => {
    for (const input of node.document.inputs) {
      inputs.push(formatCanonicalInputId(node.namespacePath, input.name));
    }
    for (const artefact of node.document.artefacts) {
      artefacts.push(`Artifact:${formatQualifiedName(node.namespacePath, artefact.name)}`);
    }
    for (const producer of node.document.producers) {
      producers.push(`Producer:${formatCanonicalProducerName(node.namespacePath, producer.name)}`);
    }
    for (const child of node.children.values()) {
      visit(child);
    }
  };

  visit(root);

  return {
    inputs: Array.from(new Set(inputs)),
    artefacts: Array.from(new Set(artefacts)),
    producers: Array.from(new Set(producers)),
  };
}
