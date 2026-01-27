import type { ModelSelectionValue } from "@/types/blueprint-graph";

/**
 * Check if a model selection represents a "speech/" meta-producer.
 * These producers (like TranscriptionProducer) have:
 * - Top-level: provider="renku", model="speech/transcription"
 * - Actual backend selection in: config.sttProvider and config.sttModel
 */
export function isNestedSttSelection(selection?: ModelSelectionValue): boolean {
  if (!selection) return false;
  // Check if the selection uses the nested STT config pattern
  return (
    selection.provider === "renku" &&
    selection.model.startsWith("speech/") &&
    typeof selection.config?.sttProvider === "string" &&
    typeof selection.config?.sttModel === "string"
  );
}

/**
 * Check if a selection uses the speech/ meta-producer pattern
 * (even if config is not yet populated - for new selections)
 */
export function isSpeechModelSelection(selection?: ModelSelectionValue): boolean {
  if (!selection) return false;
  return selection.provider === "renku" && selection.model.startsWith("speech/");
}
