import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Download,
  ExternalLink,
  Copy,
  File,
  Maximize2,
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
  shortenArtifactDisplayName,
  groupArtifactsByProducer,
  sortProducersByTopology,
} from '@/lib/artifact-utils';
import { getOutputNameFromNodeId } from '@/lib/panel-utils';
import { useExecution } from '@/contexts/execution-context';
import {
  MediaCard,
  MediaGrid,
  CollapsibleSection,
  CardActionsFooter,
  TextEditorDialog,
  VideoCard,
  AudioCard,
  ImageCard,
  type CardAction,
} from './shared';
import { EditedBadge } from './outputs/edited-badge';
import { SkippedBadge } from './outputs/skipped-badge';
import { FileUploadDialog } from './inputs/file-upload-dialog';
import {
  editArtifactFile,
  editArtifactText,
  restoreArtifact,
} from '@/data/blueprint-client';
import type {
  BlueprintOutputDef,
  BlueprintGraphData,
} from '@/types/blueprint-graph';
import type { ArtifactInfo } from '@/types/builds';

interface OutputsPanelProps {
  outputs: BlueprintOutputDef[];
  selectedNodeId: string | null;
  movieId: string | null;
  blueprintFolder: string | null;
  artifacts: ArtifactInfo[];
  graphData?: BlueprintGraphData;
  /** Callback when an artifact is edited or restored */
  onArtifactUpdated?: () => void;
}

export function OutputsPanel({
  outputs,
  selectedNodeId,
  movieId,
  blueprintFolder,
  artifacts,
  graphData,
  onArtifactUpdated,
}: OutputsPanelProps) {
  const selectedOutputName = getOutputNameFromNodeId(selectedNodeId);

  if (outputs.length === 0 && artifacts.length === 0) {
    return (
      <div className='text-muted-foreground text-sm'>
        No outputs defined in this blueprint.
      </div>
    );
  }

  if (artifacts.length > 0 && blueprintFolder && movieId) {
    return (
      <ArtifactGallery
        artifacts={artifacts}
        blueprintFolder={blueprintFolder}
        movieId={movieId}
        graphData={graphData}
        onArtifactUpdated={onArtifactUpdated}
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
          ? 'border-primary bg-primary/10 ring-2 ring-primary/40 shadow-xl -translate-y-0.5'
          : 'bg-card border-border hover:border-primary/70 hover:shadow-xl hover:-translate-y-0.5'
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
  graphData,
  onArtifactUpdated,
}: {
  artifacts: ArtifactInfo[];
  blueprintFolder: string;
  movieId: string;
  graphData?: BlueprintGraphData;
  onArtifactUpdated?: () => void;
}) {
  const {
    isArtifactSelected,
    selectProducerArtifacts,
    deselectProducerArtifacts,
    isArtifactPinned,
    pinProducerArtifacts,
    unpinProducerArtifacts,
  } = useExecution();

  // Group artifacts by producer and sort by topological order
  const { groupedByProducer, orderedProducers } = useMemo(() => {
    const grouped = groupArtifactsByProducer(artifacts);
    const ordered = sortProducersByTopology(
      Array.from(grouped.keys()),
      graphData
    );
    return { groupedByProducer: grouped, orderedProducers: ordered };
  }, [artifacts, graphData]);

  return (
    <div className='space-y-6'>
      {orderedProducers.map((producerName) => {
        const producerArtifacts = groupedByProducer.get(producerName) ?? [];
        const artifactIds = producerArtifacts.map((a) => a.id);
        const generatedIds = producerArtifacts
          .filter((a) => a.status === 'succeeded')
          .map((a) => a.id);

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

        // Compute skip/failure status for section header
        const skippedArtifacts = producerArtifacts.filter(
          (a) => a.status === 'skipped'
        );
        const failedArtifacts = producerArtifacts.filter(
          (a) => a.status === 'failed'
        );
        const allSkipped = skippedArtifacts.length === producerArtifacts.length;
        const allFailed = failedArtifacts.length === producerArtifacts.length;
        const hasSkippedOrFailed =
          skippedArtifacts.length > 0 || failedArtifacts.length > 0;

        // Determine primary skip reason for badge
        const primarySkipReason =
          skippedArtifacts[0]?.failureReason ??
          failedArtifacts[0]?.failureReason;

        const handleSelectAll = () => {
          if (allSelected) {
            deselectProducerArtifacts(artifactIds);
          } else {
            selectProducerArtifacts(artifactIds);
          }
        };

        const handlePinAll = () => {
          if (allPinned) {
            unpinProducerArtifacts(generatedIds);
          } else {
            pinProducerArtifacts(generatedIds);
          }
        };

        return (
          <ProducerArtifactSection
            key={producerName}
            producerName={producerName}
            count={producerArtifacts.length}
            allSelected={allSelected}
            someSelected={someSelected}
            onSelectAll={handleSelectAll}
            allPinned={allPinned}
            somePinned={somePinned}
            hasGenerated={generatedIds.length > 0}
            onPinAll={handlePinAll}
            allSkipped={allSkipped}
            allFailed={allFailed}
            hasSkippedOrFailed={hasSkippedOrFailed}
            skipReason={primarySkipReason}
            defaultOpen
          >
            <MediaGrid>
              {producerArtifacts.map((artifact) => {
                const isSelected = isArtifactSelected(artifact.id);
                const isPinned = isArtifactPinned(artifact.id);
                return (
                  <ArtifactCardRenderer
                    key={artifact.id}
                    artifact={artifact}
                    blueprintFolder={blueprintFolder}
                    movieId={movieId}
                    isSelected={isSelected}
                    isPinned={isPinned}
                    onArtifactUpdated={onArtifactUpdated}
                  />
                );
              })}
            </MediaGrid>
          </ProducerArtifactSection>
        );
      })}
    </div>
  );
}

// ============================================================================
// Artifact Card Renderer (dispatches to correct card type)
// ============================================================================

function ArtifactCardRenderer({
  artifact,
  blueprintFolder,
  movieId,
  isSelected,
  isPinned,
  onArtifactUpdated,
}: {
  artifact: ArtifactInfo;
  blueprintFolder: string;
  movieId: string;
  isSelected: boolean;
  isPinned: boolean;
  onArtifactUpdated?: () => void;
}) {
  // Handle failed or skipped artifacts first
  if (artifact.status === 'failed' || artifact.status === 'skipped') {
    return <FailedArtifactCard artifact={artifact} isSelected={isSelected} />;
  }

  if (artifact.mimeType.startsWith('video/')) {
    return (
      <MediaArtifactCard
        artifact={artifact}
        blueprintFolder={blueprintFolder}
        movieId={movieId}
        isSelected={isSelected}
        isPinned={isPinned}
        onArtifactUpdated={onArtifactUpdated}
        mediaType='video'
      />
    );
  }
  if (artifact.mimeType.startsWith('audio/')) {
    return (
      <MediaArtifactCard
        artifact={artifact}
        blueprintFolder={blueprintFolder}
        movieId={movieId}
        isSelected={isSelected}
        isPinned={isPinned}
        onArtifactUpdated={onArtifactUpdated}
        mediaType='audio'
      />
    );
  }
  if (artifact.mimeType.startsWith('image/')) {
    return (
      <MediaArtifactCard
        artifact={artifact}
        blueprintFolder={blueprintFolder}
        movieId={movieId}
        isSelected={isSelected}
        isPinned={isPinned}
        onArtifactUpdated={onArtifactUpdated}
        mediaType='image'
      />
    );
  }
  if (
    artifact.mimeType.startsWith('text/') ||
    artifact.mimeType === 'application/json'
  ) {
    return (
      <ArtifactTextCard
        artifact={artifact}
        blueprintFolder={blueprintFolder}
        movieId={movieId}
        isSelected={isSelected}
        isPinned={isPinned}
        onArtifactUpdated={onArtifactUpdated}
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

  const actions = (
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
// Artifact Card Footer (builds actions for CardActionsFooter)
// ============================================================================

interface ArtifactCardFooterProps {
  artifactId: string;
  displayName: string;
  downloadName: string;
  url: string;
  isEdited?: boolean;
  onExpand?: () => void;
  onEdit?: () => void;
  onRestore?: () => void;
}

function ArtifactCardFooter({
  artifactId,
  displayName,
  downloadName,
  url,
  isEdited,
  onExpand,
  onEdit,
  onRestore,
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

    // Add separator before file actions
    if (onExpand) {
      result.push({
        id: 'expand',
        label: 'Expand',
        icon: Maximize2,
        onClick: onExpand,
        separator: true,
      });
    }

    result.push({
      id: 'download',
      label: 'Download',
      icon: Download,
      onClick: handleDownload,
      separator: !onExpand,
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
    onExpand,
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
      badge={isEdited ? <EditedBadge /> : undefined}
    />
  );
}

// ============================================================================
// Media Artifact Card (unified component for video, audio, and image artifacts)
// ============================================================================

type MediaType = 'video' | 'audio' | 'image';

function MediaArtifactCard({
  artifact,
  blueprintFolder,
  movieId,
  isSelected,
  isPinned,
  onArtifactUpdated,
  mediaType,
}: {
  artifact: ArtifactInfo;
  blueprintFolder: string;
  movieId: string;
  isSelected: boolean;
  isPinned: boolean;
  onArtifactUpdated?: () => void;
  mediaType: MediaType;
}) {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const url = getBlobUrl(blueprintFolder, movieId, artifact.hash);
  const displayName = shortenArtifactDisplayName(artifact.id);
  const isEdited = artifact.editedBy === 'user';

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

  const footer = (
    <ArtifactCardFooter
      artifactId={artifact.id}
      displayName={displayName}
      downloadName={artifact.name}
      url={url}
      isEdited={isEdited}
      onEdit={handleEdit}
      onRestore={isEdited ? handleRestore : undefined}
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
          footer={footer}
        />
      )}
      {mediaType === 'audio' && (
        <AudioCard
          url={url}
          title={displayName}
          isSelected={isSelected}
          isPinned={isPinned}
          footer={footer}
        />
      )}
      {mediaType === 'image' && (
        <ImageCard
          url={url}
          title={displayName}
          isSelected={isSelected}
          isPinned={isPinned}
          footer={footer}
        />
      )}

      <FileUploadDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        mediaType={mediaType}
        multiple={false}
        onConfirm={handleFileUpload}
      />
    </>
  );
}

// ============================================================================
// Artifact Text Card (fetches content from blob URL, has save/restore)
// ============================================================================

function ArtifactTextCard({
  artifact,
  blueprintFolder,
  movieId,
  isSelected,
  isPinned,
  onArtifactUpdated,
}: {
  artifact: ArtifactInfo;
  blueprintFolder: string;
  movieId: string;
  isSelected: boolean;
  isPinned: boolean;
  onArtifactUpdated?: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const url = getBlobUrl(blueprintFolder, movieId, artifact.hash);
  const displayName = shortenArtifactDisplayName(artifact.id);
  const isEdited = artifact.editedBy === 'user';

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

  const handleEdit = () => setIsEditDialogOpen(true);

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

  const handleRestore = async () => {
    try {
      await restoreArtifact(blueprintFolder, movieId, artifact.id);
      onArtifactUpdated?.();
    } catch (error) {
      console.error('[TextCard] Restore failed:', error);
    }
  };

  const isJson = artifact.mimeType === 'application/json';
  const displayContent = content
    ? isJson
      ? formatJson(content)
      : content.slice(0, 500) + (content.length > 500 ? '...' : '')
    : '';

  return (
    <>
      <MediaCard
        isSelected={isSelected}
        isPinned={isPinned}
        footer={
          <ArtifactCardFooter
            artifactId={artifact.id}
            displayName={displayName}
            downloadName={artifact.name}
            url={url}
            isEdited={isEdited}
            onExpand={() => setIsExpanded(true)}
            onEdit={handleEdit}
            onRestore={isEdited ? handleRestore : undefined}
          />
        }
      >
        <button
          type='button'
          onClick={() => setIsExpanded(true)}
          className='aspect-video w-full bg-muted/30 p-3 text-left overflow-hidden group relative'
        >
          {isLoading ? (
            <div className='flex items-center justify-center h-full'>
              <span className='text-muted-foreground text-sm'>Loading...</span>
            </div>
          ) : (
            <>
              <pre className='text-xs text-muted-foreground font-mono whitespace-pre-wrap overflow-hidden h-full'>
                {displayContent}
              </pre>
              <div className='absolute inset-0 bg-linear-to-t from-muted/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center'>
                <Maximize2 className='size-8 text-foreground' />
              </div>
            </>
          )}
        </button>
      </MediaCard>

      <TextEditorDialog
        key={isExpanded ? `view-${artifact.hash}` : 'closed-view'}
        open={isExpanded}
        onOpenChange={setIsExpanded}
        title={displayName}
        content={content ?? ''}
        mimeType={artifact.mimeType}
        size='large'
      />

      <TextEditorDialog
        key={isEditDialogOpen ? `edit-${artifact.hash}` : 'closed'}
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        title={displayName}
        content={content ?? ''}
        mimeType={artifact.mimeType}
        onSave={handleSaveEdit}
        isSaving={isSaving}
        size='large'
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

// ============================================================================
// Utilities
// ============================================================================

function getBlobUrl(
  blueprintFolder: string,
  movieId: string,
  hash: string
): string {
  if (!blueprintFolder || !movieId || !hash) {
    console.warn('[getBlobUrl] Missing required parameters:', {
      blueprintFolder: !!blueprintFolder,
      movieId: !!movieId,
      hash: !!hash,
    });
  }
  const params = new URLSearchParams({
    folder: blueprintFolder,
    movieId,
    hash,
  });
  return `/viewer-api/blueprints/blob?${params.toString()}`;
}

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
