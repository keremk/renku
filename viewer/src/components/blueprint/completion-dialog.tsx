/**
 * Completion dialog shown after execution finishes.
 * Offers choice to clear or keep regeneration marks.
 */

import { useMemo } from "react";
import { CheckCircle2, AlertCircle, X, Pin } from "lucide-react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { useExecution } from "@/contexts/execution-context";
import type { ExecutionLogEntry } from "@/types/generation";

/**
 * Summary data extracted from execution logs.
 */
interface CompletionSummary {
  succeeded: number;
  failed: number;
  skipped: number;
  failedProducers: string[];
}

/**
 * Extract completion summary from execution logs.
 * Looks for the final info log with counts or tallies job-complete entries.
 */
function extractCompletionSummary(logs: ExecutionLogEntry[]): CompletionSummary {
  // Try to parse the final summary log first
  // Format: "Execution completed successfully (X succeeded, Y failed, Z skipped)"
  const summaryLog = [...logs].reverse().find(
    (log) => log.type === 'info' && log.message.includes('succeeded')
  );

  if (summaryLog) {
    const match = summaryLog.message.match(/(\d+)\s+succeeded.*?(\d+)\s+failed.*?(\d+)\s+skipped/);
    if (match) {
      const [, succeeded, failed, skipped] = match;
      // Find failed producers from job-complete logs
      const failedProducers = logs
        .filter((log) => log.type === 'job-complete' && log.status === 'failed')
        .map((log) => log.producer)
        .filter((p): p is string => Boolean(p));

      return {
        succeeded: parseInt(succeeded, 10),
        failed: parseInt(failed, 10),
        skipped: parseInt(skipped, 10),
        failedProducers,
      };
    }
  }

  // Fallback: tally from individual job-complete entries
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const failedProducers: string[] = [];

  for (const log of logs) {
    if (log.type === 'job-complete') {
      switch (log.status) {
        case 'succeeded':
          succeeded++;
          break;
        case 'failed':
          failed++;
          if (log.producer) {
            failedProducers.push(log.producer);
          }
          break;
        case 'skipped':
          skipped++;
          break;
      }
    }
  }

  return { succeeded, failed, skipped, failedProducers };
}

/**
 * Success content for the completion dialog.
 */
function SuccessContent({
  summary,
  selectedCount,
  pinnedCount,
  onStartFresh,
  onKeepSelections,
}: {
  summary: CompletionSummary;
  selectedCount: number;
  pinnedCount: number;
  onStartFresh: () => void;
  onKeepSelections: () => void;
}) {
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
        Run Complete
      </h2>

      {/* Summary */}
      <p className="text-sm text-muted-foreground text-center mb-6">
        {summary.succeeded} job{summary.succeeded !== 1 ? 's' : ''} completed successfully
        {summary.skipped > 0 && `, ${summary.skipped} skipped`}
      </p>

      {/* Selection info if applicable */}
      {(selectedCount > 0 || pinnedCount > 0) && (
        <div className="w-full max-w-sm bg-muted/50 rounded-lg p-3 border border-border/30 mb-6 space-y-1.5">
          {selectedCount > 0 && (
            <p className="text-xs text-muted-foreground text-center">
              You have <span className="font-medium text-foreground/80">{selectedCount}</span> artifact{selectedCount !== 1 ? 's' : ''} marked for regeneration
            </p>
          )}
          {pinnedCount > 0 && (
            <p className="text-xs text-muted-foreground text-center">
              <Pin className="inline size-3 mr-0.5 text-amber-500" />
              <span className="font-medium text-amber-500">{pinnedCount}</span> artifact{pinnedCount !== 1 ? 's' : ''} pinned (kept)
            </p>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3 w-full max-w-xs">
        <button
          onClick={onStartFresh}
          className="flex-1 py-2.5 px-4 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all duration-150 shadow-sm"
        >
          Start Fresh
        </button>
        <button
          onClick={onKeepSelections}
          className="flex-1 py-2.5 px-4 text-sm font-medium rounded-lg bg-transparent hover:bg-muted border border-border/50 text-foreground/80 hover:text-foreground transition-all duration-150"
        >
          Keep Selections
        </button>
      </div>
    </div>
  );
}

/**
 * Failure content for the completion dialog.
 */
function FailureContent({
  summary,
  selectedCount,
  pinnedCount,
  onStartFresh,
  onKeepSelections,
}: {
  summary: CompletionSummary;
  selectedCount: number;
  pinnedCount: number;
  onStartFresh: () => void;
  onKeepSelections: () => void;
}) {
  return (
    <div className="flex flex-col items-center py-8 px-6">
      {/* Error icon with gradient ring */}
      <div className="relative mb-6">
        <div className="absolute inset-0 rounded-full bg-linear-to-br from-red-500/20 to-red-600/10 blur-xl" />
        <div className="relative w-16 h-16 rounded-full bg-linear-to-br from-red-500/20 to-red-600/10 flex items-center justify-center ring-1 ring-red-500/20">
          <AlertCircle className="w-8 h-8 text-red-500" />
        </div>
      </div>

      {/* Title */}
      <h2 className="text-xl font-semibold text-foreground mb-2">
        Run Completed with Errors
      </h2>

      {/* Summary */}
      <p className="text-sm text-muted-foreground text-center mb-4">
        {summary.succeeded > 0
          ? `${summary.succeeded} succeeded, ${summary.failed} failed`
          : `${summary.failed} job${summary.failed !== 1 ? 's' : ''} failed`}
        {summary.skipped > 0 && `, ${summary.skipped} skipped`}
      </p>

      {/* Failed jobs list */}
      {summary.failedProducers.length > 0 && (
        <div className="w-full max-w-sm bg-red-500/5 border border-red-500/20 rounded-lg p-3 mb-6">
          <p className="text-xs text-red-400 mb-2 font-medium">Failed:</p>
          <ul className="text-xs text-red-400/80 space-y-1">
            {summary.failedProducers.map((producer, index) => (
              <li key={index} className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-red-400/60" />
                {producer}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Selection info if applicable */}
      {(selectedCount > 0 || pinnedCount > 0) && (
        <div className="w-full max-w-sm bg-muted/50 rounded-lg p-3 border border-border/30 mb-6 space-y-1.5">
          {selectedCount > 0 && (
            <p className="text-xs text-muted-foreground text-center">
              You have <span className="font-medium text-foreground/80">{selectedCount}</span> artifact{selectedCount !== 1 ? 's' : ''} marked for regeneration
            </p>
          )}
          {pinnedCount > 0 && (
            <p className="text-xs text-muted-foreground text-center">
              <Pin className="inline size-3 mr-0.5 text-amber-500" />
              <span className="font-medium text-amber-500">{pinnedCount}</span> artifact{pinnedCount !== 1 ? 's' : ''} pinned (kept)
            </p>
          )}
        </div>
      )}

      {/* Action buttons - reversed order for failures */}
      <div className="flex gap-3 w-full max-w-xs">
        <button
          onClick={onKeepSelections}
          className="flex-1 py-2.5 px-4 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all duration-150 shadow-sm"
        >
          Keep Selections
        </button>
        <button
          onClick={onStartFresh}
          className="flex-1 py-2.5 px-4 text-sm font-medium rounded-lg bg-transparent hover:bg-muted border border-border/50 text-foreground/80 hover:text-foreground transition-all duration-150"
        >
          Start Fresh
        </button>
      </div>
    </div>
  );
}

export function CompletionDialog() {
  const { state, dismissCompletion, getSelectedArtifacts, getPinnedArtifacts } = useExecution();

  const isOpen = state.showCompletionDialog;
  const isSuccess = state.status === 'completed';
  const selectedCount = getSelectedArtifacts().length;
  const pinnedCount = getPinnedArtifacts().length;

  const summary = useMemo(() => {
    return extractCompletionSummary(state.executionLogs);
  }, [state.executionLogs]);

  const handleStartFresh = () => {
    dismissCompletion(true);
  };

  const handleKeepSelections = () => {
    dismissCompletion(false);
  };

  if (!isOpen) return null;

  return (
    <Dialog open={true} onOpenChange={() => dismissCompletion(false)}>
      <DialogContent
        className="sm:max-w-md p-0 gap-0 overflow-hidden"
        showCloseButton={false}
      >
        {/* Custom close button */}
        <button
          onClick={() => dismissCompletion(false)}
          className="absolute right-4 top-4 p-1 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/80 transition-colors z-20"
        >
          <X className="w-4 h-4" />
          <span className="sr-only">Close</span>
        </button>

        {/* Content */}
        {isSuccess ? (
          <SuccessContent
            summary={summary}
            selectedCount={selectedCount}
            pinnedCount={pinnedCount}
            onStartFresh={handleStartFresh}
            onKeepSelections={handleKeepSelections}
          />
        ) : (
          <FailureContent
            summary={summary}
            selectedCount={selectedCount}
            pinnedCount={pinnedCount}
            onStartFresh={handleStartFresh}
            onKeepSelections={handleKeepSelections}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
