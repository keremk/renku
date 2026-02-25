/**
 * PropertyStrip: horizontal inline row of compact artifact properties.
 * Renders booleans as toggle switches and short strings as clickable badges.
 * No per-item action dropdowns — actions live at the producer level.
 */

import { useState, useCallback } from 'react';
import { Switch } from '@/components/ui/switch';
import { EditedBadge } from './edited-badge';
import { TextEditorDialog } from '../shared';
import { editArtifactText, restoreArtifact } from '@/data/blueprint-client';
import { RotateCcw } from 'lucide-react';
import type { ArtifactDisplayType } from '@/lib/artifact-content-type';

export interface PropertyStripItem {
  artifactId: string;
  label: string;
  displayType: ArtifactDisplayType;
  content: string;
  mimeType: string;
  isEdited: boolean;
}

interface PropertyStripProps {
  items: PropertyStripItem[];
  blueprintFolder: string;
  movieId: string;
  onArtifactUpdated?: () => void;
}

export function PropertyStrip({
  items,
  blueprintFolder,
  movieId,
  onArtifactUpdated,
}: PropertyStripProps) {
  if (items.length === 0) return null;

  return (
    <div className='flex flex-col gap-1.5 px-4 py-3 bg-muted/30 rounded-lg border border-border/40 mb-3'>
      {items.map((item) => (
        <PropertyItem
          key={item.artifactId}
          item={item}
          blueprintFolder={blueprintFolder}
          movieId={movieId}
          onArtifactUpdated={onArtifactUpdated}
        />
      ))}
    </div>
  );
}

function PropertyItem({
  item,
  blueprintFolder,
  movieId,
  onArtifactUpdated,
}: {
  item: PropertyStripItem;
  blueprintFolder: string;
  movieId: string;
  onArtifactUpdated?: () => void;
}) {
  if (item.displayType === 'boolean') {
    return (
      <BooleanPropertyItem
        item={item}
        blueprintFolder={blueprintFolder}
        movieId={movieId}
        onArtifactUpdated={onArtifactUpdated}
      />
    );
  }

  return (
    <CompactPropertyItem
      item={item}
      blueprintFolder={blueprintFolder}
      movieId={movieId}
      onArtifactUpdated={onArtifactUpdated}
    />
  );
}

function BooleanPropertyItem({
  item,
  blueprintFolder,
  movieId,
  onArtifactUpdated,
}: {
  item: PropertyStripItem;
  blueprintFolder: string;
  movieId: string;
  onArtifactUpdated?: () => void;
}) {
  const value = item.content.trim() === 'true';

  const handleToggle = useCallback(
    async (checked: boolean) => {
      try {
        await editArtifactText(
          blueprintFolder,
          movieId,
          item.artifactId,
          String(checked),
          item.mimeType
        );
        onArtifactUpdated?.();
      } catch (error) {
        console.error('[PropertyStrip] Boolean toggle failed:', error);
      }
    },
    [
      blueprintFolder,
      movieId,
      item.artifactId,
      item.mimeType,
      onArtifactUpdated,
    ]
  );

  const handleRestore = useCallback(async () => {
    try {
      await restoreArtifact(blueprintFolder, movieId, item.artifactId);
      onArtifactUpdated?.();
    } catch (error) {
      console.error('[PropertyStrip] Restore failed:', error);
    }
  }, [blueprintFolder, movieId, item.artifactId, onArtifactUpdated]);

  return (
    <div className='flex items-center gap-2 text-xs'>
      <span className='text-muted-foreground font-medium'>{item.label}</span>
      <Switch checked={value} onCheckedChange={handleToggle} size='sm' />
      {item.isEdited && <EditedBadge />}
      {item.isEdited && (
        <button
          type='button'
          onClick={handleRestore}
          className='p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground'
          title='Restore original'
        >
          <RotateCcw className='size-3' />
        </button>
      )}
    </div>
  );
}

function CompactPropertyItem({
  item,
  blueprintFolder,
  movieId,
  onArtifactUpdated,
}: {
  item: PropertyStripItem;
  blueprintFolder: string;
  movieId: string;
  onArtifactUpdated?: () => void;
}) {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSaveEdit = useCallback(
    async (newContent: string) => {
      setIsSaving(true);
      try {
        await editArtifactText(
          blueprintFolder,
          movieId,
          item.artifactId,
          newContent,
          item.mimeType
        );
        setIsEditDialogOpen(false);
        onArtifactUpdated?.();
      } catch (error) {
        console.error('[PropertyStrip] Save failed:', error);
      } finally {
        setIsSaving(false);
      }
    },
    [
      blueprintFolder,
      movieId,
      item.artifactId,
      item.mimeType,
      onArtifactUpdated,
    ]
  );

  const handleRestore = useCallback(async () => {
    try {
      await restoreArtifact(blueprintFolder, movieId, item.artifactId);
      onArtifactUpdated?.();
    } catch (error) {
      console.error('[PropertyStrip] Restore failed:', error);
    }
  }, [blueprintFolder, movieId, item.artifactId, onArtifactUpdated]);

  return (
    <>
      <div className='flex items-center gap-2 text-xs'>
        <span className='text-muted-foreground font-medium'>{item.label}</span>
        <button
          type='button'
          onClick={() => setIsEditDialogOpen(true)}
          className='bg-muted/60 text-foreground px-2 py-0.5 rounded truncate max-w-[200px] hover:bg-muted transition-colors'
          title={`Click to edit: ${item.content.trim()}`}
        >
          {item.content.trim()}
        </button>
        {item.isEdited && <EditedBadge />}
        {item.isEdited && (
          <button
            type='button'
            onClick={handleRestore}
            className='p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground'
            title='Restore original'
          >
            <RotateCcw className='size-3' />
          </button>
        )}
      </div>

      <TextEditorDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        title={item.label}
        content={item.content}
        mimeType={item.mimeType}
        onSave={handleSaveEdit}
        isSaving={isSaving}
        preset='inline-compact'
      />
    </>
  );
}
