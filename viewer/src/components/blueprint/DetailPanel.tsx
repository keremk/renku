import { useState } from "react";
import { InputsPanel } from "./InputsPanel";
import { OutputsPanel } from "./OutputsPanel";
import type { BlueprintGraphData, InputTemplateData } from "@/types/blueprint-graph";

type Tab = "inputs" | "outputs";

interface DetailPanelProps {
  graphData: BlueprintGraphData;
  inputData: InputTemplateData | null;
  selectedNodeId: string | null;
  movieId: string | null;
}

export function DetailPanel({
  graphData,
  inputData,
  selectedNodeId,
  movieId,
}: DetailPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("inputs");

  return (
    <div className="flex flex-col h-full bg-card rounded-xl border border-border/60 overflow-hidden">
      {/* Tab buttons */}
      <div className="flex border-b border-border/40">
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

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === "inputs" ? (
          <InputsPanel
            inputs={graphData.inputs}
            inputValues={inputData?.inputs ?? []}
            selectedNodeId={selectedNodeId}
          />
        ) : (
          <OutputsPanel
            outputs={graphData.outputs}
            selectedNodeId={selectedNodeId}
            movieId={movieId}
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
