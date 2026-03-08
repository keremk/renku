/**
 * Run button for triggering generation.
 * Shows different states based on execution status.
 * Includes a persistent scope selector for layer-limited runs.
 */

import { Play, Loader2, Square, ChevronDown, Check } from 'lucide-react';
import { useExecution } from '@/contexts/execution-context';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ExecutionStatus } from '@/types/generation';

interface RunButtonProps {
  blueprintName: string;
  movieId?: string;
}

/**
 * Get button configuration based on execution status.
 */
function getButtonConfig(
  status: ExecutionStatus,
  isStopping: boolean
): {
  icon: typeof Play;
  label: string;
  variant: 'default' | 'destructive';
  spinning: boolean;
  disabled: boolean;
} {
  // Show "Stopping..." state when cancellation is in progress
  if (isStopping) {
    return {
      icon: Loader2,
      label: 'Stopping...',
      variant: 'destructive',
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
        label: 'Run',
        variant: 'default',
        spinning: false,
        disabled: false,
      };
    case 'planning':
      return {
        icon: Loader2,
        label: 'Planning...',
        variant: 'default',
        spinning: true,
        disabled: true,
      };
    case 'confirming':
      return {
        icon: Play,
        label: 'Run',
        variant: 'default',
        spinning: false,
        disabled: true,
      };
    case 'executing':
      return {
        icon: Square,
        label: 'Stop',
        variant: 'destructive',
        spinning: false,
        disabled: false,
      };
    default:
      return {
        icon: Play,
        label: 'Run',
        variant: 'default',
        spinning: false,
        disabled: false,
      };
  }
}

function formatLayerLabel(layerIndex: number): string {
  return `Layer ${layerIndex + 1}`;
}

function getScopeLabel(upToLayer: number | null): string {
  if (upToLayer === null) {
    return 'All Layers';
  }
  return `Through ${formatLayerLabel(upToLayer)}`;
}

function isTerminalStatus(status: ExecutionStatus): boolean {
  return (
    status === 'completed' || status === 'failed' || status === 'cancelled'
  );
}

/**
 * Get CSS classes for button variant.
 */
function getVariantClasses(variant: string): string {
  switch (variant) {
    case 'destructive':
      return 'bg-destructive hover:bg-destructive/90 text-white';
    default:
      return 'bg-primary hover:bg-primary/90 text-secondary-foreground';
  }
}

export function RunButton({ blueprintName, movieId }: RunButtonProps) {
  const { state, requestPlan, cancelExecution, reset, setLayerRange } =
    useExecution();
  const config = getButtonConfig(state.status, state.isStopping);
  const Icon = config.icon;

  // Get total layers from state (set from graph topology on load)
  const totalLayers = state.totalLayers ?? 0;
  const selectedUpToLayer = state.layerRange.upToLayer;
  const scopeLabel = getScopeLabel(selectedUpToLayer);

  const handleRun = async () => {
    if (state.status === 'executing') {
      await cancelExecution();
      return;
    }

    if (isTerminalStatus(state.status)) {
      reset();
    }

    await requestPlan(blueprintName, movieId, selectedUpToLayer ?? undefined);
  };

  const handleScopeSelect = (upToLayer: number | null) => {
    setLayerRange({ upToLayer });
  };

  // Show scope selector only when there are multiple layers.
  const showScopeSelector = totalLayers > 1;
  const scopeDisabled =
    state.isStopping ||
    state.status === 'planning' ||
    state.status === 'confirming' ||
    state.status === 'executing';

  // Check if any artifacts are selected for regeneration
  const hasSelectedArtifacts = state.selectedForRegeneration.size > 0;

  return (
    <div className='inline-flex items-center gap-2'>
      {showScopeSelector && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              disabled={scopeDisabled}
              className={`
                inline-flex h-7 items-center gap-2 px-3
                rounded-md border border-border/40
                bg-sidebar-header-bg
                text-xs font-medium
                transition-colors duration-150
                hover:bg-item-hover-bg
                disabled:opacity-50 disabled:cursor-not-allowed
              `}
            >
              <span className='text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground'>
                Scope
              </span>
              <span className='text-xs font-medium text-foreground'>
                {scopeLabel}
              </span>
              <ChevronDown className='w-4 h-4' />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='min-w-[220px]'>
            <DropdownMenuItem
              onClick={() => handleScopeSelect(null)}
              className='flex items-center justify-between'
            >
              <span>All Layers</span>
              {selectedUpToLayer === null && <Check className='h-4 w-4' />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {Array.from({ length: totalLayers }, (_, i) => (
              <DropdownMenuItem
                key={i}
                onClick={() => handleScopeSelect(i)}
                className='flex items-center justify-between'
              >
                <span>Through {formatLayerLabel(i)}</span>
                {selectedUpToLayer === i && <Check className='h-4 w-4' />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <button
        onClick={handleRun}
        disabled={config.disabled}
        className={`
          inline-flex h-7 items-center gap-2 px-3
          rounded-md
          text-xs font-medium
          transition-all duration-200
          disabled:opacity-50 disabled:cursor-not-allowed
          ${getVariantClasses(config.variant)}
        `}
      >
        <Icon
          className={`h-3.5 w-3.5 ${config.spinning ? 'animate-spin' : ''}`}
        />
        {config.label}
        {hasSelectedArtifacts && state.status !== 'executing' && (
          <span className='text-xs opacity-75'>
            ({state.selectedForRegeneration.size})
          </span>
        )}
      </button>
    </div>
  );
}
