import { useState, useCallback } from "react";
import { InputsPanel } from "./inputs-panel";
import { ModelsPanel } from "./models-panel";
import { OutputsPanel } from "./outputs-panel";
import { PreviewPanel } from "./preview-panel";
import { ReadOnlyIndicator } from "./shared";
import type {
  BlueprintGraphData,
  InputTemplateData,
  ModelSelectionValue,
  ProducerModelInfo,
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

        {/* Right side: read-only indicator and action button */}
        <div className="ml-auto flex items-center gap-2 pr-3">
          {showReadOnlyIndicator && (
            <ReadOnlyIndicator
              onEnableEditing={handleEnableEditing}
              isEnabling={isEnabling}
            />
          )}
          {actionButton}
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
