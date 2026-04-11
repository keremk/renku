import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { decomposeJsonSchema } from '../resolution/schema-decomposition.js';
import { formatProducerAlias } from '../parsing/canonical-ids.js';
import { createRuntimeError, RuntimeErrorCode } from '../errors/index.js';
import type { BlueprintTreeNode, JsonSchemaDefinition } from '../types.js';

export interface OutputSchemaProviderOption {
  outputSchema?: string;
}

export type OutputSchemaByProducerAlias = Map<string, JsonSchemaDefinition>;

export function parseJsonSchemaDefinition(
  schemaJson: string,
  context?: string
): JsonSchemaDefinition {
  try {
    const parsed = JSON.parse(schemaJson);
    const name = typeof parsed.name === 'string' ? parsed.name : 'Schema';
    const strict =
      typeof parsed.strict === 'boolean' ? parsed.strict : undefined;
    const schema = parsed.schema ?? parsed;
    return { name, strict, schema };
  } catch {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_OUTPUT_SCHEMA_JSON,
      `Invalid schema JSON${context ? ` for ${context}` : ''}.`
    );
  }
}

export function buildOutputSchemaMapFromProviderOptions(
  providerOptions: ReadonlyMap<string, OutputSchemaProviderOption>
): OutputSchemaByProducerAlias {
  const schemasByProducerAlias: OutputSchemaByProducerAlias = new Map();

  for (const [producerAlias, options] of providerOptions.entries()) {
    if (!options.outputSchema) {
      continue;
    }
    schemasByProducerAlias.set(
      producerAlias,
      parseJsonSchemaDefinition(options.outputSchema, producerAlias)
    );
  }

  return schemasByProducerAlias;
}

export function applyOutputSchemasToBlueprintTree(
  tree: BlueprintTreeNode,
  schemasByProducerAlias: OutputSchemaByProducerAlias
): void {
  applyOutputSchemasToNode(tree, schemasByProducerAlias);
  for (const child of tree.children.values()) {
    applyOutputSchemasToBlueprintTree(child, schemasByProducerAlias);
  }
}

export async function loadOutputSchemasFromProducerMetadata(
  tree: BlueprintTreeNode
): Promise<OutputSchemaByProducerAlias> {
  const schemasByProducerAlias: OutputSchemaByProducerAlias = new Map();
  await collectOutputSchemasFromNode(tree, schemasByProducerAlias);
  return schemasByProducerAlias;
}

export async function hydrateOutputSchemasFromProducerMetadata(
  tree: BlueprintTreeNode
): Promise<OutputSchemaByProducerAlias> {
  const schemasByProducerAlias = await loadOutputSchemasFromProducerMetadata(
    tree
  );
  applyOutputSchemasToBlueprintTree(tree, schemasByProducerAlias);
  return schemasByProducerAlias;
}

export function applyOutputSchemasFromProviderOptionsToBlueprintTree(
  tree: BlueprintTreeNode,
  providerOptions: ReadonlyMap<string, OutputSchemaProviderOption>
): void {
  const schemasByProducerAlias =
    buildOutputSchemaMapFromProviderOptions(providerOptions);
  applyOutputSchemasToBlueprintTree(tree, schemasByProducerAlias);
}

function applyOutputSchemasToNode(
  node: BlueprintTreeNode,
  schemasByProducerAlias: OutputSchemaByProducerAlias
): void {
  for (const producer of node.document.producers) {
    const producerAlias = formatProducerAlias(
      node.namespacePath,
      producer.name
    );
    const parsedSchema = schemasByProducerAlias.get(producerAlias);
    if (!parsedSchema) {
      continue;
    }

    node.document.artefacts = node.document.artefacts.map((art) => {
      if (art.type !== 'json' || !art.arrays || art.schema) {
        return art;
      }

      const decomposed = decomposeJsonSchema(parsedSchema, art.name, art.arrays);
      for (const field of decomposed) {
        const edgeExists = node.document.edges.some(
          (edge) => edge.from === producer.name && edge.to === field.path
        );
        if (!edgeExists) {
          node.document.edges.push({ from: producer.name, to: field.path });
        }
      }

      return { ...art, schema: parsedSchema };
    });
  }
}

async function collectOutputSchemasFromNode(
  node: BlueprintTreeNode,
  schemasByProducerAlias: OutputSchemaByProducerAlias
): Promise<void> {
  const outputSchemaPath = node.document.meta.outputSchema;
  if (outputSchemaPath) {
    if (node.document.producers.length === 0) {
      throw createRuntimeError(
        RuntimeErrorCode.MISSING_OUTPUT_SCHEMA,
        `Blueprint node "${node.document.meta.id}" declares meta.outputSchema but has no local producers to receive it.`
      );
    }

    const absoluteSchemaPath = resolve(dirname(node.sourcePath), outputSchemaPath);
    let rawSchema: string;
    try {
      rawSchema = await readFile(absoluteSchemaPath, 'utf8');
    } catch (error) {
      throw createRuntimeError(
        RuntimeErrorCode.MISSING_OUTPUT_SCHEMA,
        `Failed to load output schema "${outputSchemaPath}" for blueprint node "${node.document.meta.id}" at ${absoluteSchemaPath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    const parsedSchema = parseJsonSchemaDefinition(
      rawSchema,
      `${node.document.meta.id} (${absoluteSchemaPath})`
    );
    for (const producer of node.document.producers) {
      const producerAlias = formatProducerAlias(
        node.namespacePath,
        producer.name
      );
      if (schemasByProducerAlias.has(producerAlias)) {
        throw createRuntimeError(
          RuntimeErrorCode.GRAPH_BUILD_ERROR,
          `Duplicate output schema registration for producer alias "${producerAlias}".`
        );
      }
      schemasByProducerAlias.set(producerAlias, parsedSchema);
    }
  }

  for (const child of node.children.values()) {
    await collectOutputSchemasFromNode(child, schemasByProducerAlias);
  }
}
