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
 * Auto-saves on close.
 */
export function TextEditDialog({
  open,
  onOpenChange,
  label,
  description,
  value,
  onSave,
}: TextEditDialogProps) {
  // Use a key to force remount when dialog opens, resetting internal state
  const [dialogKey, setDialogKey] = useState(0);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (isOpen) {
        // Increment key to force remount of dialog content
        setDialogKey((k) => k + 1);
      }
      onOpenChange(isOpen);
    },
    [onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <TextEditDialogContent
          key={dialogKey}
          label={label}
          description={description}
          value={value}
          onSave={onSave}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

interface TextEditDialogContentProps {
  label: string;
  description?: string;
  value: string;
  onSave: (value: string) => void;
  onClose: () => void;
}

function TextEditDialogContent({
  label,
  description,
  value,
  onSave,
  onClose,
}: TextEditDialogContentProps) {
  // Initialize with the current value
  const [editValue, setEditValue] = useState(value);

  const handleSaveAndClose = useCallback(() => {
    onSave(editValue);
    onClose();
  }, [editValue, onSave, onClose]);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <>
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
    </>
  );
}
