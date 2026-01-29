import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface TextEditDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Input label/name */
  label: string;
  /** Optional input description */
  description?: string;
  /** Current text value */
  value: string;
  /** Callback when text is saved */
  onSave: (value: string) => void;
}

/**
 * Full-screen dialog for editing text inputs.
 * Saves on explicit save, discards on cancel.
 */
export function TextEditDialog({
  open,
  onOpenChange,
  label,
  description,
  value,
  onSave,
}: TextEditDialogProps) {
  // Track the edit value locally
  const [editValue, setEditValue] = useState(value);

  // Handle dialog open state changes
  // Reset to prop value when opening, preserve state when closing
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (isOpen) {
        // Reset to current prop value when dialog opens
        setEditValue(value);
      }
      onOpenChange(isOpen);
    },
    [value, onOpenChange]
  );

  const handleSaveAndClose = useCallback(() => {
    onSave(editValue);
    onOpenChange(false);
  }, [editValue, onSave, onOpenChange]);

  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex flex-col gap-1">
            <span>{label}</span>
            {description && (
              <span className="text-sm font-normal text-muted-foreground">
                {description}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 flex flex-col gap-4">
          <Textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="flex-1 min-h-[300px] resize-none font-mono text-sm"
            placeholder={`Enter ${label}...`}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button onClick={handleSaveAndClose}>Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
