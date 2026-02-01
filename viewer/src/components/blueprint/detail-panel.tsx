import { useState, useCallback, useMemo, useEffect } from "react";
import { InputsPanel } from "./inputs-panel";
import { ModelsPanel } from "./models-panel";
import { OutputsPanel } from "./outputs-panel";
import { PreviewPanel } from "./preview-panel";
import { ReadOnlyIndicator, SaveChangesButton } from "./shared";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import type {
  BlueprintGraphData,
  InputTemplateData,
  ModelSelectionValue,
  ProducerModelInfo,
  PromptData,
  ConfigProperty,
} from "@/types/blueprint-graph";
import type { ArtifactInfo } from "@/types/builds";
import type { TimelineDocument } from "@/types/timeline";
import type { ReactNode } from "react";

type Tab = "inputs" | "models" | "outputs" | "preview";
type TimelineStatus = "idle" | "loading" | "success" | "error";

interface DetailPanelProps {
  graphData: BlueprintGraphData;
  inputData: InputTemplateData | null;
  selectedNodeId: string | null;
  movieId: string | null;
  blueprintFolder: string | null;
  artifacts: ArtifactInfo[];
  /** Optional action button to render in the tab bar (e.g., Run button) */
  actionButton?: ReactNode;
  /** Whether inputs are editable (requires a selected build with inputs file) */
  isInputsEditable?: boolean;
  /** Callback when inputs are saved */
  onSaveInputs?: (values: Record<string, unknown>) => Promise<void>;
  /** Whether editing can be enabled for this build */
  canEnableEditing?: boolean;
  /** Callback to enable editing for this build */
  onEnableEditing?: () => Promise<void>;
  /** Available models per producer from API */
  producerModels?: Record<string, ProducerModelInfo>;
  /** Current model selections from inputs.yaml */
  modelSelections?: ModelSelectionValue[];
  /** Callback when models are saved */
  onSaveModels?: (models: ModelSelectionValue[]) => Promise<void>;
  /** Prompt data per producer (for prompt producers) */
  promptDataByProducer?: Record<string, PromptData>;
  /** Callback when prompts change */
  onPromptChange?: (producerId: string, prompts: PromptData) => Promise<void>;
  /** Config properties per producer */
  configPropertiesByProducer?: Record<string, ConfigProperty[]>;
  /** Config values per producer */
  configValuesByProducer?: Record<string, Record<string, unknown>>;
  /** Callback to save all changes (inputs + models) */
  onSaveAll?: (
    inputs: Record<string, unknown>,
    models: ModelSelectionValue[],
  ) => Promise<void>;
  /** Callback to reload data (undo changes) */
  onReload?: () => void;
  /** Whether a timeline artifact exists for the selected build */
  hasTimeline?: boolean;
  // Controlled tab state (optional)
  activeTab?: Tab;
  onTabChange?: (tab: Tab) => void;
  // Playback state for preview (optional, for controlled mode)
  timeline?: TimelineDocument | null;
  timelineStatus?: TimelineStatus;
  timelineError?: Error | null;
  currentTime?: number;
  isPlaying?: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onSeek?: (time: number) => void;
  onReset?: () => void;
  /** Callback when an artifact is edited or restored */
  onArtifactUpdated?: () => void;
}

export function DetailPanel({
  graphData,
  inputData,
  selectedNodeId,
  movieId,
  blueprintFolder,
  artifacts,
  actionButton,
  isInputsEditable = false,
  onSaveInputs,
  canEnableEditing = false,
  onEnableEditing,
  producerModels = {},
  modelSelections = [],
  onSaveModels,
  promptDataByProducer = {},
  onPromptChange,
  configPropertiesByProducer = {},
  configValuesByProducer = {},
  onSaveAll,
  onReload,
  hasTimeline = false,
  activeTab: controlledActiveTab,
  onTabChange,
  timeline,
  timelineStatus,
  timelineError,
  currentTime,
  isPlaying,
  onPlay,
  onPause,
  onSeek,
  onReset,
  onArtifactUpdated,
}: DetailPanelProps) {
  // Support both controlled and uncontrolled tab state
  const [internalActiveTab, setInternalActiveTab] = useState<Tab>("inputs");
  const activeTab = controlledActiveTab ?? internalActiveTab;
  const setActiveTab = onTabChange ?? setInternalActiveTab;

  // Handle enable editing state
  const [isEnabling, setIsEnabling] = useState(false);

  const handleEnableEditing = useCallback(async () => {
    if (!onEnableEditing) return;
    setIsEnabling(true);
    try {
      await onEnableEditing();
    } finally {
      setIsEnabling(false);
    }
  }, [onEnableEditing]);

  // Show read-only indicator when not editable but can enable editing
  const showReadOnlyIndicator = !isInputsEditable && canEnableEditing;

  // ============================================================================
  // Editable State Management (lifted from individual panels)
  // ============================================================================

  // Create initial value maps from props
  const initialInputValues = useMemo(() => {
    const map: Record<string, unknown> = {};
    for (const iv of inputData?.inputs ?? []) {
      map[iv.name] = iv.value;
    }
    return map;
  }, [inputData?.inputs]);

  const initialModelSelections = useMemo(() => {
    const map = new Map<string, ModelSelectionValue>();
    for (const selection of modelSelections) {
      map.set(selection.producerId, selection);
    }
    return map;
  }, [modelSelections]);

  // Editable state for inputs
  const [editedInputs, setEditedInputs] = useState<Record<string, unknown>>(initialInputValues);
  const [editedModels, setEditedModels] = useState<Map<string, ModelSelectionValue>>(new Map());
  const [isSaving, setIsSaving] = useState(false);

  // Reset edit state when props change (e.g., build selection change)
  useEffect(() => {
    setEditedInputs(initialInputValues);
  }, [initialInputValues]);

  useEffect(() => {
    setEditedModels(new Map());
  }, [modelSelections]);

  // Compute dirty state
  const isInputsDirty = useMemo(() => {
    return JSON.stringify(editedInputs) !== JSON.stringify(initialInputValues);
  }, [editedInputs, initialInputValues]);

  const isModelsDirty = useMemo(() => {
    if (editedModels.size === 0) return false;
    for (const [producerId, value] of editedModels) {
      const original = initialModelSelections.get(producerId);
      if (!original) return true;
      if (value.provider !== original.provider || value.model !== original.model) {
        return true;
      }
    }
    return false;
  }, [editedModels, initialModelSelections]);

  const isDirty = isInputsDirty || isModelsDirty;

  // Handle input value changes
  const handleInputChange = useCallback((name: string, value: unknown) => {
    setEditedInputs((prev) => ({
      ...prev,
      [name]: value,
    }));
  }, []);

  // Handle model selection changes
  const handleModelChange = useCallback((selection: ModelSelectionValue) => {
    setEditedModels((prev) => {
      const next = new Map(prev);
      next.set(selection.producerId, selection);
      return next;
    });
  }, []);

  // Handle save all
  const handleSaveAll = useCallback(async () => {
    if (!isDirty) return;

    setIsSaving(true);
    try {
      // Build the final models array
      const finalModels: ModelSelectionValue[] = [];
      const processed = new Set<string>();

      // Add edited models first
      for (const [producerId, value] of editedModels) {
        finalModels.push(value);
        processed.add(producerId);
      }

      // Add unedited models
      for (const [producerId, value] of initialModelSelections) {
        if (!processed.has(producerId)) {
          finalModels.push(value);
        }
      }

      // Use onSaveAll if available, otherwise fall back to individual saves
      if (onSaveAll) {
        await onSaveAll(editedInputs, finalModels);
      } else {
        // Fall back to individual saves
        if (isInputsDirty && onSaveInputs) {
          await onSaveInputs(editedInputs);
        }
        if (isModelsDirty && onSaveModels) {
          await onSaveModels(finalModels);
        }
      }

      // Clear edit states after successful save
      setEditedModels(new Map());
    } finally {
      setIsSaving(false);
    }
  }, [
    isDirty,
    isInputsDirty,
    isModelsDirty,
    editedInputs,
    editedModels,
    initialModelSelections,
    onSaveAll,
    onSaveInputs,
    onSaveModels,
  ]);

  // Handle undo
  const handleUndo = useCallback(() => {
    // Reset to initial values
    setEditedInputs(initialInputValues);
    setEditedModels(new Map());
    // Optionally trigger reload from server
    onReload?.();
  }, [initialInputValues, onReload]);

  return (
    <div className="flex flex-col h-full bg-card rounded-xl border border-border/60 overflow-hidden">
      {/* Tab buttons */}
      <div className="flex items-center border-b border-border/40">
        <div className="flex">
          <TabButton
            label="Inputs"
            active={activeTab === "inputs"}
            onClick={() => setActiveTab("inputs")}
          />
          <TabButton
            label="Models"
            active={activeTab === "models"}
            onClick={() => setActiveTab("models")}
          />
          <TabButton
            label="Outputs"
            active={activeTab === "outputs"}
            onClick={() => setActiveTab("outputs")}
          />
          <TabButton
            label="Preview"
            active={activeTab === "preview"}
            onClick={() => setActiveTab("preview")}
          />
        </div>

        {/* Right side: read-only indicator, save button, action button, and theme toggle */}
        <div className="ml-auto flex items-center gap-2 pr-3">
          {showReadOnlyIndicator && (
            <ReadOnlyIndicator
              onEnableEditing={handleEnableEditing}
              isEnabling={isEnabling}
            />
          )}
          {isInputsEditable && (
            <SaveChangesButton
              isDirty={isDirty}
              isSaving={isSaving}
              onSave={handleSaveAll}
              onUndo={handleUndo}
            />
          )}
          {actionButton}
          <ThemeToggle />
        </div>
      </div>

      {/* Tab content */}
      <div className={`flex-1 overflow-auto ${activeTab === "preview" ? "" : "p-4"}`}>
        {activeTab === "inputs" && (
          <InputsPanel
            inputs={graphData.inputs}
            inputValues={inputData?.inputs ?? []}
            selectedNodeId={selectedNodeId}
            isEditable={isInputsEditable}
            onSave={onSaveInputs}
            blueprintFolder={blueprintFolder}
            movieId={movieId}
            // Controlled mode: pass edited values and change handler
            controlledValues={editedInputs}
            onValueChange={handleInputChange}
          />
        )}
        {activeTab === "models" && (
          <ModelsPanel
            producerModels={producerModels}
            modelSelections={modelSelections}
            selectedNodeId={selectedNodeId}
            isEditable={isInputsEditable}
            onSave={onSaveModels}
            canEnableEditing={canEnableEditing}
            onEnableEditing={onEnableEditing}
            // Controlled mode: pass change handler (save is handled by tab bar)
            onSelectionChange={handleModelChange}
            hideHeader={true}
            promptDataByProducer={promptDataByProducer}
            onPromptChange={onPromptChange}
            configPropertiesByProducer={configPropertiesByProducer}
            configValuesByProducer={configValuesByProducer}
          />
        )}
        {activeTab === "outputs" && (
          <OutputsPanel
            outputs={graphData.outputs}
            selectedNodeId={selectedNodeId}
            movieId={movieId}
            blueprintFolder={blueprintFolder}
            artifacts={artifacts}
            graphData={graphData}
            onArtifactUpdated={onArtifactUpdated}
          />
        )}
        {activeTab === "preview" && (
          <PreviewPanel
            movieId={movieId}
            blueprintFolder={blueprintFolder}
            hasTimeline={hasTimeline}
            timeline={timeline}
            timelineStatus={timelineStatus}
            timelineError={timelineError}
            currentTime={currentTime}
            isPlaying={isPlaying}
            onPlay={onPlay}
            onPause={onPause}
            onSeek={onSeek}
            onReset={onReset}
          />
        )}
      </div>
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        px-4 py-2 text-sm font-medium transition-colors
        ${
          active
            ? "text-foreground border-b-2 border-primary bg-primary/5"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
        }
      `}
    >
      {label}
    </button>
  );
}
