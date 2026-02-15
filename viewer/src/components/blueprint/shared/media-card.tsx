import { cn } from "@/lib/utils";

interface MediaCardProps {
  /** Card content (media preview area) */
  children: React.ReactNode;
  /** Footer content (typically label + actions) */
  footer: React.ReactNode;
  /** Optional class name for the container */
  className?: string;
  /** Whether the card is selected for regeneration */
  isSelected?: boolean;
  /** Whether the card is pinned (kept from regeneration) */
  isPinned?: boolean;
  /** Optional click handler for the card */
  onClick?: () => void;
}

/**
 * Generic card container for media items.
 * Provides consistent styling with content area and footer.
 */
export function MediaCard({
  children,
  footer,
  className,
  isSelected = false,
  isPinned = false,
  onClick,
}: MediaCardProps) {
  const Wrapper = onClick ? "button" : "div";

  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "rounded-xl border bg-card overflow-hidden flex flex-col transition-all text-left w-full shadow-lg",
        isPinned
          ? "border-amber-500 ring-2 ring-amber-500/40 shadow-xl -translate-y-1"
          : isSelected
            ? "border-primary ring-2 ring-primary/40 shadow-xl -translate-y-1"
            : "border-border",
        onClick && "hover:border-primary/70 hover:shadow-xl hover:-translate-y-1 cursor-pointer",
        className
      )}
    >
      <div className="flex-1 min-h-0">{children}</div>
      <div className="border-t border-border/60 bg-muted/50 px-4 py-3 flex items-center justify-between gap-2">
        {footer}
      </div>
    </Wrapper>
  );
}
