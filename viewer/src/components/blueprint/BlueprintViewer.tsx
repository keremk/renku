import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { BlueprintFlow } from "./BlueprintFlow";
import { DetailPanel } from "./DetailPanel";
import { BuildsListSidebar } from "./BuildsListSidebar";
import { RunButton } from "./run-button";
import { PlanDialog } from "./plan-dialog";
import { ExecutionProgressPanel } from "./execution-progress-panel";
import { ExecutionProvider, useExecution } from "@/contexts/execution-context";
import { computeBlueprintLayerCount } from "@/lib/blueprint-layout";
import { fetchBuildInputs, saveBuildInputs, enableBuildEditing, fetchProducerModels } from "@/data/blueprint-client";
import type {
  BlueprintGraphData,
  InputTemplateData,
  ModelSelectionValue,
  ProducerModelInfo,
} from "@/types/blueprint-graph";
import type { BuildInfo, BuildManifestResponse } from "@/types/builds";

interface BlueprintViewerProps {
  graphData: BlueprintGraphData;
  inputData: InputTemplateData | null;
  movieId: string | null;
  /** Blueprint folder for builds listing */
  blueprintFolder: string | null;
  /** Blueprint name (folder name, e.g., "my-blueprint") for API calls */
  blueprintName: string;
  /** Full path to the blueprint YAML file */
  blueprintPath: string;
  /** Catalog root path (if using a catalog) */
  catalogRoot?: string | null;
  /** List of builds in the folder */
  builds: BuildInfo[];
  /** Whether builds are loading */
  buildsLoading: boolean;
  /** Currently selected build ID */
  selectedBuildId: string | null;
  /** Manifest data for the selected build */
  selectedBuildManifest: BuildManifestResponse | null;
  /** Callback to refresh builds list */
  onBuildsRefresh?: () => Promise<void>;
}

// Blueprint flow panel sizing (the graph at the bottom)
const MIN_BLUEPRINT_FLOW_PERCENT = 30;
const MAX_BLUEPRINT_FLOW_PERCENT = 70;
const DEFAULT_BLUEPRINT_FLOW_PERCENT = 30;

type BottomPanelTab = 'blueprint' | 'execution';

/**
 * Serializes a value to YAML format.
 * Avoids adding quotes unless absolutely necessary for YAML syntax.
 */
function serializeYamlValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    // Only quote if the value contains characters that would break YAML parsing
    // or if it looks like a YAML special value (true, false, null, numbers)
    const needsQuoting =
      value === "" ||
      value.includes("\n") ||
      value.startsWith(" ") ||
      value.endsWith(" ") ||
      /^[#&*!|>'"]/.test(value) ||  // YAML special start chars
      /[:{}[\]]/.test(value) ||       // YAML structure chars
      value === "true" || value === "false" || value === "null" ||
      (!isNaN(Number(value)) && value !== "");  // Looks like a number

    if (needsQuoting) {
      // Use single quotes for simple cases, double quotes for complex
      if (!value.includes("'") && !value.includes("\n")) {
        return `'${value}'`;
      }
      // Fall back to double quotes with escaping
      return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
    }
    return value;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value) || typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Inner component that uses the execution context.
 */
function BlueprintViewerInner({
  graphData,
  inputData,
  movieId,
  blueprintFolder,
  blueprintName,
  blueprintPath,
  catalogRoot,
  builds,
  buildsLoading,
  selectedBuildId,
  selectedBuildManifest,
  onBuildsRefresh,
}: BlueprintViewerProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [blueprintFlowPercent, setBlueprintFlowPercent] = useState(DEFAULT_BLUEPRINT_FLOW_PERCENT);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<BottomPanelTab>('blueprint');
  const containerRef = useRef<HTMLDivElement>(null);

  // Build inputs state
  const [buildInputsContent, setBuildInputsContent] = useState<string | null>(null);
  const [buildInputsLoading, setBuildInputsLoading] = useState(false);

  // Producer models state
  const [producerModels, setProducerModels] = useState<Record<string, ProducerModelInfo>>({});

  const { state, initializeFromManifest, setTotalLayers } = useExecution();
  const isExecuting = state.status === 'executing';

  // Find the selected build to check if it has inputs
  const selectedBuild = useMemo(
    () => builds.find((b) => b.movieId === selectedBuildId),
    [builds, selectedBuildId]
  );

  // Fetch producer models on initial load
  useEffect(() => {
    if (!blueprintPath) return;

    let cancelled = false;

    const loadProducerModels = async () => {
      try {
        const response = await fetchProducerModels(blueprintPath, catalogRoot);
        if (!cancelled) {
          setProducerModels(response.producers);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to fetch producer models:", error);
        }
      }
    };

    void loadProducerModels();

    return () => {
      cancelled = true;
    };
  }, [blueprintPath, catalogRoot]);

  // Fetch build inputs when a build with inputs is selected
  useEffect(() => {
    // If conditions not met, reset state and return
    const shouldFetch = blueprintFolder && selectedBuildId && selectedBuild?.hasInputsFile;
    if (!shouldFetch) {
      // Reset content via a microtask to avoid synchronous setState warning
      queueMicrotask(() => setBuildInputsContent(null));
      return;
    }

    let cancelled = false;

    // Use async IIFE to handle the fetch and state updates
    const loadInputs = async () => {
      setBuildInputsLoading(true);
      try {
        const response = await fetchBuildInputs(blueprintFolder, selectedBuildId);
        if (!cancelled) {
          setBuildInputsContent(response.content);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to fetch build inputs:", error);
          setBuildInputsContent(null);
        }
      } finally {
        if (!cancelled) {
          setBuildInputsLoading(false);
        }
      }
    };

    void loadInputs();

    return () => {
      cancelled = true;
    };
  }, [blueprintFolder, selectedBuildId, selectedBuild?.hasInputsFile]);

  // Compute and set total layers from graph topology on load
  useEffect(() => {
    const layerCount = computeBlueprintLayerCount(graphData);
    setTotalLayers(layerCount);
  }, [graphData, setTotalLayers]);

  // Inputs panel is the inverse of blueprint flow
  const inputsPanelPercent = 100 - blueprintFlowPercent;

  // Determine if we should show the sidebar (only when blueprintFolder is available)
  const showSidebar = Boolean(blueprintFolder);

  // Parse build inputs from YAML content
  const parsedBuildInputs = useMemo<InputTemplateData | null>(() => {
    if (!buildInputsContent) return null;

    // Create a map of input definitions from graph for type/required info
    const inputDefMap = new Map<string, { type: string; required: boolean; description?: string }>();
    for (const inputDef of graphData.inputs) {
      inputDefMap.set(inputDef.name, {
        type: inputDef.type,
        required: inputDef.required,
        description: inputDef.description,
      });
    }

    // Simple YAML parsing for key-value pairs in the "inputs:" section
    const inputs: InputTemplateData["inputs"] = [];
    const lines = buildInputsContent.split("\n");
    let inInputsSection = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      // Check for section markers
      if (trimmed === "inputs:") {
        inInputsSection = true;
        continue;
      }
      if (trimmed.endsWith(":") && !trimmed.includes(" ")) {
        inInputsSection = false;
        continue;
      }

      // Parse key-value pairs in inputs section
      if (inInputsSection) {
        const colonIndex = trimmed.indexOf(":");
        if (colonIndex > 0) {
          const name = trimmed.slice(0, colonIndex).trim();
          let value: unknown = trimmed.slice(colonIndex + 1).trim();

          // Remove surrounding quotes and handle escapes
          if (typeof value === "string") {
            if (value.startsWith('"') && value.endsWith('"')) {
              // Double-quoted: handle escape sequences
              const inner = value.slice(1, -1);
              value = inner
                .replace(/\\n/g, "\n")
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, "\\");
            } else if (value.startsWith("'") && value.endsWith("'")) {
              // Single-quoted: no escape handling needed in YAML
              value = value.slice(1, -1);
            } else if (value === "true") {
              value = true;
            } else if (value === "false") {
              value = false;
            } else if (value !== "" && !isNaN(Number(value))) {
              value = Number(value);
            }
          }

          // Get type info from input definitions, with fallback
          const def = inputDefMap.get(name);
          inputs.push({
            name,
            value,
            type: def?.type ?? "string",
            required: def?.required ?? false,
            description: def?.description,
          });
        }
      }
    }

    return inputs.length > 0 ? { inputs } : null;
  }, [buildInputsContent, graphData.inputs]);

  // Parse model selections from YAML content or manifest
  const parsedModelSelections = useMemo<ModelSelectionValue[]>(() => {
    // First try to parse from inputs.yaml content
    if (buildInputsContent) {
      const models: ModelSelectionValue[] = [];
      const lines = buildInputsContent.split("\n");
      let inModelsSection = false;
      let inConfigSection = false;
      let currentModel: Partial<ModelSelectionValue> & { config?: Record<string, unknown> } = {};
      let configIndent = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        // Calculate indentation level
        const leadingSpaces = line.length - line.trimStart().length;

        // Check for section markers
        if (trimmed === "models:") {
          inModelsSection = true;
          inConfigSection = false;
          continue;
        }
        // Check for end of models section (another top-level key)
        if (inModelsSection && !line.startsWith(" ") && !line.startsWith("\t") && trimmed.endsWith(":")) {
          // Save the last model before exiting
          if (currentModel.producerId && currentModel.provider && currentModel.model) {
            models.push(currentModel as ModelSelectionValue);
          }
          inModelsSection = false;
          inConfigSection = false;
          continue;
        }

        // Parse items in models section (YAML array format)
        if (inModelsSection) {
          // Start of new array item
          if (trimmed.startsWith("- ")) {
            // Save previous model if complete
            if (currentModel.producerId && currentModel.provider && currentModel.model) {
              models.push(currentModel as ModelSelectionValue);
            }
            currentModel = {};
            inConfigSection = false;

            // Parse the first key-value on the same line as "-"
            const rest = trimmed.slice(2).trim();
            const colonIndex = rest.indexOf(":");
            if (colonIndex > 0) {
              const key = rest.slice(0, colonIndex).trim();
              const value = rest.slice(colonIndex + 1).trim();
              if (key === "producerId" || key === "provider" || key === "model") {
                currentModel[key] = value;
              } else if (key === "config" && value === "") {
                // Start of config section
                inConfigSection = true;
                currentModel.config = {};
                configIndent = leadingSpaces + 2; // Expect config items to be indented more
              }
            }
          } else {
            // Continuation of current item
            const colonIndex = trimmed.indexOf(":");
            if (colonIndex > 0) {
              const key = trimmed.slice(0, colonIndex).trim();
              const value = trimmed.slice(colonIndex + 1).trim();

              // Check if we're entering config section
              if (key === "config" && value === "") {
                inConfigSection = true;
                currentModel.config = {};
                configIndent = leadingSpaces + 2;
              } else if (inConfigSection && leadingSpaces >= configIndent) {
                // We're inside config section - parse config key-value
                if (currentModel.config) {
                  currentModel.config[key] = value;
                }
              } else if (inConfigSection && leadingSpaces < configIndent) {
                // We've exited config section
                inConfigSection = false;
                if (key === "producerId" || key === "provider" || key === "model") {
                  currentModel[key] = value;
                }
              } else if (key === "producerId" || key === "provider" || key === "model") {
                currentModel[key] = value;
              }
            }
          }
        }
      }

      // Don't forget the last model
      if (currentModel.producerId && currentModel.provider && currentModel.model) {
        models.push(currentModel as ModelSelectionValue);
      }

      if (models.length > 0) {
        return models;
      }
    }

    // Fall back to extracting from manifest inputs (for read-only builds)
    // Manifest inputs contain keys like "ProducerName.provider" and "ProducerName.model"
    // Also handles nested STT config: "ProducerName.sttProvider" and "ProducerName.sttModel"
    if (selectedBuildManifest?.inputs && Object.keys(selectedBuildManifest.inputs).length > 0) {
      const models: ModelSelectionValue[] = [];
      const inputs = selectedBuildManifest.inputs;

      // Group inputs by producer name to find provider/model pairs and config
      const producerData = new Map<string, {
        provider?: string;
        model?: string;
        sttProvider?: string;
        sttModel?: string;
      }>();

      for (const [key, value] of Object.entries(inputs)) {
        // Match patterns like "ProducerName.provider", "ProducerName.model",
        // "ProducerName.sttProvider", "ProducerName.sttModel"
        const providerMatch = key.match(/^(.+)\.provider$/);
        const modelMatch = key.match(/^(.+)\.model$/);
        const sttProviderMatch = key.match(/^(.+)\.sttProvider$/);
        const sttModelMatch = key.match(/^(.+)\.sttModel$/);

        if (providerMatch && typeof value === "string") {
          const producerId = providerMatch[1];
          const existing = producerData.get(producerId) ?? {};
          existing.provider = value;
          producerData.set(producerId, existing);
        } else if (modelMatch && typeof value === "string") {
          const producerId = modelMatch[1];
          const existing = producerData.get(producerId) ?? {};
          existing.model = value;
          producerData.set(producerId, existing);
        } else if (sttProviderMatch && typeof value === "string") {
          const producerId = sttProviderMatch[1];
          const existing = producerData.get(producerId) ?? {};
          existing.sttProvider = value;
          producerData.set(producerId, existing);
        } else if (sttModelMatch && typeof value === "string") {
          const producerId = sttModelMatch[1];
          const existing = producerData.get(producerId) ?? {};
          existing.sttModel = value;
          producerData.set(producerId, existing);
        }
      }

      // Convert to ModelSelectionValue array
      for (const [producerId, data] of producerData) {
        if (data.provider && data.model) {
          const selection: ModelSelectionValue = {
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
          models.push(selection);
        }
      }

      return models;
    }

    return [];
  }, [buildInputsContent, selectedBuildManifest]);

  // Merge input data from build inputs or manifest
  const effectiveInputData = useMemo<InputTemplateData | null>(() => {
    // Priority: build inputs file > manifest inputs > template inputs
    if (parsedBuildInputs) {
      return parsedBuildInputs;
    }
    // If we have a selected build manifest with inputs, use those
    if (selectedBuildManifest?.inputs && Object.keys(selectedBuildManifest.inputs).length > 0) {
      const manifestInputs = Object.entries(selectedBuildManifest.inputs).map(([name, value]) => ({
        name,
        value,
        type: typeof value === 'string' ? 'string' :
              typeof value === 'number' ? 'number' :
              typeof value === 'boolean' ? 'boolean' : 'unknown',
        required: true,
      }));
      return { inputs: manifestInputs };
    }
    // Fall back to the input data from file
    return inputData;
  }, [inputData, selectedBuildManifest, parsedBuildInputs]);

  // Check if inputs are editable (has build with inputs file selected)
  const isInputsEditable = Boolean(
    blueprintFolder && selectedBuildId && selectedBuild?.hasInputsFile
  );

  // Check if editing can be enabled (build selected but no inputs file)
  const canEnableEditing = Boolean(
    blueprintFolder && selectedBuildId && selectedBuild && !selectedBuild.hasInputsFile
  );

  // Handle enabling editing for a build
  const handleEnableEditing = useCallback(async () => {
    if (!blueprintFolder || !selectedBuildId) return;

    await enableBuildEditing(blueprintFolder, selectedBuildId);
    // Refresh builds list to update hasInputsFile flag
    if (onBuildsRefresh) {
      await onBuildsRefresh();
    }
  }, [blueprintFolder, selectedBuildId, onBuildsRefresh]);

  // Handle saving inputs
  const handleSaveInputs = useCallback(
    async (values: Record<string, unknown>) => {
      if (!blueprintFolder || !selectedBuildId) return;

      // Build YAML content from values
      // We need to preserve the structure of the original file
      const baseContent = buildInputsContent ?? "";

      // Simple approach: update/add values in the inputs section
      const lines = baseContent.split("\n");
      const newLines: string[] = [];
      let inInputsSection = false;
      const updatedKeys = new Set<string>();

      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed === "inputs:") {
          inInputsSection = true;
          newLines.push(line);
          continue;
        }

        if (inInputsSection && trimmed.endsWith(":") && !trimmed.includes(" ")) {
          // Entering a new section, first add any missing input values
          for (const [key, value] of Object.entries(values)) {
            if (!updatedKeys.has(key)) {
              newLines.push(`  ${key}: ${serializeYamlValue(value)}`);
              updatedKeys.add(key);
            }
          }
          inInputsSection = false;
        }

        if (inInputsSection) {
          const colonIndex = trimmed.indexOf(":");
          if (colonIndex > 0) {
            const key = trimmed.slice(0, colonIndex).trim();
            if (key in values) {
              const indent = line.match(/^(\s*)/)?.[1] ?? "  ";
              newLines.push(`${indent}${key}: ${serializeYamlValue(values[key])}`);
              updatedKeys.add(key);
              continue;
            }
          }
        }

        newLines.push(line);
      }

      // If still in inputs section at end, add any missing values
      if (inInputsSection) {
        for (const [key, value] of Object.entries(values)) {
          if (!updatedKeys.has(key)) {
            newLines.push(`  ${key}: ${serializeYamlValue(value)}`);
          }
        }
      }

      // If no inputs section existed, create one
      if (!buildInputsContent?.includes("inputs:")) {
        newLines.unshift("inputs:");
        for (const [key, value] of Object.entries(values)) {
          newLines.splice(1, 0, `  ${key}: ${serializeYamlValue(value)}`);
        }
      }

      const finalContent = newLines.join("\n");
      await saveBuildInputs(blueprintFolder, selectedBuildId, finalContent);
      setBuildInputsContent(finalContent);
    },
    [blueprintFolder, selectedBuildId, buildInputsContent]
  );

  // Handle saving models
  const handleSaveModels = useCallback(
    async (models: ModelSelectionValue[]) => {
      if (!blueprintFolder || !selectedBuildId) return;

      const baseContent = buildInputsContent ?? "";

      // Remove existing models section from content
      const lines = baseContent.split("\n");
      const newLines: string[] = [];
      let inModelsSection = false;

      for (const line of lines) {
        const trimmed = line.trim();

        // Check for models section start
        if (trimmed === "models:") {
          inModelsSection = true;
          continue; // Skip the models: line
        }

        // Check for end of models section (another top-level key)
        if (inModelsSection) {
          if (!line.startsWith(" ") && !line.startsWith("\t") && trimmed.endsWith(":") && trimmed !== "models:") {
            inModelsSection = false;
            newLines.push(line);
            continue;
          }
          // Skip lines in models section
          continue;
        }

        newLines.push(line);
      }

      // Build new models section (including config if present)
      const modelsYaml = models.map(m => {
        let yaml = `  - producerId: ${m.producerId}\n    provider: ${m.provider}\n    model: ${m.model}`;
        if (m.config && Object.keys(m.config).length > 0) {
          yaml += "\n    config:";
          for (const [key, value] of Object.entries(m.config)) {
            yaml += `\n      ${key}: ${value}`;
          }
        }
        return yaml;
      }).join("\n");

      // Append models section to content if we have any models
      let finalContent = newLines.join("\n").trimEnd();
      if (models.length > 0) {
        finalContent = finalContent + "\nmodels:\n" + modelsYaml + "\n";
      }

      await saveBuildInputs(blueprintFolder, selectedBuildId, finalContent);
      setBuildInputsContent(finalContent);
    },
    [blueprintFolder, selectedBuildId, buildInputsContent]
  );

  // Initialize producer statuses from manifest when build changes
  useEffect(() => {
    if (selectedBuildManifest?.artefacts) {
      initializeFromManifest(selectedBuildManifest.artefacts);
    }
  }, [selectedBuildManifest, initializeFromManifest]);

  // Track previous execution state to detect transitions
  const prevIsExecutingRef = useRef(isExecuting);
  const prevBottomPanelVisibleRef = useRef(state.bottomPanelVisible);

  // Auto-switch to Execution tab when execution starts or panel becomes visible
  // Only switch on transitions, use queueMicrotask to avoid synchronous setState in effect
  useEffect(() => {
    const shouldSwitch =
      (isExecuting && !prevIsExecutingRef.current) ||
      (state.bottomPanelVisible && !prevBottomPanelVisibleRef.current);

    prevIsExecutingRef.current = isExecuting;
    prevBottomPanelVisibleRef.current = state.bottomPanelVisible;

    if (shouldSwitch) {
      // Use queueMicrotask to defer the state update, avoiding synchronous setState warning
      queueMicrotask(() => setActiveTab('execution'));
    }
  }, [isExecuting, state.bottomPanelVisible]);

  const handleNodeSelect = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const relativeY = e.clientY - containerRect.top;
      // Calculate inputs panel percent from top, then derive blueprint flow percent
      const inputsPercent = (relativeY / containerRect.height) * 100;
      const flowPercent = 100 - inputsPercent;
      const clampedFlowPercent = Math.max(MIN_BLUEPRINT_FLOW_PERCENT, Math.min(MAX_BLUEPRINT_FLOW_PERCENT, flowPercent));
      setBlueprintFlowPercent(clampedFlowPercent);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  // Determine effective movie ID - use selected build or passed movieId
  const effectiveMovieId = selectedBuildId ?? movieId;

  // Create the Run button to pass to DetailPanel
  const runButton = (
    <RunButton blueprintName={blueprintName} movieId={effectiveMovieId ?? undefined} />
  );

  // Check if we have execution logs to show
  const hasExecutionLogs = state.executionLogs.length > 0;

  return (
    <div
      className="h-screen w-screen bg-background text-foreground p-4 flex flex-col"
      style={{ userSelect: isDragging ? "none" : "auto" }}
    >
      {/* Resizable panels wrapper */}
      <div ref={containerRef} className="flex-1 min-h-0 flex flex-col">
        {/* Top Panel: Sidebar + Detail Panel */}
        <div
          className="shrink-0 min-h-0 overflow-hidden flex gap-4"
          style={{ flexBasis: `${inputsPanelPercent}%`, maxHeight: `${inputsPanelPercent}%` }}
        >
          {/* Builds Sidebar (fixed width) */}
          {showSidebar && (
            <div className="w-64 shrink-0">
              <BuildsListSidebar
                builds={builds}
                selectedBuildId={selectedBuildId}
                isLoading={buildsLoading || buildInputsLoading}
                blueprintFolder={blueprintFolder}
                onRefresh={onBuildsRefresh}
              />
            </div>
          )}

          {/* Detail Panel (flexible width) */}
          <div className="flex-1 min-w-0">
            <DetailPanel
              graphData={graphData}
              inputData={effectiveInputData}
              selectedNodeId={selectedNodeId}
              movieId={effectiveMovieId}
              blueprintFolder={blueprintFolder}
              artifacts={selectedBuildManifest?.artefacts ?? []}
              actionButton={runButton}
              isInputsEditable={isInputsEditable}
              onSaveInputs={handleSaveInputs}
              canEnableEditing={canEnableEditing}
              onEnableEditing={handleEnableEditing}
              producerModels={producerModels}
              modelSelections={parsedModelSelections}
              onSaveModels={handleSaveModels}
            />
          </div>
        </div>

        {/* Resize Handle */}
        <div
          className="shrink-0 h-2 flex items-center justify-center cursor-row-resize group"
          onMouseDown={handleMouseDown}
        >
          <div className={`w-16 h-1 rounded-full transition-colors ${
            isDragging
              ? "bg-primary"
              : "bg-border/60 group-hover:bg-border"
          }`} />
        </div>

        {/* Bottom Panel with Tabs (Blueprint Flow or Execution) */}
        <div
          className="shrink-0 min-h-0 rounded-xl border border-border/40 overflow-hidden relative flex flex-col"
          style={{ flexBasis: `${blueprintFlowPercent}%`, maxHeight: `${blueprintFlowPercent}%` }}
        >
          {/* Tab Header */}
          <div className="flex items-center border-b border-border/40 bg-card/30 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('blueprint')}
              className={`px-4 py-2 text-sm font-medium transition-colors relative ${
                activeTab === 'blueprint'
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Blueprint
              {activeTab === 'blueprint' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('execution')}
              className={`px-4 py-2 text-sm font-medium transition-colors relative flex items-center gap-2 ${
                activeTab === 'execution'
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Execution
              {isExecuting && (
                <span className="flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                </span>
              )}
              {!isExecuting && hasExecutionLogs && (
                <span className="w-2 h-2 rounded-full bg-muted-foreground/50" />
              )}
              {activeTab === 'execution' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 min-h-0">
            {activeTab === 'blueprint' ? (
              <ReactFlowProvider>
                <BlueprintFlow
                  graphData={graphData}
                  onNodeSelect={handleNodeSelect}
                  producerStatuses={state.producerStatuses}
                />
              </ReactFlowProvider>
            ) : (
              <ExecutionProgressPanel
                logs={state.executionLogs}
                isExecuting={isExecuting}
              />
            )}
          </div>
        </div>
      </div>

      {/* Legend (only visible when Blueprint tab is active) */}
      {activeTab === 'blueprint' && (
        <div className="flex items-center text-xs text-muted-foreground pt-3 mt-3 border-t border-border/30 shrink-0">
          {/* Node types legend */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-blue-500/30 border border-blue-500/50" />
              <span>Input</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-3 rounded bg-card border border-border/60" />
              <span>Producer</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-purple-500/30 border border-purple-500/50" />
              <span>Output</span>
            </div>
            <div className="flex items-center gap-2 ml-4">
              <div className="w-8 h-0 border-t border-gray-400" />
              <span>Connection</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-0 border-t border-dashed border-amber-400" />
              <span>Conditional</span>
            </div>
          </div>
        </div>
      )}

      {/* Plan Dialog */}
      <PlanDialog />
    </div>
  );
}

/**
 * BlueprintViewer wrapped with ExecutionProvider.
 */
export function BlueprintViewer(props: BlueprintViewerProps) {
  return (
    <ExecutionProvider>
      <BlueprintViewerInner {...props} />
    </ExecutionProvider>
  );
}
