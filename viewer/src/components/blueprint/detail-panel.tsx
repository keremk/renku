import { useState, useCallback } from 'react';
import { InputsPanel } from './inputs-panel';
import { ModelsPanel } from './models-panel';
import { OutputsPanel } from './outputs-panel';
import { PreviewPanel } from './preview-panel';
import { StoryboardPanel } from './storyboard-panel';
import { ReadOnlyIndicator } from './shared';
import type {
  BlueprintGraphData,
  InputTemplateData,
  ModelSelectionValue,
  ProducerModelInfo,
  ProducerContractError,
  PromptData,
  ConfigFieldDescriptor,
  ProducerConfigSchemas,
  ProducerFieldPreviewEntry,
} from '@/types/blueprint-graph';
import type { UseModelSelectionEditorResult } from '@/hooks';
import type { ArtifactInfo } from '@/types/builds';
import type { TimelineDocument } from '@/types/timeline';
import type { ReactNode } from 'react';

type Tab = 'inputs' | 'models' | 'outputs' | 'storyboard' | 'preview';
type TimelineStatus = 'idle' | 'loading' | 'success' | 'error';

interface DetailPanelProps {
  graphData: BlueprintGraphData;
  inputData: InputTemplateData | null;
  isInputValuesLoading?: boolean;
  selectedNodeId: string | null;
  movieId: string | null;
  blueprintFolder: string | null;
  blueprintPath: string;
  catalogRoot?: string | null;
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
  /** Resolved build inputs (keyed by canonical input IDs) */
  buildInputs?: Record<string, unknown> | null;
  /** Available models per producer from API */
  producerModels?: Record<string, ProducerModelInfo>;
  /** Current model selections (merged saved + edits from hook) */
  modelSelections?: ModelSelectionValue[];
  /** Prompt data per producer (for prompt producers) */
  promptDataByProducer?: Record<string, PromptData>;
  /** Callback when prompts change */
  onPromptChange?: (producerId: string, prompts: PromptData) => Promise<void>;
  /** Config field descriptors per producer */
  configFieldsByProducer?: Record<string, ConfigFieldDescriptor[]>;
  /** Config values per producer */
  configValuesByProducer?: Record<string, Record<string, unknown>>;
  /** Config schemas per producer (for nested model detection) */
  configSchemasByProducer?: Record<string, ProducerConfigSchemas>;
  /** Producer-level config contract errors */
  configErrorsByProducer?: Record<string, ProducerContractError>;
  /** Resolution/aspect/size producer field preview values per producer */
  fieldPreviewByProducer?: Record<string, ProducerFieldPreviewEntry>;
  /** Producer-level preview contract/runtime errors */
  fieldPreviewErrorsByProducer?: Record<string, ProducerContractError>;
  /** Callback when config values change */
  onConfigChange?: (producerId: string, key: string, value: unknown) => void;
  /** Model selection editor (manages state and auto-save) */
  modelEditor?: UseModelSelectionEditorResult;
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
  onRetryTimeline?: () => void;
  /** Callback when an artifact is edited or restored */
  onArtifactUpdated?: () => void;
}

export function DetailPanel({
  graphData,
  inputData,
  isInputValuesLoading = false,
  selectedNodeId,
  movieId,
  blueprintFolder,
  blueprintPath,
  catalogRoot = null,
  artifacts,
  actionButton,
  isInputsEditable = false,
  onSaveInputs,
  canEnableEditing = false,
  onEnableEditing,
  buildInputs,
  producerModels = {},
  modelSelections = [],
  promptDataByProducer = {},
  onPromptChange,
  configFieldsByProducer = {},
  configValuesByProducer = {},
  configSchemasByProducer = {},
  configErrorsByProducer = {},
  fieldPreviewByProducer = {},
  fieldPreviewErrorsByProducer = {},
  onConfigChange,
  modelEditor,
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
  onRetryTimeline,
  onArtifactUpdated,
}: DetailPanelProps) {
  // Support both controlled and uncontrolled tab state
  const [internalActiveTab, setInternalActiveTab] = useState<Tab>('inputs');
  const activeTab = controlledActiveTab ?? internalActiveTab;
  const setActiveTab = onTabChange ?? setInternalActiveTab;
  const [activeProducerId, setActiveProducerId] = useState<string | null>(null);

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

  // Handle model selection changes - delegate to model editor hook
  const handleModelChange = useCallback(
    (selection: ModelSelectionValue) => {
      modelEditor?.updateSelection(selection);
    },
    [modelEditor]
  );

  const contentContainerClassName =
    activeTab === 'preview'
      ? 'flex-1 overflow-hidden'
      : activeTab === 'models' ||
          activeTab === 'storyboard' ||
          activeTab === 'outputs'
        ? 'flex-1 min-h-0 overflow-hidden p-4'
        : 'flex-1 overflow-auto p-4';

  return (
    <div className='flex flex-col h-full bg-sidebar-bg rounded-(--radius-panel) border border-panel-border overflow-hidden'>
      {/* Tab buttons */}
      <div className='flex items-center h-[45px] border-b border-border/40 bg-sidebar-header-bg shrink-0'>
        <div className='flex h-full'>
          <TabButton
            label='Inputs'
            active={activeTab === 'inputs'}
            onClick={() => setActiveTab('inputs')}
          />
          <TabButton
            label='Models'
            active={activeTab === 'models'}
            onClick={() => setActiveTab('models')}
          />
          <TabButton
            label='Outputs'
            active={activeTab === 'outputs'}
            onClick={() => setActiveTab('outputs')}
          />
          <TabButton
            label='Storyboard'
            active={activeTab === 'storyboard'}
            onClick={() => setActiveTab('storyboard')}
          />
          <TabButton
            label='Preview'
            active={activeTab === 'preview'}
            onClick={() => setActiveTab('preview')}
          />
        </div>

        {/* Right side: read-only indicator and action button */}
        <div className='ml-auto flex items-center gap-2 pr-3'>
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
      <div className={contentContainerClassName}>
        {activeTab === 'inputs' && (
          <InputsPanel
            inputs={graphData.inputs}
            loopGroups={graphData.loopGroups}
            managedCountInputs={graphData.managedCountInputs}
            inputValues={inputData?.inputs}
            isInputValuesLoading={isInputValuesLoading}
            selectedNodeId={selectedNodeId}
            isEditable={isInputsEditable}
            onSave={onSaveInputs}
            blueprintFolder={blueprintFolder}
            movieId={movieId}
          />
        )}
        {activeTab === 'models' && (
          <ModelsPanel
            producerModels={producerModels}
            graphData={graphData}
            modelSelections={modelSelections}
            selectedNodeId={selectedNodeId}
            isEditable={isInputsEditable}
            canEnableEditing={canEnableEditing}
            onEnableEditing={onEnableEditing}
            onSelectionChange={handleModelChange}
            hideHeader={true}
            promptDataByProducer={promptDataByProducer}
            onPromptChange={onPromptChange}
            configFieldsByProducer={configFieldsByProducer}
            configValuesByProducer={configValuesByProducer}
            configSchemasByProducer={configSchemasByProducer}
            configErrorsByProducer={configErrorsByProducer}
            fieldPreviewByProducer={fieldPreviewByProducer}
            fieldPreviewErrorsByProducer={fieldPreviewErrorsByProducer}
            onConfigChange={onConfigChange}
            blueprintFolder={blueprintFolder}
            movieId={movieId}
            activeProducerId={activeProducerId}
            onActiveProducerChange={setActiveProducerId}
          />
        )}
        {activeTab === 'outputs' && (
          <OutputsPanel
            outputs={graphData.outputs}
            selectedNodeId={selectedNodeId}
            movieId={movieId}
            blueprintFolder={blueprintFolder}
            artifacts={artifacts}
            graphData={graphData}
            producerModels={producerModels}
            modelSelections={modelSelections}
            buildInputs={buildInputs}
            onArtifactUpdated={onArtifactUpdated}
            activeProducerId={activeProducerId}
            onActiveProducerChange={setActiveProducerId}
          />
        )}
        {activeTab === 'storyboard' && (
          <StoryboardPanel
            blueprintPath={blueprintPath}
            blueprintFolder={blueprintFolder}
            movieId={movieId}
            catalogRoot={catalogRoot}
            artifacts={artifacts}
            graphData={graphData}
            buildInputs={buildInputs}
            isInputsEditable={isInputsEditable}
            onSaveInputs={onSaveInputs}
            producerModels={producerModels}
            modelSelections={modelSelections}
            onArtifactUpdated={onArtifactUpdated}
          />
        )}
        {activeTab === 'preview' && (
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
            onRetryTimeline={onRetryTimeline}
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
      type='button'
      onClick={onClick}
      className={`
        relative flex items-center gap-2 px-4 h-full text-[11px] uppercase tracking-[0.12em] font-semibold transition-colors
        ${
          active
            ? 'text-foreground bg-item-active-bg'
            : 'text-muted-foreground hover:text-foreground hover:bg-item-hover-bg'
        }
      `}
    >
      {label}
      {active && (
        <div className='absolute bottom-0 left-0 right-0 h-0.5 bg-primary' />
      )}
    </button>
  );
}
