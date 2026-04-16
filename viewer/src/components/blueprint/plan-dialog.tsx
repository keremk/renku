/**
 * Plan confirmation dialog.
 * Shows an interactive overview of the execution plan with per-producer controls.
 */

import { useMemo, useState, useCallback, useEffect, useRef, useReducer } from "react";
import { CheckCircle2, AlertCircle, Layers, Briefcase, DollarSign, X, Copy, Check, Pin, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useExecution } from "@/contexts/execution-context";
import type { PlanDisplayInfo } from "@/types/generation";
import { formatViewerMessage } from "@/utils/format-viewer-message";
import { getProducerDisplayParts } from "@/lib/panel-utils";
import { ProducerCountStepper } from "./producer-count-stepper";

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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function buildFallbackCliCommand(args: {
  blueprintName: string | null;
  movieId: string | null;
  upToLayer: number | null;
  selectedForRegeneration: Set<string>;
  pinnedArtifacts: Set<string>;
  producerOverrides: ProducerOverrides;
}): string | undefined {
  if (!args.blueprintName) {
    return undefined;
  }

  const parts: string[] = ['renku generate'];
  if (args.movieId) {
    parts.push(`--movie-id=${shellQuote(args.movieId)}`);
  }
  parts.push(`--blueprint=${shellQuote(args.blueprintName)}`);

  const regenerateIds = Array.from(args.selectedForRegeneration).sort();
  for (const regenerateId of regenerateIds) {
    parts.push(`--regen=${shellQuote(regenerateId)}`);
  }

  const pinIds = Array.from(args.pinnedArtifacts).sort();
  for (const pinId of pinIds) {
    parts.push(`--pin=${shellQuote(pinId)}`);
  }

  const producerPidValues = Object.entries(args.producerOverrides)
    .map(([producerId, override]) => {
      if (override.enabled === false) {
        return `${producerId}:0`;
      }
      if (override.count !== undefined) {
        return `${producerId}:${override.count}`;
      }
      return null;
    })
    .filter((value): value is string => value !== null)
    .sort();
  for (const producerPidValue of producerPidValues) {
    parts.push(`--pid=${shellQuote(producerPidValue)}`);
  }

  if (args.upToLayer !== null) {
    parts.push(`--up=${args.upToLayer}`);
  }

  parts.push('--explain');
  return parts.join(' ');
}

/**
 * Shared display state for a producer family row in the run dialog.
 */
interface ProducerPlanRow {
  producerId: string;
  displayKey: string;
  groupKey: string | null;
  groupLabel: string | null;
  leafLabel: string;
  sortLayer: number;
  inheritedCount: number;
  effectiveCount: number;
  maxSelectableCount: number | null;
  scheduledJobCount: number;
  cost: number;
  hasPlaceholders: boolean;
  hasCostData: boolean;
  isDirty: boolean;
  isDisabled: boolean;
  blockedReason?: string;
}

type ProducerOverrides = Record<
  string,
  { enabled?: boolean; count?: number }
>;

interface DraftPreviewState {
  draftOverrides: ProducerOverrides;
  draftPlanInfo: PlanDisplayInfo | null;
  draftError: string | null;
  draftErrorSignature: string | null;
  isPreviewPlanning: boolean;
}

type DraftPreviewAction =
  | {
      type: "seed-session";
      planInfo: PlanDisplayInfo;
      overrides: ProducerOverrides;
    }
  | {
      type: "preview-start";
    }
  | {
      type: "preview-success";
      planInfo: PlanDisplayInfo;
    }
  | {
      type: "preview-error";
      error: string;
      signature: string;
    }
  | {
      type: "clear-preview-status";
    }
  | {
      type: "update-overrides";
      updater: (current: ProducerOverrides) => ProducerOverrides;
    };

const INITIAL_DRAFT_PREVIEW_STATE: DraftPreviewState = {
  draftOverrides: {},
  draftPlanInfo: null,
  draftError: null,
  draftErrorSignature: null,
  isPreviewPlanning: false,
};

function draftPreviewReducer(
  state: DraftPreviewState,
  action: DraftPreviewAction
): DraftPreviewState {
  switch (action.type) {
    case "seed-session":
      return {
        draftOverrides: action.overrides,
        draftPlanInfo: action.planInfo,
        draftError: null,
        draftErrorSignature: null,
        isPreviewPlanning: false,
      };
    case "preview-start":
      return {
        ...state,
        isPreviewPlanning: true,
      };
    case "preview-success":
      return {
        ...state,
        draftPlanInfo: action.planInfo,
        draftError: null,
        draftErrorSignature: null,
        isPreviewPlanning: false,
      };
    case "preview-error":
      return {
        ...state,
        draftError: action.error,
        draftErrorSignature: action.signature,
        isPreviewPlanning: false,
      };
    case "clear-preview-status":
      return {
        ...state,
        draftError: null,
        draftErrorSignature: null,
        isPreviewPlanning: false,
      };
    case "update-overrides":
      return {
        ...state,
        draftOverrides: action.updater(state.draftOverrides),
      };
    default:
      return state;
  }
}

function stripProducerPrefix(producerId: string): string {
  return producerId.startsWith('Producer:')
    ? producerId.slice('Producer:'.length)
    : producerId;
}

function toCanonicalProducerId(producerId: string): string {
  return producerId.startsWith('Producer:')
    ? producerId
    : `Producer:${producerId}`;
}

function serializeProducerOverrides(
  producerOverrides: ProducerOverrides
): string {
  return Object.entries(producerOverrides)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([producerId, override]) =>
      `${producerId}:${override.enabled === false ? 'disabled' : 'enabled'}:${override.count ?? 'inherit'}`
    )
    .join('|');
}

function buildProducerRows(
  planInfo: PlanDisplayInfo,
  producerOverrides: ProducerOverrides,
  args?: {
    baselineCountByProducerId?: Map<string, number>;
    baselineOverrideSignatureByProducerId?: Map<string, string>;
    blockedReasonByProducerId?: Map<string, string>;
  }
): ProducerPlanRow[] {
  const producerLayerMap = new Map<string, number>();
  for (const layer of planInfo.layerBreakdown) {
    for (const job of layer.jobs) {
      const producerKey = stripProducerPrefix(job.producer);
      if (!producerLayerMap.has(producerKey)) {
        producerLayerMap.set(producerKey, layer.index);
      }
    }
  }

  const costByProducer = new Map(
    planInfo.costByProducer.map((entry) => [stripProducerPrefix(entry.name), entry])
  );
  const schedulingByProducer = new Map(
    (planInfo.producerScheduling ?? []).map((entry) => [
      stripProducerPrefix(entry.producerId),
      entry,
    ])
  );
  const overridesByProducer = new Map(
    Object.entries(producerOverrides).map(([producerId, override]) => [
      stripProducerPrefix(producerId),
      override,
    ])
  );

  const visibleProducerKeys = new Set<string>();
  for (const key of costByProducer.keys()) {
    visibleProducerKeys.add(key);
  }
  for (const [key, scheduling] of schedulingByProducer) {
    if (scheduling.scheduledJobCount > 0 || scheduling.scheduledCount > 0) {
      visibleProducerKeys.add(key);
    }
  }
  for (const key of overridesByProducer.keys()) {
    visibleProducerKeys.add(key);
  }

  return Array.from(visibleProducerKeys)
    .map((displayKey) => {
      const scheduling = schedulingByProducer.get(displayKey);
      const costEntry = costByProducer.get(displayKey);
      const override = overridesByProducer.get(displayKey);
      const displayParts = getProducerDisplayParts(displayKey);

      const inheritedCount =
        scheduling?.effectiveCountLimit === null
          ? scheduling.maxSelectableCount
          : scheduling?.effectiveCountLimit;
      const effectiveCount =
        override?.enabled === false
          ? 0
          : override?.count !== undefined
            ? override.count
            : inheritedCount ?? scheduling?.scheduledCount ?? costEntry?.count ?? 0;
      const maxSelectableCount =
        scheduling?.maxSelectableCount ?? costEntry?.count ?? null;
      const baselineCount =
        args?.baselineCountByProducerId?.get(
          scheduling?.producerId ?? toCanonicalProducerId(displayKey)
        ) ?? effectiveCount;
      const currentOverrideSignature = `${override?.enabled ?? 'inherit'}:${override?.count ?? 'inherit'}`;
      const baselineOverrideSignature =
        args?.baselineOverrideSignatureByProducerId?.get(
          scheduling?.producerId ?? toCanonicalProducerId(displayKey)
        ) ?? currentOverrideSignature;

      return {
        producerId: scheduling?.producerId ?? toCanonicalProducerId(displayKey),
        displayKey,
        groupKey: displayParts.groupKey,
        groupLabel: displayParts.groupLabel,
        leafLabel: displayParts.leafLabel,
        sortLayer: producerLayerMap.get(displayKey) ?? Number.MAX_SAFE_INTEGER,
        inheritedCount: baselineCount,
        effectiveCount,
        maxSelectableCount,
        scheduledJobCount:
          effectiveCount === 0
            ? 0
            : scheduling?.scheduledJobCount ?? costEntry?.count ?? 0,
        cost:
          effectiveCount === 0 && costEntry === undefined ? 0 : (costEntry?.cost ?? 0),
        hasPlaceholders: costEntry?.hasPlaceholders ?? false,
        hasCostData:
          effectiveCount === 0 ? true : (costEntry?.hasCostData ?? false),
        isDirty: currentOverrideSignature !== baselineOverrideSignature,
        isDisabled: effectiveCount === 0,
        blockedReason: args?.blockedReasonByProducerId?.get(
          scheduling?.producerId ?? toCanonicalProducerId(displayKey)
        ),
      } satisfies ProducerPlanRow;
    })
    .sort((left, right) => {
      if (left.sortLayer !== right.sortLayer) {
        return left.sortLayer - right.sortLayer;
      }

      const leftGroup = left.groupKey ?? left.displayKey;
      const rightGroup = right.groupKey ?? right.displayKey;
      const groupCompare = leftGroup.localeCompare(rightGroup);
      if (groupCompare !== 0) {
        return groupCompare;
      }

      return left.leafLabel.localeCompare(right.leafLabel);
    });
}

function buildProducerListItems(rows: ProducerPlanRow[]) {
  const items: Array<
    | { type: 'producer'; row: ProducerPlanRow }
    | {
        type: 'group';
        groupKey: string;
        groupLabel: string;
        rows: ProducerPlanRow[];
      }
  > = [];
  const seenGroups = new Set<string>();

  for (const row of rows) {
    if (!row.groupKey || !row.groupLabel) {
      items.push({ type: 'producer', row });
      continue;
    }

    if (seenGroups.has(row.groupKey)) {
      continue;
    }

    seenGroups.add(row.groupKey);
    items.push({
      type: 'group',
      groupKey: row.groupKey,
      groupLabel: row.groupLabel,
      rows: rows.filter((candidate) => candidate.groupKey === row.groupKey),
    });
  }

  return items;
}

interface InvalidPlanIssue {
  producerId: string;
  producerLabel: string;
  artifactLabels: string[];
  summary: string;
}

interface InvalidPlanExplanation {
  summary: string;
  action: string;
  issues: InvalidPlanIssue[];
}

function formatProducerFamilyLabel(producerId: string): string {
  const displayParts = getProducerDisplayParts(stripProducerPrefix(producerId));
  if (displayParts.groupLabel) {
    return `${displayParts.groupLabel} / ${displayParts.leafLabel}`;
  }
  return displayParts.leafLabel;
}

function normalizeArtifactGroupKey(label: string): string {
  return label.replace(/\s+\(item \d+\)$/i, '').trim();
}

function summarizeArtifactLabels(labels: string[]): string {
  if (labels.length === 0) {
    return 'required output';
  }

  const counts = new Map<string, number>();
  for (const label of labels) {
    const key = normalizeArtifactGroupKey(label);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const entries = Array.from(counts.entries());
  if (entries.length === 1) {
    const [label, count] = entries[0]!;
    return count === 1 ? label : `${label} (${count} items)`;
  }

  const [firstLabel] = entries[0]!;
  return `${firstLabel} +${entries.length - 1} more`;
}

function extractRawErrorMessage(errorMessage: string): string {
  const requestEnvelopePattern = /^Request failed \(\d+\):\s*/;
  const candidate = errorMessage.replace(requestEnvelopePattern, '').trim();
  if (!candidate.startsWith('{') && !candidate.startsWith('[')) {
    return candidate;
  }

  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'error' in parsed &&
      typeof (parsed as { error?: unknown }).error === 'object' &&
      (parsed as { error?: { message?: unknown } }).error?.message &&
      typeof (parsed as { error?: { message?: unknown } }).error?.message === 'string'
    ) {
      return (parsed as { error: { message: string } }).error.message;
    }
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'message' in parsed &&
      typeof (parsed as { message?: unknown }).message === 'string'
    ) {
      return (parsed as { message: string }).message;
    }
  } catch {
    return candidate;
  }

  return candidate;
}

function parseInvalidPlanExplanation(errorMessage: string): InvalidPlanExplanation {
  const formattedMessage = formatViewerMessage(errorMessage);
  const dependencyPrefix =
    'Producer overrides leave required upstream artifacts unavailable:';

  if (!formattedMessage.startsWith(dependencyPrefix)) {
    return {
      summary: formattedMessage,
      action:
        'Adjust the counts until every downstream producer still has the outputs it needs.',
      issues: [],
    };
  }

  const rawMessage = extractRawErrorMessage(errorMessage);
  const rawDetails = rawMessage
    .replace(dependencyPrefix, '')
    .replace(/\s+\(Code:\s*[A-Z]\d+\)\s*$/i, '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const formattedDetails = formattedMessage
    .slice(dependencyPrefix.length)
    .replace(/\s+\(Code:\s*[A-Z]\d+\)\s*$/i, '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const issuesByProducerId = new Map<string, InvalidPlanIssue>();
  for (const [index, detail] of formattedDetails.entries()) {
    const rawDetail = rawDetails[index] ?? detail;
    const producerMatch = /^Producer:([^ ;]+?)(?:\[\d+\])?\s+requires\b/i.exec(
      rawDetail
    );
    if (!producerMatch) {
      continue;
    }

    const producerId = toCanonicalProducerId(
      stripProducerPrefix(producerMatch[1]!).replace(/\[\d+\]/g, '')
    );
    const artifactMatch = / requires (.*)$/i.exec(detail);
    const artifactLabel = artifactMatch?.[1]?.trim() ?? 'required output';
    const existingIssue = issuesByProducerId.get(producerId);

    if (existingIssue) {
      existingIssue.artifactLabels.push(artifactLabel);
      existingIssue.summary = `${existingIssue.producerLabel} needs ${summarizeArtifactLabels(
        existingIssue.artifactLabels
      )}.`;
      continue;
    }

    const producerLabel = formatProducerFamilyLabel(producerId);
    issuesByProducerId.set(producerId, {
      producerId,
      producerLabel,
      artifactLabels: [artifactLabel],
      summary: `${producerLabel} needs ${artifactLabel}.`,
    });
  }

  const issues = Array.from(issuesByProducerId.values()).map((issue) => ({
    ...issue,
    summary: `${issue.producerLabel} needs ${summarizeArtifactLabels(
      issue.artifactLabels
    )}.`,
  }));

  return {
    summary:
      'This draft is missing output that another producer in the preview still needs.',
    action:
      'Raise the upstream count again, or lower the producer that depends on that missing output.',
    issues,
  };
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
 * Copy CLI command button with feedback.
 */
function CopyCliCommandButton({ cliCommand }: { cliCommand: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(cliCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy CLI command:', err);
    }
  }, [cliCommand]);

  return (
    <button
      onClick={handleCopy}
      title="Copy CLI command"
      className="flex items-center gap-1.5 py-1.5 px-2.5 text-xs font-medium rounded-md bg-muted/50 hover:bg-muted border border-border/40 text-muted-foreground hover:text-foreground transition-all duration-150"
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 text-emerald-500" />
          <span className="text-emerald-500">Copied!</span>
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5" />
          <span>Copy CLI</span>
        </>
      )}
    </button>
  );
}

function ProducerPlanRowView({
  row,
  onCountChange,
}: {
  row: ProducerPlanRow;
  onCountChange: (producerId: string, count: number) => void;
}) {
  const placeholderMarker = row.hasPlaceholders && row.hasCostData ? '*' : '';
  const metaBadges: string[] = [];
  if (row.isDirty) {
    metaBadges.push('Changed');
  }
  if (row.isDisabled) {
    metaBadges.push("Won't run");
  }

  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_88px_74px] items-center gap-3 px-3 py-2.5 transition-colors ${
        row.blockedReason
          ? 'bg-amber-500/6'
          : row.isDirty
            ? 'bg-sky-500/5'
            : ''
      }`}
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground/90">
          {row.leafLabel}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>{row.scheduledJobCount} job{row.scheduledJobCount === 1 ? '' : 's'}</span>
          {row.maxSelectableCount !== null && (
            <span>Range 0-{row.maxSelectableCount}</span>
          )}
          {metaBadges.map((badge) => (
            <span
              key={badge}
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                badge === 'Changed'
                  ? 'bg-sky-500/12 text-sky-300'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {badge}
            </span>
          ))}
        </div>
        {row.blockedReason && (
          <div className="mt-1 text-[11px] text-amber-300/90">
            {row.blockedReason}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        {row.maxSelectableCount !== null ? (
          <ProducerCountStepper
            value={row.effectiveCount}
            max={row.maxSelectableCount}
            inputLabel={`Count for ${row.leafLabel}`}
            onChange={(count) => onCountChange(row.producerId, count)}
          />
        ) : (
          <span className="text-xs text-muted-foreground">Count unavailable</span>
        )}
      </div>

      <div className="text-right text-xs font-medium tabular-nums text-foreground/85">
        {formatCurrencyOrNA(row.cost, row.hasCostData)}
        {placeholderMarker && (
          <span className="ml-1 text-amber-500" title="Estimated">*</span>
        )}
      </div>
    </div>
  );
}

function PreviewStatusRail({
  hasDraftChanges,
  isPreviewPlanning,
  invalidPlanExplanation,
  isNoop,
  onResetDraft,
}: {
  hasDraftChanges: boolean;
  isPreviewPlanning: boolean;
  invalidPlanExplanation: InvalidPlanExplanation | null;
  isNoop: boolean;
  onResetDraft: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  const toneClasses = invalidPlanExplanation
    ? 'border-amber-500/25 bg-amber-500/8'
    : hasDraftChanges
      ? 'border-sky-500/18 bg-sky-500/6'
      : 'border-border/30 bg-muted/20';
  const title = invalidPlanExplanation
    ? "Preview can't run yet"
    : isPreviewPlanning
      ? 'Recalculating preview'
      : isNoop
        ? 'Nothing will run with these counts'
        : hasDraftChanges
          ? 'Preview ready'
          : 'Preview matches the committed run';
  const message = invalidPlanExplanation
    ? `Showing the last runnable preview above. ${invalidPlanExplanation.action}`
    : isPreviewPlanning
      ? 'Keeping the last valid preview visible while the new draft is being calculated.'
      : isNoop
        ? 'Increase any producer count above 0 to make this draft runnable.'
        : hasDraftChanges
          ? 'These changes stay local to the dialog until you click Run.'
          : 'Changes here are only a preview until you click Run.';

  return (
    <div
      aria-live="polite"
      className={`mx-6 mb-3 min-h-[4.75rem] rounded-xl border px-4 py-3 ${toneClasses}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {isPreviewPlanning ? (
              <div className="size-3.5 rounded-full border-2 border-primary/70 border-t-transparent animate-spin" />
            ) : invalidPlanExplanation ? (
              <AlertTriangle className="size-3.5 text-amber-300" />
            ) : (
              <CheckCircle2 className="size-3.5 text-emerald-400/80" />
            )}
            <p className="text-xs font-medium text-foreground/90">{title}</p>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {message}
          </p>
          {invalidPlanExplanation && showDetails && invalidPlanExplanation.issues.length > 0 && (
            <div className="mt-2 space-y-1">
              {invalidPlanExplanation.issues.slice(0, 3).map((issue) => (
                <p key={issue.producerId} className="text-[11px] text-amber-200/90">
                  {issue.summary}
                </p>
              ))}
              {invalidPlanExplanation.issues.length > 3 && (
                <p className="text-[11px] text-amber-200/75">
                  +{invalidPlanExplanation.issues.length - 3} more blocked producer
                  {invalidPlanExplanation.issues.length - 3 === 1 ? '' : 's'}.
                </p>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {invalidPlanExplanation && invalidPlanExplanation.issues.length > 0 && (
            <button
              type="button"
              onClick={() => setShowDetails((current) => !current)}
              className="rounded-md border border-border/40 bg-background/50 px-2.5 py-1 text-[11px] font-medium text-foreground/80 transition-colors hover:bg-background/80 hover:text-foreground"
            >
              {showDetails ? 'Hide details' : 'Why?'}
            </button>
          )}
          {hasDraftChanges && (
            <button
              type="button"
              onClick={onResetDraft}
              className="rounded-md border border-border/40 bg-background/50 px-2.5 py-1 text-[11px] font-medium text-foreground/80 transition-colors hover:bg-background/80 hover:text-foreground"
            >
              Reset
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ProducerRunList({
  items,
  onCountChange,
}: {
  items: ReturnType<typeof buildProducerListItems>;
  onCountChange: (producerId: string, count: number) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
        No scheduled producers in the current plan.
      </div>
    );
  }

  return (
    <div className="space-y-2 p-2">
      {items.map((item) => {
        if (item.type === 'producer') {
          return (
            <div
              key={item.row.displayKey}
              className="rounded-xl border border-border/35 bg-background/35"
            >
              <ProducerPlanRowView
                row={item.row}
                onCountChange={onCountChange}
              />
            </div>
          );
        }

        return (
          <div
            key={item.groupKey}
            className="rounded-xl border border-border/40 bg-background/40 overflow-hidden"
          >
            <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground bg-muted/25 border-b border-border/25">
              {item.groupLabel}
            </div>
            <div className="divide-y divide-border/10">
              {item.rows.map((row) => (
                <ProducerPlanRowView
                  key={row.displayKey}
                  row={row}
                  onCountChange={onCountChange}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Execution plan dialog content.
 */
function PlanContent({
  planInfo,
  producerListItems,
  displayedStageCount,
  showCostRange,
  isSurgicalMode,
  isPreviewPlanning,
  invalidPlanExplanation,
  hasDraftChanges,
  cliCommand,
  pinnedCount,
  isNoop,
  onCountChange,
  onResetDraft,
  onCancel,
  onExecute,
}: {
  planInfo: PlanDisplayInfo;
  producerListItems: ReturnType<typeof buildProducerListItems>;
  displayedStageCount: number;
  showCostRange: boolean;
  isSurgicalMode: boolean;
  isPreviewPlanning: boolean;
  invalidPlanExplanation: InvalidPlanExplanation | null;
  hasDraftChanges: boolean;
  cliCommand?: string;
  pinnedCount: number;
  isNoop: boolean;
  onCountChange: (producerId: string, count: number) => void;
  onResetDraft: () => void;
  onCancel: () => void;
  onExecute: () => void;
}) {
  return (
    <div>
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
            value={displayedStageCount}
            label="Stages"
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

      {/* Pinned artifacts info */}
      {pinnedCount > 0 && (
        <div className="mx-6 mb-2 bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
          <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
            <Pin className="inline size-3.5 mr-1" />
            {pinnedCount} artifact{pinnedCount !== 1 ? 's' : ''} pinned — will be kept from prior run
          </p>
        </div>
      )}

      {planInfo.warnings && planInfo.warnings.length > 0 && (
        <div className="mx-6 mb-2 rounded-lg border border-amber-500/30 bg-amber-500/8 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-3.5" />
            Planning Warnings
          </div>
          <ul className="space-y-1">
            {planInfo.warnings.map((warning) => (
              <li key={`${warning.code}:${warning.targetId}`} className="text-xs text-amber-700/90 dark:text-amber-300/90">
                {formatViewerMessage(warning)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Producer Breakdown */}
      <div className="px-6 pb-5">
        <div className="rounded-xl border border-border/40 overflow-hidden">
          <div className="bg-muted/30 px-4 py-2.5 border-b border-border/30">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-foreground/90">Run by Producer</span>
              <span className="text-[11px] text-muted-foreground">
                Preview only until you click Run
              </span>
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto bg-muted/10">
            <ProducerRunList
              items={producerListItems}
              onCountChange={onCountChange}
            />
          </div>
        </div>
      </div>

      {/* Cost estimate note */}
      {planInfo.hasPlaceholders && (
        <div className="mx-6 mb-2 bg-muted/50 rounded-lg p-2">
          <p className="text-xs text-muted-foreground text-center">
            * Cost is estimated. Some producers may be skipped based on conditional logic.
          </p>
        </div>
      )}

      <PreviewStatusRail
        key={invalidPlanExplanation?.summary ?? 'preview-status'}
        hasDraftChanges={hasDraftChanges}
        isPreviewPlanning={isPreviewPlanning}
        invalidPlanExplanation={invalidPlanExplanation}
        isNoop={isNoop}
        onResetDraft={onResetDraft}
      />

      {/* Footer */}
      <div className="px-6 py-4 border-t border-border/30 bg-muted/20 flex justify-between items-center">
        {/* CLI command copy button */}
        <div className="flex items-center">
          {cliCommand && (
            <CopyCliCommandButton cliCommand={cliCommand} />
          )}
        </div>
        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="py-2 px-4 text-sm font-medium rounded-lg bg-transparent hover:bg-muted border border-border/50 text-foreground/80 hover:text-foreground transition-all duration-150"
          >
            Cancel
          </button>
          <button
            onClick={onExecute}
            disabled={isPreviewPlanning || invalidPlanExplanation !== null || isNoop}
            className="py-2 px-5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all duration-150 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
          >
            {isPreviewPlanning ? 'Updating...' : 'Run'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PlanningFailureContent({
  error,
  cliCommand,
  onClose,
}: {
  error: string;
  cliCommand?: string;
  onClose: () => void;
}) {
  const formattedError = formatViewerMessage(error);

  return (
    <div className="flex flex-col py-6 px-6">
      <h2 className="text-lg font-semibold text-foreground mb-1">
        Plan Could Not Be Prepared
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        The planner returned an error. You can copy the CLI command below to inspect or reproduce it from terminal.
      </p>

      <div className="rounded-lg border border-red-500/30 bg-red-500/8 p-3 mb-4">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-300">
          <AlertCircle className="size-3.5" />
          Planning Error
        </div>
        <p className="text-xs text-red-700/90 dark:text-red-300/90">{formattedError}</p>
      </div>

      <div className="flex justify-between items-center">
        <div>{cliCommand && <CopyCliCommandButton cliCommand={cliCommand} />}</div>
        <button
          onClick={onClose}
          className="py-2 px-4 text-sm font-medium rounded-lg bg-transparent hover:bg-muted border border-border/50 text-foreground/80 hover:text-foreground transition-all duration-150"
        >
          Close
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
    getPinnedArtifacts,
    previewPlan,
  } = useExecution();

  const { planInfo: committedPlanInfo, status, error } = state;
  const [draftPreviewState, dispatchDraftPreview] = useReducer(
    draftPreviewReducer,
    INITIAL_DRAFT_PREVIEW_STATE
  );
  const {
    draftOverrides,
    draftPlanInfo,
    draftError,
    draftErrorSignature,
    isPreviewPlanning,
  } = draftPreviewState;
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewAbortControllerRef = useRef<AbortController | null>(null);
  const previewRequestIdRef = useRef(0);
  const draftSessionKeyRef = useRef<string | null>(null);
  const lastDraftOverrideSignatureRef = useRef<string | null>(null);

  const committedOverrideSignature = useMemo(
    () => serializeProducerOverrides(state.producerOverrides),
    [state.producerOverrides]
  );
  const draftOverrideSignature = useMemo(
    () => serializeProducerOverrides(draftOverrides),
    [draftOverrides]
  );
  const clearPreviewAsyncState = useCallback(() => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    if (previewAbortControllerRef.current) {
      previewAbortControllerRef.current.abort();
      previewAbortControllerRef.current = null;
    }
  }, []);
  const seedDraftPreviewSession = useCallback(
    (nextPlanInfo: PlanDisplayInfo, nextOverrides: ProducerOverrides) => {
      lastDraftOverrideSignatureRef.current = serializeProducerOverrides(
        nextOverrides
      );
      clearPreviewAsyncState();
      previewRequestIdRef.current += 1;
      dispatchDraftPreview({
        type: "seed-session",
        planInfo: nextPlanInfo,
        overrides: nextOverrides,
      });
    },
    [clearPreviewAsyncState]
  );
  const committedProducerRows = useMemo(() => {
    if (!committedPlanInfo) {
      return [];
    }
    return buildProducerRows(committedPlanInfo, state.producerOverrides);
  }, [committedPlanInfo, state.producerOverrides]);
  const baselineCountByProducerId = useMemo(
    () =>
      new Map(
        committedProducerRows.map((row) => [row.producerId, row.effectiveCount])
      ),
    [committedProducerRows]
  );
  const baselineOverrideSignatureByProducerId = useMemo(
    () =>
      new Map(
        committedProducerRows.map((row) => [
          row.producerId,
          `${state.producerOverrides[row.producerId]?.enabled ?? 'inherit'}:${state.producerOverrides[row.producerId]?.count ?? 'inherit'}`,
        ])
      ),
    [committedProducerRows, state.producerOverrides]
  );
  const isOpen =
    status === 'confirming' ||
    (status === 'failed' && error !== null && !state.showCompletionDialog);
  const planInfo = draftPlanInfo ?? committedPlanInfo;
  const currentErrorMessage =
    draftError !== null && draftErrorSignature === draftOverrideSignature
      ? draftError
      : undefined;
  const invalidPlanExplanation = useMemo(
    () => (currentErrorMessage ? parseInvalidPlanExplanation(currentErrorMessage) : null),
    [currentErrorMessage]
  );
  const blockedReasonByProducerId = useMemo(
    () =>
      new Map(
        (invalidPlanExplanation?.issues ?? []).map((issue) => [
          issue.producerId,
          `Needs ${summarizeArtifactLabels(issue.artifactLabels)}.`,
        ])
      ),
    [invalidPlanExplanation]
  );
  const producerRows = useMemo(() => {
    if (!planInfo) {
      return [];
    }
    return buildProducerRows(planInfo, draftOverrides, {
      baselineCountByProducerId,
      baselineOverrideSignatureByProducerId,
      blockedReasonByProducerId,
    });
  }, [
    baselineCountByProducerId,
    baselineOverrideSignatureByProducerId,
    blockedReasonByProducerId,
    draftOverrides,
    planInfo,
  ]);
  const producerListItems = useMemo(
    () => buildProducerListItems(producerRows),
    [producerRows]
  );
  const hasDraftChanges = draftOverrideSignature !== committedOverrideSignature;

  const fallbackCliCommand = useMemo(
    () =>
      buildFallbackCliCommand({
        blueprintName: state.blueprintName,
        movieId: state.movieId,
        upToLayer: state.layerRange.upToLayer,
        selectedForRegeneration: state.selectedForRegeneration,
        pinnedArtifacts: state.pinnedArtifacts,
        producerOverrides:
          committedPlanInfo !== null ? draftOverrides : state.producerOverrides,
      }),
    [
      committedPlanInfo,
      state.blueprintName,
      state.movieId,
      state.layerRange.upToLayer,
      state.selectedForRegeneration,
      state.pinnedArtifacts,
      draftOverrides,
      state.producerOverrides,
    ]
  );
  const cliCommand = planInfo?.cliCommand ?? fallbackCliCommand;
  const isSurgicalMode = planInfo?.surgicalInfo && planInfo.surgicalInfo.length > 0;
  const isNoop = planInfo?.totalJobs === 0;
  const showCostRange = planInfo?.hasRanges && planInfo.minCost !== planInfo.maxCost;
  const pinnedCount = getPinnedArtifacts().length;
  const displayedStageCount = useMemo(() => {
    if (!planInfo) {
      return 0;
    }
    if (state.layerRange.upToLayer !== null) {
      return state.layerRange.upToLayer + 1;
    }
    return planInfo.blueprintLayers;
  }, [planInfo, state.layerRange.upToLayer]);

  useEffect(() => {
    return () => {
      clearPreviewAsyncState();
      previewRequestIdRef.current += 1;
    };
  }, [clearPreviewAsyncState]);

  useEffect(() => {
    if (!isOpen || !committedPlanInfo) {
      draftSessionKeyRef.current = null;
      lastDraftOverrideSignatureRef.current = null;
      previewRequestIdRef.current += 1;
      clearPreviewAsyncState();
      return;
    }

    const nextSessionKey = `${committedPlanInfo.planId}:${committedOverrideSignature}`;
    if (draftSessionKeyRef.current === nextSessionKey) {
      return;
    }

    draftSessionKeyRef.current = nextSessionKey;
    seedDraftPreviewSession(committedPlanInfo, state.producerOverrides);
  }, [
    committedPlanInfo,
    committedOverrideSignature,
    clearPreviewAsyncState,
    isOpen,
    seedDraftPreviewSession,
    state.producerOverrides,
  ]);

  useEffect(() => {
    if (!isOpen || !committedPlanInfo || !state.blueprintName) {
      return;
    }

    if (lastDraftOverrideSignatureRef.current === draftOverrideSignature) {
      return;
    }

    lastDraftOverrideSignatureRef.current = draftOverrideSignature;
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
    }
    if (previewAbortControllerRef.current) {
      previewAbortControllerRef.current.abort();
      previewAbortControllerRef.current = null;
    }

    previewTimerRef.current = setTimeout(() => {
      previewTimerRef.current = null;
      const requestId = previewRequestIdRef.current + 1;
      const requestSignature = draftOverrideSignature;
      previewRequestIdRef.current = requestId;
      const abortController = new AbortController();
      previewAbortControllerRef.current = abortController;
      dispatchDraftPreview({ type: "preview-start" });

      void previewPlan({
        blueprintName: state.blueprintName!,
        movieId: state.movieId ?? undefined,
        upToLayer: state.layerRange.upToLayer ?? undefined,
        producerOverrides: draftOverrides,
        signal: abortController.signal,
      })
        .then((nextPlanInfo) => {
          if (requestId !== previewRequestIdRef.current) {
            return;
          }
          if (previewAbortControllerRef.current === abortController) {
            previewAbortControllerRef.current = null;
          }
          dispatchDraftPreview({
            type: "preview-success",
            planInfo: nextPlanInfo,
          });
        })
        .catch((previewError) => {
          if (abortController.signal.aborted) {
            if (previewAbortControllerRef.current === abortController) {
              previewAbortControllerRef.current = null;
            }
            return;
          }
          if (requestId !== previewRequestIdRef.current) {
            return;
          }
          if (previewAbortControllerRef.current === abortController) {
            previewAbortControllerRef.current = null;
          }
          dispatchDraftPreview({
            type: "preview-error",
            error:
              previewError instanceof Error
                ? previewError.message
                : 'Failed to update plan preview',
            signature: requestSignature,
          });
        });
    }, 200);
  }, [
    state.blueprintName,
    state.movieId,
    state.layerRange.upToLayer,
    committedPlanInfo,
    draftOverrideSignature,
    draftOverrides,
    isOpen,
    previewPlan,
  ]);

  const handleCountChange = useCallback(
    (producerId: string, count: number) => {
      const baselineCount = baselineCountByProducerId.get(producerId);
      const committedOverride = state.producerOverrides[producerId];
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }
      if (previewAbortControllerRef.current) {
        previewAbortControllerRef.current.abort();
        previewAbortControllerRef.current = null;
      }
      previewRequestIdRef.current += 1;
      dispatchDraftPreview({ type: "clear-preview-status" });
      dispatchDraftPreview({
        type: "update-overrides",
        updater: (currentOverrides) => {
          const nextOverrides = { ...currentOverrides };
          if (baselineCount !== undefined && count === baselineCount) {
            if (committedOverride) {
              nextOverrides[producerId] = committedOverride;
            } else {
              delete nextOverrides[producerId];
            }
            return nextOverrides;
          }

          nextOverrides[producerId] =
            count === 0
              ? { enabled: false, count: 0 }
              : { enabled: true, count };
          return nextOverrides;
        },
      });
    },
    [baselineCountByProducerId, state.producerOverrides]
  );

  const handleResetDraft = useCallback(() => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    if (previewAbortControllerRef.current) {
      previewAbortControllerRef.current.abort();
      previewAbortControllerRef.current = null;
    }
    previewRequestIdRef.current += 1;
    lastDraftOverrideSignatureRef.current = committedOverrideSignature;
    if (committedPlanInfo) {
      dispatchDraftPreview({
        type: "seed-session",
        planInfo: committedPlanInfo,
        overrides: state.producerOverrides,
      });
    }
  }, [committedOverrideSignature, committedPlanInfo, state.producerOverrides]);

  const handleDismiss = useCallback(() => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    if (previewAbortControllerRef.current) {
      previewAbortControllerRef.current.abort();
      previewAbortControllerRef.current = null;
    }
    previewRequestIdRef.current += 1;
    dismissDialog();
  }, [dismissDialog]);

  const handleExecute = () => {
    const executionPlanInfo = draftPlanInfo ?? committedPlanInfo;
    const executionOverrides =
      draftSessionKeyRef.current !== null ? draftOverrides : state.producerOverrides;
    if (!executionPlanInfo || currentErrorMessage) {
      return;
    }
    clearLogs();
    void confirmExecution({
      dryRun: false,
      planInfo: executionPlanInfo,
      producerOverrides: executionOverrides,
    });
  };

  if (!isOpen) return null;

  const dialogTitle =
    status === 'failed' && error && !committedPlanInfo
      ? 'Plan Could Not Be Prepared'
      : isNoop && invalidPlanExplanation === null && producerRows.length === 0
          ? 'All Caught Up'
          : isSurgicalMode
            ? 'Confirm Regeneration'
            : 'Confirm Execution';
  const dialogDescription =
    status === 'failed' && error && !committedPlanInfo
      ? 'The planner returned an error and execution cannot start.'
      : isNoop && invalidPlanExplanation === null && producerRows.length === 0
          ? 'There is no work to run for the current selection.'
          : 'Review the plan before running.';

  return (
    <Dialog open={true} onOpenChange={() => handleDismiss()}>
      <DialogContent
        className="sm:max-w-lg p-0 gap-0 overflow-hidden"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{dialogTitle}</DialogTitle>
        <DialogDescription className="sr-only">
          {dialogDescription}
        </DialogDescription>
        {/* Custom close button */}
        <button
          onClick={handleDismiss}
          className="absolute right-4 top-4 p-1 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/80 transition-colors z-20"
        >
          <X className="w-4 h-4" />
          <span className="sr-only">Close</span>
        </button>

        {/* Content */}
        {status === 'failed' && error && !committedPlanInfo ? (
          <PlanningFailureContent
            error={error}
            cliCommand={cliCommand}
            onClose={handleDismiss}
          />
        ) : isNoop && invalidPlanExplanation === null && producerRows.length === 0 ? (
          <NoopContent onClose={handleDismiss} />
        ) : planInfo ? (
          <PlanContent
            planInfo={planInfo}
            producerListItems={producerListItems}
            displayedStageCount={displayedStageCount}
            showCostRange={showCostRange ?? false}
            isSurgicalMode={isSurgicalMode ?? false}
            isPreviewPlanning={isPreviewPlanning}
            invalidPlanExplanation={invalidPlanExplanation}
            hasDraftChanges={hasDraftChanges}
            cliCommand={cliCommand}
            pinnedCount={pinnedCount}
            isNoop={isNoop ?? false}
            onCountChange={handleCountChange}
            onResetDraft={handleResetDraft}
            onCancel={handleDismiss}
            onExecute={handleExecute}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
