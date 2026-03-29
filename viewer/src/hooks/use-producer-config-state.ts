import { useMemo } from 'react';
import type {
  ConfigFieldDescriptor,
  ModelSelectionValue,
  NestedModelConfigSchema,
  ProducerConfigSchemas,
} from '@/types/blueprint-graph';

export interface UseProducerConfigStateOptions {
  /** Config schemas from API */
  configSchemas: Record<string, ProducerConfigSchemas>;
  /** Current model selections (including edits) */
  currentSelections: ModelSelectionValue[];
}

export interface UseProducerConfigStateResult {
  /** Config field descriptors for each producer based on current model selection */
  configFieldsByProducer: Record<string, ConfigFieldDescriptor[]>;
  /** Config values for each producer from current selections */
  configValuesByProducer: Record<string, Record<string, unknown>>;
  /** Get nested model schemas for a producer (if any) */
  getNestedModelSchemas: (
    producerId: string
  ) => NestedModelConfigSchema[] | undefined;
}

const LEGACY_TIMELINE_CONFIG_KEYS = [
  'tracks',
  'masterTracks',
  'imageClip',
  'videoClip',
  'audioClip',
  'musicClip',
  'transcriptionClip',
  'textClip',
] as const;

function extractLegacyTimelineConfig(
  config: Record<string, unknown>
): Record<string, unknown> | null {
  const timeline: Record<string, unknown> = {};

  for (const key of LEGACY_TIMELINE_CONFIG_KEYS) {
    if (config[key] !== undefined) {
      timeline[key] = config[key];
    }
  }

  return Object.keys(timeline).length > 0 ? timeline : null;
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

  // Compute config field descriptors for each producer based on current model selection
  const configFieldsByProducer = useMemo<
    Record<string, ConfigFieldDescriptor[]>
  >(() => {
    const result: Record<string, ConfigFieldDescriptor[]> = {};

    for (const [producerId, schemas] of Object.entries(configSchemas)) {
      // Find current model selection for this producer
      const selection = currentSelections.find(
        (s) => s.producerId === producerId
      );
      if (!selection) {
        continue;
      }

      // Get top-level config properties from the selected model's schema
      const modelKey = `${selection.provider}/${selection.model}`;
      const modelSchema = schemas.modelSchemas[modelKey];
      const topLevelFields = removeNestedSelectorControlledFields(
        modelSchema?.fields ?? [],
        schemas.nestedModels ?? []
      );

      // If this producer has nested models, merge in nested model config properties
      if (schemas.nestedModels && schemas.nestedModels.length > 0) {
        const mergedFields = [...topLevelFields];

        for (const nestedModel of schemas.nestedModels) {
          // Get nested provider/model from selection config
          const nestedConfig = selection.config?.[
            nestedModel.declaration.configPath
          ] as Record<string, unknown> | undefined;

          if (nestedConfig) {
            const nestedProvider = nestedConfig[
              nestedModel.declaration.providerField
            ] as string | undefined;
            const nestedModelName = nestedConfig[
              nestedModel.declaration.modelField
            ] as string | undefined;

            if (nestedProvider && nestedModelName) {
              // Look up nested model schema
              const nestedKey = `${nestedProvider}/${nestedModelName}`;
              const nestedSchema = nestedModel.modelSchemas[nestedKey];

              if (nestedSchema?.fields) {
                const providerField = nestedModel.declaration.providerField;
                const modelField = nestedModel.declaration.modelField;
                for (const field of nestedSchema.fields) {
                  if (
                    field.keyPath === providerField ||
                    field.keyPath === modelField
                  ) {
                    continue;
                  }
                  mergedFields.push(
                    prefixFieldDescriptor(
                      field,
                      nestedModel.declaration.configPath
                    )
                  );
                }
              }
            }
          }
        }

        result[producerId] = mergedFields;
      } else {
        result[producerId] = topLevelFields;
      }
    }

    return result;
  }, [configSchemas, currentSelections]);

  // Compute config values for each producer from model selection configs
  const configValuesByProducer = useMemo<
    Record<string, Record<string, unknown>>
  >(() => {
    const result: Record<string, Record<string, unknown>> = {};

    for (const selection of currentSelections) {
      if (!selection.config || Object.keys(selection.config).length === 0) {
        continue;
      }

      const config: Record<string, unknown> = { ...selection.config };

      const producerSchemas = configSchemas[selection.producerId];
      const modelKey = `${selection.provider}/${selection.model}`;
      const modelSchema = producerSchemas?.modelSchemas[modelKey];
      const hasTimelineProperty =
        modelSchema?.fields.some((field) => field.keyPath === 'timeline') ??
        false;

      if (hasTimelineProperty && config.timeline === undefined) {
        const legacyTimeline = extractLegacyTimelineConfig(selection.config);
        if (legacyTimeline) {
          config.timeline = legacyTimeline;
        }
      }

      if (Object.keys(config).length > 0) {
        result[selection.producerId] = config;
      }
    }

    return result;
  }, [currentSelections, configSchemas]);

  // Function to get nested model schemas for a producer
  const getNestedModelSchemas = useMemo(() => {
    return (producerId: string): NestedModelConfigSchema[] | undefined => {
      const schemas = configSchemas[producerId];
      return schemas?.nestedModels;
    };
  }, [configSchemas]);

  return {
    configFieldsByProducer,
    configValuesByProducer,
    getNestedModelSchemas,
  };
}

function prefixFieldDescriptor(
  field: ConfigFieldDescriptor,
  prefix: string
): ConfigFieldDescriptor {
  const keyPath = `${prefix}.${field.keyPath}`;
  return {
    ...field,
    keyPath,
    fields: field.fields?.map((child) => prefixFieldDescriptor(child, prefix)),
    item: field.item ? prefixFieldDescriptor(field.item, prefix) : undefined,
    value: field.value ? prefixFieldDescriptor(field.value, prefix) : undefined,
    variants: field.variants?.map((variant) => ({
      ...prefixFieldDescriptor(variant, prefix),
      id: variant.id,
    })),
  };
}

function removeNestedSelectorControlledFields(
  fields: ConfigFieldDescriptor[],
  nestedModels: NestedModelConfigSchema[]
): ConfigFieldDescriptor[] {
  const hidden = new Set<string>();
  for (const nestedModel of nestedModels) {
    const configPath = nestedModel.declaration.configPath;
    hidden.add(`${configPath}.${nestedModel.declaration.providerField}`);
    hidden.add(`${configPath}.${nestedModel.declaration.modelField}`);
  }

  const prune = (
    field: ConfigFieldDescriptor
  ): ConfigFieldDescriptor | null => {
    if (hidden.has(field.keyPath)) {
      return null;
    }

    const nextFields = field.fields
      ?.map((child) => prune(child))
      .filter((child): child is ConfigFieldDescriptor => child !== null);

    return {
      ...field,
      fields: nextFields,
    };
  };

  return fields
    .map((field) => prune(field))
    .filter((field): field is ConfigFieldDescriptor => field !== null);
}
