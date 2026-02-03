import { useState, useEffect, useCallback, useMemo } from "react";
import { EnableEditingBanner } from "./shared";
import { ProducerSection } from "./models/producer-section";
import { hasNestedModels, getNestedModelSelection } from "./models/stt-helpers";
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
  /** Current model selections from inputs.yaml */
  modelSelections: ModelSelectionValue[];
  /** Currently selected node ID for highlighting */
  selectedNodeId: string | null;
  /** Whether models are editable (requires buildId) */
  isEditable?: boolean;
  /** Callback when models are saved (only used when not in controlled mode) */
  onSave?: (models: ModelSelectionValue[]) => Promise<void>;
  /** Whether editing can be enabled for this build */
  canEnableEditing?: boolean;
  /** Callback to enable editing for this build */
  onEnableEditing?: () => Promise<void>;
  /** Controlled mode: callback when a selection changes */
  onSelectionChange?: (selection: ModelSelectionValue) => void;
  /** Whether to hide the header (save is handled elsewhere) */
  hideHeader?: boolean;
  /** Prompt data per producer (for prompt producers) */
  promptDataByProducer?: Record<string, PromptData>;
  /** Callback when prompts change */
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
  onSave,
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
  // Determine if we're in controlled mode
  const isControlled = onSelectionChange !== undefined;
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
  const initialSelectionMap = useMemo(() => {
    const map = new Map<string, ModelSelectionValue>();
    for (const selection of modelSelections) {
      map.set(selection.producerId, selection);
    }
    return map;
  }, [modelSelections]);

  // Track edit values locally (for uncontrolled mode)
  const [editValues, setEditValues] = useState<Map<string, ModelSelectionValue>>(
    new Map()
  );
  const [isSaving, setIsSaving] = useState(false);

  // Reset edit values when model selections change (e.g., build selection change)
  useEffect(() => {
    setEditValues(new Map());
  }, [modelSelections]);

  // Compute if there are unsaved changes (for uncontrolled mode)
  const isDirty = useMemo(() => {
    for (const [producerId, value] of editValues) {
      const original = initialSelectionMap.get(producerId);
      if (!original) {
        return true; // New selection
      }

      // Check if this producer has nested models via schema
      const schemas = configSchemasByProducer[producerId];
      if (hasNestedModels(schemas)) {
        const nestedDecl = schemas.nestedModels[0].declaration;
        const nestedSel = getNestedModelSelection(original, nestedDecl.configPath);
        if (!nestedSel || value.provider !== nestedSel.provider || value.model !== nestedSel.model) {
          return true;
        }
        continue;
      }

      // Standard comparison for other producers
      if (
        value.provider !== original.provider ||
        value.model !== original.model
      ) {
        return true;
      }
    }
    return false;
  }, [editValues, initialSelectionMap, configSchemasByProducer]);

  // Get the current selection for a producer
  // In controlled mode, props contain current state (saved + edits) so use directly
  // In uncontrolled mode, check editValues first, then fall back to initial
  const getSelection = useCallback(
    (producerId: string): ModelSelectionValue | undefined => {
      // In controlled mode, trust the props completely
      // (parent hook manages edits and passes merged currentSelections)
      if (isControlled) {
        const existing = initialSelectionMap.get(producerId);
        if (!existing) return undefined;

        // Check if this producer has nested models via schema
        const schemas = configSchemasByProducer[producerId];
        if (hasNestedModels(schemas)) {
          // For producers with nested models, the top-level selection stays as-is
          // The nested model selector handles the config.stt.provider/model separately
          return existing;
        }

        return existing;
      }

      // Uncontrolled mode: check for edited value first
      if (editValues.has(producerId)) {
        return editValues.get(producerId);
      }

      const existing = initialSelectionMap.get(producerId);
      if (!existing) return undefined;

      // Check if this producer has nested models via schema
      const schemas = configSchemasByProducer[producerId];
      if (hasNestedModels(schemas)) {
        return existing;
      }

      return existing;
    },
    [isControlled, editValues, initialSelectionMap, configSchemasByProducer]
  );

  // Handle selection change
  const handleSelectionChange = useCallback(
    (selection: ModelSelectionValue) => {
      if (isControlled) {
        // In controlled mode, notify parent
        onSelectionChange(selection);
      } else {
        // In uncontrolled mode, update internal state
        setEditValues((prev) => {
          const next = new Map(prev);
          next.set(selection.producerId, selection);
          return next;
        });
      }
    },
    [isControlled, onSelectionChange]
  );

  // Handle save (for uncontrolled mode)
  // For producers with nested models, wrap edited values back in the nested format
  const handleSave = useCallback(async () => {
    if (!onSave || !isDirty) return;

    setIsSaving(true);
    try {
      // Merge original selections with edited values
      const allSelections: ModelSelectionValue[] = [];
      const processed = new Set<string>();

      // First add all edited values
      for (const [producerId, value] of editValues) {
        const original = initialSelectionMap.get(producerId);
        const schemas = configSchemasByProducer[producerId];

        // If producer has nested models via schema, preserve the top-level and update nested
        if (hasNestedModels(schemas)) {
          // Find the first nested model declaration
          const nestedDecl = schemas.nestedModels[0].declaration;
          allSelections.push({
            producerId,
            provider: original?.provider ?? "renku",
            model: original?.model ?? value.model,
            config: {
              ...original?.config,
              [nestedDecl.configPath]: {
                ...(original?.config?.[nestedDecl.configPath] as Record<string, unknown> ?? {}),
                [nestedDecl.providerField]: value.provider,
                [nestedDecl.modelField]: value.model,
              },
            },
          });
        } else {
          allSelections.push(value);
        }
        processed.add(producerId);
      }

      // Then add original values that weren't edited
      for (const [producerId, value] of initialSelectionMap) {
        if (!processed.has(producerId)) {
          allSelections.push(value);
        }
      }

      await onSave(allSelections);
      // Clear edit state after successful save
      setEditValues(new Map());
    } finally {
      setIsSaving(false);
    }
  }, [onSave, isDirty, initialSelectionMap, editValues, configSchemasByProducer]);

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

      // Asset producers: show if they have displayable config OR no config (for model selection)
      if (info.category === "asset") {
        return hasDisplayableConfig || configProps.length === 0;
      }

      // Composition producers: show only if they have displayable config
      // (no model selection needed, so nothing to show if no config)
      if (info.category === "composition") {
        return hasDisplayableConfig;
      }

      // Default: show if has displayable config
      return hasDisplayableConfig;
    });
  }, [producerModels, configPropertiesByProducer]);

  // Track which producers have been edited (for showing edited badge)
  const editedProducerIds = useMemo(() => {
    const edited = new Set<string>();
    // Check model edits
    for (const producerId of editValues.keys()) {
      edited.add(producerId);
    }
    // Check prompt edits (if prompts have source: 'build', they're edited)
    for (const [producerId, promptData] of Object.entries(promptDataByProducer)) {
      if (promptData.source === 'build') {
        edited.add(producerId);
      }
    }
    return edited;
  }, [editValues, promptDataByProducer]);

  // Suppress unused variable warnings temporarily
  void isSaving;
  void handleSave;

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
        const isEdited = editedProducerIds.has(producerId);
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
            isEdited={isEdited}
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
