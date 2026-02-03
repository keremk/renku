import type {
  ModelSelectionValue,
  NestedModelConfigSchema,
  ProducerConfigSchemas,
} from "@/types/blueprint-graph";

/**
 * Check if a producer has nested model declarations in its schema.
 * This is the schema-driven way to detect producers that delegate to nested models.
 */
export function hasNestedModels(
  schemas: ProducerConfigSchemas | undefined
): schemas is ProducerConfigSchemas & { nestedModels: NestedModelConfigSchema[] } {
  return Boolean(schemas?.nestedModels && schemas.nestedModels.length > 0);
}

/**
 * Get the nested model selection from a model selection's config.
 * Returns undefined if no nested model is configured at the given config path.
 */
export function getNestedModelSelection(
  selection: ModelSelectionValue | undefined,
  configPath: string
): { provider: string; model: string } | undefined {
  if (!selection?.config) return undefined;

  const nestedConfig = selection.config[configPath] as
    | Record<string, unknown>
    | undefined;

  if (!nestedConfig || typeof nestedConfig !== "object") {
    return undefined;
  }

  const provider = nestedConfig.provider;
  const model = nestedConfig.model;

  if (typeof provider !== "string" || typeof model !== "string") {
    return undefined;
  }

  return { provider, model };
}
