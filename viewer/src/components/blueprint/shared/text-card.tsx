/**
 * Unified text card component for displaying and editing text content.
 * Used across Inputs panel (text inputs), Models panel (prompts), and Outputs panel (text artifacts).
 *
 * Features:
 * - Preview area with hover overlay and expand icon
 * - Click to open syntax-highlighted dialog
 * - Empty states for editable and non-editable modes
 * - Variables panel for prompt templates
 */

import { useState, useMemo, useCallback } from 'react';
import { FileText, Plus, Maximize2, Pencil } from 'lucide-react';
import { MediaCard } from './media-card';
import { TextEditorDialog } from './text-editor-dialog';
import type { TextEditorDialogPreset } from './text-editor-dialog';
import { CardActionsFooter, type CardAction } from './card-actions-footer';
import { cn } from '@/lib/utils';

export interface TextCardProps {
  /** Card label shown in footer */
  label: string;
  /** Optional description */
  description?: string;
  /** Text content to display */
  value: string;
  /** Whether content is editable */
  isEditable?: boolean;
  /** Whether card is selected */
  isSelected?: boolean;
  /** Callback when value changes (edit mode) */
  onChange?: (value: string) => void;
  /** Language for syntax highlighting (json, markdown). Defaults to markdown */
  language?: 'json' | 'markdown';
  /** Variables available for prompt templates */
  variables?: string[];
  /** Content area sizing: "fixed" (h-[200px]) or "aspect" (aspect-video). Defaults to "fixed" */
  sizing?: 'fixed' | 'aspect';
  /** Dialog preset for editing/expanding text content */
  dialogPreset?: TextEditorDialogPreset;
}

/** Safety limit for preview to avoid DOM performance issues with very large text */
const PREVIEW_SAFETY_LIMIT = 5000;

/**
 * Unified text card for displaying and editing text content.
 * Shows a preview with hover overlay, click to expand/edit in a dialog.
 */
export function TextCard({
  label,
  description,
  value,
  isEditable = false,
  isSelected = false,
  onChange,
  language = 'markdown',
  variables,
  sizing = 'fixed',
  dialogPreset,
}: TextCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  // Limit text for preview (CSS handles visual clipping, this is just a safety limit for DOM performance)
  const previewText = useMemo(() => {
    if (!value) return null;
    if (value.length <= PREVIEW_SAFETY_LIMIT) return value;
    return value.slice(0, PREVIEW_SAFETY_LIMIT);
  }, [value]);

  const isEmpty = !value;

  // Format JSON for display if needed (CSS handles visual clipping)
  const formattedPreview = useMemo(() => {
    if (!previewText) return '';
    if (language === 'json') {
      try {
        const parsed = JSON.parse(value);
        const formatted = JSON.stringify(parsed, null, 2);
        // Apply safety limit for DOM performance
        return formatted.length <= PREVIEW_SAFETY_LIMIT
          ? formatted
          : formatted.slice(0, PREVIEW_SAFETY_LIMIT);
      } catch {
        return previewText;
      }
    }
    return previewText;
  }, [previewText, language, value]);

  const handleSave = useCallback(
    (newValue: string) => {
      onChange?.(newValue);
      setDialogOpen(false);
    },
    [onChange]
  );

  // Build footer actions
  const footerActions = useMemo((): CardAction[] => {
    const actions: CardAction[] = [];

    if (isEditable) {
      actions.push({
        id: 'edit',
        label: 'Edit',
        icon: Pencil,
        onClick: () => setDialogOpen(true),
      });
    }

    return actions;
  }, [isEditable]);

  // Sizing classes
  const contentSizeClass = sizing === 'aspect' ? 'aspect-video' : 'h-[200px]';
  const emptyMinHeight = sizing === 'aspect' ? 'aspect-video' : 'min-h-[120px]';

  // Empty state - non-editable
  if (isEmpty && !isEditable) {
    return (
      <MediaCard
        isSelected={isSelected}
        footer={<CardActionsFooter label={label} description={description} />}
      >
        <div
          className={cn(
            'bg-muted/30 flex flex-col items-center justify-center gap-3 p-6 text-muted-foreground',
            emptyMinHeight
          )}
        >
          <FileText className='size-8' />
          <span className='text-xs'>No content</span>
        </div>
      </MediaCard>
    );
  }

  // Empty state - editable (add placeholder)
  if (isEmpty && isEditable) {
    return (
      <>
        <button
          type='button'
          onClick={() => setDialogOpen(true)}
          className={cn(
            'w-full rounded-xl border-2 border-dashed transition-all',
            emptyMinHeight,
            'flex flex-col items-center justify-center gap-3',
            'bg-muted/30 text-muted-foreground',
            'hover:border-primary hover:bg-primary/10 hover:text-foreground hover:shadow-lg hover:-translate-y-1 cursor-pointer'
          )}
        >
          <div className='w-14 h-14 rounded-full bg-muted/50 flex items-center justify-center'>
            <FileText className='size-7' />
          </div>
          <div className='flex items-center gap-1.5 text-xs font-medium'>
            <Plus className='size-3.5' />
            <span>Add {label}</span>
          </div>
        </button>

        <TextEditorDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title={`Add ${label}`}
          content=''
          language={language}
          variables={variables}
          onSave={handleSave}
          preset={dialogPreset}
        />
      </>
    );
  }

  // Content state - show preview with hover overlay
  // Note: Content area is clickable (button), not the entire card, to avoid nested buttons with dropdown
  return (
    <>
      <MediaCard
        isSelected={isSelected}
        footer={
          <CardActionsFooter
            label={label}
            description={description}
            actions={footerActions}
            disabled={!isEditable}
          />
        }
      >
        <button
          type='button'
          onClick={() => setDialogOpen(true)}
          className={cn(
            'w-full bg-muted/30 p-4 text-left overflow-hidden group relative',
            contentSizeClass
          )}
        >
          <pre className='text-xs text-muted-foreground font-mono whitespace-pre-wrap overflow-hidden h-full max-h-full'>
            {formattedPreview}
          </pre>
          <div className='absolute inset-0 bg-linear-to-t from-card to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center'>
            <Maximize2 className='size-8 text-foreground' />
          </div>
        </button>
      </MediaCard>

      <TextEditorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={isEditable ? `Edit ${label}` : label}
        content={value}
        language={language}
        variables={variables}
        onSave={isEditable ? handleSave : undefined}
        preset={dialogPreset}
      />
    </>
  );
}
