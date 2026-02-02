import { useState, useMemo } from "react";
import { FileText, Plus } from "lucide-react";
import { MediaCard } from "../shared/media-card";
import { InputCardFooter } from "./input-card-footer";
import { TextEditDialog } from "./text-edit-dialog";
import type { BlueprintInputDef } from "@/types/blueprint-graph";
import { cn } from "@/lib/utils";

/**
 * Props using input definition (original interface for inputs panel).
 */
interface InputDefProps {
  /** Input definition */
  input: BlueprintInputDef;
  label?: never;
  description?: never;
}

/**
 * Props using direct label/description (for prompts and other uses).
 */
interface DirectProps {
  /** Label to display in footer */
  label: string;
  /** Optional description */
  description?: string;
  input?: never;
}

/**
 * Props for custom dialog rendering.
 */
interface CustomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onSave: (value: string) => void;
}

type TextInputCardProps = (InputDefProps | DirectProps) & {
  /** Current text value */
  value: unknown;
  /** Callback when value changes */
  onChange: (value: string) => void;
  /** Whether the input is editable */
  isEditable: boolean;
  /** Whether the card is selected */
  isSelected?: boolean;
  /**
   * Optional custom dialog renderer.
   * If provided, will be used instead of TextEditDialog.
   * Useful for prompts that need syntax highlighting or variable insertion.
   */
  renderDialog?: (props: CustomDialogProps) => React.ReactNode;
};

/**
 * Card component for text type inputs.
 * Shows a preview of the text with edit support via dialog.
 *
 * Can be used with either:
 * - `input` prop (BlueprintInputDef) for inputs panel
 * - `label` and `description` props directly for prompts and other uses
 *
 * Supports custom dialog via `renderDialog` prop for specialized editing
 * (e.g., prompts with syntax highlighting and variables).
 */
export function TextInputCard({
  input,
  label: directLabel,
  description: directDescription,
  value,
  onChange,
  isEditable,
  isSelected = false,
  renderDialog,
}: TextInputCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  // Get label and description from either source
  const label = input?.name ?? directLabel ?? "";
  const description = input?.description ?? directDescription;

  // Convert value to string
  const textValue = useMemo(() => {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    return String(value);
  }, [value]);

  // Truncate for preview
  const previewText = useMemo(() => {
    if (!textValue) return null;
    const maxLength = 200;
    if (textValue.length <= maxLength) return textValue;
    return textValue.slice(0, maxLength) + "...";
  }, [textValue]);

  const isEmpty = !textValue;

  // Render the edit dialog (custom or default)
  const dialog = renderDialog ? (
    renderDialog({
      open: dialogOpen,
      onOpenChange: setDialogOpen,
      value: textValue,
      onSave: onChange,
    })
  ) : (
    <TextEditDialog
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      label={label}
      description={description}
      value={textValue}
      onSave={onChange}
    />
  );

  // Empty state - show placeholder
  if (isEmpty && !isEditable) {
    return (
      <MediaCard
        isSelected={isSelected}
        footer={
          <InputCardFooter
            label={label}
            description={description}
            disabled={true}
          />
        }
      >
        <div className="aspect-video bg-muted/30 flex flex-col items-center justify-center gap-3 p-6 text-muted-foreground">
          <FileText className="size-8" />
          <span className="text-xs">No content</span>
        </div>
      </MediaCard>
    );
  }

  // Empty editable state - show add placeholder
  if (isEmpty && isEditable) {
    return (
      <>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className={cn(
            "w-full aspect-video rounded-xl border-2 border-dashed transition-all",
            "flex flex-col items-center justify-center gap-3",
            "bg-muted/30 text-muted-foreground",
            "hover:border-primary hover:bg-primary/10 hover:text-foreground hover:shadow-lg hover:-translate-y-1 cursor-pointer"
          )}
        >
          <div className="w-14 h-14 rounded-full bg-muted/50 flex items-center justify-center">
            <FileText className="size-7" />
          </div>
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <Plus className="size-3.5" />
            <span>Add {label}</span>
          </div>
        </button>

        {dialog}
      </>
    );
  }

  return (
    <>
      <MediaCard
        isSelected={isSelected}
        onClick={isEditable ? () => setDialogOpen(true) : undefined}
        footer={
          <InputCardFooter
            label={label}
            description={description}
            onEdit={isEditable ? () => setDialogOpen(true) : undefined}
            disabled={!isEditable}
          />
        }
      >
        <div className="aspect-video bg-muted/30 p-4 overflow-hidden">
          <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap h-full overflow-hidden">
            {previewText}
          </pre>
        </div>
      </MediaCard>

      {dialog}
    </>
  );
}
