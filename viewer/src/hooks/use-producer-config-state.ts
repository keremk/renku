import { useMemo } from "react";
import type {
  ConfigProperty,
  ModelSelectionValue,
  NestedModelConfigSchema,
  ProducerConfigSchemas,
} from "@/types/blueprint-graph";

export interface UseProducerConfigStateOptions {
  /** Config schemas from API */
  configSchemas: Record<string, ProducerConfigSchemas>;
  /** Current model selections (including edits) */
  currentSelections: ModelSelectionValue[];
}

export interface UseProducerConfigStateResult {
  /** Config properties for each producer based on current model selection */
  configPropertiesByProducer: Record<string, ConfigProperty[]>;
  /** Config values for each producer from current selections */
  configValuesByProducer: Record<string, Record<string, unknown>>;
  /** Get nested model schemas for a producer (if any) */
  getNestedModelSchemas: (producerId: string) => NestedModelConfigSchema[] | undefined;
}

/**
 * Hook for computing derived config state from schemas and selections.
 *
 * This hook:
 * - Computes config properties for each producer based on current model selection
 * - Handles nested model schema resolution
 * - Merges nested model config properties with top-level properties
 * - Returns everything ModelsPanel needs for rendering config editors
 */
export function useProducerConfigState(
  options: UseProducerConfigStateOptions
): UseProducerConfigStateResult {
  const { configSchemas, currentSelections } = options;

  // Compute config properties for each producer based on current model selection
  const configPropertiesByProducer = useMemo<Record<string, ConfigProperty[]>>(() => {
    const result: Record<string, ConfigProperty[]> = {};

    for (const [producerId, schemas] of Object.entries(configSchemas)) {
      // Find current model selection for this producer
      const selection = currentSelections.find((s) => s.producerId === producerId);
      if (!selection) {
        continue;
      }

      // Get top-level config properties from the selected model's schema
      const modelKey = `${selection.provider}/${selection.model}`;
      const modelSchema = schemas.modelSchemas[modelKey];
      const topLevelProperties = modelSchema?.properties ?? [];

      // If this producer has nested models, merge in nested model config properties
      if (schemas.nestedModels && schemas.nestedModels.length > 0) {
        const mergedProperties = [...topLevelProperties];

        for (const nestedModel of schemas.nestedModels) {
          // Get nested provider/model from selection config
          const nestedConfig = selection.config?.[nestedModel.declaration.configPath] as
            | Record<string, unknown>
            | undefined;

          if (nestedConfig) {
            const nestedProvider = nestedConfig[nestedModel.declaration.providerField] as
              | string
              | undefined;
            const nestedModelName = nestedConfig[nestedModel.declaration.modelField] as
              | string
              | undefined;

            if (nestedProvider && nestedModelName) {
              // Look up nested model schema
              const nestedKey = `${nestedProvider}/${nestedModelName}`;
              const nestedSchema = nestedModel.modelSchemas[nestedKey];

              if (nestedSchema?.properties) {
                // Add nested properties with namespaced keys
                for (const prop of nestedSchema.properties) {
                  mergedProperties.push({
                    ...prop,
                    // Namespace the key under the configPath (e.g., "stt.diarize")
                    key: `${nestedModel.declaration.configPath}.${prop.key}`,
                  });
                }
              }
            }
          }
        }

        result[producerId] = mergedProperties;
      } else {
        result[producerId] = topLevelProperties;
      }
    }

    return result;
  }, [configSchemas, currentSelections]);

  // Compute config values for each producer from model selection configs
  const configValuesByProducer = useMemo<Record<string, Record<string, unknown>>>(() => {
    const result: Record<string, Record<string, unknown>> = {};

    for (const selection of currentSelections) {
      if (!selection.config || Object.keys(selection.config).length === 0) {
        continue;
      }

      // Flatten nested config for UI consumption
      const flatConfig: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(selection.config)) {
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          // Check if this is a nested model config (has provider/model)
          const nested = value as Record<string, unknown>;
          if (typeof nested.provider === "string" && typeof nested.model === "string") {
            // This is a nested model config - flatten its properties
            for (const [nestedKey, nestedValue] of Object.entries(nested)) {
              // Skip provider/model - these are displayed separately in the nested model selector
              if (nestedKey === "provider" || nestedKey === "model") {
                continue;
              }
              flatConfig[`${key}.${nestedKey}`] = nestedValue;
            }
          } else {
            // Regular nested object - keep as-is
            flatConfig[key] = value;
          }
        } else {
          flatConfig[key] = value;
        }
      }

      if (Object.keys(flatConfig).length > 0) {
        result[selection.producerId] = flatConfig;
      }
    }

    return result;
  }, [currentSelections]);

  // Function to get nested model schemas for a producer
  const getNestedModelSchemas = useMemo(() => {
    return (producerId: string): NestedModelConfigSchema[] | undefined => {
      const schemas = configSchemas[producerId];
      return schemas?.nestedModels;
    };
  }, [configSchemas]);

  return {
    configPropertiesByProducer,
    configValuesByProducer,
    getNestedModelSchemas,
  };
}
