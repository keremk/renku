import { useState } from "react";
import { InputsPanel } from "./InputsPanel";
import { OutputsPanel } from "./OutputsPanel";
import type { BlueprintGraphData, InputTemplateData } from "@/types/blueprint-graph";
import type { ArtifactInfo } from "@/types/builds";
import type { ReactNode } from "react";

type Tab = "inputs" | "outputs";

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
}: DetailPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("inputs");

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
            label="Outputs"
            active={activeTab === "outputs"}
            onClick={() => setActiveTab("outputs")}
          />
        </div>
        {/* Action button area (right side of tabs) */}
        {actionButton && (
          <div className="ml-auto pr-3">
            {actionButton}
          </div>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === "inputs" ? (
          <InputsPanel
            inputs={graphData.inputs}
            inputValues={inputData?.inputs ?? []}
            selectedNodeId={selectedNodeId}
            isEditable={isInputsEditable}
            onSave={onSaveInputs}
            canEnableEditing={canEnableEditing}
            onEnableEditing={onEnableEditing}
          />
        ) : (
          <OutputsPanel
            outputs={graphData.outputs}
            selectedNodeId={selectedNodeId}
            movieId={movieId}
            blueprintFolder={blueprintFolder}
            artifacts={artifacts}
            graphData={graphData}
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
