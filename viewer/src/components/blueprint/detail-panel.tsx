import { useState, useCallback } from 'react';
import { InputsPanel } from './inputs-panel';
import { ModelsPanel } from './models-panel';
import { OutputsPanel } from './outputs-panel';
import { PreviewPanel } from './preview-panel';
import { ReadOnlyIndicator } from './shared';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import type {
  BlueprintGraphData,
  InputTemplateData,
  ModelSelectionValue,
  ProducerModelInfo,
  PromptData,
  ConfigProperty,
  ProducerConfigSchemas,
} from '@/types/blueprint-graph';
import type { UseModelSelectionEditorResult } from '@/hooks';
import type { ArtifactInfo } from '@/types/builds';
import type { TimelineDocument } from '@/types/timeline';
import type { ReactNode } from 'react';

type Tab = 'inputs' | 'models' | 'outputs' | 'preview';
type TimelineStatus = 'idle' | 'loading' | 'success' | 'error';

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
  /** Current model selections (merged saved + edits from hook) */
  modelSelections?: ModelSelectionValue[];
  /** Prompt data per producer (for prompt producers) */
  promptDataByProducer?: Record<string, PromptData>;
  /** Callback when prompts change */
  onPromptChange?: (producerId: string, prompts: PromptData) => Promise<void>;
  /** Config properties per producer */
  configPropertiesByProducer?: Record<string, ConfigProperty[]>;
  /** Config values per producer */
  configValuesByProducer?: Record<string, Record<string, unknown>>;
  /** Config schemas per producer (for nested model detection) */
  configSchemasByProducer?: Record<string, ProducerConfigSchemas>;
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
  promptDataByProducer = {},
  onPromptChange,
  configPropertiesByProducer = {},
  configValuesByProducer = {},
  configSchemasByProducer = {},
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
  onArtifactUpdated,
}: DetailPanelProps) {
  // Support both controlled and uncontrolled tab state
  const [internalActiveTab, setInternalActiveTab] = useState<Tab>('inputs');
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
      : activeTab === 'models' || activeTab === 'outputs'
        ? 'flex-1 min-h-0 overflow-hidden p-4'
        : 'flex-1 overflow-auto p-4';

  return (
    <div className='flex flex-col h-full bg-sidebar-bg rounded-[var(--radius-panel)] border border-panel-border overflow-hidden'>
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
            label='Preview'
            active={activeTab === 'preview'}
            onClick={() => setActiveTab('preview')}
          />
        </div>

        {/* Right side: read-only indicator, action button, and theme toggle */}
        <div className='ml-auto flex items-center gap-2 pr-3'>
          {showReadOnlyIndicator && (
            <ReadOnlyIndicator
              onEnableEditing={handleEnableEditing}
              isEnabling={isEnabling}
            />
          )}
          {actionButton}
          <ThemeToggle />
        </div>
      </div>

      {/* Tab content */}
      <div className={contentContainerClassName}>
        {activeTab === 'inputs' && (
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
        {activeTab === 'models' && (
          <ModelsPanel
            producerModels={producerModels}
            modelSelections={modelSelections}
            selectedNodeId={selectedNodeId}
            isEditable={isInputsEditable}
            canEnableEditing={canEnableEditing}
            onEnableEditing={onEnableEditing}
            onSelectionChange={handleModelChange}
            hideHeader={true}
            promptDataByProducer={promptDataByProducer}
            onPromptChange={onPromptChange}
            configPropertiesByProducer={configPropertiesByProducer}
            configValuesByProducer={configValuesByProducer}
            configSchemasByProducer={configSchemasByProducer}
            onConfigChange={onConfigChange}
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
        <div className='absolute bottom-0 left-0 right-0 h-[2px] bg-primary' />
      )}
    </button>
  );
}
