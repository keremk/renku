/**
 * Plan confirmation dialog.
 * Shows cost breakdown and allows user to confirm or cancel execution.
 */

import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StageRangePicker } from "./stage-range-picker";
import type { StageStatus } from "@gorenku/core/browser";
import { useExecution } from "@/contexts/execution-context";
import type { ProducerStatusMap, LayerRange, PlanDisplayInfo } from "@/types/generation";

/**
 * Format currency value for display.
 */
function formatCurrency(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

/**
 * Format currency value or show "N/A" if no cost data available.
 */
function formatCurrencyOrNA(value: number, hasCostData: boolean): string {
  if (!hasCostData) return "N/A";
  return formatCurrency(value);
}

/**
 * Calculate dynamic totals based on the selected stage range.
 */
function calculateRangeTotals(
  planInfo: PlanDisplayInfo,
  stageRange: { startStage: number; endStage: number }
): { layers: number; jobs: number; cost: number; minCost: number; maxCost: number } {
  const filtered = planInfo.layerBreakdown.filter(
    (l) => l.index >= stageRange.startStage && l.index <= stageRange.endStage
  );
  return {
    layers: filtered.length,
    jobs: filtered.reduce((sum, l) => sum + l.jobCount, 0),
    cost: filtered.reduce((sum, l) => sum + l.layerCost, 0),
    minCost: filtered.reduce((sum, l) => sum + l.layerMinCost, 0),
    maxCost: filtered.reduce((sum, l) => sum + l.layerMaxCost, 0),
  };
}

/**
 * Convert LayerRange to StageRange format.
 */
function layerRangeToStageRange(
  layerRange: LayerRange,
  totalLayers: number,
): { startStage: number; endStage: number } {
  return {
    startStage: layerRange.reRunFrom ?? 0,
    endStage: layerRange.upToLayer ?? totalLayers - 1,
  };
}

/**
 * Convert StageRange back to LayerRange format.
 */
function stageRangeToLayerRange(
  stageRange: { startStage: number; endStage: number },
  totalLayers: number,
): LayerRange {
  return {
    reRunFrom: stageRange.startStage === 0 ? null : stageRange.startStage,
    upToLayer: stageRange.endStage === totalLayers - 1 ? null : stageRange.endStage,
  };
}

/**
 * Derive stage statuses from producer statuses and plan layer breakdown.
 *
 * A stage is:
 * - 'succeeded' if all producers in that layer have status 'success'
 * - 'failed' if any producer has status 'error'
 * - 'not-run' otherwise
 */
function deriveStageStatusesFromProducerStatuses(
  planInfo: PlanDisplayInfo,
  producerStatuses: ProducerStatusMap,
): StageStatus[] | null {
  // If no producer statuses exist, this is a clean run
  if (Object.keys(producerStatuses).length === 0) {
    return null;
  }

  return planInfo.layerBreakdown.map((layer) => {
    const producers = layer.jobs.map((job) => job.producer);

    if (producers.length === 0) {
      return 'succeeded'; // Empty layers are considered succeeded
    }

    let hasAnyRun = false;
    let hasAnyFailed = false;
    let allSucceeded = true;

    for (const producer of producers) {
      const status = producerStatuses[producer];

      if (status === 'success') {
        hasAnyRun = true;
      } else if (status === 'error') {
        hasAnyRun = true;
        hasAnyFailed = true;
        allSucceeded = false;
      } else if (status === 'running' || status === 'pending') {
        // Currently running or pending - treat as not yet complete
        allSucceeded = false;
      } else {
        // 'not-run-yet' or undefined
        allSucceeded = false;
      }
    }

    if (!hasAnyRun) {
      return 'not-run';
    }

    if (hasAnyFailed) {
      return 'failed';
    }

    if (allSucceeded) {
      return 'succeeded';
    }

    // Partial run - treat as not-run for safety
    return 'not-run';
  });
}

export function PlanDialog() {
  const {
    state,
    setLayerRange,
    replanWithRange,
    confirmExecution,
    dismissDialog,
    clearLogs,
  } = useExecution();

  const { planInfo, status, layerRange, error, producerStatuses } = state;

  // Only show when in confirming state or when there's an error to display
  // Also keep dialog open during re-planning (planning status with existing planInfo)
  const isReplanning = status === 'planning' && planInfo !== null;
  const isOpen = status === 'confirming' || (status === 'failed' && error !== null) || isReplanning;

  // Derive stage statuses from producer statuses
  const stageStatuses = useMemo(() => {
    if (!planInfo) return null;
    return deriveStageStatusesFromProducerStatuses(planInfo, producerStatuses);
  }, [planInfo, producerStatuses]);

  // Convert layer range to stage range
  const stageRange = useMemo(() => {
    if (!planInfo) return { startStage: 0, endStage: 0 };
    return layerRangeToStageRange(layerRange, planInfo.layers);
  }, [layerRange, planInfo]);

  // Calculate dynamic totals based on selected stage range
  // Must be called before any early returns to satisfy React Hooks rules
  const rangeTotals = useMemo(() => {
    if (!planInfo) return { layers: 0, jobs: 0, cost: 0, minCost: 0, maxCost: 0 };
    return calculateRangeTotals(planInfo, stageRange);
  }, [planInfo, stageRange]);

  // Handle stage range changes
  const handleStageRangeChange = (newRange: { startStage: number; endStage: number }) => {
    if (!planInfo) return;
    const newLayerRange = stageRangeToLayerRange(newRange, planInfo.layers);

    // Check if reRunFrom changed - if so, we need to re-request the plan
    // because the planner optimizes out jobs based on existing artifacts
    const currentReRunFrom = layerRange.reRunFrom;
    const newReRunFrom = newLayerRange.reRunFrom;

    if (currentReRunFrom !== newReRunFrom) {
      // Re-request the plan with new reRunFrom (this also updates layerRange)
      replanWithRange(newReRunFrom);
    } else {
      // Only upToLayer changed - no need to re-request plan, just update state
      setLayerRange(newLayerRange);
    }
  };

  if (!isOpen) return null;

  // Error state
  if (status === 'failed' && error) {
    return (
      <Dialog open={true} onOpenChange={() => dismissDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-500">Planning Failed</DialogTitle>
            <DialogDescription>{error}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={dismissDialog}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-muted hover:bg-muted/80 transition-colors"
            >
              Close
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Plan confirmation state
  if (!planInfo) return null;

  // Check if this is a surgical run
  const isSurgicalMode = planInfo.surgicalInfo && planInfo.surgicalInfo.length > 0;

  // Determine if we should show a cost range
  const showCostRange = planInfo.hasRanges && rangeTotals.minCost !== rangeTotals.maxCost;

  return (
    <Dialog open={true} onOpenChange={() => dismissDialog()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isSurgicalMode ? "Confirm Surgical Regeneration" : "Confirm Execution Plan"}
          </DialogTitle>
          <DialogDescription>
            {isSurgicalMode
              ? "Review the surgical regeneration targets before running."
              : "Review the execution plan before running."
            }
          </DialogDescription>
        </DialogHeader>

        {/* Plan Summary */}
        <div className="space-y-4 relative">
          {/* Re-planning overlay */}
          {isReplanning && (
            <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-10 rounded-lg">
              <div className="text-sm text-muted-foreground">Updating plan...</div>
            </div>
          )}

          {/* Stats - using dynamic range totals */}
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-2xl font-bold">{rangeTotals.layers}</div>
              <div className="text-xs text-muted-foreground">Layers</div>
            </div>
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-2xl font-bold">{rangeTotals.jobs}</div>
              <div className="text-xs text-muted-foreground">Jobs</div>
            </div>
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-2xl font-bold">
                {showCostRange
                  ? `${formatCurrency(rangeTotals.minCost)}-${formatCurrency(rangeTotals.maxCost)}`
                  : formatCurrency(rangeTotals.cost)
                }
              </div>
              <div className="text-xs text-muted-foreground">Est. Cost</div>
            </div>
          </div>

          {/* Surgical Mode Info */}
          {isSurgicalMode && (
            <div className="py-3 border-t border-border/40">
              <div className="text-sm font-medium mb-2">Surgical Regeneration Targets</div>
              <div className="space-y-2">
                {planInfo.surgicalInfo!.map((info, idx) => (
                  <div key={idx} className="p-2 bg-muted/50 rounded-lg text-sm">
                    <div>
                      <span className="text-muted-foreground">Target: </span>
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">{info.targetArtifactId}</code>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Source Job: </span>
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">{info.sourceJobId}</code>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stage Range Picker - only show for non-surgical runs with multiple layers */}
          {!isSurgicalMode && planInfo.layers > 1 && (
            <div className="py-3 border-t border-border/40">
              <div className="text-sm text-muted-foreground mb-2">Execution Stages:</div>
              <StageRangePicker
                totalStages={planInfo.layers}
                value={stageRange}
                onChange={handleStageRangeChange}
                stageStatuses={stageStatuses}
              />
            </div>
          )}

          {/* Cost Breakdown */}
          <div className="border border-border/40 rounded-lg overflow-hidden">
            <div className="bg-muted/50 px-3 py-2 text-sm font-medium border-b border-border/40">
              Cost by Producer
            </div>
            <div className="max-h-40 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-background sticky top-0 z-10">
                  <tr className="bg-muted/50">
                    <th className="text-left px-3 py-1.5 font-medium">Producer</th>
                    <th className="text-right px-3 py-1.5 font-medium">Count</th>
                    <th className="text-right px-3 py-1.5 font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {planInfo.costByProducer.map((entry) => (
                    <tr key={entry.name} className="border-t border-border/20">
                      <td className="px-3 py-1.5">
                        <span className="flex items-center gap-1">
                          {entry.name}
                          {entry.hasPlaceholders && entry.hasCostData && (
                            <span className="text-amber-500 text-xs">*</span>
                          )}
                        </span>
                      </td>
                      <td className="text-right px-3 py-1.5 text-muted-foreground">
                        {entry.count}
                      </td>
                      <td className="text-right px-3 py-1.5">
                        {formatCurrencyOrNA(entry.cost, entry.hasCostData)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <button
            onClick={dismissDialog}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-muted hover:bg-muted/80 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              clearLogs();
              confirmExecution(false);
            }}
            disabled={isReplanning}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isReplanning ? 'Updating...' : 'Execute'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
