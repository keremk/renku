import { Button } from "@/components/ui/button";

interface PanelHeaderProps {
  title: string;
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => void;
}

/**
 * Shared header component for editable panels.
 * Shows a title and "Save Changes" button when there are unsaved changes.
 */
export function PanelHeader({ title, isDirty, isSaving, onSave }: PanelHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      {isDirty && (
        <Button
          size="sm"
          onClick={onSave}
          disabled={isSaving}
          className="h-7 px-3 text-xs"
        >
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
      )}
    </div>
  );
}
