import { ChevronDown, Save, Undo2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface SaveChangesButtonProps {
  /** Whether there are unsaved changes */
  isDirty: boolean;
  /** Whether a save operation is in progress */
  isSaving: boolean;
  /** Callback to save changes */
  onSave: () => Promise<void>;
  /** Callback to undo changes (reloads from build folder) */
  onUndo: () => void;
  /** Optional class name for the container */
  className?: string;
}

/**
 * A button with dropdown for saving changes or undoing edits.
 * Only visible when there are unsaved changes.
 * Positioned in the tab bar, left of the RUN button.
 */
export function SaveChangesButton({
  isDirty,
  isSaving,
  onSave,
  onUndo,
  className,
}: SaveChangesButtonProps) {
  // Don't render if there are no changes
  if (!isDirty && !isSaving) {
    return null;
  }

  const handleSave = async () => {
    try {
      await onSave();
    } catch (error) {
      console.error("Failed to save changes:", error);
    }
  };

  return (
    <div className={className}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="default"
            disabled={isSaving}
            className="gap-2 px-4 py-1.5 h-auto text-sm font-medium"
          >
            {isSaving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save className="size-4" />
                <span>Save Changes</span>
                <ChevronDown className="size-4" />
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[160px]">
          <DropdownMenuItem onClick={handleSave} disabled={isSaving}>
            <Save className="size-4" />
            <span>Save Changes</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onUndo} disabled={isSaving}>
            <Undo2 className="size-4" />
            <span>Undo Changes</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
