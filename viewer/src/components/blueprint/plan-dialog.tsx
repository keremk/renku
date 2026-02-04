/**
 * Plan confirmation dialog.
 * Shows a non-interactive overview of the execution plan with cost breakdown.
 * User selects artifacts in Outputs panel and layer limit via Run button dropdown.
 */

import { useMemo } from "react";
import { CheckCircle2, AlertCircle, Layers, Briefcase, DollarSign, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { useExecution } from "@/contexts/execution-context";
import type { PlanDisplayInfo } from "@/types/generation";

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
 * Sort cost by producer entries by layer (producers in earlier layers first).
 */
function sortCostByLayer(planInfo: PlanDisplayInfo): PlanDisplayInfo['costByProducer'] {
  const producerLayerMap = new Map<string, number>();
  for (const layer of planInfo.layerBreakdown) {
    for (const job of layer.jobs) {
      if (!producerLayerMap.has(job.producer)) {
        producerLayerMap.set(job.producer, layer.index);
      }
    }
  }

  return [...planInfo.costByProducer].sort((a, b) => {
    const layerA = producerLayerMap.get(a.name) ?? Infinity;
    const layerB = producerLayerMap.get(b.name) ?? Infinity;
    return layerA - layerB;
  });
}

/**
 * Stat card component for consistent styling.
 */
function StatCard({
  icon: Icon,
  value,
  label,
  iconColor = "text-primary"
}: {
  icon: typeof Layers;
  value: string | number;
  label: string;
  iconColor?: string;
}) {
  return (
    <div className="flex flex-col items-center p-4 rounded-xl bg-linear-to-b from-muted/80 to-muted/40 border border-border/30">
      <Icon className={`w-5 h-5 ${iconColor} mb-2 opacity-80`} />
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

/**
 * NOOP dialog content - shown when there's nothing to execute.
 */
function NoopContent({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col items-center py-8 px-6">
      {/* Success icon with gradient ring */}
      <div className="relative mb-6">
        <div className="absolute inset-0 rounded-full bg-linear-to-br from-emerald-500/20 to-emerald-600/10 blur-xl" />
        <div className="relative w-16 h-16 rounded-full bg-linear-to-br from-emerald-500/20 to-emerald-600/10 flex items-center justify-center ring-1 ring-emerald-500/20">
          <CheckCircle2 className="w-8 h-8 text-emerald-500" />
        </div>
      </div>

      {/* Title */}
      <h2 className="text-xl font-semibold text-foreground mb-2">
        All Caught Up
      </h2>

      {/* Description */}
      <p className="text-sm text-muted-foreground text-center max-w-xs mb-6">
        The selected layers have already completed successfully. No work needed.
      </p>

      {/* Tip box */}
      <div className="w-full max-w-sm bg-muted/50 rounded-lg p-4 border border-border/30 mb-6">
        <p className="text-xs text-muted-foreground text-center leading-relaxed">
          <span className="font-medium text-foreground/80">Tip:</span> To re-run completed work,
          select specific artifacts in the Outputs tab or choose a different layer range.
        </p>
      </div>

      {/* Close button */}
      <button
        onClick={onClose}
        className="w-full max-w-[200px] py-2.5 px-6 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all duration-150 shadow-sm"
      >
        Got it
      </button>
    </div>
  );
}

/**
 * Error dialog content.
 */
function ErrorContent({ error, onClose }: { error: string; onClose: () => void }) {
  return (
    <div className="flex flex-col items-center py-8 px-6">
      {/* Error icon */}
      <div className="relative mb-6">
        <div className="absolute inset-0 rounded-full bg-linear-to-br from-red-500/20 to-red-600/10 blur-xl" />
        <div className="relative w-16 h-16 rounded-full bg-linear-to-br from-red-500/20 to-red-600/10 flex items-center justify-center ring-1 ring-red-500/20">
          <AlertCircle className="w-8 h-8 text-red-500" />
        </div>
      </div>

      {/* Title */}
      <h2 className="text-xl font-semibold text-foreground mb-2">
        Planning Failed
      </h2>

      {/* Error message */}
      <div className="w-full max-w-sm bg-red-500/5 border border-red-500/20 rounded-lg p-4 mb-6">
        <p className="text-sm text-red-400 text-center">
          {error}
        </p>
      </div>

      {/* Close button */}
      <button
        onClick={onClose}
        className="w-full max-w-[200px] py-2.5 px-6 text-sm font-medium rounded-lg bg-muted hover:bg-muted/80 active:scale-[0.98] transition-all duration-150"
      >
        Close
      </button>
    </div>
  );
}

/**
 * Execution plan dialog content.
 */
function PlanContent({
  planInfo,
  sortedCostByProducer,
  showCostRange,
  isSurgicalMode,
  isReplanning,
  onCancel,
  onExecute,
}: {
  planInfo: PlanDisplayInfo;
  sortedCostByProducer: PlanDisplayInfo['costByProducer'];
  showCostRange: boolean;
  isSurgicalMode: boolean;
  isReplanning: boolean;
  onCancel: () => void;
  onExecute: () => void;
}) {
  return (
    <div className="relative">
      {/* Re-planning overlay */}
      {isReplanning && (
        <div className="absolute inset-0 bg-background/90 backdrop-blur-sm flex items-center justify-center z-10 rounded-lg">
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">Updating plan...</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-border/30">
        <h2 className="text-lg font-semibold text-foreground">
          {isSurgicalMode ? "Confirm Regeneration" : "Confirm Execution"}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {isSurgicalMode
            ? `Regenerating ${planInfo.surgicalInfo!.length} artifact(s) and dependencies`
            : "Review the plan before running"
          }
        </p>
      </div>

      {/* Stats */}
      <div className="px-6 py-5">
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            icon={Layers}
            value={planInfo.layers}
            label="Layers"
            iconColor="text-blue-500"
          />
          <StatCard
            icon={Briefcase}
            value={planInfo.totalJobs}
            label="Jobs"
            iconColor="text-purple-500"
          />
          <StatCard
            icon={DollarSign}
            value={showCostRange
              ? `${formatCurrency(planInfo.minCost)}–${formatCurrency(planInfo.maxCost)}`
              : formatCurrency(planInfo.totalCost)
            }
            label="Est. Cost"
            iconColor="text-emerald-500"
          />
        </div>
      </div>

      {/* Cost Breakdown */}
      <div className="px-6 pb-5">
        <div className="rounded-xl border border-border/40 overflow-hidden">
          <div className="bg-muted/30 px-4 py-2.5 border-b border-border/30">
            <span className="text-sm font-medium text-foreground/90">Cost by Producer</span>
          </div>
          <div className="max-h-44 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/20 bg-muted/20">
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">Producer</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">Count</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/10">
                {sortedCostByProducer.map((entry) => (
                  <tr key={entry.name} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-1.5 text-foreground/90">
                        {entry.name}
                        {entry.hasPlaceholders && entry.hasCostData && (
                          <span className="text-amber-500 text-xs" title="Estimated">*</span>
                        )}
                      </span>
                    </td>
                    <td className="text-right px-4 py-2.5 text-muted-foreground tabular-nums">
                      {entry.count}
                    </td>
                    <td className="text-right px-4 py-2.5 font-medium tabular-nums">
                      {formatCurrencyOrNA(entry.cost, entry.hasCostData)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-border/30 bg-muted/20 flex justify-end gap-3">
        <button
          onClick={onCancel}
          className="py-2 px-4 text-sm font-medium rounded-lg bg-transparent hover:bg-muted border border-border/50 text-foreground/80 hover:text-foreground transition-all duration-150"
        >
          Cancel
        </button>
        <button
          onClick={onExecute}
          disabled={isReplanning}
          className="py-2 px-5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all duration-150 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
        >
          {isReplanning ? 'Updating...' : 'Execute'}
        </button>
      </div>
    </div>
  );
}

export function PlanDialog() {
  const {
    state,
    confirmExecution,
    dismissDialog,
    clearLogs,
  } = useExecution();

  const { planInfo, status, error } = state;

  const isReplanning = status === 'planning' && planInfo !== null;
  const isOpen = status === 'confirming' || (status === 'failed' && error !== null) || isReplanning;

  const sortedCostByProducer = useMemo(() => {
    if (!planInfo) return [];
    return sortCostByLayer(planInfo);
  }, [planInfo]);

  if (!isOpen) return null;

  const isSurgicalMode = planInfo?.surgicalInfo && planInfo.surgicalInfo.length > 0;
  const isNoop = planInfo?.totalJobs === 0;
  const showCostRange = planInfo?.hasRanges && planInfo.minCost !== planInfo.maxCost;

  const handleExecute = () => {
    clearLogs();
    confirmExecution(false);
  };

  return (
    <Dialog open={true} onOpenChange={() => dismissDialog()}>
      <DialogContent
        className="sm:max-w-md p-0 gap-0 overflow-hidden"
        showCloseButton={false}
      >
        {/* Custom close button */}
        <button
          onClick={dismissDialog}
          className="absolute right-4 top-4 p-1 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/80 transition-colors z-20"
        >
          <X className="w-4 h-4" />
          <span className="sr-only">Close</span>
        </button>

        {/* Content */}
        {status === 'failed' && error ? (
          <ErrorContent error={error} onClose={dismissDialog} />
        ) : isNoop ? (
          <NoopContent onClose={dismissDialog} />
        ) : planInfo ? (
          <PlanContent
            planInfo={planInfo}
            sortedCostByProducer={sortedCostByProducer}
            showCostRange={showCostRange ?? false}
            isSurgicalMode={isSurgicalMode ?? false}
            isReplanning={isReplanning}
            onCancel={dismissDialog}
            onExecute={handleExecute}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
