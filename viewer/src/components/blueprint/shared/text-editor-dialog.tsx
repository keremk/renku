/**
 * Unified text editor dialog component for displaying and editing text content
 * with syntax highlighting. Used across Inputs, Models, and Outputs panels.
 *
 * Features:
 * - Syntax highlighting for JSON and Markdown
 * - Optional variables panel for prompt templates
 * - Semantic layout presets per panel context
 * - Dark/light mode support with Renku theme
 */

import { useState, useCallback, useRef } from 'react';
import { Editor } from 'prism-react-editor';
import { BasicSetup } from 'prism-react-editor/setups';

// Language grammars
import 'prism-react-editor/prism/languages/json';
import 'prism-react-editor/prism/languages/markdown';

// Required CSS
import 'prism-react-editor/layout.css';
import 'prism-react-editor/search.css';

// Renku editor theme (warm amber palette)
import '@/styles/prism-renku-dark.css';
import '@/styles/prism-renku-light.css';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useDarkMode } from '@/hooks/use-dark-mode';

export interface TextEditorDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Dialog title */
  title: string;
  /** Text content to display/edit */
  content: string;
  /** Language for syntax highlighting (direct) */
  language?: 'json' | 'markdown';
  /** MIME type (alternative to language, for outputs) */
  mimeType?: string;
  /** Variables available for prompt templates (only shown when editable) */
  variables?: string[];
  /** Callback when content is saved (undefined = readOnly) */
  onSave?: (content: string) => void;
  /** Whether save is in progress */
  isSaving?: boolean;
  /** Semantic layout preset to avoid cross-panel sizing collisions */
  preset?: TextEditorDialogPreset;
  /**
   * Legacy size variant.
   * Prefer `preset` for new call sites; kept for backwards compatibility.
   */
  size?: 'compact' | 'default' | 'large';
  /** Whether to show language badge in title (default: true) */
  showLanguageBadge?: boolean;
}

export type TextEditorDialogPreset =
  | 'input-edit'
  | 'prompt-authoring'
  | 'output-edit'
  | 'inline-compact';

type DialogPresetConfig = {
  dialogClasses: string;
  editorSizingClass: string;
};

const PRESET_CONFIGS: Record<TextEditorDialogPreset, DialogPresetConfig> = {
  'inline-compact': {
    dialogClasses:
      'w-[40vw] max-w-xl max-h-[50vh] flex flex-col overflow-hidden p-0 gap-0',
    editorSizingClass: 'min-h-[120px]',
  },
  'input-edit': {
    dialogClasses: 'w-[46vw] max-w-3xl h-[40vh] flex flex-col overflow-hidden p-0 gap-0',
    editorSizingClass: 'min-h-0',
  },
  'prompt-authoring': {
    dialogClasses: 'w-[72vw] max-w-6xl h-[84vh] flex flex-col overflow-hidden p-0 gap-0',
    editorSizingClass: 'min-h-0',
  },
  'output-edit': {
    dialogClasses: 'w-[42vw] max-w-3xl h-[46vh] flex flex-col overflow-hidden p-0 gap-0',
    editorSizingClass: 'min-h-0',
  },
};

const LEGACY_SIZE_PRESET: Record<
  'compact' | 'default' | 'large',
  TextEditorDialogPreset
> = {
  compact: 'inline-compact',
  default: 'input-edit',
  large: 'prompt-authoring',
};

/**
 * Get prism-react-editor language from MIME type.
 * Treats text/plain as markdown since LLM outputs often contain markdown formatting.
 */
function getLanguageFromMimeType(mimeType: string): 'json' | 'markdown' {
  if (mimeType === 'application/json') {
    return 'json';
  }
  // Treat text/plain as markdown - LLM outputs often contain markdown formatting
  return 'markdown';
}

/**
 * Unified text editor dialog for displaying and editing text content.
 * Consolidates TextCardDialog, PromptEditDialog, and ArtifactTextEditDialog.
 *
 * Presets:
 * - "prompt-authoring": larger workspace for long prompts in Models panel
 * - "output-edit": compact editor for prompt artifacts in Outputs panel
 * - "input-edit": medium dialog for Inputs panel editing
 * - "inline-compact": compact quick-edit dialog for inline properties
 */
export function TextEditorDialog({
  open,
  onOpenChange,
  title,
  content,
  language,
  mimeType,
  variables,
  onSave,
  isSaving = false,
  preset,
  size = 'default',
  showLanguageBadge = true,
}: TextEditorDialogProps) {
  const isDark = useDarkMode();

  // Track the current value via ref to avoid re-renders
  const valueRef = useRef(content);
  // Key to force remount editor when content changes
  const [editorKey, setEditorKey] = useState(0);

  // Determine language from prop or mimeType
  const resolvedLanguage =
    language ?? (mimeType ? getLanguageFromMimeType(mimeType) : 'markdown');

  // Read-only when no onSave callback provided
  const readOnly = !onSave;

  // Show variables panel when variables exist and editable
  const showVariables = variables && variables.length > 0 && !readOnly;

  // Reset to content when dialog opens
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (isOpen) {
        valueRef.current = content;
        // Force remount editor with new content
        setEditorKey((k) => k + 1);
      }
      onOpenChange(isOpen);
    },
    [content, onOpenChange]
  );

  const handleSaveAndClose = useCallback(() => {
    onSave?.(valueRef.current);
  }, [onSave]);

  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  // Track value changes without causing re-renders
  const handleUpdate = useCallback((value: string) => {
    valueRef.current = value;
  }, []);

  // Insert a variable (copies to clipboard)
  const handleInsertVariable = useCallback((variable: string) => {
    navigator.clipboard.writeText(`{{${variable}}}`);
  }, []);

  const resolvedPreset = preset ?? LEGACY_SIZE_PRESET[size];
  const { dialogClasses, editorSizingClass } = PRESET_CONFIGS[resolvedPreset];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={dialogClasses}>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2 text-[11px] uppercase tracking-[0.12em]'>
            <span className='truncate'>{title}</span>
            {showLanguageBadge && (
              <span className='text-xs font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded'>
                {resolvedLanguage.toUpperCase()}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className='sr-only'>
            {readOnly
              ? 'Review text content in the editor dialog.'
              : 'Edit text content in the editor dialog and save changes.'}
          </DialogDescription>
        </DialogHeader>

        <div className='flex-1 min-h-0 flex flex-col gap-4 px-6 pt-6 pb-4'>
          {/* Variables panel */}
          {showVariables && (
            <div>
              <div className='text-xs text-muted-foreground mb-2'>
                Available Variables (click to copy):
              </div>
              <div className='flex flex-wrap gap-1'>
                {variables.map((v) => (
                  <button
                    key={v}
                    type='button'
                    onClick={() => handleInsertVariable(v)}
                    className='text-xs bg-primary/10 text-primary px-2 py-1 rounded hover:bg-primary/20 transition-colors'
                  >
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Editor container */}
          <div
            className={cn(
              'relative flex-1 min-h-0 rounded-lg border overflow-hidden',
              editorSizingClass,
              isDark ? 'bg-editor-bg prism-dark' : 'bg-editor-bg prism-light'
            )}
          >
            <Editor
              key={editorKey}
              language={resolvedLanguage}
              value={content}
              onUpdate={handleUpdate}
              readOnly={readOnly}
              wordWrap={true}
              lineNumbers={false}
              style={{
                height: '100%',
                fontSize: '14px',
              }}
            >
              <BasicSetup />
            </Editor>
          </div>
        </div>

        <DialogFooter>
          {readOnly ? (
            <Button variant='outline' onClick={handleCancel}>
              Close
            </Button>
          ) : (
            <>
              <Button
                variant='outline'
                onClick={handleCancel}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button onClick={handleSaveAndClose} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
