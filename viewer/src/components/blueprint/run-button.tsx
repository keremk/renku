/**
 * Run button for triggering generation.
 * Shows different states based on execution status.
 */

import { Play, Loader2, Square } from "lucide-react";
import { useExecution } from "@/contexts/execution-context";
import type { ExecutionStatus } from "@/types/generation";

interface RunButtonProps {
  blueprintName: string;
  movieId?: string;
}

/**
 * Get button configuration based on execution status.
 */
function getButtonConfig(status: ExecutionStatus, isStopping: boolean): {
  icon: typeof Play;
  label: string;
  variant: "default" | "destructive";
  spinning: boolean;
  disabled: boolean;
} {
  // Show "Stopping..." state when cancellation is in progress
  if (isStopping) {
    return {
      icon: Loader2,
      label: "Stopping...",
      variant: "destructive",
      spinning: true,
      disabled: true,
    };
  }

  switch (status) {
    case 'idle':
    case 'completed':
    case 'failed':
    case 'cancelled':
      // All "done" states show "Run" and open the dialog
      return {
        icon: Play,
        label: "Run",
        variant: "default",
        spinning: false,
        disabled: false,
      };
    case 'planning':
      return {
        icon: Loader2,
        label: "Planning...",
        variant: "default",
        spinning: true,
        disabled: true,
      };
    case 'confirming':
      return {
        icon: Play,
        label: "Run",
        variant: "default",
        spinning: false,
        disabled: true,
      };
    case 'executing':
      return {
        icon: Square,
        label: "Stop",
        variant: "destructive",
        spinning: false,
        disabled: false,
      };
    default:
      return {
        icon: Play,
        label: "Run",
        variant: "default",
        spinning: false,
        disabled: false,
      };
  }
}

/**
 * Get CSS classes for button variant.
 */
function getVariantClasses(variant: string): string {
  switch (variant) {
    case 'destructive':
      return "bg-destructive hover:bg-destructive/90 text-white";
    default:
      return "bg-primary hover:bg-primary/90 text-secondary-foreground";
  }
}

export function RunButton({ blueprintName, movieId }: RunButtonProps) {
  const { state, requestPlan, cancelExecution, reset } = useExecution();
  const config = getButtonConfig(state.status, state.isStopping);
  const Icon = config.icon;

  const handleClick = async () => {
    if (state.status === 'executing') {
      await cancelExecution();
    } else if (state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') {
      reset();
      await requestPlan(blueprintName, movieId);
    } else if (state.status === 'idle') {
      await requestPlan(blueprintName, movieId);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={config.disabled}
      className={`
        inline-flex items-center gap-2 px-4 py-1.5 rounded-md
        text-sm font-medium
        transition-all duration-200
        disabled:opacity-50 disabled:cursor-not-allowed
        ${getVariantClasses(config.variant)}
      `}
    >
      <Icon
        className={`w-4 h-4 ${config.spinning ? "animate-spin" : ""}`}
      />
      {config.label}
    </button>
  );
}
