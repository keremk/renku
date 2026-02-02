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

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { FileText, Plus, Maximize2 } from "lucide-react";
import { Editor } from "prism-react-editor";
import { BasicSetup } from "prism-react-editor/setups";

// Language grammars
import "prism-react-editor/prism/languages/json";
import "prism-react-editor/prism/languages/markdown";

// Required CSS
import "prism-react-editor/layout.css";
import "prism-react-editor/search.css";

// Gruvbox theme
import "@/styles/prism-gruvbox-dark.css";
import "@/styles/prism-gruvbox-light.css";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MediaCard } from "./media-card";
import { cn } from "@/lib/utils";

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
  language?: "json" | "markdown";
  /** Variables available for prompt templates */
  variables?: string[];
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
  language = "markdown",
  variables,
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
    if (!previewText) return "";
    if (language === "json") {
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

  // Empty state - non-editable
  if (isEmpty && !isEditable) {
    return (
      <MediaCard
        isSelected={isSelected}
        footer={<TextCardFooter label={label} description={description} />}
      >
        <div className="bg-muted/30 flex flex-col items-center justify-center gap-3 p-6 text-muted-foreground min-h-[120px]">
          <FileText className="size-8" />
          <span className="text-xs">No content</span>
        </div>
      </MediaCard>
    );
  }

  // Empty state - editable (add placeholder)
  if (isEmpty && isEditable) {
    return (
      <>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className={cn(
            "w-full rounded-xl border-2 border-dashed transition-all min-h-[120px]",
            "flex flex-col items-center justify-center gap-3",
            "bg-muted/30 text-muted-foreground",
            "hover:border-primary hover:bg-primary/10 hover:text-foreground hover:shadow-lg hover:-translate-y-1 cursor-pointer"
          )}
        >
          <div className="w-14 h-14 rounded-full bg-muted/50 flex items-center justify-center">
            <FileText className="size-7" />
          </div>
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <Plus className="size-3.5" />
            <span>Add {label}</span>
          </div>
        </button>

        <TextCardDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title={`Add ${label}`}
          content=""
          language={language}
          variables={variables}
          onSave={handleSave}
        />
      </>
    );
  }

  // Content state - show preview with hover overlay
  return (
    <>
      <MediaCard
        isSelected={isSelected}
        onClick={() => setDialogOpen(true)}
        footer={
          <TextCardFooter
            label={label}
            description={description}
            onEdit={isEditable ? () => setDialogOpen(true) : undefined}
          />
        }
      >
        <div className="bg-muted/30 p-4 text-left overflow-hidden group relative h-[200px]">
          <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap overflow-hidden h-full max-h-full">
            {formattedPreview}
          </pre>
          <div className="absolute inset-0 bg-linear-to-t from-card to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <Maximize2 className="size-8 text-foreground" />
          </div>
        </div>
      </MediaCard>

      <TextCardDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={isEditable ? `Edit ${label}` : label}
        content={value}
        language={language}
        variables={variables}
        onSave={isEditable ? handleSave : undefined}
        readOnly={!isEditable}
      />
    </>
  );
}

// ============================================================================
// Text Card Footer
// ============================================================================

interface TextCardFooterProps {
  label: string;
  description?: string;
  onEdit?: () => void;
}

function TextCardFooter({ label, description, onEdit }: TextCardFooterProps) {
  return (
    <>
      <div className="flex-1 min-w-0">
        <span className="text-xs text-foreground truncate block" title={label}>
          {label}
        </span>
        {description && (
          <span
            className="text-[10px] text-muted-foreground truncate block"
            title={description}
          >
            {description}
          </span>
        )}
      </div>
      {onEdit && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
        >
          Edit
        </button>
      )}
    </>
  );
}

// ============================================================================
// Text Card Dialog
// ============================================================================

interface TextCardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  content: string;
  language: "json" | "markdown";
  variables?: string[];
  onSave?: (content: string) => void;
  readOnly?: boolean;
  isSaving?: boolean;
}

function TextCardDialog({
  open,
  onOpenChange,
  title,
  content,
  language,
  variables,
  onSave,
  readOnly = false,
  isSaving = false,
}: TextCardDialogProps) {
  // Track the current value via ref to avoid re-renders
  const valueRef = useRef(content);
  // Key to force remount editor when content changes
  const [editorKey, setEditorKey] = useState(0);

  // Determine theme based on Tailwind's dark mode class
  const [isDark, setIsDark] = useState(() => {
    return document.documentElement.classList.contains("dark");
  });

  // Subscribe to dark mode changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

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

  const showVariables = variables && variables.length > 0 && !readOnly;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[60vw] max-w-5xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="truncate">{title}</span>
            <span className="text-xs font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {language.toUpperCase()}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col gap-4">
          {/* Variables panel */}
          {showVariables && (
            <div>
              <div className="text-xs text-muted-foreground mb-2">
                Available Variables (click to copy):
              </div>
              <div className="flex flex-wrap gap-1">
                {variables.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => handleInsertVariable(v)}
                    className="text-xs bg-primary/10 text-primary px-2 py-1 rounded hover:bg-primary/20 transition-colors"
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
              "relative flex-1 min-h-[300px] rounded-lg border overflow-hidden",
              isDark ? "bg-[#1d2021] prism-dark" : "bg-[#fbf1c7] prism-light"
            )}
          >
            <Editor
              key={editorKey}
              language={language}
              value={content}
              onUpdate={handleUpdate}
              readOnly={readOnly}
              wordWrap={true}
              lineNumbers={false}
              style={{
                height: "100%",
                fontSize: "14px",
              }}
            >
              <BasicSetup />
            </Editor>
          </div>

          <div className="flex justify-end gap-2">
            {readOnly ? (
              <Button variant="outline" onClick={handleCancel}>
                Close
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={handleCancel}
                  disabled={isSaving}
                >
                  Cancel
                </Button>
                <Button onClick={handleSaveAndClose} disabled={isSaving}>
                  {isSaving ? "Saving..." : "Save"}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
