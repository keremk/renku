/**
 * Handler for producer config schemas.
 * Returns JSON schema config properties per producer/model that are NOT mapped through connections.
 */

import path from "node:path";
import {
  loadYamlBlueprintTree,
  getProducerMappings,
  resolveMappingsForModel,
  type BlueprintTreeNode,
} from "@gorenku/core";
import {
  loadModelCatalog,
  loadModelSchemaFile,
  type LoadedModelCatalog,
  type SchemaFile,
} from "@gorenku/providers";
import { detectProducerCategory } from "./producer-models.js";
import type { ProducerCategory } from "./types.js";

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
 * Config schemas for a producer's available models.
 */
export interface ProducerConfigSchemas {
  producerId: string;
  category: ProducerCategory;
  /** Config schemas per model - key is "provider/model" */
  modelSchemas: Record<string, ModelConfigSchema>;
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
  "prompt",
  "image_url",
  "video_url",
  "audio_url",
  "text",
  "content",
  "messages",
  "system",
  "user",
]);

/**
 * Determines which schema properties are NOT mapped (i.e., config properties).
 * A property is considered "mapped" if it appears as a target field in the producer's mappings.
 */
function getUnmappedProperties(
  schemaFile: SchemaFile,
  mappedFields: Set<string>,
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

    configProperties.push({
      key,
      schema,
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
  model: string,
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
      if (typeof mapping === "string") {
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
 * Gets config schemas for all producers in a blueprint.
 */
export async function getProducerConfigSchemas(
  blueprintPath: string,
  catalogRoot?: string,
): Promise<ProducerConfigSchemasResponse> {
  const { root } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });
  const producers: Record<string, ProducerConfigSchemas> = {};

  // Load model catalog
  let catalog: LoadedModelCatalog | null = null;
  let catalogModelsDir: string | null = null;
  if (catalogRoot) {
    catalogModelsDir = path.join(catalogRoot, "models");
    catalog = await loadModelCatalog(catalogModelsDir);
  }

  // Visit all producer imports in the blueprint
  const visitNode = async (node: BlueprintTreeNode) => {
    for (const producerImport of node.document.producerImports) {
      const producerId = producerImport.name;
      const childNode = producerImport.path ? node.children.get(producerId) : undefined;
      const category = detectProducerCategory(producerImport, childNode);

      // Prompt producers use prompts, not config - skip them
      if (category === "prompt") {
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

      // For each provider/model combination
      for (const [provider, modelMappings] of Object.entries(mappings)) {
        for (const model of Object.keys(modelMappings)) {
          const schemaFile = await loadModelSchemaFile(catalogModelsDir, catalog, provider, model);
          if (!schemaFile) {
            continue;
          }

          // Get the set of fields that are mapped through connections
          const mappedFields = getMappedFieldsForModel(root, producerId, provider, model);

          // Get unmapped properties (config properties)
          const configProperties = getUnmappedProperties(schemaFile, mappedFields);

          if (configProperties.length > 0) {
            const key = `${provider}/${model}`;
            modelSchemas[key] = {
              provider,
              model,
              properties: configProperties,
            };
          }
        }
      }

      producers[producerId] = {
        producerId,
        category,
        modelSchemas,
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
