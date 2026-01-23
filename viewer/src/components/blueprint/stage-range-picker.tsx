/**
 * Stage Range Picker
 *
 * A custom component for selecting execution stage ranges.
 * Uses discrete clickable boxes for each stage, only allows contiguous range selections,
 * and enforces business rules based on previous run history.
 */

import { useCallback, useMemo } from 'react';
import {
  isValidStartStage,
  type StageStatus,
  type StageValidationContext,
} from '@gorenku/core/browser';

export type { StageStatus };

interface StageRangePickerProps {
  /** Total number of stages in the plan */
  totalStages: number;
  /** Current selected range */
  value: { startStage: number; endStage: number };
  /** Callback when range changes */
  onChange: (range: { startStage: number; endStage: number }) => void;
  /** Stage statuses from previous run, or null for clean run */
  stageStatuses: StageStatus[] | null;
  /** Whether the picker is disabled */
  disabled?: boolean;
}

/**
 * Status display for a stage in the picker.
 */
type StageDisplayStatus = 'selected' | 'valid' | 'disabled' | 'succeeded' | 'failed' | 'not-run';

export function StageRangePicker({
  totalStages,
  value,
  onChange,
  stageStatuses,
  disabled = false,
}: StageRangePickerProps) {
  // Build validation context
  const validationContext: StageValidationContext = useMemo(
    () => ({
      totalStages,
      stageStatuses,
    }),
    [totalStages, stageStatuses],
  );

  // Calculate which stages are valid start stages
  const validStartStages = useMemo(() => {
    const valid = new Set<number>();
    for (let i = 0; i < totalStages; i++) {
      if (isValidStartStage(i, validationContext)) {
        valid.add(i);
      }
    }
    return valid;
  }, [totalStages, validationContext]);

  /**
   * Get the display status for a stage box.
   */
  const getStageDisplayStatus = useCallback(
    (stageIndex: number): StageDisplayStatus => {
      const { startStage, endStage } = value;

      // Selected: within the current range
      if (stageIndex >= startStage && stageIndex <= endStage) {
        return 'selected';
      }

      // Check if this is a valid start stage
      const canStartHere = validStartStages.has(stageIndex);

      // If not a valid start and before the current start, it's disabled
      if (!canStartHere && stageIndex < startStage) {
        // Show the historical status if available
        if (stageStatuses) {
          const status = stageStatuses[stageIndex];
          if (status === 'succeeded') return 'succeeded';
          if (status === 'failed') return 'failed';
          return 'not-run';
        }
        return 'disabled';
      }

      // If valid start or within extendable range
      if (canStartHere || stageIndex > endStage) {
        return 'valid';
      }

      // Show status from previous run
      if (stageStatuses) {
        const status = stageStatuses[stageIndex];
        if (status === 'succeeded') return 'succeeded';
        if (status === 'failed') return 'failed';
      }

      return 'valid';
    },
    [value, validStartStages, stageStatuses],
  );

  /**
   * Handle clicking a stage box.
   */
  const handleStageClick = useCallback(
    (stageIndex: number) => {
      if (disabled) return;

      const { startStage, endStage } = value;
      const isMultiStageRange = endStage > startStage;

      // If clicking before current start
      if (stageIndex < startStage) {
        // Only move start if it's a valid start stage
        if (validStartStages.has(stageIndex)) {
          onChange({ startStage: stageIndex, endStage });
        }
        return;
      }

      // If clicking after current end
      if (stageIndex > endStage) {
        onChange({ startStage, endStage: stageIndex });
        return;
      }

      // Clicking within range

      // Special case: clicking on start stage when range has multiple stages
      // → collapse to just the start stage
      if (stageIndex === startStage && isMultiStageRange) {
        onChange({ startStage, endStage: startStage });
        return;
      }

      // Special case: clicking on end stage when range has multiple stages
      // → collapse to just the end stage (if it's a valid start)
      if (stageIndex === endStage && isMultiStageRange) {
        if (validStartStages.has(endStage)) {
          onChange({ startStage: endStage, endStage });
        }
        return;
      }

      // Clicking somewhere in the middle - determine which handle is closer
      const distToStart = stageIndex - startStage;
      const distToEnd = endStage - stageIndex;

      if (distToStart <= distToEnd) {
        // Closer to start - move start (if valid)
        if (validStartStages.has(stageIndex)) {
          onChange({ startStage: stageIndex, endStage });
        }
      } else {
        // Closer to end - move end
        onChange({ startStage, endStage: stageIndex });
      }
    },
    [disabled, value, validStartStages, onChange],
  );

  /**
   * Get CSS classes for a stage box based on its status.
   */
  const getStageClasses = useCallback((status: StageDisplayStatus): string => {
    const base = 'w-8 h-8 rounded-md flex items-center justify-center text-xs font-medium transition-all cursor-pointer';

    switch (status) {
      case 'selected':
        return `${base} bg-primary text-primary-foreground ring-2 ring-primary ring-offset-1 ring-offset-background`;
      case 'valid':
        return `${base} bg-muted hover:bg-muted/80 text-foreground border border-border/60 hover:border-primary/50`;
      case 'succeeded':
        return `${base} bg-green-500/20 text-green-600 border border-green-500/40 opacity-60 cursor-default`;
      case 'failed':
        return `${base} bg-red-500/20 text-red-600 border border-red-500/40 opacity-60 cursor-not-allowed`;
      case 'not-run':
        return `${base} bg-muted/50 text-muted-foreground border border-border/30 opacity-60 cursor-not-allowed`;
      case 'disabled':
      default:
        return `${base} bg-muted/30 text-muted-foreground/60 border border-border/20 opacity-40 cursor-not-allowed`;
    }
  }, []);

  // Don't show if only 1 stage or less (after all hooks)
  if (totalStages <= 1) {
    return null;
  }

  return (
    <div className={`flex flex-col gap-2 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <div className="flex items-center gap-1.5">
        {Array.from({ length: totalStages }, (_, i) => {
          const status = getStageDisplayStatus(i);
          const isClickable = status === 'selected' || status === 'valid';

          return (
            <button
              key={i}
              type="button"
              onClick={() => handleStageClick(i)}
              disabled={disabled || !isClickable}
              className={getStageClasses(status)}
              title={getStageTooltip(i, status, stageStatuses?.[i])}
            >
              {i}
            </button>
          );
        })}
      </div>

      {/* Range display */}
      <div className="text-xs text-muted-foreground">
        {value.startStage === 0 && value.endStage === totalStages - 1 ? (
          <span>Running all stages (0-{totalStages - 1})</span>
        ) : value.startStage === value.endStage ? (
          <span>Running stage {value.startStage} only</span>
        ) : (
          <span>Running stages {value.startStage} to {value.endStage}</span>
        )}
      </div>
    </div>
  );
}

/**
 * Generate tooltip text for a stage box.
 */
function getStageTooltip(
  index: number,
  displayStatus: StageDisplayStatus,
  stageStatus: StageStatus | undefined,
): string {
  switch (displayStatus) {
    case 'selected':
      return `Stage ${index} (selected)`;
    case 'valid':
      return `Click to select stage ${index}`;
    case 'succeeded':
      return `Stage ${index}: Completed successfully`;
    case 'failed':
      return `Stage ${index}: Failed - cannot start from stage ${index + 1}`;
    case 'not-run':
      return `Stage ${index}: Not run yet`;
    case 'disabled':
      return stageStatus === 'failed'
        ? `Stage ${index}: Failed - cannot start after this stage`
        : `Stage ${index}: Previous stage must succeed first`;
    default:
      return `Stage ${index}`;
  }
}
