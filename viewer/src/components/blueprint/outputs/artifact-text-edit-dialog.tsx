/**
 * Dialog for editing text artifacts (JSON, Markdown) with syntax highlighting.
 * Uses prism-react-editor for a proper code editing experience.
 */

import { useState, useCallback, useEffect, useRef } from "react";
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
import { cn } from "@/lib/utils";

interface ArtifactTextEditDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Artifact display name */
  title: string;
  /** Current text content */
  content: string;
  /** MIME type (application/json or text/markdown) */
  mimeType: string;
  /** Callback when text is saved (optional when readOnly) */
  onSave?: (content: string) => void;
  /** Whether save is in progress */
  isSaving?: boolean;
  /** Whether the dialog is read-only (view mode) */
  readOnly?: boolean;
}

/**
 * Get prism-react-editor language from MIME type.
 * Treats text/plain as markdown since LLM outputs often contain markdown formatting
 * and markdown highlighting handles plain text gracefully.
 */
function getLanguageFromMimeType(mimeType: string): string {
  if (mimeType === "application/json") {
    return "json";
  }
  // Treat text/plain as markdown - LLM outputs often contain markdown formatting
  // and markdown highlighting handles plain text gracefully
  if (
    mimeType.includes("markdown") ||
    mimeType === "text/markdown" ||
    mimeType === "text/plain"
  ) {
    return "markdown";
  }
  // Fallback to markdown for unknown types
  return "markdown";
}

/**
 * Dialog for editing text artifacts with proper code editing experience.
 * Uses prism-react-editor for syntax highlighting and editing.
 */
export function ArtifactTextEditDialog({
  open,
  onOpenChange,
  title,
  content,
  mimeType,
  onSave,
  isSaving = false,
  readOnly = false,
}: ArtifactTextEditDialogProps) {
  // Track the current value via ref to avoid re-renders
  const valueRef = useRef(content);
  // Key to force remount editor when content changes
  const [editorKey, setEditorKey] = useState(0);
  const language = getLanguageFromMimeType(mimeType);

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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[60vw] max-w-7xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="truncate">{title}</span>
            <span className="text-xs font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {language.toUpperCase()}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col gap-4">
          {/* Editor container */}
          <div
            className={cn(
              "relative flex-1 min-h-[400px] rounded-lg border overflow-hidden",
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
