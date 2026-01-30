/**
 * Dialog for editing text artifacts (JSON, Markdown) with syntax highlighting.
 * Uses Prism.js for highlighting with Gruvbox theme.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markdown";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Import Gruvbox theme based on system preference
// The CSS files are loaded conditionally via className
import "@/styles/prism-gruvbox-dark.css";
import "@/styles/prism-gruvbox-light.css";

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
 * Get Prism.js language from MIME type.
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
 * Dialog for editing text artifacts with syntax-highlighted preview.
 * Uses a textarea for editing with a synchronized highlighted overlay.
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
  const [editValue, setEditValue] = useState(content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const language = getLanguageFromMimeType(mimeType);

  // Reset to content when dialog opens via onOpenChange callback
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (isOpen) {
        setEditValue(content);
      }
      onOpenChange(isOpen);
    },
    [content, onOpenChange]
  );

  const handleSaveAndClose = useCallback(() => {
    onSave?.(editValue);
  }, [editValue, onSave]);

  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  // Ref for the scrollable container in edit mode
  const containerRef = useRef<HTMLDivElement>(null);

  // Highlighted code memoized
  const highlightedCode = useMemo(() => {
    if (language === "plaintext") {
      return editValue;
    }
    try {
      return Prism.highlight(editValue, Prism.languages[language], language);
    } catch {
      return editValue;
    }
  }, [editValue, language]);

  // Determine theme class based on Tailwind's dark mode class
  const [isDark, setIsDark] = useState(() => {
    // Initial value from DOM
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
              "relative flex-1 min-h-[400px] rounded-lg border",
              isDark ? "bg-[#1d2021] prism-dark" : "bg-[#fbf1c7] prism-light"
            )}
          >
            {readOnly ? (
              /* Read-only mode: single scrollable pre element */
              <pre
                ref={preRef}
                className={cn(
                  "absolute inset-0 m-0 p-4 overflow-auto",
                  "font-mono text-sm whitespace-pre-wrap break-words",
                  `language-${language}`
                )}
              >
                <code
                  className={`language-${language}`}
                  dangerouslySetInnerHTML={{ __html: highlightedCode }}
                />
              </pre>
            ) : (
              /* Edit mode: single scrollable container with both elements inside */
              <div
                ref={containerRef}
                className="absolute inset-0 overflow-auto"
              >
                <div className="relative min-h-full">
                  {/* Highlighted code display - determines the content height */}
                  <pre
                    ref={preRef}
                    className={cn(
                      "m-0 p-4 pointer-events-none",
                      "font-mono text-sm whitespace-pre-wrap break-words leading-[1.5]",
                      `language-${language}`
                    )}
                    style={{ padding: "1rem" }}
                    aria-hidden
                  >
                    <code
                      className={`language-${language}`}
                      dangerouslySetInnerHTML={{ __html: highlightedCode }}
                    />
                  </pre>

                  {/* Transparent textarea overlaid on top */}
                  <textarea
                    ref={textareaRef}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className={cn(
                      "absolute inset-0 w-full h-full p-4 resize-none",
                      "font-mono text-sm whitespace-pre-wrap break-words leading-[1.5]",
                      "bg-transparent caret-zinc-800 dark:caret-zinc-200",
                      "text-transparent",
                      "selection:bg-primary/30 selection:text-transparent",
                      "focus:outline-none",
                      // Remove default textarea styling
                      "border-none outline-none"
                    )}
                    spellCheck={false}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            {readOnly ? (
              <Button variant="outline" onClick={handleCancel}>
                Close
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
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
