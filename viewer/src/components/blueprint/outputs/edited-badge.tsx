/**
 * Badge indicating an artifact has been user-edited.
 */

import { cn } from "@/lib/utils";

interface EditedBadgeProps {
  className?: string;
}

/**
 * Amber badge showing "Edited" status for user-modified artifacts.
 */
export function EditedBadge({ className }: EditedBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium",
        "bg-amber-500/20 text-amber-600 dark:text-amber-400",
        className
      )}
    >
      Edited
    </span>
  );
}
