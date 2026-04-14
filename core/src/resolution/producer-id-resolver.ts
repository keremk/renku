import type { BlueprintTreeNode } from '../types.js';
import {
  formatCanonicalProducerId,
  formatProducerAlias,
  parseCanonicalProducerId,
} from '../parsing/canonical-ids.js';

export interface LeafProducerReference {
  canonicalProducerId: string;
  authoredProducerId: string;
  namespacePath: string[];
  producerName: string;
  node: BlueprintTreeNode;
}

export function collectLeafProducerReferences(
  tree: BlueprintTreeNode
): LeafProducerReference[] {
  const references: LeafProducerReference[] = [];

  const visit = (node: BlueprintTreeNode): void => {
    for (const producer of node.document.producers) {
      references.push({
        canonicalProducerId: formatCanonicalProducerId(
          node.namespacePath,
          producer.name
        ),
        authoredProducerId: formatProducerAlias(
          node.namespacePath,
          producer.name
        ),
        namespacePath: node.namespacePath,
        producerName: producer.name,
        node,
      });
    }

    for (const child of node.children.values()) {
      visit(child);
    }
  };

  visit(tree);
  return references;
}

export function findLeafProducerReferenceByCanonicalId(
  tree: BlueprintTreeNode,
  canonicalProducerId: string
): LeafProducerReference | undefined {
  return collectLeafProducerReferences(tree).find(
    (reference) => reference.canonicalProducerId === canonicalProducerId
  );
}

export function findLeafProducerReferenceByAuthoredId(
  tree: BlueprintTreeNode,
  authoredProducerId: string
): LeafProducerReference | undefined {
  return collectLeafProducerReferences(tree).find(
    (reference) => reference.authoredProducerId === authoredProducerId
  );
}

export function canonicalizeAuthoredProducerId(
  tree: BlueprintTreeNode,
  authoredProducerId: string
): string | undefined {
  return findLeafProducerReferenceByAuthoredId(tree, authoredProducerId)
    ?.canonicalProducerId;
}

export function decanonicalizeProducerId(
  tree: BlueprintTreeNode,
  canonicalProducerId: string
): string | undefined {
  return findLeafProducerReferenceByCanonicalId(tree, canonicalProducerId)
    ?.authoredProducerId;
}

export function getCanonicalProducerDisplayParts(canonicalProducerId: string): {
  groupSegments: string[];
  leafName: string;
} {
  const parsed = parseCanonicalProducerId(canonicalProducerId);
  return {
    groupSegments: parsed.path,
    leafName: parsed.name,
  };
}
