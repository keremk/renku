import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PromptPreviewProps {
  /** Label for the prompt (e.g., "System Prompt", "User Prompt") */
  label: string;
  /** The prompt content */
  content: string;
  /** Whether editing is enabled */
  isEditable: boolean;
  /** Callback when edit button is clicked */
  onEdit?: () => void;
}

/**
 * Highlights template variables like {{Variable}} in the prompt text.
 */
function highlightVariables(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /\{\{([^}]+)\}\}/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    // Add the highlighted variable
    parts.push(
      <span
        key={`var-${match.index}`}
        className="bg-primary/20 text-primary px-0.5 rounded font-medium"
      >
        {match[0]}
      </span>
    );
    lastIndex = regex.lastIndex;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

/**
 * Preview component for a prompt with collapsible content and edit button.
 * Shows first 3 lines with expand/collapse functionality.
 */
export function PromptPreview({
  label,
  content,
  isEditable,
  onEdit,
}: PromptPreviewProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Split content into lines
  const lines = useMemo(() => content.split("\n"), [content]);
  const hasMoreLines = lines.length > 3;
  const displayContent = isExpanded ? content : lines.slice(0, 3).join("\n");

  return (
    <div className="space-y-1">
      {/* Header with label and edit button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
            disabled={!hasMoreLines}
          >
            {hasMoreLines ? (
              isExpanded ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )
            ) : (
              <div className="size-3" />
            )}
          </button>
          <span className="text-xs font-medium text-muted-foreground">
            {label}
          </span>
          {hasMoreLines && !isExpanded && (
            <span className="text-xs text-muted-foreground">
              (+{lines.length - 3} more lines)
            </span>
          )}
        </div>
        {isEditable && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onEdit}
            className="h-6 px-2 text-xs gap-1"
          >
            <Pencil className="size-3" />
            Edit
          </Button>
        )}
      </div>

      {/* Content preview */}
      <div
        className={`
          text-xs text-foreground bg-background/50 p-2 rounded border border-border/30
          whitespace-pre-wrap font-mono
          ${!isExpanded && hasMoreLines ? "line-clamp-3" : ""}
        `}
      >
        {highlightVariables(displayContent)}
        {!isExpanded && hasMoreLines && (
          <span className="text-muted-foreground">...</span>
        )}
      </div>
    </div>
  );
}
