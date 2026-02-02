import { cn } from "@/lib/utils";

interface MediaGridProps {
  /** Grid items */
  children: React.ReactNode;
  /** Optional class name for the container */
  className?: string;
}

/**
 * Responsive grid layout for media cards.
 * 1 column on mobile, 2 on sm, 3 on lg, 4 on xl.
 */
export function MediaGrid({ children, className }: MediaGridProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5",
        className
      )}
    >
      {children}
    </div>
  );
}
