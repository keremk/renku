/**
 * Plan confirmation dialog.
 * Shows cost breakdown and allows user to confirm or cancel execution.
 */

import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LayerRangeSlider } from "./layer-range-slider";
import { useExecution } from "@/contexts/execution-context";

/**
 * Format currency value for display.
 */
function formatCurrency(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function PlanDialog() {
  const {
    state,
    setLayerRange,
    confirmExecution,
    dismissDialog,
  } = useExecution();

  const { planInfo, status, layerRange, error } = state;

  // Only show when in confirming state or when there's an error to display
  const isOpen = status === 'confirming' || (status === 'failed' && error !== null);

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

          {/* Layer Range Slider */}
          {planInfo.layers > 1 && (
            <div className="flex items-center justify-between py-2 border-t border-border/40">
              <span className="text-sm text-muted-foreground">Layer Range:</span>
              <LayerRangeSlider
                totalLayers={planInfo.layers}
                value={layerRange}
                onChange={setLayerRange}
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
