/**
 * Dialog for editing prompts with syntax highlighting for variables.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { Editor } from "prism-react-editor";
import { BasicSetup } from "prism-react-editor/setups";

// Language grammars
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
import { cn } from "@/lib/utils";

interface PromptEditDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Dialog title (e.g., "Edit System Prompt") */
  title: string;
  /** Current prompt content */
  content: string;
  /** Variables available for use in the prompt */
  variables?: string[];
  /** Callback when prompt is saved */
  onSave: (content: string) => void | Promise<void>;
  /** Whether save is in progress */
  isSaving?: boolean;
}

/**
 * Dialog for editing prompts with a code editor.
 * Shows available variables and highlights them in the content.
 */
export function PromptEditDialog({
  open,
  onOpenChange,
  title,
  content,
  variables = [],
  onSave,
  isSaving = false,
}: PromptEditDialogProps) {
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
    onSave(valueRef.current);
  }, [onSave]);

  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  // Track value changes without causing re-renders
  const handleUpdate = useCallback((value: string) => {
    valueRef.current = value;
  }, []);

  // Insert a variable at cursor position (simplified - just copies to clipboard)
  const handleInsertVariable = useCallback((variable: string) => {
    navigator.clipboard.writeText(`{{${variable}}}`);
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[60vw] max-w-5xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col gap-4">
          {/* Variables panel */}
          {variables.length > 0 && (
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
              language="markdown"
              value={content}
              onUpdate={handleUpdate}
              wordWrap={true}
              style={{
                height: "100%",
                fontSize: "14px",
              }}
            >
              <BasicSetup />
            </Editor>
          </div>

          <div className="flex justify-end gap-2">
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
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
