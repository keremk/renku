/**
 * ObjectArraySection: two-zone layout for object-array sub-groups.
 *
 * Fetches content for text/json artifacts in the group, classifies each
 * into compact (boolean/compact) vs. content, then renders:
 * - PropertyStrip for compact items (booleans, short strings)
 * - MediaGrid for content items (text cards, media cards, and failure cards)
 */

import { Fragment, useState, useEffect, useCallback } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  getArtifactLabel,
  getBlobUrl,
  type ArtifactSubGroup,
} from '@/lib/artifact-utils';
import { inferDisplayType } from '@/lib/artifact-content-type';
import type { ArtifactDisplayType } from '@/lib/artifact-content-type';
import { PropertyStrip, type PropertyStripItem } from './property-strip';
import { EditedBadge } from './edited-badge';
import { MediaCard, MediaGrid, TextEditorDialog } from '../shared';
import { useExecution } from '@/contexts/execution-context';
import { editArtifactText, restoreArtifact } from '@/data/blueprint-client';
import type { ArtifactInfo } from '@/types/builds';

interface ObjectArraySectionProps {
  subGroup: ArtifactSubGroup;
  blueprintFolder: string;
  movieId: string;
  onArtifactUpdated?: () => void;
  renderArtifactCard: (artifact: ArtifactInfo) => React.ReactNode;
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
  renderArtifactCard,
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
    isEdited: c.artifact.lastRevisionBy === 'user',
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
              <Fragment key={item.artifact.id}>
                {renderArtifactCard(item.artifact)}
              </Fragment>
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
  const isEdited = artifact.lastRevisionBy === 'user';

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

function formatJson(content: string): string {
  try {
    const parsed = JSON.parse(content);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return content;
  }
}
