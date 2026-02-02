import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface CollapsibleSectionProps {
  /** Section title */
  title: string;
  /** Optional item count to show as badge */
  count?: number;
  /** Whether to start expanded */
  defaultOpen?: boolean;
  /** Optional description to show below title */
  description?: string;
  /** Optional action buttons to render on the right side */
  actions?: React.ReactNode;
  /** Section content */
  children: React.ReactNode;
  /** Optional class name for the container */
  className?: string;
  /** Whether to wrap content in a subtle background for visual grouping */
  contentBackground?: boolean;
  /** Whether the entire section is highlighted (e.g., when selected) */
  isHighlighted?: boolean;
}

/**
 * Reusable collapsible section with header, count badge, and optional actions.
 * Used for grouping related items in panels.
 */
export function CollapsibleSection({
  title,
  count,
  defaultOpen = true,
  description,
  actions,
  children,
  className,
  contentBackground = false,
  isHighlighted = false,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className={cn(
        className,
        isHighlighted && "ring-1 ring-primary/30 bg-primary/5 rounded-lg"
      )}
    >
      <div className="flex items-start gap-2 w-full group hover:bg-muted/50 rounded-lg px-2 py-1.5 transition-colors">
        <CollapsibleTrigger className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground flex-shrink-0">
              {isOpen ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </span>
            <span className="text-sm font-medium text-foreground truncate">
              {title}
            </span>
            {count !== undefined && (
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full flex-shrink-0">
                {count}
              </span>
            )}
          </div>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5 ml-6 line-clamp-2">
              {description}
            </p>
          )}
        </CollapsibleTrigger>
        {actions && (
          <div className="flex-shrink-0 mt-0.5">{actions}</div>
        )}
      </div>
      <CollapsibleContent className={cn("pt-3", !isOpen && "hidden")}>
        {contentBackground ? (
          <div className="bg-muted/20 border border-border/30 rounded-lg p-3">
            {children}
          </div>
        ) : (
          children
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
