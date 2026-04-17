import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { DetailPanel } from './detail-panel';
import { BuildsListSidebar } from './builds-list-sidebar';
import { RunButton } from './run-button';
import { SwitchBlueprintDialog } from './switch-blueprint-dialog';
import { PlanDialog } from './plan-dialog';
import { CompletionDialog } from './completion-dialog';
import { BottomTabbedPanel } from './bottom-tabbed-panel';
import { ViewerPageHeader } from '@/components/layout/viewer-page-header';
import { ExecutionProvider, useExecution } from '@/contexts/execution-context';
import { computeBlueprintLayerCount } from '@/lib/blueprint-layout';
import { cn } from '@/lib/utils';
import { enableBuildEditing } from '@/data/blueprint-client';
import {
  useBuildInputs,
  useProducerModels,
  useProducerConfigSchemas,
  useProducerConfigState,
  useProducerPrompts,
  usePanelResizer,
  useBottomPanelTabs,
  usePreviewPlayback,
  useModelSelectionEditor,
  useProducerFieldPreview,
} from '@/hooks';
import { useMovieTimeline } from '@/services/use-movie-timeline';
import type {
  BlueprintGraphData,
  InputTemplateData,
  ModelSelectionValue,
} from '@/types/blueprint-graph';
import type { BuildInfo, BuildStateResponse } from '@/types/builds';

type DetailPanelTab = 'inputs' | 'models' | 'outputs' | 'storyboard' | 'preview';

interface WorkspaceLayoutProps {
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
  /** Build-state data for the selected build */
  selectedBuildState: BuildStateResponse | null;
  /** Callback to refresh builds list */
  onBuildsRefresh?: () => Promise<void>;
  /** Callback to refresh the selected build state (after artifact edits) */
  onBuildStateRefresh?: () => void;
}

// Blueprint flow panel sizing (the graph at the bottom)
const MIN_BLUEPRINT_FLOW_PERCENT = 30;
const MAX_BLUEPRINT_FLOW_PERCENT = 70;
const DEFAULT_BLUEPRINT_FLOW_PERCENT = 30;
const HEADER_RESERVED_SPACE_PX = 62;
const HEADER_REVEAL_TRIGGER_Y_PX = 8;
const TOUCH_HEADER_REVEAL_TRIGGER_Y_PX = 24;
const HEADER_HIDE_THRESHOLD_Y_PX = 96;
const HEADER_ANIMATION_CLASS =
  'transition-[transform,opacity,padding-top] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]';

/**
 * Inner component that uses the execution context.
 */
function WorkspaceLayoutInner({
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
  selectedBuildState,
  onBuildsRefresh,
  onBuildStateRefresh,
}: WorkspaceLayoutProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [detailPanelTab, setDetailPanelTab] =
    useState<DetailPanelTab>('inputs');
  const [isHeaderPinned, setIsHeaderPinned] = useState(true);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const { state, initializeFromManifest, setTotalLayers, setLayerRange } =
    useExecution();
  const isExecuting = state.status === 'executing';

  // Tab state management with auto-switching
  const { activeTab: bottomActiveTab, setActiveTab: setBottomActiveTab } =
    useBottomPanelTabs({
      isExecuting,
      bottomPanelVisible: state.bottomPanelVisible,
    });

  // Find the selected build to check if it has inputs
  const selectedBuild = useMemo(
    () => builds.find((b) => b.movieId === selectedBuildId),
    [builds, selectedBuildId]
  );
  const selectedBuildHasInputs = selectedBuild?.hasInputsFile ?? false;

  // Custom hooks for data fetching and panel resizing
  const { producerModels } = useProducerModels({
    blueprintPath,
    catalogRoot,
  });

  const { configSchemas, errorsByProducer: configErrorsByProducer } =
    useProducerConfigSchemas({
      blueprintPath,
      catalogRoot,
    });

  const {
    inputs: buildInputs,
    models: buildModels,
    isLoading: buildInputsLoading,
    hasLoadedInputs,
    saveInputs: handleSaveInputs,
    saveModels: handleSaveModels,
  } = useBuildInputs({
    blueprintFolder,
    blueprintPath,
    selectedBuildId,
    hasInputsFile: selectedBuildHasInputs,
    catalogRoot,
  });
  const isInputValuesLoading = selectedBuildHasInputs && buildInputsLoading;

  const {
    percent: blueprintFlowPercent,
    isDragging,
    handleMouseDown,
  } = usePanelResizer({
    containerRef,
    minPercent: MIN_BLUEPRINT_FLOW_PERCENT,
    maxPercent: MAX_BLUEPRINT_FLOW_PERCENT,
    defaultPercent: DEFAULT_BLUEPRINT_FLOW_PERCENT,
  });

  // Compute and set total layers from graph topology on load
  useEffect(() => {
    const layerCount = computeBlueprintLayerCount(graphData);
    setTotalLayers(layerCount);
  }, [graphData, setTotalLayers]);

  useEffect(() => {
    setIsHeaderVisible(isHeaderPinned);
  }, [isHeaderPinned]);

  useEffect(() => {
    if (isHeaderPinned) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') {
        return;
      }

      if (event.clientY <= HEADER_REVEAL_TRIGGER_Y_PX) {
        setIsHeaderVisible((previous) => (previous ? previous : true));
        return;
      }

      if (event.clientY > HEADER_HIDE_THRESHOLD_Y_PX) {
        setIsHeaderVisible((previous) => (previous ? false : previous));
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') {
        return;
      }

      if (event.clientY <= TOUCH_HEADER_REVEAL_TRIGGER_Y_PX) {
        setIsHeaderVisible((previous) => (previous ? previous : true));
        return;
      }

      if (event.clientY > HEADER_HIDE_THRESHOLD_Y_PX) {
        setIsHeaderVisible((previous) => (previous ? false : previous));
      }
    };

    const handleMouseLeave = () => {
      setIsHeaderVisible(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [isHeaderPinned]);

  // Inputs panel is the inverse of blueprint flow
  const inputsPanelPercent = 100 - blueprintFlowPercent;

  // Determine if we should show the sidebar (only when blueprintFolder is available)
  const showSidebar = Boolean(blueprintFolder);

  // Convert parsed build inputs to InputTemplateData format
  const parsedBuildInputs = useMemo<InputTemplateData | null>(() => {
    if (!buildInputs || Object.keys(buildInputs).length === 0) return null;

    // Create a map of input definitions from graph for type/required info
    const inputDefMap = new Map<
      string,
      { type: string; required: boolean; description?: string }
    >();
    for (const inputDef of graphData.inputs) {
      inputDefMap.set(inputDef.name, {
        type: inputDef.type,
        required: inputDef.required,
        description: inputDef.description,
      });
    }

    // Convert server response to InputTemplateData format
    const inputs: InputTemplateData['inputs'] = [];
    for (const [name, value] of Object.entries(buildInputs)) {
      // Get type info from input definitions, with fallback
      const def = inputDefMap.get(name);
      inputs.push({
        name,
        value,
        type: def?.type ?? 'string',
        required: def?.required ?? false,
        description: def?.description,
      });
    }

    return inputs.length > 0 ? { inputs } : null;
  }, [buildInputs, graphData.inputs]);

  // Model selections: prioritize editable build inputs, then stored build-state models
  const parsedModelSelections = useMemo<ModelSelectionValue[]>(() => {
    // Use models from build inputs if available (editable builds)
    if (buildModels.length > 0) {
      return buildModels;
    }

    return selectedBuildState?.models ?? [];
  }, [buildModels, selectedBuildState?.models]);

  // Use the model selection editor hook for single source of truth
  const modelEditor = useModelSelectionEditor({
    savedSelections: parsedModelSelections,
    onSave: handleSaveModels,
  });

  // Merge input data from editable build inputs or read-only build state
  const effectiveInputData = useMemo<InputTemplateData | null>(() => {
    // For editable builds, never fall back to stored/template values.
    // Wait until build inputs are loaded to avoid writing fallback/template content.
    if (selectedBuildHasInputs) {
      if (!hasLoadedInputs) {
        return null;
      }
      return parsedBuildInputs;
    }

    // If we have a selected build state with inputs, use those
    if (
      selectedBuildState?.inputs &&
      Object.keys(selectedBuildState.inputs).length > 0
    ) {
      const buildStateInputs = Object.entries(selectedBuildState.inputs).map(
        ([name, value]) => ({
          name,
          value,
          type:
            typeof value === 'string'
              ? 'string'
              : typeof value === 'number'
                ? 'number'
                : typeof value === 'boolean'
                  ? 'boolean'
                  : 'unknown',
          required: true,
        })
      );
      return { inputs: buildStateInputs };
    }
    // Fall back to the input data from file
    return inputData;
  }, [
    inputData,
    selectedBuildHasInputs,
    selectedBuildState,
    parsedBuildInputs,
    hasLoadedInputs,
  ]);

  // Check if inputs are editable (has build with inputs file selected)
  const isInputsEditable = Boolean(
    blueprintFolder &&
      selectedBuildId &&
      selectedBuild?.hasInputsFile &&
      hasLoadedInputs
  );

  // Check if editing can be enabled (build selected but no inputs file)
  const canEnableEditing = Boolean(
    blueprintFolder &&
      selectedBuildId &&
      selectedBuild &&
      !selectedBuild.hasInputsFile
  );

  // Fetch prompts for prompt-type producers (only when editing is enabled)
  const { promptDataByProducer, savePrompt: handleSavePrompt } =
    useProducerPrompts({
      blueprintFolder,
      blueprintPath,
      movieId: selectedBuildId,
      producerModels,
      catalogRoot,
      enabled: isInputsEditable,
    });

  // Compute config properties and values using the dedicated hook
  const { configFieldsByProducer, configValuesByProducer } =
    useProducerConfigState({
      configSchemas,
      currentSelections: modelEditor.currentSelections,
    });

  const previewInputs = useMemo<Record<string, unknown>>(() => {
    if (!effectiveInputData) {
      return {};
    }

    const values: Record<string, unknown> = {};
    for (const entry of effectiveInputData.inputs) {
      if (entry.value === undefined) {
        continue;
      }
      values[entry.name] = entry.value;
    }
    return values;
  }, [effectiveInputData]);

  const { fieldPreviewByProducer, fieldPreviewErrorsByProducer } =
    useProducerFieldPreview({
      blueprintPath,
      blueprintFolder,
      movieId: selectedBuildId ?? movieId,
      catalogRoot,
      inputs: previewInputs,
      modelSelections: modelEditor.currentSelections,
      enabled: modelEditor.currentSelections.length > 0,
    });

  // Handle enabling editing for a build
  const handleEnableEditing = useCallback(async () => {
    if (!blueprintFolder || !selectedBuildId) return;

    await enableBuildEditing(blueprintFolder, selectedBuildId);
    // Refresh builds list to update hasInputsFile flag
    if (onBuildsRefresh) {
      await onBuildsRefresh();
    }
  }, [blueprintFolder, selectedBuildId, onBuildsRefresh]);

  // Handle config value changes - delegate to hook
  const handleConfigChange = useCallback(
    (producerId: string, key: string, value: unknown) => {
      modelEditor.updateConfig(producerId, key, value);
    },
    [modelEditor]
  );

  // Initialize producer statuses from build state when build changes
  // Skip during execution to avoid SSE-driven status badges being overwritten
  useEffect(() => {
    if (state.status === 'executing') {
      return;
    }
    if (selectedBuildState?.artifacts) {
      initializeFromManifest(selectedBuildState.artifacts);
    }
  }, [selectedBuildState, initializeFromManifest, state.status]);

  const handleNodeSelect = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
  }, []);

  const handleToggleHeaderPin = useCallback(() => {
    setIsHeaderPinned((previous) => !previous);
  }, []);

  const handleLayerSelect = useCallback(
    (layerIndex: number) => {
      setLayerRange({ upToLayer: layerIndex });
    },
    [setLayerRange]
  );

  // Determine effective movie ID - use selected build or passed movieId
  const effectiveMovieId = selectedBuildId ?? movieId;

  // Create action button to pass to DetailPanel
  const runButton = (
    <RunButton
      blueprintName={blueprintName}
      movieId={effectiveMovieId ?? undefined}
    />
  );

  // Check if we have execution logs to show
  const hasExecutionLogs = state.executionLogs.length > 0;

  // Check if the selected build has a timeline artifact
  const hasTimeline = useMemo(() => {
    const artifacts = selectedBuildState?.artifacts;
    if (!artifacts) return false;
    // Check for timeline artifact (id contains "Timeline")
    return artifacts.some((a) => a.id.includes('Timeline'));
  }, [selectedBuildState?.artifacts]);

  // Lift timeline and playback state for syncing between Preview and Timeline panels
  const {
    timeline,
    status: timelineStatus,
    error: timelineError,
    retry: retryTimeline,
  } = useMovieTimeline(
    hasTimeline ? blueprintFolder : null,
    hasTimeline ? effectiveMovieId : null,
    hasTimeline ? (selectedBuildState?.revision ?? null) : null
  );
  const { currentTime, isPlaying, play, pause, seek, reset } =
    usePreviewPlayback(effectiveMovieId);

  const handleDetailTabChange = useCallback(
    (tab: DetailPanelTab) => {
      setDetailPanelTab(tab);
      if (tab === 'preview') {
        setBottomActiveTab('timeline');
      }
    },
    [setBottomActiveTab]
  );

  // Handle bottom panel tab changes with coordination to detail panel
  const handleBottomTabChange = useCallback(
    (tab: typeof bottomActiveTab) => {
      setBottomActiveTab(tab);
      if (tab === 'timeline') {
        setDetailPanelTab('preview');
      }
    },
    [setBottomActiveTab]
  );

  const showHeader = isHeaderPinned || isHeaderVisible;

  return (
    <div
      className='h-screen w-screen bg-background text-foreground p-3 flex flex-col'
      style={{ userSelect: isDragging ? 'none' : 'auto' }}
    >
      <div className='relative flex-1 min-h-0'>
        <div
          className={cn(
            'absolute inset-x-0 top-0 z-30',
            HEADER_ANIMATION_CLASS,
            showHeader
              ? 'translate-y-0 opacity-100'
              : '-translate-y-[calc(100%+14px)] opacity-0 pointer-events-none'
          )}
        >
          <ViewerPageHeader
            subtitle='Workspace'
            showSettingsButton
            showPinButton
            isPinned={isHeaderPinned}
            onPinToggle={handleToggleHeaderPin}
            beforeThemeContent={
              <SwitchBlueprintDialog currentBlueprintName={blueprintName} />
            }
            className={cn(!isHeaderPinned && 'shadow-xl')}
          />
        </div>

        <div
          className={cn('h-full min-h-0', HEADER_ANIMATION_CLASS)}
          style={{ paddingTop: isHeaderPinned ? HEADER_RESERVED_SPACE_PX : 0 }}
        >
          {/* Resizable panels wrapper */}
          <div ref={containerRef} className='h-full min-h-0 flex flex-col'>
            {/* Top Panel: Sidebar + Detail Panel */}
            <div
              className='shrink-0 min-h-0 overflow-hidden flex gap-4'
              style={{
                flexBasis: `${inputsPanelPercent}%`,
                maxHeight: `${inputsPanelPercent}%`,
              }}
            >
              {/* Builds Sidebar (fixed width) */}
              {showSidebar && (
                <div className='w-64 shrink-0'>
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
              <div className='flex-1 min-w-0'>
                <DetailPanel
                  graphData={graphData}
                  inputData={effectiveInputData}
                  isInputValuesLoading={isInputValuesLoading}
                  selectedNodeId={selectedNodeId}
                  movieId={effectiveMovieId}
                  blueprintFolder={blueprintFolder}
                  blueprintPath={blueprintPath}
                  catalogRoot={catalogRoot}
                  artifacts={selectedBuildState?.artifacts ?? []}
                  actionButton={runButton}
                  isInputsEditable={isInputsEditable}
                  onSaveInputs={handleSaveInputs}
                  canEnableEditing={canEnableEditing}
                  onEnableEditing={handleEnableEditing}
                  buildInputs={buildInputs}
                  producerModels={producerModels}
                  modelSelections={modelEditor.currentSelections}
                  promptDataByProducer={promptDataByProducer}
                  onPromptChange={handleSavePrompt}
                  configFieldsByProducer={configFieldsByProducer}
                  configValuesByProducer={configValuesByProducer}
                  configSchemasByProducer={configSchemas}
                  configErrorsByProducer={configErrorsByProducer}
                  fieldPreviewByProducer={fieldPreviewByProducer}
                  fieldPreviewErrorsByProducer={fieldPreviewErrorsByProducer}
                  onConfigChange={handleConfigChange}
                  modelEditor={modelEditor}
                  hasTimeline={hasTimeline}
                  activeTab={detailPanelTab}
                  onTabChange={handleDetailTabChange}
                  timeline={timeline}
                  timelineStatus={timelineStatus}
                  timelineError={timelineError}
                  currentTime={currentTime}
                  isPlaying={isPlaying}
                  onPlay={play}
                  onPause={pause}
                  onSeek={seek}
                  onReset={reset}
                  onRetryTimeline={retryTimeline}
                  onArtifactUpdated={onBuildStateRefresh}
                />
              </div>
            </div>

            {/* Resize Handle */}
            <div
              className='shrink-0 h-2 flex items-center justify-center cursor-row-resize group'
              onMouseDown={handleMouseDown}
            >
              <div
                className={`w-16 h-1 rounded-full transition-colors ${
                  isDragging
                    ? 'bg-primary'
                    : 'bg-border/60 group-hover:bg-border'
                }`}
              />
            </div>

            {/* Bottom Panel with Tabs (Blueprint Flow, Execution, or Timeline) */}
            <div
              className='shrink-0 min-h-0 rounded-[var(--radius-panel)] border border-sidebar-border overflow-hidden relative flex flex-col bg-sidebar-bg'
              style={{
                flexBasis: `${blueprintFlowPercent}%`,
                maxHeight: `${blueprintFlowPercent}%`,
              }}
            >
              <BottomTabbedPanel
                activeTab={bottomActiveTab}
                onTabChange={handleBottomTabChange}
                isExecuting={isExecuting}
                hasLogs={hasExecutionLogs}
                graphData={graphData}
                blueprintName={blueprintName}
                selectedUpToLayer={state.layerRange.upToLayer}
                onLayerSelect={handleLayerSelect}
                onNodeSelect={handleNodeSelect}
                producerStatuses={state.producerStatuses}
                executionLogs={state.executionLogs}
                timeline={timeline}
                timelineStatus={timelineStatus}
                timelineError={timelineError}
                blueprintFolder={blueprintFolder}
                currentTime={currentTime}
                isPlaying={isPlaying}
                onPlay={play}
                onPause={pause}
                onSeek={seek}
                hasTimeline={hasTimeline}
                movieId={effectiveMovieId}
                onRetryTimeline={retryTimeline}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Plan Dialog */}
      <PlanDialog />

      {/* Completion Dialog */}
      <CompletionDialog />
    </div>
  );
}

/**
 * WorkspaceLayout wrapped with ExecutionProvider.
 */
export function WorkspaceLayout(props: WorkspaceLayoutProps) {
  return (
    <ExecutionProvider onArtifactProduced={props.onBuildStateRefresh}>
      <WorkspaceLayoutInner {...props} />
    </ExecutionProvider>
  );
}
