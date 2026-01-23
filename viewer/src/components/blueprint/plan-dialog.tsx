/**
 * Plan confirmation dialog.
 * Shows cost breakdown and allows user to confirm or cancel execution.
 */

import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
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
    confirmExecution,
    dismissDialog,
  } = useExecution();

  const { planInfo, status, layerRange, error, producerStatuses } = state;

  // Only show when in confirming state or when there's an error to display
  const isOpen = status === 'confirming' || (status === 'failed' && error !== null);

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

  // Handle stage range changes
  const handleStageRangeChange = (newRange: { startStage: number; endStage: number }) => {
    if (!planInfo) return;
    setLayerRange(stageRangeToLayerRange(newRange, planInfo.layers));
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

  const showCostRange = planInfo.hasRanges && planInfo.minCost !== planInfo.maxCost;

  return (
    <Dialog open={true} onOpenChange={() => dismissDialog()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirm Execution Plan</DialogTitle>
          <DialogDescription>
            Review the execution plan before running.
          </DialogDescription>
        </DialogHeader>

        {/* Plan Summary */}
        <div className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-2xl font-bold">{planInfo.layers}</div>
              <div className="text-xs text-muted-foreground">Layers</div>
            </div>
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-2xl font-bold">{planInfo.totalJobs}</div>
              <div className="text-xs text-muted-foreground">Jobs</div>
            </div>
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-2xl font-bold">
                {showCostRange
                  ? `${formatCurrency(planInfo.minCost)}-${formatCurrency(planInfo.maxCost)}`
                  : formatCurrency(planInfo.totalCost)
                }
              </div>
              <div className="text-xs text-muted-foreground">Est. Cost</div>
            </div>
          </div>

          {/* Stage Range Picker */}
          {planInfo.layers > 1 && (
            <div className="py-3 border-t border-border/40">
              <div className="text-sm text-muted-foreground mb-2">Select Stage Range:</div>
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
                <thead className="bg-muted/30 sticky top-0">
                  <tr>
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
                          {entry.hasPlaceholders && (
                            <span className="text-amber-500 text-xs">*</span>
                          )}
                        </span>
                      </td>
                      <td className="text-right px-3 py-1.5 text-muted-foreground">
                        {entry.count}
                      </td>
                      <td className="text-right px-3 py-1.5">
                        {formatCurrency(entry.cost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Placeholder Warning */}
          {planInfo.hasPlaceholders && (
            <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-sm">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <span className="font-medium text-amber-500">Estimated costs</span>
                <p className="text-muted-foreground text-xs mt-0.5">
                  Some costs are estimates (*) because they depend on outputs from previous steps.
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <button
            onClick={dismissDialog}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-muted hover:bg-muted/80 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => confirmExecution(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-border hover:bg-muted transition-colors"
          >
            Dry Run
          </button>
          <button
            onClick={() => confirmExecution(false)}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Execute
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
