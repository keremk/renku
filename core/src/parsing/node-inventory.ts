import {
  formatCanonicalInputId,
  formatCanonicalOutputId,
  formatCanonicalProducerId,
} from './canonical-ids.js';
import type { BlueprintTreeNode } from '../types.js';

export interface ParsedNodeInventory {
  inputs: string[];
  outputs: string[];
  producers: string[];
}

/**
 * Parse-only inventory of blueprint nodes (no connections resolved).
 * Produces canonical ids for every authored input/output connector and every
 * executable producer across the tree.
 */
export function collectNodeInventory(root: BlueprintTreeNode): ParsedNodeInventory {
  const inputs: string[] = [];
  const outputs: string[] = [];
  const producers: string[] = [];

  const visit = (node: BlueprintTreeNode): void => {
    for (const input of node.document.inputs) {
      inputs.push(formatCanonicalInputId(node.namespacePath, input.name));
    }
    for (const output of node.document.outputs) {
      outputs.push(formatCanonicalOutputId(node.namespacePath, output.name));
    }
    for (const producer of node.document.producers) {
      producers.push(formatCanonicalProducerId(node.namespacePath, producer.name));
    }
    for (const child of node.children.values()) {
      visit(child);
    }
  };

  visit(root);

  return {
    inputs: Array.from(new Set(inputs)),
    outputs: Array.from(new Set(outputs)),
    producers: Array.from(new Set(producers)),
  };
}
