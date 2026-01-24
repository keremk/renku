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

/**
 * Generates the range message with skip/stop annotations.
 */
interface RangeMessageProps {
  startStage: number;
  endStage: number;
  totalStages: number;
  stageStatuses: StageStatus[] | null;
}

function RangeMessage({ startStage, endStage, totalStages, stageStatuses }: RangeMessageProps) {
  const lastStage = totalStages - 1;

  // Count skipped layers (succeeded layers before startStage)
  const skippedLayers: number[] = [];
  for (let i = 0; i < startStage; i++) {
    if (stageStatuses?.[i] === 'succeeded') {
      skippedLayers.push(i);
    }
  }

  const hasSkipped = skippedLayers.length > 0;
  const hasStopped = endStage < lastStage;

  // Build main run message
  let runPart: string;
  if (startStage === endStage) {
    runPart = `Running stage ${startStage} only`;
  } else if (startStage === 0 && endStage === lastStage && hasSkipped) {
    runPart = `Re-running all stages (0-${lastStage})`;
  } else if (startStage === 0 && endStage === lastStage) {
    runPart = `Running all stages (0-${lastStage})`;
  } else {
    runPart = `Running stages ${startStage}-${endStage}`;
  }

  // Build annotations for skip/stop
  const annotations: string[] = [];
  if (hasSkipped) {
    const skippedStr =
      skippedLayers.length === 1
        ? `skipping ${skippedLayers[0]}`
        : `skipping ${skippedLayers[0]}-${skippedLayers[skippedLayers.length - 1]}`;
    annotations.push(skippedStr);
  }
  if (hasStopped) {
    annotations.push(`stopping before ${endStage + 1}`);
  }

  if (annotations.length > 0) {
    return <span>{runPart} ({annotations.join('; ')})</span>;
  }
  return <span>{runPart}</span>;
}

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
 * - 'selected': Within the run range [startStage, endStage]
 * - 'skipped': Succeeded stage before startStage (light green)
 * - 'stopped': Stage after endStage (gray - won't run this time)
 * - 'disabled': Not a valid start option (muted)
 */
type StageDisplayStatus = 'selected' | 'skipped' | 'stopped' | 'disabled';

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
   *
   * Visual states:
   * - 'selected': Within run range [startStage, endStage] - will run
   * - 'skipped': Succeeded stage before startStage - will be skipped (green)
   * - 'stopped': Stage after endStage - won't run this time (gray)
   * - 'disabled': Not clickable (e.g., stage before a failed stage)
   */
  const getStageDisplayStatus = useCallback(
    (stageIndex: number): StageDisplayStatus => {
      const { startStage, endStage } = value;

      // Layers within run range are selected
      if (stageIndex >= startStage && stageIndex <= endStage) {
        return 'selected';
      }

      // Layers before startStage
      if (stageIndex < startStage) {
        // If it's a valid start stage (succeeded), show as "skipped" (green)
        if (validStartStages.has(stageIndex)) {
          return 'skipped';
        }
        // Otherwise disabled (can't start from here)
        return 'disabled';
      }

      // Layers after endStage are "stopped" (gray - won't run this time)
      return 'stopped';
    },
    [value, validStartStages],
  );

  /**
   * Handle clicking a stage box.
   *
   * Click behavior:
   * - Click GREEN (skipped) layer → expand run range to include it (move startStage there)
   * - Click GRAY (stopped) layer → expand run range to include it (move endStage there)
   * - Click first SELECTED (at startStage, if succeeded) → skip it (move startStage forward)
   * - Click last SELECTED (at endStage) → stop earlier (move endStage backward)
   * - Click middle SELECTED → no action (no gaps allowed)
   */
  const handleStageClick = useCallback(
    (stageIndex: number) => {
      if (disabled) return;

      const { startStage, endStage } = value;
      const status = getStageDisplayStatus(stageIndex);

      // Click on GREEN (skipped) layer → move startStage there (expand run to include it)
      if (status === 'skipped') {
        onChange({ startStage: stageIndex, endStage });
        return;
      }

      // Click on GRAY (stopped) layer → move endStage there (run more)
      if (status === 'stopped') {
        onChange({ startStage, endStage: stageIndex });
        return;
      }

      // Click on selected layer
      if (status === 'selected') {
        // First selected (at startStage) - can skip if it succeeded and not the only stage
        if (stageIndex === startStage) {
          const canSkip = stageStatuses?.[stageIndex] === 'succeeded';
          if (canSkip && startStage < endStage) {
            onChange({ startStage: stageIndex + 1, endStage });
          }
          return;
        }

        // Last selected (at endStage) - can shrink if not at startStage
        if (stageIndex === endStage && endStage > startStage) {
          onChange({ startStage, endStage: stageIndex - 1 });
          return;
        }

        // Middle selected - no action (no gaps allowed in range)
      }
    },
    [disabled, value, getStageDisplayStatus, stageStatuses, onChange],
  );

  /**
   * Get CSS classes for a stage button based on its status and position.
   * Uses ShadCN button group styling - connected buttons with shared border.
   *
   * Visual states:
   * - selected: Primary color (will run)
   * - skipped: Light green (succeeded, will be skipped)
   * - stopped: Muted gray (won't run this time)
   * - disabled: Very muted, not clickable
   */
  const getStageClasses = useCallback(
    (status: StageDisplayStatus, index: number): string => {
      const isFirst = index === 0;
      const isLast = index === totalStages - 1;

      // Base classes for button group items
      const base = [
        'h-9 px-3 min-w-[2.25rem]',
        'inline-flex items-center justify-center',
        'text-sm font-medium',
        'transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'border-y border-r border-input',
        // First button gets left border and rounded left corners
        isFirst ? 'border-l rounded-l-md' : '',
        // Last button gets rounded right corners
        isLast ? 'rounded-r-md' : '',
      ].join(' ');

      switch (status) {
        case 'selected':
          // Will run - primary color
          return `${base} bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer`;
        case 'skipped':
          // Succeeded, will be skipped - light green, clickable to re-include
          return `${base} bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900 cursor-pointer`;
        case 'stopped':
          // After endStage - gray, clickable to extend run
          return `${base} bg-muted text-muted-foreground hover:bg-muted/80 cursor-pointer`;
        case 'disabled':
        default:
          // Not a valid option - very muted, not clickable
          return `${base} bg-muted/30 text-muted-foreground/60 opacity-50 cursor-not-allowed`;
      }
    },
    [totalStages],
  );

  // Don't show if only 1 stage or less (after all hooks)
  if (totalStages <= 1) {
    return null;
  }

  return (
    <div className={`flex flex-col gap-2 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* Button Group */}
      <div className="inline-flex" role="group">
        {Array.from({ length: totalStages }, (_, i) => {
          const status = getStageDisplayStatus(i);
          // All states except 'disabled' are clickable
          const isClickable = status !== 'disabled';

          return (
            <button
              key={i}
              type="button"
              onClick={() => handleStageClick(i)}
              disabled={disabled || !isClickable}
              className={getStageClasses(status, i)}
              title={getStageTooltip(i, status, stageStatuses?.[i])}
            >
              {i}
            </button>
          );
        })}
      </div>

      {/* Range display with skip/stop annotations */}
      <div className="text-xs text-muted-foreground">
        <RangeMessage
          startStage={value.startStage}
          endStage={value.endStage}
          totalStages={totalStages}
          stageStatuses={stageStatuses}
        />
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
      return `Stage ${index}: Will run (click to adjust range)`;
    case 'skipped':
      return `Stage ${index}: Will be skipped (click to re-include)`;
    case 'stopped':
      return `Stage ${index}: Won't run (click to include)`;
    case 'disabled':
      return stageStatus === 'failed'
        ? `Stage ${index}: Failed - cannot start after this stage`
        : `Stage ${index}: Previous stage must succeed first`;
    default:
      return `Stage ${index}`;
  }
}
