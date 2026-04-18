import {
  Fragment,
  useState,
  useEffect,
  useMemo,
  useCallback,
  type ComponentProps,
  type ReactNode,
} from 'react';
import {
  Download,
  ExternalLink,
  Copy,
  FolderOpen,
  File,
  RefreshCw,
  Square,
  CheckSquare,
  Check,
  Pencil,
  RotateCcw,
  Pin,
  PinOff,
  AlertCircle,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  shortenArtifactDisplayName,
  groupArtifactsByProducer,
  classifyAndGroupArtifacts,
  getArtifactLabel,
  getBlobUrl,
  resolveArtifactProducerNodeId,
  type ArtifactSubGroup,
} from '@/lib/artifact-utils';
import { resolveAudioInputBindingSource } from '@/lib/audio-input-binding-resolver';
import { resolvePromptArtifactForMedia } from '@/lib/artifact-prompt-resolver';
import { ObjectArraySection } from './outputs/object-array-section';
import {
  getOutputNameFromNodeId,
  formatProducerDisplayName,
  sortProducerIdsByExecutionFlow,
} from '@/lib/panel-utils';
import { useExecution } from '@/contexts/execution-context';
import {
  MediaCard,
  MediaGrid,
  CollapsibleSection,
  CardActionsFooter,
  ProducerNavigationPane,
  TextEditorDialog,
  SyntaxPreview,
  VideoCard,
  AudioCard,
  ImageCard,
  ImageEditDialog,
  VideoEditDialog,
  AudioEditDialog,
  MusicEditDialog,
  type CardAction,
} from './shared';
import { EditedBadge } from './outputs/edited-badge';
import { SkippedBadge } from './outputs/skipped-badge';
import {
  applyArtifactPreview,
  deleteArtifactPreview,
  editArtifactFile,
  editArtifactText,
  estimateArtifactPreview,
  fetchArtifactPreviewEditModels,
  generateArtifactPreview,
  openArtifactsProducerFolder,
  restoreArtifact,
} from '@/data/blueprint-client';
import type {
  BlueprintOutputDef,
  BlueprintGraphData,
  ProducerModelInfo,
  AvailableModelOption,
  ModelSelectionValue,
} from '@/types/blueprint-graph';
import type { ArtifactInfo } from '@/types/builds';

interface OutputsPanelProps {
  outputs: BlueprintOutputDef[];
  selectedNodeId: string | null;
  movieId: string | null;
  blueprintFolder: string | null;
  artifacts: ArtifactInfo[];
  graphData?: BlueprintGraphData;
  producerModels?: Record<string, ProducerModelInfo>;
  modelSelections?: ModelSelectionValue[];
  /** Resolved build inputs (keyed by canonical input IDs like Input:Producer.Key) */
  buildInputs?: Record<string, unknown> | null;
  /** Callback when an artifact is edited or restored */
  onArtifactUpdated?: () => void;
  /** Shared active producer selection across detail tabs */
  activeProducerId?: string | null;
  /** Callback when the active producer changes */
  onActiveProducerChange?: (producerId: string) => void;
}

export function OutputsPanel({
  outputs,
  selectedNodeId,
  movieId,
  blueprintFolder,
  artifacts,
  graphData,
  producerModels,
  modelSelections,
  buildInputs,
  onArtifactUpdated,
  activeProducerId,
  onActiveProducerChange,
}: OutputsPanelProps) {
  const selectedOutputName = getOutputNameFromNodeId(selectedNodeId);

  if (outputs.length === 0 && artifacts.length === 0) {
    return (
      <div className='text-muted-foreground text-sm'>
        No outputs defined in this blueprint.
      </div>
    );
  }

  if (blueprintFolder && movieId) {
    return (
      <ArtifactGallery
        artifacts={artifacts}
        blueprintFolder={blueprintFolder}
        movieId={movieId}
        selectedNodeId={selectedNodeId}
        graphData={graphData}
        producerModels={producerModels}
        modelSelections={modelSelections}
        buildInputs={buildInputs}
        onArtifactUpdated={onArtifactUpdated}
        activeProducerId={activeProducerId}
        onActiveProducerChange={onActiveProducerChange}
      />
    );
  }

  return (
    <div className='space-y-4'>
      {!movieId && (
        <div className='text-muted-foreground text-xs bg-muted/20 p-3 rounded-lg border border-border/30 mb-4'>
          Select a build to view generated artifacts.
        </div>
      )}

      {outputs.map((output) => {
        const isSelected = selectedOutputName === output.name;

        return (
          <OutputDefinitionCard
            key={output.name}
            output={output}
            isSelected={isSelected}
          />
        );
      })}
    </div>
  );
}

function OutputDefinitionCard({
  output,
  isSelected,
}: {
  output: BlueprintOutputDef;
  isSelected: boolean;
}) {
  return (
    <div
      className={cn(
        'p-4 rounded-xl border transition-all shadow-lg',
        isSelected
          ? 'border-item-active-border bg-item-active-bg ring-2 ring-primary/40 shadow-xl -translate-y-0.5'
          : 'bg-panel-bg border-panel-border hover:border-primary/70 hover:shadow-xl hover:-translate-y-0.5'
      )}
    >
      <div className='flex items-center gap-2 mb-1'>
        <span className='font-semibold text-sm text-foreground'>
          {output.name}
        </span>
        <span className='text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded'>
          {output.type}
        </span>
        {output.itemType && (
          <span className='text-xs text-muted-foreground'>
            ({output.itemType}[])
          </span>
        )}
      </div>

      {output.description && (
        <p className='text-xs text-muted-foreground'>{output.description}</p>
      )}
    </div>
  );
}

// ============================================================================
// Artifact Gallery (Producer-based grouping)
// ============================================================================

function ArtifactGallery({
  artifacts,
  blueprintFolder,
  movieId,
  selectedNodeId,
  graphData,
  producerModels,
  modelSelections,
  buildInputs,
  onArtifactUpdated,
  activeProducerId: controlledActiveProducerId,
  onActiveProducerChange,
}: {
  artifacts: ArtifactInfo[];
  blueprintFolder: string;
  movieId: string;
  selectedNodeId: string | null;
  graphData?: BlueprintGraphData;
  producerModels?: Record<string, ProducerModelInfo>;
  modelSelections?: ModelSelectionValue[];
  buildInputs?: Record<string, unknown> | null;
  onArtifactUpdated?: () => void;
  activeProducerId?: string | null;
  onActiveProducerChange?: (producerId: string) => void;
}) {
  const {
    isArtifactSelected,
    selectProducerArtifacts,
    deselectProducerArtifacts,
    isArtifactPinned,
    pinProducerArtifacts,
    unpinProducerArtifacts,
  } = useExecution();

  // Group artifacts by producer and order them to match the Models pane first.
  const { groupedByProducer, orderedProducers } = useMemo(() => {
    const grouped = groupArtifactsByProducer(artifacts);
    const modelProducerNames = producerModels ? Object.keys(producerModels) : [];
    const graphProducerNames =
      graphData?.nodes
        .filter((node) => node.type === 'producer')
        .map((node) => node.id) ?? [];
    const artifactProducerNames = Array.from(grouped.keys());
    const producerIds = Array.from(
      new Set([
        ...modelProducerNames,
        ...graphProducerNames,
        ...artifactProducerNames,
      ])
    );

    return {
      groupedByProducer: grouped,
      orderedProducers: sortProducerIdsByExecutionFlow(producerIds, graphData),
    };
  }, [artifacts, graphData, producerModels]);

  const selectedProducerFromNode =
    selectedNodeId?.startsWith('Producer:') === true ? selectedNodeId : null;

  const producerSections = useMemo(
    () =>
      orderedProducers.map((producerName) => {
        const producerArtifacts = groupedByProducer.get(producerName) ?? [];
        const artifactIds = producerArtifacts.map((artifact) => artifact.id);
        const generatedIds = producerArtifacts
          .filter((artifact) => artifactHasDisplayableOutput(artifact))
          .map((artifact) => artifact.id);

        const selectedCount = artifactIds.filter((id) =>
          isArtifactSelected(id)
        ).length;
        const allSelected =
          selectedCount === artifactIds.length && artifactIds.length > 0;
        const someSelected =
          selectedCount > 0 && selectedCount < artifactIds.length;

        const pinnedCount = generatedIds.filter((id) =>
          isArtifactPinned(id)
        ).length;
        const allPinned =
          pinnedCount === generatedIds.length && generatedIds.length > 0;
        const somePinned = pinnedCount > 0 && pinnedCount < generatedIds.length;

        const skippedArtifacts = producerArtifacts.filter(
          (artifact) => artifact.status === 'skipped'
        );
        const failedArtifacts = producerArtifacts.filter(
          (artifact) => artifact.status === 'failed'
        );
        const allSkipped = skippedArtifacts.length === producerArtifacts.length;
        const allFailed = failedArtifacts.length === producerArtifacts.length;
        const hasSkippedOrFailed =
          skippedArtifacts.length > 0 || failedArtifacts.length > 0;
        const skipReason =
          skippedArtifacts[0]?.failureReason ??
          failedArtifacts[0]?.failureReason;

        return {
          producerName,
          producerArtifacts,
          artifactIds,
          generatedIds,
          allSelected,
          someSelected,
          allPinned,
          somePinned,
          allSkipped,
          allFailed,
          hasSkippedOrFailed,
          skipReason,
          hasGenerated: generatedIds.length > 0,
          subGroups: classifyAndGroupArtifacts(producerArtifacts),
          isPromptProducer:
            producerModels?.[producerName]?.category === 'prompt',
        };
      }),
    [
      groupedByProducer,
      isArtifactPinned,
      isArtifactSelected,
      orderedProducers,
      producerModels,
    ]
  );

  const [internalActiveProducerId, setInternalActiveProducerId] = useState<
    string | null
  >(null);
  const [openingProducerName, setOpeningProducerName] = useState<string | null>(
    null
  );
  const [availableEditModels, setAvailableEditModels] = useState<
    AvailableModelOption[]
  >([]);

  const resolvedActiveProducerId =
    controlledActiveProducerId ?? internalActiveProducerId;

  const handleActiveProducerChange = useCallback(
    (producerId: string) => {
      if (onActiveProducerChange) {
        onActiveProducerChange(producerId);
        return;
      }

      setInternalActiveProducerId(producerId);
    },
    [onActiveProducerChange]
  );

  const graphProducerNodeById = useMemo(
    () =>
      new Map(
        (graphData?.nodes ?? [])
          .filter((node) => node.type === 'producer')
          .map((node) => [node.id, node])
      ),
    [graphData]
  );

  const handleOpenProducerFolder = useCallback(
    async (producerNodeId: string) => {
      setOpeningProducerName(producerNodeId);
      try {
        const producerNode = graphProducerNodeById.get(producerNodeId);
        const producerFolderKey =
          producerNode?.namespacePath?.join('.') ?? producerNode?.label;
        if (!producerFolderKey) {
          throw new Error(
            `Producer ${producerNodeId} is missing namespace metadata for artifact folder resolution.`
          );
        }
        await openArtifactsProducerFolder(
          blueprintFolder,
          movieId,
          producerFolderKey
        );
      } catch (error) {
        console.error('[outputs-panel] Failed to open producer folder', error);
      } finally {
        setOpeningProducerName((current) =>
          current === producerNodeId ? null : current
        );
      }
    },
    [blueprintFolder, graphProducerNodeById, movieId]
  );

  useEffect(() => {
    let cancelled = false;

    const loadEditModels = async () => {
      try {
        const response = await fetchArtifactPreviewEditModels();
        if (!cancelled) {
          setAvailableEditModels(response.models);
        }
      } catch {
        if (!cancelled) {
          setAvailableEditModels([]);
        }
      }
    };

    void loadEditModels();

    return () => {
      cancelled = true;
    };
  }, []);

  const activeSection = useMemo(() => {
    if (resolvedActiveProducerId) {
      const manualSection = producerSections.find(
        (section) => section.producerName === resolvedActiveProducerId
      );
      if (manualSection) {
        return manualSection;
      }
    }

    if (selectedProducerFromNode) {
      const sectionFromNode = producerSections.find(
        (section) => section.producerName === selectedProducerFromNode
      );
      if (sectionFromNode) {
        return sectionFromNode;
      }
    }

    return producerSections[0];
  }, [producerSections, selectedProducerFromNode, resolvedActiveProducerId]);

  return (
    <TooltipProvider>
      <div className='flex h-full min-h-0 gap-4'>
        <ProducerNavigationPane
          producerIds={producerSections.map((section) => section.producerName)}
          activeProducerId={activeSection?.producerName ?? null}
          onSelectProducer={handleActiveProducerChange}
          renderProducerActions={(producerId) => {
            const section = producerSections.find(
              (candidate) => candidate.producerName === producerId
            );
            if (!section) {
              return null;
            }

            return (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type='button'
                      onClick={() => {
                        void handleOpenProducerFolder(producerId);
                      }}
                      className={cn(
                        'size-7 inline-flex items-center justify-center rounded-md transition-colors hover:bg-muted/70',
                        openingProducerName === producerId
                          ? 'text-primary'
                          : 'text-muted-foreground'
                      )}
                      aria-label='Open in Finder'
                      disabled={openingProducerName === producerId}
                    >
                      <FolderOpen className='size-4' />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side='top'>Open in Finder</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type='button'
                      onClick={() => {
                        if (!section.hasGenerated) {
                          return;
                        }
                        if (section.allPinned) {
                          unpinProducerArtifacts(section.generatedIds);
                        } else {
                          pinProducerArtifacts(section.generatedIds);
                        }
                      }}
                      className={cn(
                        'size-7 inline-flex items-center justify-center rounded-md transition-colors hover:bg-muted/70',
                        !section.hasGenerated &&
                          'text-muted-foreground/40 cursor-not-allowed',
                        section.hasGenerated &&
                          section.allPinned &&
                          'text-amber-500',
                        section.hasGenerated &&
                          section.somePinned &&
                          'text-amber-500/70',
                        section.hasGenerated &&
                          !section.allPinned &&
                          !section.somePinned &&
                          'text-muted-foreground'
                      )}
                      aria-label='Keep'
                      disabled={!section.hasGenerated}
                    >
                      <Pin className='size-4' />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side='top'>Keep</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type='button'
                      onClick={() => {
                        if (section.allSelected) {
                          deselectProducerArtifacts(section.artifactIds);
                        } else {
                          selectProducerArtifacts(section.artifactIds);
                        }
                      }}
                      className={cn(
                        'size-7 inline-flex items-center justify-center rounded-md transition-colors hover:bg-muted/70',
                        section.allSelected && 'text-primary',
                        section.someSelected &&
                          !section.allSelected &&
                          'text-primary/70',
                        !section.allSelected &&
                          !section.someSelected &&
                          'text-muted-foreground'
                      )}
                      aria-label='Generate Again'
                    >
                      <RefreshCw className='size-4' />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side='top'>Generate Again</TooltipContent>
                </Tooltip>
              </>
            );
          }}
        />

        <section className='min-w-0 flex-1 bg-muted/40 rounded-xl border border-border/40 overflow-hidden flex flex-col'>
          {activeSection ? (
            <>
              <div className='px-4 py-3 border-b border-border/40 bg-panel-header-bg'>
                <div className='flex items-center gap-2'>
                  <h3 className='text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                    {formatProducerDisplayName(activeSection.producerName)}
                  </h3>
                  {(activeSection.allSkipped || activeSection.allFailed) &&
                    activeSection.skipReason && (
                      <SkippedBadge reason={activeSection.skipReason} />
                    )}
                </div>
              </div>

              <div className='flex-1 overflow-y-auto p-4'>
                <ProducerArtifactSection
                  producerName={activeSection.producerName}
                  count={activeSection.producerArtifacts.length}
                  allSelected={activeSection.allSelected}
                  someSelected={activeSection.someSelected}
                  onSelectAll={() => {
                    if (activeSection.allSelected) {
                      deselectProducerArtifacts(activeSection.artifactIds);
                    } else {
                      selectProducerArtifacts(activeSection.artifactIds);
                    }
                  }}
                  allPinned={activeSection.allPinned}
                  somePinned={activeSection.somePinned}
                  hasGenerated={activeSection.hasGenerated}
                  onPinAll={() => {
                    if (activeSection.allPinned) {
                      unpinProducerArtifacts(activeSection.generatedIds);
                    } else {
                      pinProducerArtifacts(activeSection.generatedIds);
                    }
                  }}
                  allSkipped={activeSection.allSkipped}
                  allFailed={activeSection.allFailed}
                  hasSkippedOrFailed={activeSection.hasSkippedOrFailed}
                  skipReason={activeSection.skipReason}
                  hideActions
                  flat
                >
                  {activeSection.producerArtifacts.length === 0 ? (
                    <div className='rounded-lg border border-dashed border-border/60 bg-background/40 px-4 py-6 text-sm text-muted-foreground'>
                      No artifacts generated yet for this producer.
                    </div>
                  ) : (
                    <div className='space-y-5'>
                      {activeSection.subGroups.map((subGroup) => (
                        <SubGroupSection
                          key={subGroup.sortKey}
                          subGroup={subGroup}
                          artifacts={artifacts}
                          graphData={graphData}
                          blueprintFolder={blueprintFolder}
                          movieId={movieId}
                          isPromptProducer={activeSection.isPromptProducer}
                          producerModels={producerModels}
                          modelSelections={modelSelections}
                          availableEditModels={availableEditModels}
                          buildInputs={buildInputs}
                          onArtifactUpdated={onArtifactUpdated}
                        />
                      ))}
                    </div>
                  )}
                </ProducerArtifactSection>
              </div>
            </>
          ) : (
            <div className='h-full min-h-[220px] flex items-center justify-center text-sm text-muted-foreground'>
              No producer outputs available.
            </div>
          )}
        </section>
      </div>
    </TooltipProvider>
  );
}

// ============================================================================
// Artifact Card Renderer (dispatches to correct card type)
// ============================================================================

function ArtifactCardRenderer({
  artifact,
  artifacts,
  graphData,
  blueprintFolder,
  movieId,
  isSelected,
  isPinned,
  producerModels,
  modelSelections,
  availableEditModels,
  buildInputs,
  onArtifactUpdated,
  subGroup,
  useSimplifiedTextFooter,
}: {
  artifact: ArtifactInfo;
  artifacts: ArtifactInfo[];
  graphData?: BlueprintGraphData;
  blueprintFolder: string;
  movieId: string;
  isSelected: boolean;
  isPinned: boolean;
  producerModels?: Record<string, ProducerModelInfo>;
  modelSelections?: ModelSelectionValue[];
  availableEditModels?: AvailableModelOption[];
  buildInputs?: Record<string, unknown> | null;
  onArtifactUpdated?: () => void;
  subGroup?: ArtifactSubGroup;
  useSimplifiedTextFooter?: boolean;
}) {
  // When a later rerun fails or skips, we still show the last usable output
  // and surface the latest attempt state as badges on the card.
  if (
    (artifact.status === 'failed' || artifact.status === 'skipped') &&
    !artifactHasDisplayableOutput(artifact)
  ) {
    return <FailedArtifactCard artifact={artifact} isSelected={isSelected} />;
  }

  if (artifact.mimeType.startsWith('video/')) {
    return (
      <MediaArtifactCard
        artifact={artifact}
        artifacts={artifacts}
        graphData={graphData}
        blueprintFolder={blueprintFolder}
        movieId={movieId}
        isSelected={isSelected}
        isPinned={isPinned}
        producerModels={producerModels}
        modelSelections={modelSelections}
        onArtifactUpdated={onArtifactUpdated}
        mediaType='video'
        subGroup={subGroup}
      />
    );
  }
  if (artifact.mimeType.startsWith('audio/')) {
    const mediaType = resolveAudioMediaTypeForArtifact({
      artifact,
      graphData,
      producerModels,
    });

    return (
      <MediaArtifactCard
        artifact={artifact}
        artifacts={artifacts}
        graphData={graphData}
        blueprintFolder={blueprintFolder}
        movieId={movieId}
        isSelected={isSelected}
        isPinned={isPinned}
        producerModels={producerModels}
        modelSelections={modelSelections}
        buildInputs={buildInputs}
        onArtifactUpdated={onArtifactUpdated}
        mediaType={mediaType}
        subGroup={subGroup}
      />
    );
  }
  if (artifact.mimeType.startsWith('image/')) {
    return (
      <MediaArtifactCard
        artifact={artifact}
        artifacts={artifacts}
        graphData={graphData}
        blueprintFolder={blueprintFolder}
        movieId={movieId}
        isSelected={isSelected}
        isPinned={isPinned}
        producerModels={producerModels}
        modelSelections={modelSelections}
        availableEditModels={availableEditModels}
        onArtifactUpdated={onArtifactUpdated}
        mediaType='image'
        subGroup={subGroup}
      />
    );
  }
  if (
    artifact.mimeType.startsWith('text/') ||
    artifact.mimeType === 'application/json'
  ) {
    return (
      <TextArtifactSmartCard
        artifact={artifact}
        blueprintFolder={blueprintFolder}
        movieId={movieId}
        isSelected={isSelected}
        isPinned={isPinned}
        onArtifactUpdated={onArtifactUpdated}
        subGroup={subGroup}
        useSimplifiedFooter={useSimplifiedTextFooter}
      />
    );
  }
  return (
    <GenericCard
      artifact={artifact}
      isSelected={isSelected}
      isPinned={isPinned}
    />
  );
}

// ============================================================================
// Producer Artifact Section (with selection support)
// ============================================================================

function ProducerArtifactSection({
  producerName,
  count,
  allSelected,
  someSelected,
  onSelectAll,
  allPinned = false,
  somePinned = false,
  hasGenerated = false,
  onPinAll,
  allSkipped = false,
  allFailed = false,
  hasSkippedOrFailed: _hasSkippedOrFailed = false,
  skipReason,
  defaultOpen = true,
  hideActions = false,
  flat = false,
  children,
}: {
  producerName: string;
  count: number;
  allSelected: boolean;
  someSelected: boolean;
  onSelectAll: () => void;
  allPinned?: boolean;
  somePinned?: boolean;
  hasGenerated?: boolean;
  onPinAll?: () => void;
  allSkipped?: boolean;
  allFailed?: boolean;
  hasSkippedOrFailed?: boolean;
  skipReason?: import('@/types/builds').ArtifactFailureReason;
  defaultOpen?: boolean;
  hideActions?: boolean;
  flat?: boolean;
  children: React.ReactNode;
}) {
  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelectAll();
  };

  const handlePinClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onPinAll?.();
  };

  const actions = hideActions ? undefined : (
    <div className='flex items-center gap-1'>
      {hasGenerated && onPinAll && (
        <button
          type='button'
          onClick={handlePinClick}
          className={cn(
            'flex items-center gap-1.5 px-2 py-1 rounded hover:bg-muted transition-colors text-xs',
            allPinned || somePinned ? 'text-amber-500' : 'text-muted-foreground'
          )}
          title={allPinned ? 'Unpin all' : 'Pin all (keep from regeneration)'}
        >
          <span>Keep</span>
          {allPinned ? (
            <Pin className='size-4' />
          ) : somePinned ? (
            <Pin className='size-4 opacity-50' />
          ) : (
            <PinOff className='size-4' />
          )}
        </button>
      )}
      <button
        type='button'
        onClick={handleCheckboxClick}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded hover:bg-muted transition-colors text-xs',
          allSelected || someSelected ? 'text-primary' : 'text-muted-foreground'
        )}
        title={allSelected ? 'Deselect all' : 'Select all for regeneration'}
      >
        <span>Generate Again</span>
        {allSelected ? (
          <CheckSquare className='size-4' />
        ) : someSelected ? (
          <Square className='size-4 fill-primary/30' />
        ) : (
          <Square className='size-4' />
        )}
      </button>
    </div>
  );

  // Build title with optional skip badge
  const titleWithBadge = (
    <div className='flex items-center gap-2'>
      <span>{producerName}</span>
      {(allSkipped || allFailed) && skipReason && (
        <SkippedBadge reason={skipReason} />
      )}
    </div>
  );

  if (flat) {
    return <>{children}</>;
  }

  return (
    <CollapsibleSection
      title={titleWithBadge}
      count={count}
      defaultOpen={defaultOpen}
      actions={actions}
    >
      {children}
    </CollapsibleSection>
  );
}

// ============================================================================
// Sub-Group Section (renders a sub-group with optional header)
// ============================================================================

function SubGroupHeader({ label }: { label: string }) {
  return (
    <div className='flex items-center gap-3 mb-3 mt-4'>
      <span className='text-sm font-semibold text-foreground whitespace-nowrap'>
        {label}
      </span>
      <div className='h-px flex-1 bg-border/60' />
    </div>
  );
}

function SubGroupSection({
  subGroup,
  artifacts,
  graphData,
  blueprintFolder,
  movieId,
  isPromptProducer,
  producerModels,
  modelSelections,
  availableEditModels,
  buildInputs,
  onArtifactUpdated,
}: {
  subGroup: ArtifactSubGroup;
  artifacts: ArtifactInfo[];
  graphData?: BlueprintGraphData;
  blueprintFolder: string;
  movieId: string;
  isPromptProducer: boolean;
  producerModels?: Record<string, ProducerModelInfo>;
  modelSelections?: ModelSelectionValue[];
  availableEditModels?: AvailableModelOption[];
  buildInputs?: Record<string, unknown> | null;
  onArtifactUpdated?: () => void;
}) {
  const { isArtifactSelected, isArtifactPinned } = useExecution();

  const renderArtifactCard = useCallback(
    (artifact: ArtifactInfo) => {
      const isSelected = isArtifactSelected(artifact.id);
      const isPinned = isArtifactPinned(artifact.id);

      return (
        <ArtifactCardRenderer
          artifact={artifact}
          artifacts={artifacts}
          graphData={graphData}
          blueprintFolder={blueprintFolder}
          movieId={movieId}
          isSelected={isSelected}
          isPinned={isPinned}
          producerModels={producerModels}
          modelSelections={modelSelections}
          availableEditModels={availableEditModels}
          buildInputs={buildInputs}
          onArtifactUpdated={onArtifactUpdated}
          subGroup={subGroup}
          useSimplifiedTextFooter={isPromptProducer}
        />
      );
    },
    [
      artifacts,
      availableEditModels,
      blueprintFolder,
      buildInputs,
      graphData,
      isArtifactPinned,
      isArtifactSelected,
      isPromptProducer,
      modelSelections,
      movieId,
      onArtifactUpdated,
      producerModels,
      subGroup,
    ]
  );

  // Object-array sub-groups get the two-zone layout
  if (subGroup.type === 'object-array') {
    return (
      <div>
        {subGroup.label && <SubGroupHeader label={subGroup.label} />}
        <ObjectArraySection
          subGroup={subGroup}
          blueprintFolder={blueprintFolder}
          movieId={movieId}
          onArtifactUpdated={onArtifactUpdated}
          renderArtifactCard={renderArtifactCard}
        />
      </div>
    );
  }

  return (
    <div>
      {subGroup.label && <SubGroupHeader label={subGroup.label} />}
      <MediaGrid className='grid-cols-[repeat(auto-fill,minmax(20rem,20rem))]! justify-start'>
        {subGroup.artifacts.map((artifact) => {
          return (
            <Fragment key={artifact.id}>
              {renderArtifactCard(artifact)}
            </Fragment>
          );
        })}
      </MediaGrid>
    </div>
  );
}

// ============================================================================
// Artifact Card Footer (builds actions for CardActionsFooter)
// ============================================================================

interface ArtifactCardFooterProps {
  artifactId: string;
  displayName: string;
  downloadName: string;
  url: string;
  isEdited?: boolean;
  onEdit?: () => void;
  onRestore?: () => void;
  badge?: ReactNode;
}

function ArtifactCardFooter({
  artifactId,
  displayName,
  downloadName,
  url,
  isEdited,
  onEdit,
  onRestore,
  badge,
}: ArtifactCardFooterProps) {
  const {
    isArtifactSelected,
    toggleArtifactSelection,
    isArtifactPinned,
    toggleArtifactPin,
  } = useExecution();
  const isSelected = isArtifactSelected(artifactId);
  const isPinned = isArtifactPinned(artifactId);

  const handleDownload = useCallback(() => {
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    a.click();
  }, [url, downloadName]);

  const handleCopyUrl = useCallback(async () => {
    await navigator.clipboard.writeText(window.location.origin + url);
  }, [url]);

  const handleOpenInNewTab = useCallback(() => {
    window.open(url, '_blank');
  }, [url]);

  const handleToggleRegeneration = useCallback(() => {
    toggleArtifactSelection(artifactId);
  }, [toggleArtifactSelection, artifactId]);

  const handleTogglePin = useCallback(() => {
    toggleArtifactPin(artifactId);
  }, [toggleArtifactPin, artifactId]);

  // Build actions list
  const actions = useMemo((): CardAction[] => {
    const result: CardAction[] = [];

    if (onEdit) {
      result.push({
        id: 'edit',
        label: 'Edit',
        icon: Pencil,
        onClick: onEdit,
      });
    }

    if (isEdited && onRestore) {
      result.push({
        id: 'restore',
        label: 'Restore Original',
        icon: RotateCcw,
        onClick: onRestore,
      });
    }

    result.push({
      id: 'regenerate',
      label: 'Generate Again',
      icon: RefreshCw,
      onClick: handleToggleRegeneration,
      suffix: (
        <Check
          className={`size-4 ${isSelected ? 'text-primary' : 'invisible'}`}
        />
      ),
    });

    result.push({
      id: 'pin',
      label: 'Keep (Pin)',
      icon: Pin,
      onClick: handleTogglePin,
      suffix: (
        <Pin
          className={`size-4 ${isPinned ? 'text-amber-500' : 'invisible'}`}
        />
      ),
    });

    result.push({
      id: 'download',
      label: 'Download',
      icon: Download,
      onClick: handleDownload,
      separator: true,
    });

    result.push({
      id: 'open-new-tab',
      label: 'Open in new tab',
      icon: ExternalLink,
      onClick: handleOpenInNewTab,
    });

    result.push({
      id: 'copy-url',
      label: 'Copy URL',
      icon: Copy,
      onClick: handleCopyUrl,
    });

    return result;
  }, [
    onEdit,
    isEdited,
    onRestore,
    handleToggleRegeneration,
    handleTogglePin,
    handleDownload,
    handleOpenInNewTab,
    handleCopyUrl,
    isSelected,
    isPinned,
  ]);

  return (
    <CardActionsFooter
      label={displayName}
      actions={actions}
      badge={
        <>
          {badge}
          {isEdited ? <EditedBadge /> : null}
        </>
      }
    />
  );
}

// ============================================================================
// Media Artifact Card (unified component for video, audio, and image artifacts)
// ============================================================================

type MediaType = 'video' | 'audio' | 'music' | 'image';

function resolveAudioMediaTypeForArtifact(args: {
  artifact: ArtifactInfo;
  graphData?: BlueprintGraphData;
  producerModels?: Record<string, ProducerModelInfo>;
}): 'audio' | 'music' {
  const { artifact, graphData, producerModels } = args;
  const producerNodeId = resolveArtifactProducerNodeId(artifact);

  if (!producerNodeId) {
    return 'audio';
  }

  const producerTypeFromModels = producerModels?.[producerNodeId]?.producerType;
  if (producerTypeFromModels === 'audio/text-to-music') {
    return 'music';
  }

  const producerTypeFromGraph = graphData?.nodes.find(
    (node) => node.type === 'producer' && node.id === producerNodeId
  )?.producerType;

  if (producerTypeFromGraph === 'audio/text-to-music') {
    return 'music';
  }

  return 'audio';
}

function readStringInputValue(
  buildInputs: Record<string, unknown> | null | undefined,
  key: string | undefined
): string | undefined {
  if (!buildInputs || !key) {
    return undefined;
  }
  const value = buildInputs[key];
  return typeof value === 'string' ? value : undefined;
}

function MediaArtifactCard({
  artifact,
  artifacts,
  graphData,
  blueprintFolder,
  movieId,
  isSelected,
  isPinned,
  producerModels,
  modelSelections,
  availableEditModels,
  buildInputs,
  onArtifactUpdated,
  mediaType,
  subGroup,
}: {
  artifact: ArtifactInfo;
  artifacts: ArtifactInfo[];
  graphData?: BlueprintGraphData;
  blueprintFolder: string;
  movieId: string;
  isSelected: boolean;
  isPinned: boolean;
  producerModels?: Record<string, ProducerModelInfo>;
  modelSelections?: ModelSelectionValue[];
  availableEditModels?: AvailableModelOption[];
  buildInputs?: Record<string, unknown> | null;
  onArtifactUpdated?: () => void;
  mediaType: MediaType;
  subGroup?: ArtifactSubGroup;
}) {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const url = getBlobUrl(blueprintFolder, movieId, artifact.hash);
  const promptArtifact = resolvePromptArtifactForMedia({
    mediaArtifact: artifact,
    artifacts,
    graphData,
  });
  const promptLabel = promptArtifact
    ? `Prompt (${shortenArtifactDisplayName(promptArtifact.id)})`
    : 'Prompt';
  const promptUrl = promptArtifact
    ? getBlobUrl(blueprintFolder, movieId, promptArtifact.hash)
    : undefined;
  const displayName = getArtifactLabel(artifact.id, subGroup);
  const isEdited = artifact.lastRevisionBy === 'user';
  const artifactProducerNodeId = resolveArtifactProducerNodeId(artifact);
  const availableRerunModels = artifactProducerNodeId
    ? (producerModels?.[artifactProducerNodeId]?.availableModels ?? [])
    : [];
  const currentModelSelection = artifactProducerNodeId
    ? modelSelections?.find(
        (selection) => selection.producerId === artifactProducerNodeId
      )
    : undefined;
  const initialModel = currentModelSelection
    ? {
        provider: currentModelSelection.provider,
        model: currentModelSelection.model,
      }
    : undefined;

  const voiceSource =
    mediaType === 'audio'
      ? resolveAudioInputBindingSource({
          audioArtifact: artifact,
          inputName: 'VoiceId',
          graphData,
        })
      : null;
  const emotionSource =
    mediaType === 'audio'
      ? resolveAudioInputBindingSource({
          audioArtifact: artifact,
          inputName: 'Emotion',
          graphData,
        })
      : null;

  const [emotionFromArtifact, setEmotionFromArtifact] = useState<
    string | undefined
  >(undefined);

  const emotionSourceArtifact =
    mediaType === 'audio' && emotionSource?.kind === 'artifact'
      ? artifacts.find((candidate) => candidate.id === emotionSource.artifactId)
      : undefined;
  const emotionSourceArtifactHash = emotionSourceArtifact?.hash;

  useEffect(() => {
    if (mediaType !== 'audio' || !emotionSourceArtifactHash) {
      setEmotionFromArtifact(undefined);
      return;
    }

    let cancelled = false;
    const emotionUrl = getBlobUrl(
      blueprintFolder,
      movieId,
      emotionSourceArtifactHash
    );

    const loadEmotion = async () => {
      try {
        const response = await fetch(emotionUrl);
        if (!response.ok) {
          throw new Error(
            `Failed to load emotion source (${response.status} ${response.statusText})`
          );
        }
        const text = await response.text();
        if (!cancelled) {
          setEmotionFromArtifact(text.trim());
        }
      } catch {
        if (!cancelled) {
          setEmotionFromArtifact(undefined);
        }
      }
    };

    void loadEmotion();

    return () => {
      cancelled = true;
    };
  }, [blueprintFolder, emotionSourceArtifactHash, mediaType, movieId]);

  const initialVoiceId =
    mediaType === 'audio' && voiceSource?.kind === 'input'
      ? readStringInputValue(buildInputs, voiceSource.inputName)
      : undefined;

  const emotionFromInput =
    mediaType === 'audio' && emotionSource?.kind === 'input'
      ? readStringInputValue(buildInputs, emotionSource.inputName)
      : undefined;

  const initialEmotion =
    mediaType === 'audio'
      ? (emotionFromArtifact ?? emotionFromInput)
      : undefined;

  const handleEdit = () => setIsEditDialogOpen(true);

  const handleFileUpload = async (files: File[]) => {
    if (files.length === 0) return;
    await editArtifactFile(blueprintFolder, movieId, artifact.id, files[0]);
    onArtifactUpdated?.();
  };

  const handleRestore = async () => {
    try {
      await restoreArtifact(blueprintFolder, movieId, artifact.id);
      onArtifactUpdated?.();
    } catch (error) {
      console.error(`[MediaArtifactCard:${mediaType}] Restore failed:`, error);
    }
  };

  const handleImagePreviewRegenerate = async (
    params: Parameters<
      NonNullable<ComponentProps<typeof ImageEditDialog>['onRegenerate']>
    >[0]
  ) => {
    return generateArtifactPreview(blueprintFolder, movieId, artifact.id, {
      mode: params.mode,
      prompt: params.prompt,
      promptArtifactId:
        params.mode === 'rerun' ? promptArtifact?.id : undefined,
      model: params.model,
      cameraParams: params.cameraParams,
    });
  };

  const handleImagePreviewEstimate = async (
    params: Parameters<
      NonNullable<ComponentProps<typeof ImageEditDialog>['onEstimateCost']>
    >[0]
  ) => {
    const response = await estimateArtifactPreview(
      blueprintFolder,
      movieId,
      artifact.id,
      {
        mode: params.mode,
        prompt: params.prompt,
        promptArtifactId:
          params.mode === 'rerun' ? promptArtifact?.id : undefined,
        model: params.model,
        cameraParams: params.cameraParams,
      }
    );

    return response.estimatedCost;
  };

  const handleVideoPreviewRegenerate = async (
    params: Parameters<
      NonNullable<ComponentProps<typeof VideoEditDialog>['onRegenerate']>
    >[0]
  ) => {
    return generateArtifactPreview(blueprintFolder, movieId, artifact.id, {
      mode: params.mode,
      prompt: params.prompt,
      promptArtifactId:
        params.mode === 'rerun' ? promptArtifact?.id : undefined,
      model: params.model,
      clipParams: params.clipParams,
      sourceTempId: params.sourceTempId,
    });
  };

  const handleVideoPreviewEstimate = async (
    params: Parameters<
      NonNullable<ComponentProps<typeof VideoEditDialog>['onEstimateCost']>
    >[0]
  ) => {
    const response = await estimateArtifactPreview(
      blueprintFolder,
      movieId,
      artifact.id,
      {
        mode: params.mode,
        prompt: params.prompt,
        promptArtifactId:
          params.mode === 'rerun' ? promptArtifact?.id : undefined,
        model: params.model,
        clipParams: params.clipParams,
      }
    );

    return response.estimatedCost;
  };

  const handleAudioPreviewRegenerate = async (
    params: Parameters<
      NonNullable<ComponentProps<typeof AudioEditDialog>['onRegenerate']>
    >[0]
  ) => {
    return generateArtifactPreview(blueprintFolder, movieId, artifact.id, {
      mode: params.mode,
      prompt: params.prompt,
      promptArtifactId: promptArtifact?.id,
      model: params.model,
      inputOverrides: params.inputOverrides,
    });
  };

  const handleAudioPreviewEstimate = async (
    params: Parameters<
      NonNullable<ComponentProps<typeof AudioEditDialog>['onEstimateCost']>
    >[0]
  ) => {
    const response = await estimateArtifactPreview(
      blueprintFolder,
      movieId,
      artifact.id,
      {
        mode: params.mode,
        prompt: params.prompt,
        promptArtifactId: promptArtifact?.id,
        model: params.model,
        inputOverrides: params.inputOverrides,
      }
    );

    return response.estimatedCost;
  };

  const handleMusicPreviewRegenerate = async (
    params: Parameters<
      NonNullable<ComponentProps<typeof MusicEditDialog>['onRegenerate']>
    >[0]
  ) => {
    return generateArtifactPreview(blueprintFolder, movieId, artifact.id, {
      mode: params.mode,
      prompt: params.prompt,
      promptArtifactId:
        params.mode === 'rerun' ? promptArtifact?.id : undefined,
      model: params.model,
      clipParams: params.clipParams,
      sourceTempId: params.sourceTempId,
    });
  };

  const handleMusicPreviewEstimate = async (
    params: Parameters<
      NonNullable<ComponentProps<typeof MusicEditDialog>['onEstimateCost']>
    >[0]
  ) => {
    const response = await estimateArtifactPreview(
      blueprintFolder,
      movieId,
      artifact.id,
      {
        mode: params.mode,
        prompt: params.prompt,
        promptArtifactId:
          params.mode === 'rerun' ? promptArtifact?.id : undefined,
        model: params.model,
        clipParams: params.clipParams,
      }
    );

    return response.estimatedCost;
  };

  const handlePreviewApply = async (tempId: string) => {
    await applyArtifactPreview(blueprintFolder, movieId, artifact.id, tempId);
    onArtifactUpdated?.();
  };

  const handlePreviewCleanup = async (tempId: string) => {
    await deleteArtifactPreview(blueprintFolder, movieId, tempId);
  };

  const footer = (
    <ArtifactCardFooter
      artifactId={artifact.id}
      displayName={displayName}
      downloadName={artifact.name}
      url={url}
      isEdited={isEdited}
      onEdit={handleEdit}
      onRestore={isEdited ? handleRestore : undefined}
      badge={<ArtifactAttemptBadge artifact={artifact} />}
    />
  );

  return (
    <>
      {mediaType === 'video' && (
        <VideoCard
          url={url}
          title={displayName}
          isSelected={isSelected}
          isPinned={isPinned}
          expandable
          promptTitle={promptLabel}
          promptUrl={promptUrl}
          footer={footer}
        />
      )}
      {(mediaType === 'audio' || mediaType === 'music') && (
        <AudioCard
          url={url}
          title={displayName}
          isSelected={isSelected}
          isPinned={isPinned}
          expandable
          promptTitle={promptLabel}
          promptUrl={promptUrl}
          footer={footer}
        />
      )}
      {mediaType === 'image' && (
        <ImageCard
          url={url}
          title={displayName}
          isSelected={isSelected}
          isPinned={isPinned}
          promptTitle={promptLabel}
          promptUrl={promptUrl}
          footer={footer}
        />
      )}

      {mediaType === 'image' ? (
        <ImageEditDialog
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          imageUrl={url}
          title={`Edit Image \u2014 ${displayName}`}
          availableModels={availableRerunModels}
          availableEditModels={availableEditModels}
          initialModel={initialModel}
          promptUrl={promptUrl}
          onFileUpload={handleFileUpload}
          onEstimateCost={handleImagePreviewEstimate}
          onRegenerate={handleImagePreviewRegenerate}
          onApplyGenerated={handlePreviewApply}
          onCleanupGenerated={handlePreviewCleanup}
        />
      ) : mediaType === 'video' ? (
        <VideoEditDialog
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          videoUrl={url}
          title={`Edit Video — ${displayName}`}
          availableModels={availableRerunModels}
          initialModel={initialModel}
          promptUrl={promptUrl}
          onFileUpload={handleFileUpload}
          onEstimateCost={handleVideoPreviewEstimate}
          onRegenerate={handleVideoPreviewRegenerate}
          onApplyGenerated={handlePreviewApply}
          onCleanupGenerated={handlePreviewCleanup}
        />
      ) : mediaType === 'music' ? (
        <MusicEditDialog
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          musicUrl={url}
          title={`Edit Music — ${displayName}`}
          availableModels={availableRerunModels}
          initialModel={initialModel}
          promptUrl={promptUrl}
          onFileUpload={handleFileUpload}
          onEstimateCost={handleMusicPreviewEstimate}
          onRegenerate={handleMusicPreviewRegenerate}
          onApplyGenerated={handlePreviewApply}
          onCleanupGenerated={handlePreviewCleanup}
        />
      ) : (
        <AudioEditDialog
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          audioUrl={url}
          title={`Edit Audio — ${displayName}`}
          availableModels={availableRerunModels}
          initialModel={initialModel}
          promptUrl={promptUrl}
          initialVoiceId={initialVoiceId}
          initialEmotion={initialEmotion}
          onFileUpload={handleFileUpload}
          onEstimateCost={handleAudioPreviewEstimate}
          onRegenerate={handleAudioPreviewRegenerate}
          onApplyGenerated={handlePreviewApply}
          onCleanupGenerated={handlePreviewCleanup}
        />
      )}
    </>
  );
}

// ============================================================================
// Text Artifact Smart Card (dispatches to boolean, compact, or text card)
// ============================================================================

function TextArtifactSmartCard({
  artifact,
  blueprintFolder,
  movieId,
  isSelected,
  isPinned,
  onArtifactUpdated,
  subGroup,
  useSimplifiedFooter = false,
}: {
  artifact: ArtifactInfo;
  blueprintFolder: string;
  movieId: string;
  isSelected: boolean;
  isPinned: boolean;
  onArtifactUpdated?: () => void;
  subGroup?: ArtifactSubGroup;
  useSimplifiedFooter?: boolean;
}) {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const url = getBlobUrl(blueprintFolder, movieId, artifact.hash);
  const displayName = getArtifactLabel(artifact.id, subGroup);
  const isEdited = artifact.lastRevisionBy === 'user';

  useEffect(() => {
    let cancelled = false;
    const loadContent = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(url);
        const text = await res.text();
        if (!cancelled) {
          setContent(text);
        }
      } catch (error) {
        console.error('[TextCard] Failed to load content:', error);
        if (!cancelled) {
          setContent('Failed to load content');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    loadContent();
    return () => {
      cancelled = true;
    };
  }, [url]);

  // While loading, show a compact skeleton placeholder
  if (isLoading || content === null) {
    return (
      <div className='rounded-xl border border-border bg-card px-4 py-3 animate-pulse'>
        <div className='h-4 bg-muted/50 rounded w-3/4' />
      </div>
    );
  }

  const handleSaveEdit = async (newContent: string) => {
    setIsSaving(true);
    try {
      await editArtifactText(
        blueprintFolder,
        movieId,
        artifact.id,
        newContent,
        artifact.mimeType
      );
      setIsEditDialogOpen(false);
      onArtifactUpdated?.();
    } catch (error) {
      console.error('[TextCard] Edit failed:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const isJson = artifact.mimeType === 'application/json';
  const displayContent = isJson
    ? formatJson(content)
    : content.slice(0, 500) + (content.length > 500 ? '...' : '');

  const handleEdit = () => setIsEditDialogOpen(true);

  const handleRestore = async () => {
    try {
      await restoreArtifact(blueprintFolder, movieId, artifact.id);
      onArtifactUpdated?.();
    } catch (error) {
      console.error('[TextCard] Restore failed:', error);
    }
  };

  const simplifiedFooter = (
    <>
      <div className='flex items-center gap-1.5 flex-1 min-w-0'>
        <span className='text-xs text-foreground truncate' title={displayName}>
          {displayName}
        </span>
        <ArtifactAttemptBadge artifact={artifact} />
        {isEdited && <EditedBadge />}
      </div>
      {isEdited && (
        <button
          type='button'
          onClick={(e) => {
            e.stopPropagation();
            handleRestore();
          }}
          className='p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground'
          title='Restore original'
        >
          <RotateCcw className='size-3.5' />
        </button>
      )}
    </>
  );

  const footer = useSimplifiedFooter ? (
    simplifiedFooter
  ) : (
    <ArtifactCardFooter
      artifactId={artifact.id}
      displayName={displayName}
      downloadName={artifact.name}
      url={url}
      isEdited={isEdited}
      onEdit={handleEdit}
      onRestore={isEdited ? handleRestore : undefined}
      badge={<ArtifactAttemptBadge artifact={artifact} />}
    />
  );

  return (
    <>
      <MediaCard isSelected={isSelected} isPinned={isPinned} footer={footer}>
        <button
          type='button'
          onClick={() => setIsEditDialogOpen(true)}
          className='min-h-[100px] max-h-[180px] w-full bg-muted/30 p-3 text-left overflow-hidden group relative'
        >
          {isJson ? (
            <SyntaxPreview
              content={displayContent}
              language='json'
              className='h-full pointer-events-none'
            />
          ) : (
            <pre className='text-xs text-muted-foreground font-mono whitespace-pre-wrap overflow-hidden h-full'>
              {displayContent}
            </pre>
          )}
          {!useSimplifiedFooter && (
            <div className='absolute inset-0 bg-linear-to-t from-muted/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center'>
              <Pencil className='size-8 text-foreground' />
            </div>
          )}
        </button>
      </MediaCard>

      <TextEditorDialog
        key={isEditDialogOpen ? `edit-${artifact.hash}` : 'closed'}
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        title={displayName}
        content={content}
        mimeType={artifact.mimeType}
        onSave={handleSaveEdit}
        isSaving={isSaving}
        preset='output-edit'
      />
    </>
  );
}

// ============================================================================
// Generic Card
// ============================================================================

function GenericCard({
  artifact,
  isSelected,
  isPinned,
}: {
  artifact: ArtifactInfo;
  isSelected: boolean;
  isPinned: boolean;
}) {
  const { isArtifactSelected, toggleArtifactSelection } = useExecution();
  const displayName = shortenArtifactDisplayName(artifact.id);
  const selected = isArtifactSelected(artifact.id);

  return (
    <MediaCard
      isSelected={isSelected}
      isPinned={isPinned}
      footer={
        <>
          <span
            className='text-xs text-foreground truncate flex-1'
            title={displayName}
          >
            {displayName}
          </span>
          <button
            type='button'
            onClick={() => toggleArtifactSelection(artifact.id)}
            className={cn(
              'p-1 rounded hover:bg-muted transition-colors',
              selected ? 'text-primary' : 'text-muted-foreground'
            )}
            title={selected ? 'Deselect' : 'Select for regeneration'}
          >
            <RefreshCw className='size-3' />
          </button>
          <span className='text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded'>
            {artifact.mimeType}
          </span>
        </>
      }
    >
      <div className='aspect-video bg-muted/30 flex flex-col items-center justify-center gap-2'>
        <File className='size-12 text-muted-foreground' />
        <span className='text-xs text-muted-foreground'>
          {formatFileSize(artifact.size)}
        </span>
      </div>
    </MediaCard>
  );
}

// ============================================================================
// Failed/Skipped Artifact Card
// ============================================================================

function FailedArtifactCard({
  artifact,
  isSelected,
}: {
  artifact: ArtifactInfo;
  isSelected: boolean;
}) {
  const { toggleArtifactSelection } = useExecution();
  const displayName = shortenArtifactDisplayName(artifact.id);

  const isSkipped = artifact.status === 'skipped';
  const isFailed = artifact.status === 'failed';
  const isRecoverable =
    artifact.recoverable === true &&
    typeof artifact.providerRequestId === 'string' &&
    artifact.providerRequestId.length > 0;
  const isConditionalSkip = artifact.failureReason === 'conditions_not_met';

  const handleToggleRegeneration = useCallback(() => {
    toggleArtifactSelection(artifact.id);
  }, [toggleArtifactSelection, artifact.id]);

  // Determine icon and styling based on failure type
  const Icon = isConditionalSkip ? Clock : AlertCircle;
  const iconColor = isConditionalSkip
    ? 'text-muted-foreground'
    : 'text-destructive';
  const borderColor = isConditionalSkip
    ? 'border-muted'
    : 'border-destructive/50';

  // Build failure message
  let failureMessage = '';
  if (artifact.skipMessage) {
    failureMessage = artifact.skipMessage;
  } else if (artifact.failureReason === 'timeout') {
    failureMessage = 'Request timed out';
  } else if (artifact.failureReason === 'connection_error') {
    failureMessage = 'Connection failed';
  } else if (artifact.failureReason === 'upstream_failure') {
    failureMessage = 'Dependency failed';
  } else if (artifact.failureReason === 'conditions_not_met') {
    failureMessage = 'Conditions not met';
  } else if (isFailed) {
    failureMessage = 'Generation failed';
  } else if (isSkipped) {
    failureMessage = 'Skipped';
  }

  return (
    <MediaCard
      isSelected={isSelected}
      className={borderColor}
      footer={
        <div className='flex items-center justify-between w-full gap-2'>
          <span
            className='text-xs text-foreground truncate flex-1'
            title={displayName}
          >
            {displayName}
          </span>
          <div className='flex items-center gap-1'>
            <button
              type='button'
              onClick={handleToggleRegeneration}
              className={cn(
                'p-1 rounded hover:bg-muted transition-colors',
                isSelected ? 'text-primary' : 'text-muted-foreground'
              )}
              title={isSelected ? 'Deselect' : 'Select for regeneration'}
            >
              <RefreshCw className='size-3' />
            </button>
          </div>
        </div>
      }
    >
      <div className='aspect-video bg-muted/30 flex flex-col items-center justify-center gap-3 p-4'>
        <Icon className={cn('size-12', iconColor)} />
        <div className='text-center'>
          <p className={cn('text-sm font-medium', iconColor)}>
            {failureMessage}
          </p>
          {artifact.provider && (
            <p className='text-xs text-muted-foreground mt-1'>
              {artifact.provider}
              {artifact.model && ` / ${artifact.model}`}
            </p>
          )}
          {isRecoverable && (
            <p className='text-xs text-muted-foreground mt-2 bg-muted/50 px-2 py-1 rounded'>
              Will be rechecked automatically on Run.
            </p>
          )}
        </div>
      </div>
    </MediaCard>
  );
}

function artifactHasDisplayableOutput(artifact: ArtifactInfo): boolean {
  return artifact.hash.length > 0;
}

function ArtifactAttemptBadge({ artifact }: { artifact: ArtifactInfo }) {
  const isFailed = artifact.status === 'failed';
  const isSkipped = artifact.status === 'skipped';

  if (!isFailed && !isSkipped) {
    return null;
  }

  const toneClass = isFailed
    ? 'border-destructive/40 bg-destructive/10 text-destructive'
    : 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  const label = isFailed ? 'Failed' : 'Skipped';
  const title = artifact.showingPreviousOutput
    ? `Latest attempt ${label.toLowerCase()}. Showing previous output.`
    : `Latest attempt ${label.toLowerCase()}.`;

  return (
    <>
      <span
        className={cn(
          'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]',
          toneClass
        )}
        title={title}
      >
        {label}
      </span>
      {artifact.showingPreviousOutput ? (
        <span
          className='inline-flex items-center rounded-full border border-border/50 bg-muted/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground'
          title='Showing the last succeeded output from an earlier run.'
        >
          Previous
        </span>
      ) : null}
    </>
  );
}

// ============================================================================
// Utilities
// ============================================================================

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatJson(content: string): string {
  try {
    const parsed = JSON.parse(content);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return content;
  }
}
