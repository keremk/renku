import { MoreHorizontal, Pencil, Trash2, Maximize2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface InputCardFooterProps {
  /** Input label/name to display */
  label: string;
  /** Optional description (shown via title attribute) */
  description?: string;
  /** Callback when Expand is clicked */
  onExpand?: () => void;
  /** Callback when Edit is clicked */
  onEdit?: () => void;
  /** Callback when Remove is clicked */
  onRemove?: () => void;
  /** Whether Remove option should be shown */
  canRemove?: boolean;
  /** Whether actions are disabled */
  disabled?: boolean;
}

/**
 * Footer component for input cards with label and dropdown menu.
 */
export function InputCardFooter({
  label,
  description,
  onExpand,
  onEdit,
  onRemove,
  canRemove = false,
  disabled = false,
}: InputCardFooterProps) {
  const showDropdown = !disabled && (onExpand || onEdit || (canRemove && onRemove));

  return (
    <>
      <span
        className="text-xs text-foreground truncate flex-1"
        title={description ?? label}
      >
        {label}
      </span>

      {showDropdown && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onExpand && (
              <DropdownMenuItem onClick={onExpand}>
                <Maximize2 className="size-4" />
                <span>Expand</span>
              </DropdownMenuItem>
            )}
            {onExpand && (onEdit || (canRemove && onRemove)) && (
              <DropdownMenuSeparator />
            )}
            {onEdit && (
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="size-4" />
                <span>Edit</span>
              </DropdownMenuItem>
            )}
            {canRemove && onRemove && (
              <DropdownMenuItem
                onClick={onRemove}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="size-4" />
                <span>Remove</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}
