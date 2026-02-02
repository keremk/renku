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
        "rounded-xl transition-all",
        isHighlighted
          ? "bg-primary/15 shadow-lg"
          : "bg-muted/40",
        className
      )}
    >
      <div className="flex items-start gap-3 w-full group hover:bg-muted/60 rounded-t-xl px-4 py-3.5 transition-colors">
        <CollapsibleTrigger className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2.5">
            <span className="text-primary flex-shrink-0">
              {isOpen ? (
                <ChevronDown className="size-5" />
              ) : (
                <ChevronRight className="size-5" />
              )}
            </span>
            <span className="text-sm font-bold text-foreground truncate">
              {title}
            </span>
            {count !== undefined && (
              <span className="text-xs font-medium text-primary-foreground bg-primary px-2.5 py-0.5 rounded-full flex-shrink-0">
                {count}
              </span>
            )}
          </div>
          {description && (
            <p className="text-xs text-muted-foreground mt-1.5 ml-7 line-clamp-2">
              {description}
            </p>
          )}
        </CollapsibleTrigger>
        {actions && (
          <div className="flex-shrink-0 mt-0.5">{actions}</div>
        )}
      </div>
      <CollapsibleContent className={cn(!isOpen && "hidden")}>
        <div className="px-4 pb-4">
          {contentBackground ? (
            <div className="bg-card rounded-lg p-4 shadow-md">
              {children}
            </div>
          ) : (
            children
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
