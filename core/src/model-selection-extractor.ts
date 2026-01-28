/**
 * Utility for extracting model selections from flat input keys.
 * Used by the viewer API to parse manifest inputs into structured model selections.
 */

/**
 * Model selection extracted from flat input keys.
 */
export interface ExtractedModelSelection {
  producerId: string;
  provider: string;
  model: string;
  config?: Record<string, unknown>;
}

/**
 * Result of extracting model selections from inputs.
 */
export interface ExtractModelSelectionsResult {
  modelSelections: ExtractedModelSelection[];
  remainingInputs: Record<string, unknown>;
}

/**
 * Extract model selections from flat input keys.
 * Matches patterns:
 * - ProducerName.provider
 * - ProducerName.model
 * - ProducerName.sttProvider (for nested STT config)
 * - ProducerName.sttModel (for nested STT config)
 *
 * @param inputs - Flat key-value pairs from manifest inputs
 * @returns Object with modelSelections array and remainingInputs (non-model inputs)
 */
export function extractModelSelectionsFromInputs(
  inputs: Record<string, unknown>
): ExtractModelSelectionsResult {
  if (!inputs || typeof inputs !== 'object' || Object.keys(inputs).length === 0) {
    return { modelSelections: [], remainingInputs: {} };
  }

  // Group inputs by producer name to find provider/model pairs and config
  const producerData = new Map<string, {
    provider?: string;
    model?: string;
    sttProvider?: string;
    sttModel?: string;
  }>();

  // Track which keys are model-related for filtering
  const modelRelatedKeys = new Set<string>();

  for (const [key, value] of Object.entries(inputs)) {
    // Match patterns like "ProducerName.provider", "ProducerName.model"
    const providerMatch = key.match(/^(.+)\.provider$/);
    const modelMatch = key.match(/^(.+)\.model$/);
    const sttProviderMatch = key.match(/^(.+)\.sttProvider$/);
    const sttModelMatch = key.match(/^(.+)\.sttModel$/);

    if (providerMatch && typeof value === 'string') {
      const producerId = providerMatch[1];
      const existing = producerData.get(producerId) ?? {};
      existing.provider = value;
      producerData.set(producerId, existing);
      modelRelatedKeys.add(key);
    } else if (modelMatch && typeof value === 'string') {
      const producerId = modelMatch[1];
      const existing = producerData.get(producerId) ?? {};
      existing.model = value;
      producerData.set(producerId, existing);
      modelRelatedKeys.add(key);
    } else if (sttProviderMatch && typeof value === 'string') {
      const producerId = sttProviderMatch[1];
      const existing = producerData.get(producerId) ?? {};
      existing.sttProvider = value;
      producerData.set(producerId, existing);
      modelRelatedKeys.add(key);
    } else if (sttModelMatch && typeof value === 'string') {
      const producerId = sttModelMatch[1];
      const existing = producerData.get(producerId) ?? {};
      existing.sttModel = value;
      producerData.set(producerId, existing);
      modelRelatedKeys.add(key);
    }
  }

  // Convert to ModelSelection array (only complete pairs)
  const modelSelections: ExtractedModelSelection[] = [];
  for (const [producerId, data] of producerData) {
    // Only include if we have both provider AND model
    if (data.provider && data.model) {
      const selection: ExtractedModelSelection = {
        producerId,
        provider: data.provider,
        model: data.model,
      };

      // Add nested STT config if present
      if (data.sttProvider && data.sttModel) {
        selection.config = {
          sttProvider: data.sttProvider,
          sttModel: data.sttModel,
        };
      }

      modelSelections.push(selection);
    }
  }

  // Build remaining inputs (exclude model-related keys for complete pairs)
  const completePairs = new Set(modelSelections.map(s => s.producerId));
  const remainingInputs: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(inputs)) {
    // Check if this key belongs to a complete model selection
    const isModelKey = modelRelatedKeys.has(key);
    if (isModelKey) {
      // Extract producer ID from the key
      const match = key.match(/^(.+)\.(provider|model|sttProvider|sttModel)$/);
      if (match && completePairs.has(match[1])) {
        // Skip this key - it's part of a complete model selection
        continue;
      }
    }
    remainingInputs[key] = value;
  }

  return { modelSelections, remainingInputs };
}
