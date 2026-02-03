import { useMemo } from "react";
import { Pencil, Trash2, Maximize2 } from "lucide-react";
import { CardActionsFooter, type CardAction } from "../shared/card-actions-footer";

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
 * This is a thin wrapper around CardActionsFooter with input-specific action presets.
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
  // Build actions list based on what callbacks are provided
  const actions = useMemo((): CardAction[] => {
    const result: CardAction[] = [];

    if (onExpand) {
      result.push({
        id: "expand",
        label: "Expand",
        icon: Maximize2,
        onClick: onExpand,
      });
    }

    if (onEdit) {
      result.push({
        id: "edit",
        label: "Edit",
        icon: Pencil,
        onClick: onEdit,
        separator: result.length > 0, // separator after expand if present
      });
    }

    if (canRemove && onRemove) {
      result.push({
        id: "remove",
        label: "Remove",
        icon: Trash2,
        onClick: onRemove,
        destructive: true,
      });
    }

    return result;
  }, [onExpand, onEdit, onRemove, canRemove]);

  return (
    <CardActionsFooter
      label={label}
      description={description}
      actions={actions}
      disabled={disabled}
    />
  );
}
