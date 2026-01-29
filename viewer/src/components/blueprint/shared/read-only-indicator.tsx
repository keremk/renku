import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ReadOnlyIndicatorProps {
  /** Callback when Enable Editing is clicked */
  onEnableEditing: () => void;
  /** Whether enabling is in progress */
  isEnabling?: boolean;
}

/**
 * Compact read-only indicator for the tab bar.
 * Shows a badge with "Enable" button.
 */
export function ReadOnlyIndicator({
  onEnableEditing,
  isEnabling = false,
}: ReadOnlyIndicatorProps) {
  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/30">
      <Lock className="size-3.5 text-amber-500" />
      <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
        Read-only
      </span>
      <Button
        size="sm"
        variant="ghost"
        onClick={onEnableEditing}
        disabled={isEnabling}
        className="h-6 px-2 text-xs text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 hover:text-amber-700 dark:hover:text-amber-300"
      >
        {isEnabling ? "..." : "Enable"}
      </Button>
    </div>
  );
}
