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

/**
 * @deprecated Use hasNestedModels with schema-driven detection instead.
 * Check if a model selection represents a "speech/" meta-producer.
 * These producers (like TranscriptionProducer) have:
 * - Top-level: provider="renku", model="speech/transcription"
 * - Actual backend selection in: config.stt.provider and config.stt.model
 */
export function isNestedSttSelection(selection?: ModelSelectionValue): boolean {
  if (!selection) return false;
  // Check if the selection uses the nested STT config pattern (new format)
  const sttConfig = selection.config?.stt as Record<string, unknown> | undefined;
  return (
    selection.provider === "renku" &&
    selection.model.startsWith("speech/") &&
    typeof sttConfig?.provider === "string" &&
    typeof sttConfig?.model === "string"
  );
}

/**
 * @deprecated Use hasNestedModels with schema-driven detection instead.
 * Check if a selection uses the speech/ meta-producer pattern
 * (even if config is not yet populated - for new selections)
 */
export function isSpeechModelSelection(selection?: ModelSelectionValue): boolean {
  if (!selection) return false;
  return selection.provider === "renku" && selection.model.startsWith("speech/");
}
