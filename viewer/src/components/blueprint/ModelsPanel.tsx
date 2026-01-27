import { useState, useEffect, useCallback, useMemo } from "react";
import { PanelHeader, EnableEditingBanner } from "./shared";
import { ModelCard } from "./models/model-card";
import { isNestedSttSelection, isSpeechModelSelection } from "./models/stt-helpers";
import type {
  ModelSelectionValue,
  ProducerModelInfo,
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
  /** Callback when models are saved */
  onSave?: (models: ModelSelectionValue[]) => Promise<void>;
  /** Whether editing can be enabled for this build */
  canEnableEditing?: boolean;
  /** Callback to enable editing for this build */
  onEnableEditing?: () => Promise<void>;
}

export function ModelsPanel({
  producerModels,
  modelSelections,
  selectedNodeId,
  isEditable = false,
  onSave,
  canEnableEditing = false,
  onEnableEditing,
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
  const initialSelectionMap = useMemo(() => {
    const map = new Map<string, ModelSelectionValue>();
    for (const selection of modelSelections) {
      map.set(selection.producerId, selection);
    }
    return map;
  }, [modelSelections]);

  // Track edit values locally
  const [editValues, setEditValues] = useState<Map<string, ModelSelectionValue>>(
    new Map()
  );
  const [isSaving, setIsSaving] = useState(false);

  // Reset edit values when model selections change (e.g., build selection change)
  useEffect(() => {
    setEditValues(new Map());
  }, [modelSelections]);

  // Compute if there are unsaved changes
  // For nested STT selections, compare against config.sttProvider/sttModel
  const isDirty = useMemo(() => {
    for (const [producerId, value] of editValues) {
      const original = initialSelectionMap.get(producerId);
      if (!original) {
        return true; // New selection
      }

      // For nested STT selections, compare against config values
      if (isNestedSttSelection(original)) {
        const sttProvider = original.config!.sttProvider as string;
        const sttModel = original.config!.sttModel as string;
        if (value.provider !== sttProvider || value.model !== sttModel) {
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
  }, [editValues, initialSelectionMap]);

  // Get the current selection for a producer (edited or original)
  // For nested STT selections, extract the actual provider/model from config
  const getSelection = useCallback(
    (producerId: string): ModelSelectionValue | undefined => {
      // Check for edited value first
      if (editValues.has(producerId)) {
        return editValues.get(producerId);
      }

      const existing = initialSelectionMap.get(producerId);
      if (!existing) return undefined;

      // For nested STT selections, extract actual provider/model from config
      if (isNestedSttSelection(existing)) {
        return {
          ...existing,
          provider: existing.config!.sttProvider as string,
          model: existing.config!.sttModel as string,
        };
      }

      return existing;
    },
    [editValues, initialSelectionMap]
  );

  // Handle selection change
  const handleSelectionChange = useCallback(
    (selection: ModelSelectionValue) => {
      setEditValues((prev) => {
        const next = new Map(prev);
        next.set(selection.producerId, selection);
        return next;
      });
    },
    []
  );

  // Handle save
  // For nested STT selections, wrap edited values back in the nested format
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

        // If original was in nested STT format, preserve that format
        if (original && isSpeechModelSelection(original)) {
          allSelections.push({
            producerId,
            provider: original.provider, // "renku"
            model: original.model, // "speech/transcription"
            config: {
              sttProvider: value.provider,
              sttModel: value.model,
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
  }, [onSave, isDirty, initialSelectionMap, editValues]);

  // Determine which producer is selected based on node ID
  const selectedProducerId = selectedNodeId?.startsWith("Producer:")
    ? selectedNodeId.replace("Producer:", "")
    : null;

  // Get list of producer IDs from the producerModels
  const producerIds = useMemo(
    () => Object.keys(producerModels),
    [producerModels]
  );

  if (producerIds.length === 0) {
    return (
      <div className="text-muted-foreground text-sm">
        No producers with configurable models in this blueprint.
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-2xl mx-auto">
      {/* Enable Editing banner for read-only builds */}
      {canEnableEditing && !isEditable && (
        <EnableEditingBanner
          isEnabling={isEnabling}
          onEnableEditing={handleEnableEditing}
        />
      )}

      {/* Header with save button */}
      {isEditable && (
        <PanelHeader
          title="Edit Models"
          isDirty={isDirty}
          isSaving={isSaving}
          onSave={handleSave}
        />
      )}

      {producerIds.map((producerId) => {
        const info = producerModels[producerId];
        const selection = getSelection(producerId);
        const isSelected = selectedProducerId === producerId;

        return (
          <ModelCard
            key={producerId}
            producerId={producerId}
            producerType={info.producerType}
            description={info.description}
            category={info.category}
            availableModels={info.availableModels}
            currentSelection={selection}
            isSelected={isSelected}
            isEditable={info.category !== 'composition' && isEditable}
            onChange={handleSelectionChange}
          />
        );
      })}
    </div>
  );
}
