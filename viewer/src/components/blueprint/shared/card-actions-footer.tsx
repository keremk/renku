/**
 * Unified card footer component with label and action dropdown.
 * Used across Inputs, Models, and Outputs panels.
 *
 * CRITICAL: This component returns a React fragment (<>), NOT a wrapper div.
 * This preserves MediaCard's justify-between layout.
 */

import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export interface CardAction {
  /** Unique identifier for the action */
  id: string;
  /** Display label for the action */
  label: string;
  /** Icon component to display */
  icon: React.ComponentType<{ className?: string }>;
  /** Click handler */
  onClick: () => void;
  /** Show separator before this action */
  separator?: boolean;
  /** Additional content after the label (e.g., checkmark) */
  suffix?: React.ReactNode;
  /** Red styling for destructive actions */
  destructive?: boolean;
}

export interface CardActionsFooterProps {
  /** Primary label displayed on the left */
  label: string;
  /** Optional description (shown via title attribute on label) */
  description?: string;
  /** List of actions for the dropdown menu */
  actions?: CardAction[];
  /** Optional badge element to show after the label (e.g., EditedBadge) */
  badge?: React.ReactNode;
  /** Whether actions are disabled */
  disabled?: boolean;
}

/**
 * Footer component for cards with label and dropdown actions menu.
 *
 * CRITICAL: Returns a fragment (<>), not a wrapper div, to preserve
 * MediaCard's flex justify-between layout.
 *
 * Layout within MediaCard:
 * <div class="flex items-center justify-between gap-2">
 *   {footer} <!-- Must be fragment with two flex children -->
 * </div>
 */
export function CardActionsFooter({
  label,
  description,
  actions,
  badge,
  disabled = false,
}: CardActionsFooterProps) {
  const showDropdown = !disabled && actions && actions.length > 0;

  return (
    <>
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <span
          className="text-xs text-foreground truncate"
          title={description ?? label}
        >
          {label}
        </span>
        {badge}
      </div>
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
            {actions.map((action, index) => (
              <CardActionItem
                key={action.id}
                action={action}
                showSeparator={Boolean(action.separator) && index > 0}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}

function CardActionItem({
  action,
  showSeparator,
}: {
  action: CardAction;
  showSeparator: boolean;
}) {
  const Icon = action.icon;

  return (
    <>
      {showSeparator && <DropdownMenuSeparator />}
      <DropdownMenuItem
        onClick={action.onClick}
        className={action.destructive ? "text-destructive focus:text-destructive" : undefined}
      >
        <Icon className="size-4" />
        <span className={action.suffix ? "flex-1" : undefined}>{action.label}</span>
        {action.suffix}
      </DropdownMenuItem>
    </>
  );
}
