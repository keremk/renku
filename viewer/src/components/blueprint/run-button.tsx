/**
 * Run button for triggering generation.
 * Shows different states based on execution status.
 * Includes a dropdown to select "up to which layer" to run.
 */

import { Play, Loader2, Square, ChevronDown } from "lucide-react";
import { useExecution } from "@/contexts/execution-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  showDropdown: boolean;
} {
  // Show "Stopping..." state when cancellation is in progress
  if (isStopping) {
    return {
      icon: Loader2,
      label: "Stopping...",
      variant: "destructive",
      spinning: true,
      disabled: true,
      showDropdown: false,
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
        showDropdown: true,
      };
    case 'planning':
      return {
        icon: Loader2,
        label: "Planning...",
        variant: "default",
        spinning: true,
        disabled: true,
        showDropdown: false,
      };
    case 'confirming':
      return {
        icon: Play,
        label: "Run",
        variant: "default",
        spinning: false,
        disabled: true,
        showDropdown: false,
      };
    case 'executing':
      return {
        icon: Square,
        label: "Stop",
        variant: "destructive",
        spinning: false,
        disabled: false,
        showDropdown: false,
      };
    default:
      return {
        icon: Play,
        label: "Run",
        variant: "default",
        spinning: false,
        disabled: false,
        showDropdown: true,
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

  // Get total layers from state (set from graph topology on load)
  const totalLayers = state.totalLayers ?? 0;

  const handleRunAll = async () => {
    if (state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') {
      reset();
    }
    await requestPlan(blueprintName, movieId);
  };

  const handleRunUpTo = async (layer: number) => {
    if (state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') {
      reset();
    }
    await requestPlan(blueprintName, movieId, layer);
  };

  const handleClick = async () => {
    if (state.status === 'executing') {
      await cancelExecution();
    } else {
      await handleRunAll();
    }
  };

  // Show dropdown only when we have more than 1 layer
  const showDropdown = config.showDropdown && totalLayers > 1;

  // Check if any artifacts are selected for regeneration
  const hasSelectedArtifacts = state.selectedForRegeneration.size > 0;

  return (
    <div className="inline-flex">
      {/* Main button */}
      <button
        onClick={handleClick}
        disabled={config.disabled}
        className={`
          inline-flex items-center gap-2 px-4 py-1.5
          text-sm font-medium
          transition-all duration-200
          disabled:opacity-50 disabled:cursor-not-allowed
          ${showDropdown ? 'rounded-l-md' : 'rounded-md'}
          ${getVariantClasses(config.variant)}
        `}
      >
        <Icon
          className={`w-4 h-4 ${config.spinning ? "animate-spin" : ""}`}
        />
        {config.label}
        {hasSelectedArtifacts && config.showDropdown && (
          <span className="text-xs opacity-75">
            ({state.selectedForRegeneration.size})
          </span>
        )}
      </button>

      {/* Dropdown trigger */}
      {showDropdown && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              disabled={config.disabled}
              className={`
                inline-flex items-center px-2 py-1.5
                text-sm font-medium
                transition-all duration-200
                disabled:opacity-50 disabled:cursor-not-allowed
                rounded-r-md border-l border-white/20
                ${getVariantClasses(config.variant)}
              `}
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[180px]">
            <DropdownMenuItem onClick={handleRunAll}>
              Run All Layers
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {Array.from({ length: totalLayers }, (_, i) => (
              <DropdownMenuItem key={i} onClick={() => handleRunUpTo(i)}>
                Run up to Layer {i}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
