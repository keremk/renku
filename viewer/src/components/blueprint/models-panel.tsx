import { useState, useCallback, useMemo } from "react";
import { EnableEditingBanner } from "./shared";
import { ProducerSection } from "./models/producer-section";
import { hasRegisteredEditor } from "./models/config-editors";
import { isComplexProperty } from "./models/config-utils";
import type {
  ModelSelectionValue,
  ProducerModelInfo,
  ProducerConfigSchemas,
  PromptData,
  ConfigProperty,
} from "@/types/blueprint-graph";

interface ModelsPanelProps {
  /** Available models per producer from API */
  producerModels: Record<string, ProducerModelInfo>;
  /** Current model selections (from hook, includes edits) */
  modelSelections: ModelSelectionValue[];
  /** Currently selected node ID for highlighting */
  selectedNodeId: string | null;
  /** Whether models are editable (requires buildId) */
  isEditable?: boolean;
  /** Whether editing can be enabled for this build */
  canEnableEditing?: boolean;
  /** Callback to enable editing for this build */
  onEnableEditing?: () => Promise<void>;
  /** Callback when a model selection changes (auto-save handled by parent hook) */
  onSelectionChange?: (selection: ModelSelectionValue) => void;
  /** Whether to hide the header */
  hideHeader?: boolean;
  /** Prompt data per producer (for prompt producers) */
  promptDataByProducer?: Record<string, PromptData>;
  /** Callback when prompts change (immediate save) */
  onPromptChange?: (producerId: string, prompts: PromptData) => void | Promise<void>;
  /** Config properties per producer */
  configPropertiesByProducer?: Record<string, ConfigProperty[]>;
  /** Config values per producer */
  configValuesByProducer?: Record<string, Record<string, unknown>>;
  /** Callback when config changes */
  onConfigChange?: (producerId: string, key: string, value: unknown) => void;
  /** Config schemas per producer (for nested model detection) */
  configSchemasByProducer?: Record<string, ProducerConfigSchemas>;
}

export function ModelsPanel({
  producerModels,
  modelSelections,
  selectedNodeId,
  isEditable = false,
  canEnableEditing = false,
  onEnableEditing,
  onSelectionChange,
  hideHeader: _hideHeader = false,
  promptDataByProducer = {},
  onPromptChange,
  configPropertiesByProducer = {},
  configValuesByProducer = {},
  onConfigChange,
  configSchemasByProducer = {},
}: ModelsPanelProps) {
  const [isEnabling, setIsEnabling] = useState(false);

  // Handle enable editing
  const handleEnableEditing = useCallback(async () => {
    if (!onEnableEditing) return;
    setIsEnabling(true);
    try {
      await onEnableEditing();
    } finally {
      setIsEnabling(false);
    }
  }, [onEnableEditing]);

  // Create a map of current selections by producerId
  const selectionMap = useMemo(() => {
    const map = new Map<string, ModelSelectionValue>();
    for (const selection of modelSelections) {
      map.set(selection.producerId, selection);
    }
    return map;
  }, [modelSelections]);

  // Get the current selection for a producer
  const getSelection = useCallback(
    (producerId: string): ModelSelectionValue | undefined => {
      return selectionMap.get(producerId);
    },
    [selectionMap]
  );

  // Handle selection change - delegate to parent (auto-save handled by parent hook)
  const handleSelectionChange = useCallback(
    (selection: ModelSelectionValue) => {
      onSelectionChange?.(selection);
    },
    [onSelectionChange]
  );

  // Determine which producer is selected based on node ID
  const selectedProducerId = selectedNodeId?.startsWith("Producer:")
    ? selectedNodeId.replace("Producer:", "")
    : null;

  // Get list of producer IDs, filtering out producers with only unhandled complex properties
  const producerIds = useMemo(() => {
    return Object.keys(producerModels).filter((producerId) => {
      const info = producerModels[producerId];
      const configProps = configPropertiesByProducer[producerId] ?? [];

      // Prompt producers always show (they have prompts)
      if (info.category === "prompt") return true;

      // Asset producers always show (they need the model selector dropdown)
      if (info.category === "asset") return true;

      // Check if producer has displayable config
      const hasDisplayableConfig = configProps.some((prop) => {
        // Primitive types are always displayable
        if (!isComplexProperty(prop)) {
          return true;
        }
        // Complex types are displayable if we have a registered editor
        return hasRegisteredEditor(prop.key);
      });

      // Check if producer has ONLY unhandled complex properties (no displayable content)
      const hasOnlyUnhandledComplex = configProps.length > 0 && !hasDisplayableConfig;

      // Hide producers that have ONLY unhandled complex properties
      if (hasOnlyUnhandledComplex) return false;

      // Composition producers: show only if they have displayable config
      // (no model selection needed, so nothing to show if no config)
      if (info.category === "composition") {
        return hasDisplayableConfig;
      }

      // Default: show if has displayable config
      return hasDisplayableConfig;
    });
  }, [producerModels, configPropertiesByProducer]);

  if (producerIds.length === 0) {
    return (
      <div className="text-muted-foreground text-sm">
        No producers with configurable models in this blueprint.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Enable Editing banner for read-only builds */}
      {canEnableEditing && !isEditable && (
        <EnableEditingBanner
          isEnabling={isEnabling}
          onEnableEditing={handleEnableEditing}
        />
      )}

      {producerIds.map((producerId) => {
        const info = producerModels[producerId];
        const selection = getSelection(producerId);
        const isSelected = selectedProducerId === producerId;
        const schemas = configSchemasByProducer[producerId];

        return (
          <ProducerSection
            key={producerId}
            producerId={producerId}
            producerType={info.producerType}
            description={info.description}
            category={info.category}
            availableModels={info.availableModels}
            currentSelection={selection}
            isSelected={isSelected}
            isEditable={isEditable}
            onModelChange={handleSelectionChange}
            promptData={promptDataByProducer[producerId]}
            onPromptChange={onPromptChange ? (prompts) => onPromptChange(producerId, prompts) : undefined}
            configProperties={configPropertiesByProducer[producerId]}
            configValues={configValuesByProducer[producerId]}
            onConfigChange={onConfigChange ? (key, value) => onConfigChange(producerId, key, value) : undefined}
            nestedModelSchemas={schemas?.nestedModels}
          />
        );
      })}
    </div>
  );
}
