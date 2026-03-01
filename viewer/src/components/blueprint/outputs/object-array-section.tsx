/**
 * ObjectArraySection: two-zone layout for object-array sub-groups.
 *
 * Fetches content for text/json artifacts in the group, classifies each
 * into compact (boolean/compact) vs. content, then renders:
 * - PropertyStrip for compact items (booleans, short strings)
 * - MediaGrid for content items (text cards, media cards, and failure cards)
 */

import { useState, useEffect, useCallback } from 'react';
import { RotateCcw, AlertCircle, Clock, File } from 'lucide-react';
import {
  getArtifactLabel,
  getBlobUrl,
  type ArtifactSubGroup,
} from '@/lib/artifact-utils';
import { inferDisplayType } from '@/lib/artifact-content-type';
import type { ArtifactDisplayType } from '@/lib/artifact-content-type';
import { PropertyStrip, type PropertyStripItem } from './property-strip';
import { EditedBadge } from './edited-badge';
import {
  MediaCard,
  MediaGrid,
  TextEditorDialog,
  VideoCard,
  AudioCard,
  ImageCard,
} from '../shared';
import { useExecution } from '@/contexts/execution-context';
import { editArtifactText, restoreArtifact } from '@/data/blueprint-client';
import type { ArtifactInfo } from '@/types/builds';

interface ObjectArraySectionProps {
  subGroup: ArtifactSubGroup;
  blueprintFolder: string;
  movieId: string;
  onArtifactUpdated?: () => void;
}

interface ClassifiedArtifact {
  artifact: ArtifactInfo;
  content: string;
  displayType: ArtifactDisplayType | null;
  label: string;
}

export function ObjectArraySection({
  subGroup,
  blueprintFolder,
  movieId,
  onArtifactUpdated,
}: ObjectArraySectionProps) {
  const [classified, setClassified] = useState<ClassifiedArtifact[] | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadAndClassify = async () => {
      setIsLoading(true);
      const results: ClassifiedArtifact[] = await Promise.all(
        subGroup.artifacts.map(
          async (artifact): Promise<ClassifiedArtifact> => {
            const label = getArtifactLabel(artifact.id, subGroup);

            // Non-text artifacts go to content grid
            const isText =
              artifact.mimeType.startsWith('text/') ||
              artifact.mimeType === 'application/json';

            if (
              !isText ||
              artifact.status === 'failed' ||
              artifact.status === 'skipped'
            ) {
              return {
                artifact,
                content: '',
                displayType: null,
                label,
              };
            }

            const url = getBlobUrl(blueprintFolder, movieId, artifact.hash);
            try {
              const res = await fetch(url);
              const text = await res.text();
              const displayType = inferDisplayType(text);
              return { artifact, content: text, displayType, label };
            } catch {
              return {
                artifact,
                content: 'Failed to load',
                displayType: 'text',
                label,
              };
            }
          }
        )
      );

      if (!cancelled) {
        setClassified(results);
        setIsLoading(false);
      }
    };

    loadAndClassify();
    return () => {
      cancelled = true;
    };
  }, [subGroup, blueprintFolder, movieId]);

  if (isLoading || !classified) {
    return (
      <div className='space-y-2 animate-pulse'>
        <div className='h-10 bg-muted/30 rounded-lg' />
        <div className='grid [grid-template-columns:repeat(auto-fill,minmax(20rem,20rem))] justify-start gap-5'>
          {[1, 2, 3].map((i) => (
            <div key={i} className='aspect-video bg-muted/30 rounded-xl' />
          ))}
        </div>
      </div>
    );
  }

  const compactItems = classified.filter(
    (c): c is ClassifiedArtifact & { displayType: 'boolean' | 'compact' } =>
      c.displayType === 'boolean' || c.displayType === 'compact'
  );
  const contentItems = classified.filter(
    (c) => c.displayType === 'text' || c.displayType === null
  );

  const propertyStripItems: PropertyStripItem[] = compactItems.map((c) => ({
    artifactId: c.artifact.id,
    label: c.label,
    displayType: c.displayType,
    content: c.content,
    mimeType: c.artifact.mimeType,
    isEdited: c.artifact.editedBy === 'user',
  }));

  return (
    <div>
      {propertyStripItems.length > 0 && (
        <PropertyStrip
          items={propertyStripItems}
          blueprintFolder={blueprintFolder}
          movieId={movieId}
          onArtifactUpdated={onArtifactUpdated}
        />
      )}
      {contentItems.length > 0 && (
        <MediaGrid className='!grid-cols-[repeat(auto-fill,minmax(20rem,20rem))] justify-start'>
          {contentItems.map((item) =>
            item.displayType === 'text' ? (
              <ContentCard
                key={item.artifact.id}
                artifact={item.artifact}
                content={item.content}
                label={item.label}
                blueprintFolder={blueprintFolder}
                movieId={movieId}
                onArtifactUpdated={onArtifactUpdated}
              />
            ) : (
              <NonTextArtifactCard
                key={item.artifact.id}
                artifact={item.artifact}
                label={item.label}
                blueprintFolder={blueprintFolder}
                movieId={movieId}
                onArtifactUpdated={onArtifactUpdated}
              />
            )
          )}
        </MediaGrid>
      )}
    </div>
  );
}

/**
 * Simplified text card for object-array content items.
 * Click → opens edit dialog directly. No action dropdown.
 */
function ContentCard({
  artifact,
  content,
  label,
  blueprintFolder,
  movieId,
  onArtifactUpdated,
}: {
  artifact: ArtifactInfo;
  content: string;
  label: string;
  blueprintFolder: string;
  movieId: string;
  onArtifactUpdated?: () => void;
}) {
  const { isArtifactSelected, isArtifactPinned } = useExecution();
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const isSelected = isArtifactSelected(artifact.id);
  const isPinned = isArtifactPinned(artifact.id);
  const isEdited = artifact.editedBy === 'user';

  const isJson = artifact.mimeType === 'application/json';
  const displayContent = isJson
    ? formatJson(content)
    : content.slice(0, 500) + (content.length > 500 ? '...' : '');

  const handleSaveEdit = useCallback(
    async (newContent: string) => {
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
        console.error('[ObjectArraySection] Edit failed:', error);
      } finally {
        setIsSaving(false);
      }
    },
    [
      blueprintFolder,
      movieId,
      artifact.id,
      artifact.mimeType,
      onArtifactUpdated,
    ]
  );

  const handleRestore = useCallback(async () => {
    try {
      await restoreArtifact(blueprintFolder, movieId, artifact.id);
      onArtifactUpdated?.();
    } catch (error) {
      console.error('[ObjectArraySection] Restore failed:', error);
    }
  }, [blueprintFolder, movieId, artifact.id, onArtifactUpdated]);

  const footer = (
    <ObjectArrayCardFooter
      label={label}
      isEdited={isEdited}
      onRestore={isEdited ? handleRestore : undefined}
    />
  );

  return (
    <>
      <MediaCard isSelected={isSelected} isPinned={isPinned} footer={footer}>
        <button
          type='button'
          onClick={() => setIsEditDialogOpen(true)}
          className='min-h-[100px] max-h-[180px] w-full bg-muted/30 p-3 text-left overflow-hidden'
        >
          <pre className='text-xs text-muted-foreground font-mono whitespace-pre-wrap overflow-hidden h-full'>
            {displayContent}
          </pre>
        </button>
      </MediaCard>

      <TextEditorDialog
        key={isEditDialogOpen ? `edit-${artifact.hash}` : 'closed'}
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        title={label}
        content={content}
        mimeType={artifact.mimeType}
        onSave={handleSaveEdit}
        isSaving={isSaving}
        preset='output-edit'
      />
    </>
  );
}

function NonTextArtifactCard({
  artifact,
  label,
  blueprintFolder,
  movieId,
  onArtifactUpdated,
}: {
  artifact: ArtifactInfo;
  label: string;
  blueprintFolder: string;
  movieId: string;
  onArtifactUpdated?: () => void;
}) {
  const { isArtifactSelected, isArtifactPinned } = useExecution();
  const isSelected = isArtifactSelected(artifact.id);
  const isPinned = isArtifactPinned(artifact.id);

  if (artifact.status === 'failed' || artifact.status === 'skipped') {
    return (
      <FailedArtifactCard
        artifact={artifact}
        label={label}
        isSelected={isSelected}
      />
    );
  }

  const url = getBlobUrl(blueprintFolder, movieId, artifact.hash);
  const isEdited = artifact.editedBy === 'user';

  const handleRestore = async () => {
    try {
      await restoreArtifact(blueprintFolder, movieId, artifact.id);
      onArtifactUpdated?.();
    } catch (error) {
      console.error('[ObjectArraySection] Restore failed:', error);
    }
  };

  const footer = (
    <ObjectArrayCardFooter
      label={label}
      isEdited={isEdited}
      onRestore={isEdited ? handleRestore : undefined}
    />
  );

  if (artifact.mimeType.startsWith('video/')) {
    return (
      <VideoCard
        url={url}
        title={label}
        isSelected={isSelected}
        isPinned={isPinned}
        footer={footer}
      />
    );
  }

  if (artifact.mimeType.startsWith('audio/')) {
    return (
      <AudioCard
        url={url}
        title={label}
        isSelected={isSelected}
        isPinned={isPinned}
        footer={footer}
      />
    );
  }

  if (artifact.mimeType.startsWith('image/')) {
    return (
      <ImageCard
        url={url}
        title={label}
        isSelected={isSelected}
        isPinned={isPinned}
        footer={footer}
      />
    );
  }

  return (
    <MediaCard isSelected={isSelected} isPinned={isPinned} footer={footer}>
      <div className='aspect-video bg-muted/30 flex flex-col items-center justify-center gap-2 p-4'>
        <File className='size-12 text-muted-foreground' />
        <div className='text-xs text-muted-foreground'>
          {formatFileSize(artifact.size)}
        </div>
        <div className='text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded'>
          {artifact.mimeType}
        </div>
      </div>
    </MediaCard>
  );
}

function FailedArtifactCard({
  artifact,
  label,
  isSelected,
}: {
  artifact: ArtifactInfo;
  label: string;
  isSelected: boolean;
}) {
  const isConditionalSkip = artifact.failureReason === 'conditions_not_met';
  const Icon = isConditionalSkip ? Clock : AlertCircle;
  const iconClass = isConditionalSkip
    ? 'text-muted-foreground'
    : 'text-destructive';
  const borderClass = isConditionalSkip
    ? 'border-muted'
    : 'border-destructive/50';

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
  } else if (artifact.status === 'failed') {
    failureMessage = 'Generation failed';
  } else {
    failureMessage = 'Skipped';
  }

  return (
    <MediaCard
      isSelected={isSelected}
      className={borderClass}
      footer={<span className='text-xs text-foreground truncate'>{label}</span>}
    >
      <div className='aspect-video bg-muted/30 flex flex-col items-center justify-center gap-2 p-4'>
        <Icon className={`size-10 ${iconClass}`} />
        <div className={`text-xs text-center ${iconClass}`}>
          {failureMessage}
        </div>
      </div>
    </MediaCard>
  );
}

function ObjectArrayCardFooter({
  label,
  isEdited,
  onRestore,
}: {
  label: string;
  isEdited: boolean;
  onRestore?: () => void;
}) {
  return (
    <>
      <div className='flex items-center gap-1.5 flex-1 min-w-0'>
        <span className='text-xs text-foreground truncate' title={label}>
          {label}
        </span>
        {isEdited && <EditedBadge />}
      </div>
      {isEdited && onRestore && (
        <button
          type='button'
          onClick={(e) => {
            e.stopPropagation();
            onRestore();
          }}
          className='p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground'
          title='Restore original'
        >
          <RotateCcw className='size-3.5' />
        </button>
      )}
    </>
  );
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
