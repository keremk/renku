import { formatProducerAlias, type BlueprintTreeNode } from '@gorenku/core';

/**
 * Producer category based on the producer reference path.
 */
export type ProducerCategory = 'prompt' | 'asset';

/**
 * Information about a producer extracted from a blueprint.
 */
export interface ExtractedProducer {
  /** Full alias including namespace path */
  alias: string;
  /** Local name of the producer */
  localName: string;
  /** Description from the producer definition */
  description?: string;
  /** Category of the producer (prompt or asset) */
  category: ProducerCategory;
  /** Producer reference path (e.g., "prompt/documentary-talkinghead") */
  producerRef: string;
}

/**
 * Error thrown when producer extraction fails.
 */
export class ProducerExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProducerExtractionError';
  }
}

/**
 * Extract all producers from a blueprint tree that need model selection.
 *
 * Categories:
 * - prompt/* → LLM text producers, use openai/vercel models
 * - asset/* → Asset producers, use models from producer YAML mappings
 * - composition/* → Skipped entirely (handled separately with timeline config)
 *
 * @throws ProducerExtractionError if a producer uses unsupported syntax
 */
export function extractProducers(root: BlueprintTreeNode): ExtractedProducer[] {
  const producers: ExtractedProducer[] = [];
  collectFromNode(root, [], producers);
  return producers;
}

function collectFromNode(
  node: BlueprintTreeNode,
  namespacePath: string[],
  producers: ExtractedProducer[],
): void {
  for (const importDef of node.document.producerImports) {
    const ref = importDef.producer;

    // Require the `producer:` field - reject legacy `path:` syntax
    if (!ref) {
      if (importDef.path) {
        throw new ProducerExtractionError(
          `Producer "${importDef.name}" uses legacy "path:" syntax which is no longer supported. ` +
          `Please update to use "producer:" syntax (e.g., "producer: prompt/my-producer" or "producer: asset/my-producer").`
        );
      }
      // Skip producers without either field (shouldn't happen in valid YAML)
      continue;
    }

    // Categorize by prefix
    let category: ProducerCategory | 'composition';
    if (ref.startsWith('composition/')) {
      category = 'composition';
    } else if (ref.startsWith('prompt/')) {
      category = 'prompt';
    } else if (ref.startsWith('asset/')) {
      category = 'asset';
    } else {
      throw new ProducerExtractionError(
        `Producer "${importDef.name}" has invalid producer reference "${ref}". ` +
        `Producer references must start with "prompt/", "asset/", or "composition/".`
      );
    }

    // Skip composition producers - they're handled separately
    if (category === 'composition') {
      continue;
    }

    const alias = formatProducerAlias(namespacePath, importDef.name);

    producers.push({
      alias,
      localName: importDef.name,
      description: importDef.description,
      category,
      producerRef: ref,
    });
  }

  // Process child nodes recursively
  for (const [childName, childNode] of node.children) {
    collectFromNode(childNode, [...namespacePath, childName], producers);
  }
}
