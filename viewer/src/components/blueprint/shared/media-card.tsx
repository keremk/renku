import { cn } from "@/lib/utils";

interface MediaCardProps {
  /** Card content (media preview area) */
  children: React.ReactNode;
  /** Footer content (typically label + actions) */
  footer: React.ReactNode;
  /** Optional class name for the container */
  className?: string;
  /** Whether the card is selected */
  isSelected?: boolean;
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
  onClick,
}: MediaCardProps) {
  const Wrapper = onClick ? "button" : "div";

  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "rounded-xl border bg-card overflow-hidden flex flex-col transition-all text-left w-full",
        isSelected
          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
          : "border-border",
        onClick && "hover:border-primary/50 cursor-pointer",
        className
      )}
    >
      <div className="flex-1 min-h-0">{children}</div>
      <div className="border-t border-border bg-muted/50 px-3 py-2 flex items-center justify-between gap-2">
        {footer}
      </div>
    </Wrapper>
  );
}
