import { useState, useMemo } from "react";
import { FileText, Plus } from "lucide-react";
import { MediaCard } from "../shared/media-card";
import { InputCardFooter } from "./input-card-footer";
import { TextEditDialog } from "./text-edit-dialog";
import type { BlueprintInputDef } from "@/types/blueprint-graph";
import { cn } from "@/lib/utils";

interface TextInputCardProps {
  /** Input definition */
  input: BlueprintInputDef;
  /** Current text value */
  value: unknown;
  /** Callback when value changes */
  onChange: (value: string) => void;
  /** Whether the input is editable */
  isEditable: boolean;
}

/**
 * Card component for text type inputs.
 * Shows a preview of the text with edit support via dialog.
 */
export function TextInputCard({
  input,
  value,
  onChange,
  isEditable,
}: TextInputCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

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

  // Empty state - show placeholder
  if (isEmpty && !isEditable) {
    return (
      <MediaCard
        footer={
          <InputCardFooter
            label={input.name}
            description={input.description}
            disabled={true}
          />
        }
      >
        <div className="aspect-video bg-muted/30 flex flex-col items-center justify-center gap-2 p-4 text-muted-foreground">
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
            "flex flex-col items-center justify-center gap-2",
            "bg-muted/30 text-muted-foreground",
            "hover:border-primary/50 hover:bg-primary/5 hover:text-foreground cursor-pointer"
          )}
        >
          <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center">
            <FileText className="size-6" />
          </div>
          <div className="flex items-center gap-1 text-xs">
            <Plus className="size-3" />
            <span>Add {input.name}</span>
          </div>
        </button>

        <TextEditDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          label={input.name}
          description={input.description}
          value={textValue}
          onSave={onChange}
        />
      </>
    );
  }

  return (
    <>
      <MediaCard
        onClick={isEditable ? () => setDialogOpen(true) : undefined}
        footer={
          <InputCardFooter
            label={input.name}
            description={input.description}
            onEdit={isEditable ? () => setDialogOpen(true) : undefined}
            disabled={!isEditable}
          />
        }
      >
        <div className="aspect-video bg-muted/30 p-3 overflow-hidden">
          <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap h-full overflow-hidden">
            {previewText}
          </pre>
        </div>
      </MediaCard>

      <TextEditDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        label={input.name}
        description={input.description}
        value={textValue}
        onSave={onChange}
      />
    </>
  );
}
