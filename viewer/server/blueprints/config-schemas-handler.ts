/**
 * Handler for producer config schemas.
 * Returns JSON schema config properties per producer/model that are NOT mapped through connections.
 */

import path from 'node:path';
import {
  loadYamlBlueprintTree,
  getProducerMappings,
  resolveMappingsForModel,
  type BlueprintTreeNode,
} from '@gorenku/core';
import {
  loadModelCatalog,
  loadModelSchemaFile,
  getAvailableModelsForNestedSlot,
  type LoadedModelCatalog,
  type SchemaFile,
  type NestedModelDeclaration,
} from '@gorenku/providers';
import { detectProducerCategory } from './producer-models.js';
import type { ProducerCategory } from './types.js';

/**
 * JSON Schema property definition.
 */
export interface SchemaProperty {
  type?: string;
  description?: string;
  title?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
  items?: SchemaProperty;
  /** JSON Schema $ref for referencing other schema definitions */
  $ref?: string;
}

/**
 * Config property with metadata for UI display.
 */
export interface ConfigProperty {
  /** Property key (e.g., "aspect_ratio", "imageClip.artifact") */
  key: string;
  /** JSON schema for this property */
  schema: SchemaProperty;
  /** Whether this property is required */
  required: boolean;
}

/**
 * Config schema for a specific provider/model combination.
 */
export interface ModelConfigSchema {
  provider: string;
  model: string;
  properties: ConfigProperty[];
}

/**
 * Schema information for a nested model slot.
 */
export interface NestedModelConfigSchema {
  /** Declaration from the parent schema's x-renku-nested-models */
  declaration: NestedModelDeclaration;
  /** Available models from catalog that match this slot's constraints */
  availableModels: Array<{ provider: string; model: string }>;
  /** Config schemas for each available nested model - key is "provider/model" */
  modelSchemas: Record<string, ModelConfigSchema>;
}

/**
 * Config schemas for a producer's available models.
 */
export interface ProducerConfigSchemas {
  producerId: string;
  category: ProducerCategory;
  /** Config schemas per model - key is "provider/model" */
  modelSchemas: Record<string, ModelConfigSchema>;
  /** Nested model schemas (if the producer's schema declares nested models) */
  nestedModels?: NestedModelConfigSchema[];
}

/**
 * Response from GET /blueprints/producer-config-schemas
 */
export interface ProducerConfigSchemasResponse {
  producers: Record<string, ProducerConfigSchemas>;
}

/**
 * Properties that should always be excluded from config (output-related or internal).
 */
const EXCLUDED_PROPERTIES = new Set([
  'prompt',
  'image_url',
  'video_url',
  'audio_url',
  'content',
  'messages',
  'system',
  'user',
]);

function parseLocalSchemaRef(ref: string): string | undefined {
  const directMatch = ref.match(/^#\/([A-Za-z_][A-Za-z0-9_]*)$/);
  if (directMatch) {
    return directMatch[1];
  }
  const defsMatch = ref.match(/^#\/\$defs\/([A-Za-z_][A-Za-z0-9_]*)$/);
  if (defsMatch) {
    return defsMatch[1];
  }
  return undefined;
}

function resolveSchemaProperty(
  schema: SchemaProperty,
  definitions: Record<string, unknown>,
  seenRefs: Set<string> = new Set()
): SchemaProperty {
  if (typeof schema.$ref === 'string') {
    const refName = parseLocalSchemaRef(schema.$ref);
    if (refName && !seenRefs.has(refName)) {
      const resolved = definitions[refName];
      if (
        resolved &&
        typeof resolved === 'object' &&
        !Array.isArray(resolved)
      ) {
        const merged: SchemaProperty = {
          ...(resolved as SchemaProperty),
          ...schema,
        };
        delete merged.$ref;
        const nextSeen = new Set(seenRefs);
        nextSeen.add(refName);
        return resolveSchemaProperty(merged, definitions, nextSeen);
      }
    }
  }

  const next: SchemaProperty = { ...schema };

  if (next.items && typeof next.items === 'object') {
    next.items = resolveSchemaProperty(next.items, definitions, seenRefs);
  }

  if (next.properties) {
    const resolvedProperties: Record<string, SchemaProperty> = {};
    for (const [key, value] of Object.entries(next.properties)) {
      resolvedProperties[key] = resolveSchemaProperty(
        value,
        definitions,
        seenRefs
      );
    }
    next.properties = resolvedProperties;
  }

  return next;
}

/**
 * Determines which schema properties are NOT mapped (i.e., config properties).
 * A property is considered "mapped" if it appears as a target field in the producer's mappings.
 */
function getUnmappedProperties(
  schemaFile: SchemaFile,
  mappedFields: Set<string>
): ConfigProperty[] {
  const inputSchema = schemaFile.inputSchema;
  if (!inputSchema?.properties) {
    return [];
  }

  const properties = inputSchema.properties as Record<string, SchemaProperty>;
  const required = new Set(inputSchema.required ?? []);
  const configProperties: ConfigProperty[] = [];

  for (const [key, schema] of Object.entries(properties)) {
    // Skip if this property is mapped through a connection
    if (mappedFields.has(key)) {
      continue;
    }

    // Skip excluded properties (outputs, prompts, etc.)
    if (EXCLUDED_PROPERTIES.has(key)) {
      continue;
    }

    const resolvedSchema = resolveSchemaProperty(
      schema,
      schemaFile.definitions as Record<string, unknown>
    );

    configProperties.push({
      key,
      schema: resolvedSchema,
      required: required.has(key),
    });
  }

  return configProperties;
}

/**
 * Extracts the set of target fields from a producer's mappings for a specific model.
 * These are the fields that get values from connections, not from config.
 */
function getMappedFieldsForModel(
  blueprintTree: BlueprintTreeNode,
  producerId: string,
  provider: string,
  model: string
): Set<string> {
  const mappedFields = new Set<string>();

  const mappings = resolveMappingsForModel(blueprintTree, {
    provider,
    model,
    producerId,
  });

  if (mappings) {
    for (const mapping of Object.values(mappings)) {
      // Get the target field from the mapping
      if (typeof mapping === 'string') {
        mappedFields.add(mapping);
      } else if (mapping.field) {
        mappedFields.add(mapping.field);
      }
      // Also handle expand mappings that target multiple fields
      if (mapping.expand) {
        // Expanded mappings can target nested fields which we should also exclude
        // The actual expanded field names depend on the table values
        // For simplicity, we mark the base field as mapped
      }
    }
  }

  return mappedFields;
}

/**
 * Process nested model declarations and load their schemas.
 */
async function processNestedModels(
  nestedModelDeclarations: NestedModelDeclaration[],
  catalog: LoadedModelCatalog,
  catalogModelsDir: string
): Promise<NestedModelConfigSchema[]> {
  const result: NestedModelConfigSchema[] = [];

  for (const declaration of nestedModelDeclarations) {
    // Get available models from catalog that match this slot's constraints
    const availableModels = getAvailableModelsForNestedSlot(
      catalog,
      declaration
    );

    // Load config schemas for each available nested model
    const modelSchemas: Record<string, ModelConfigSchema> = {};

    // Create a set of mapped fields from the declaration (fields provided by parent)
    const mappedFields = new Set(declaration.mappedFields ?? []);

    for (const { provider, model } of availableModels) {
      const schemaFile = await loadModelSchemaFile(
        catalogModelsDir,
        catalog,
        provider,
        model
      );
      if (!schemaFile) {
        continue;
      }

      // Filter out fields that are provided by the parent via mappedFields
      const configProperties = getUnmappedProperties(schemaFile, mappedFields);

      const key = `${provider}/${model}`;
      modelSchemas[key] = {
        provider,
        model,
        properties: configProperties,
      };
    }

    result.push({
      declaration,
      availableModels,
      modelSchemas,
    });
  }

  return result;
}

/**
 * Gets config schemas for all producers in a blueprint.
 */
export async function getProducerConfigSchemas(
  blueprintPath: string,
  catalogRoot?: string
): Promise<ProducerConfigSchemasResponse> {
  const { root } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });
  const producers: Record<string, ProducerConfigSchemas> = {};

  // Load model catalog
  let catalog: LoadedModelCatalog | null = null;
  let catalogModelsDir: string | null = null;
  if (catalogRoot) {
    catalogModelsDir = path.join(catalogRoot, 'models');
    catalog = await loadModelCatalog(catalogModelsDir);
  }

  // Visit all producer imports in the blueprint
  const visitNode = async (node: BlueprintTreeNode) => {
    for (const producerImport of node.document.producerImports) {
      const producerId = producerImport.name;
      const childNode = producerImport.path
        ? node.children.get(producerId)
        : undefined;
      const category = detectProducerCategory(producerImport, childNode);

      // Prompt producers use prompts, not config - skip them
      if (category === 'prompt') {
        producers[producerId] = {
          producerId,
          category,
          modelSchemas: {},
        };
        continue;
      }

      // Asset and composition producers can have config schemas
      // Get available models from mappings
      const mappings = getProducerMappings(root, producerId);
      if (!mappings || !catalog || !catalogModelsDir) {
        producers[producerId] = {
          producerId,
          category,
          modelSchemas: {},
        };
        continue;
      }

      const modelSchemas: Record<string, ModelConfigSchema> = {};
      let nestedModels: NestedModelConfigSchema[] | undefined;

      // For each provider/model combination
      for (const [provider, modelMappings] of Object.entries(mappings)) {
        for (const model of Object.keys(modelMappings)) {
          const schemaFile = await loadModelSchemaFile(
            catalogModelsDir,
            catalog,
            provider,
            model
          );
          if (!schemaFile) {
            continue;
          }

          // Get the set of fields that are mapped through connections
          const mappedFields = getMappedFieldsForModel(
            root,
            producerId,
            provider,
            model
          );

          // Get unmapped properties (config properties)
          const configProperties = getUnmappedProperties(
            schemaFile,
            mappedFields
          );

          // Always add the entry so client knows schema was loaded (even if no config properties)
          const key = `${provider}/${model}`;
          modelSchemas[key] = {
            provider,
            model,
            properties: configProperties,
          };

          // Process nested model declarations if present
          if (schemaFile.nestedModels && schemaFile.nestedModels.length > 0) {
            nestedModels = await processNestedModels(
              schemaFile.nestedModels,
              catalog,
              catalogModelsDir
            );
          }
        }
      }

      producers[producerId] = {
        producerId,
        category,
        modelSchemas,
        nestedModels,
      };
    }

    // Visit children
    for (const child of node.children.values()) {
      await visitNode(child);
    }
  };

  await visitNode(root);
  return { producers };
}
