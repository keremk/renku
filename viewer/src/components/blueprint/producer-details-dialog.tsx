import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, ArrowRight, Layers, MapPin, RotateCcw } from "lucide-react";
import type { ProducerBinding } from "@/types/blueprint-graph";
import type { ProducerSchedulingSummary, ProducerStatus } from "@/types/generation";

interface ProducerDetails {
  nodeId: string;
  label: string;
  runnable?: boolean;
  producerType?: string;
  description?: string;
  loop?: string;
  status: ProducerStatus;
  inputBindings: ProducerBinding[];
  outputBindings: ProducerBinding[];
}

interface ProducerDetailsDialogProps {
  open: boolean;
  producer: ProducerDetails | null;
  producerId?: string;
  override?: {
    enabled?: boolean;
    count?: number;
  };
  scheduling?: ProducerSchedulingSummary;
  schedulingLoading?: boolean;
  schedulingError?: string | null;
  onSetOverrideEnabled?: (producerId: string, enabled: boolean) => void;
  onSetOverrideCount?: (producerId: string, count: number | null) => void;
  onResetOverride?: (producerId: string) => void;
  onOpenChange: (open: boolean) => void;
}

type DialogTab = "overview" | "inputs" | "outputs";

function getStatusBadgeClasses(status: ProducerStatus): string {
  switch (status) {
    case "success":
      return "border-emerald-500/45 bg-emerald-500/14 text-emerald-700 dark:text-emerald-300";
    case "error":
      return "border-red-500/45 bg-red-500/14 text-red-700 dark:text-red-300";
    case "running":
      return "border-blue-500/45 bg-blue-500/14 text-blue-700 dark:text-blue-300";
    case "pending":
      return "border-amber-500/45 bg-amber-500/14 text-amber-700 dark:text-amber-300";
    case "skipped":
      return "border-slate-500/45 bg-slate-500/14 text-slate-700 dark:text-slate-300";
    case "not-run-yet":
      return "border-border/50 bg-muted text-muted-foreground";
    default:
      return "border-border/50 bg-muted text-muted-foreground";
  }
}

function formatStatusLabel(status: ProducerStatus): string {
  if (status === "not-run-yet") {
    return "Not run yet";
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function getEndpointTypeCardClasses(endpointType: ProducerBinding["sourceType"]): string {
  switch (endpointType) {
    case "input":
      return "border-l-sky-500 bg-item-hover-bg";
    case "producer":
      return "border-l-emerald-500 bg-item-hover-bg";
    case "output":
      return "border-l-fuchsia-500 bg-item-hover-bg";
    case "unknown":
    default:
      return "border-l-muted bg-item-hover-bg";
  }
}

function getEndpointTypeDotClasses(endpointType: ProducerBinding["sourceType"]): string {
  switch (endpointType) {
    case "input":
      return "bg-sky-500 dark:bg-sky-300";
    case "producer":
      return "bg-emerald-500 dark:bg-emerald-300";
    case "output":
      return "bg-fuchsia-500 dark:bg-fuchsia-300";
    case "unknown":
    default:
      return "bg-muted-foreground";
  }
}

function stripReferencePrefix(ref: string): string {
  return ref
    .replace(/^Input\./, "")
    .replace(/^Output\./, "")
    .replace(/^Artifact:/, "");
}

function normalizeProducerSegment(value: string): string {
  return value.replace(/\[[^\]]+\]/g, "");
}

function formatProducerContext(value: string): string {
  return normalizeProducerSegment(value).replace(/Producer$/, "");
}

function summarizeReference(reference: string, currentProducerLabel: string): {
  primary: string;
  contextProducer?: string;
  isCurrentProducer: boolean;
} {
  const clean = stripReferencePrefix(reference);
  const parts = clean.split(".");

  if (parts.length <= 1) {
    return { primary: clean, isCurrentProducer: false };
  }

  const producerSegment = parts[0];
  const pathSegment = parts.slice(1).join(" / ");
  const isCurrentProducer =
    normalizeProducerSegment(producerSegment) === normalizeProducerSegment(currentProducerLabel);

  if (isCurrentProducer) {
    return {
      primary: pathSegment,
      isCurrentProducer: true,
    };
  }

  return {
    primary: pathSegment,
    contextProducer: formatProducerContext(producerSegment),
    isCurrentProducer: false,
  };
}

function EndpointLegend() {
  const items: Array<{ label: string; type: ProducerBinding["sourceType"] }> = [
    { label: "Input", type: "input" },
    { label: "Producer", type: "producer" },
    { label: "Output", type: "output" },
  ];

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-foreground/70 dark:text-muted-foreground">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1">
          <span className={`inline-block h-2 w-2 rounded-full ${getEndpointTypeDotClasses(item.type)}`} />
          <span>{item.label}</span>
        </span>
      ))}
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center px-4 h-full text-[11px] uppercase tracking-[0.12em] font-semibold transition-colors ${
        active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-item-hover-bg"
      }`}
    >
      {label}
      {active && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary" />
      )}
    </button>
  );
}

function ConnectionRow({
  binding,
  showRawRefs,
  currentProducerLabel,
}: {
  binding: ProducerBinding;
  showRawRefs: boolean;
  currentProducerLabel: string;
}) {
  const fromSummary = summarizeReference(binding.from, currentProducerLabel);
  const toSummary = summarizeReference(binding.to, currentProducerLabel);

  return (
    <li className="rounded-lg bg-muted px-3 py-2.5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <div className={`min-w-0 rounded-md border-l-2 px-2.5 py-2 ${getEndpointTypeCardClasses(binding.sourceType)}`}>
          <div className="flex items-start gap-2">
            <span className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${getEndpointTypeDotClasses(binding.sourceType)}`} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium leading-snug text-foreground break-words" title={binding.from}>
                  {fromSummary.primary}
                </p>
                {fromSummary.isCurrentProducer && (
                  <MapPin
                    className="h-3.5 w-3.5 shrink-0 text-primary/85"
                    aria-label="Current producer"
                  />
                )}
              </div>
              {fromSummary.contextProducer && (
                <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-foreground/55 dark:text-muted-foreground">
                  <Layers className="h-3 w-3" aria-hidden="true" />
                  <span>{fromSummary.contextProducer}</span>
                </p>
              )}
            </div>
          </div>
          {showRawRefs && (
            <p className="mt-1 truncate pt-1 font-mono text-[11px] text-muted-foreground/70" title={binding.from}>
              {binding.from}
            </p>
          )}
        </div>

        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/80" aria-hidden="true" />

        <div className={`min-w-0 rounded-md border-l-2 px-2.5 py-2 ${getEndpointTypeCardClasses(binding.targetType)}`}>
          <div className="flex items-start gap-2">
            <span className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${getEndpointTypeDotClasses(binding.targetType)}`} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium leading-snug text-foreground break-words" title={binding.to}>
                  {toSummary.primary}
                </p>
                {toSummary.isCurrentProducer && (
                  <MapPin
                    className="h-3.5 w-3.5 shrink-0 text-primary/85"
                    aria-label="Current producer"
                  />
                )}
              </div>
              {toSummary.contextProducer && (
                <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-foreground/55 dark:text-muted-foreground">
                  <Layers className="h-3 w-3" aria-hidden="true" />
                  <span>{toSummary.contextProducer}</span>
                </p>
              )}
            </div>
          </div>
          {showRawRefs && (
            <p className="mt-1 truncate pt-1 font-mono text-[11px] text-muted-foreground/70" title={binding.to}>
              {binding.to}
            </p>
          )}
        </div>
      </div>
      {binding.isConditional && (
        <div className="mt-2">
          <span className="rounded border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
            {binding.conditionName ? `if ${binding.conditionName}` : "conditional"}
          </span>
        </div>
      )}
    </li>
  );
}

function ConnectionsPanel({
  bindings,
  showRawRefs,
  onToggleRawRefs,
  title,
  emptyLabel,
  currentProducerLabel,
}: {
  bindings: ProducerBinding[];
  showRawRefs: boolean;
  onToggleRawRefs: () => void;
  title: string;
  emptyLabel: string;
  currentProducerLabel: string;
}) {
  return (
    <section className="flex h-full flex-col rounded-xl bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {bindings.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onToggleRawRefs}
          className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground hover:bg-item-hover-bg hover:text-foreground transition-colors"
        >
          {showRawRefs ? "Hide raw refs" : "Show raw refs"}
        </button>
      </div>
      <EndpointLegend />
      {bindings.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
          {bindings.map((binding, index) => (
            <ConnectionRow
              key={`${binding.from}->${binding.to}-${index}`}
              binding={binding}
              showRawRefs={showRawRefs}
              currentProducerLabel={currentProducerLabel}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function SchedulingOverridesSection({
  producer,
  producerId,
  override,
  scheduling,
  schedulingLoading,
  schedulingError,
  onSetOverrideEnabled,
  onSetOverrideCount,
  onResetOverride,
}: {
  producer: ProducerDetails;
  producerId: string;
  override?: {
    enabled?: boolean;
    count?: number;
  };
  scheduling?: ProducerSchedulingSummary;
  schedulingLoading?: boolean;
  schedulingError?: string | null;
  onSetOverrideEnabled?: (producerId: string, enabled: boolean) => void;
  onSetOverrideCount?: (producerId: string, count: number | null) => void;
  onResetOverride?: (producerId: string) => void;
}) {
  const hasOverride = override !== undefined;
  const effectiveEnabled = override?.enabled ?? true;
  const maxSelectableCount = scheduling?.maxSelectableCount;
  const inheritedCountLimit =
    scheduling?.effectiveCountLimit === null
      ? maxSelectableCount
      : scheduling?.effectiveCountLimit;
  const effectiveCount =
    override?.count ?? inheritedCountLimit ?? maxSelectableCount;

  const warningText = scheduling?.warnings[0];

  return (
    <section className="rounded-lg bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Scheduling Overrides</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Control whether this producer runs and cap first-dimension generation count.
          </p>
        </div>
        <button
          type="button"
          disabled={!hasOverride}
          onClick={() => onResetOverride?.(producerId)}
          className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-item-hover-bg hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between rounded-md bg-muted px-2.5 py-2">
        <div>
          <p className="text-xs font-medium text-foreground">Schedule Producer</p>
          <p className="text-[11px] text-muted-foreground">
            {override?.enabled === undefined ? "Inheriting plan defaults" : "Override applied"}
          </p>
        </div>
        <Switch
          aria-label={`Schedule ${producer.label}`}
          checked={effectiveEnabled}
          onCheckedChange={(checked) =>
            onSetOverrideEnabled?.(producerId, checked)
          }
        />
      </div>

      <div className="mt-3 rounded-md bg-muted px-2.5 py-2">
        <label className="text-xs font-medium text-foreground" htmlFor={`producer-count-${producerId}`}>
          Artifact Count
        </label>
        {maxSelectableCount !== undefined ? (
          <>
            <div className="mt-1 flex items-center gap-2">
              <input
                id={`producer-count-${producerId}`}
                type="number"
                min={1}
                max={maxSelectableCount}
                disabled={!effectiveEnabled}
                value={effectiveCount ?? ""}
                onChange={(event) => {
                  const value = event.target.value.trim();
                  if (value.length === 0) {
                    onSetOverrideCount?.(producerId, null);
                    return;
                  }
                  const parsed = Number.parseInt(value, 10);
                  if (!Number.isInteger(parsed)) {
                    return;
                  }
                  if (parsed < 1 || parsed > maxSelectableCount) {
                    return;
                  }
                  onSetOverrideCount?.(producerId, parsed);
                }}
                className="w-20 rounded border border-border/50 bg-background px-2 py-1 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              />
              <span className="text-[11px] text-muted-foreground">
                1 to {maxSelectableCount}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Current plan constraint:{' '}
              {scheduling?.effectiveCountLimit === null
                ? 'No cap'
                : scheduling?.effectiveCountLimit}
            </p>
          </>
        ) : schedulingLoading ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Calculating available count...
          </p>
        ) : (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Available count is not ready. Open Run to refresh plan scheduling.
          </p>
        )}
      </div>

      {schedulingError && (
        <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/8 px-2.5 py-2 text-[11px] text-red-700 dark:text-red-300">
          {schedulingError}
        </div>
      )}

      {warningText && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{warningText}</span>
        </div>
      )}
    </section>
  );
}

function ProducerDetailsDialogBody({
  open,
  producer,
  producerId,
  override,
  scheduling,
  schedulingLoading,
  schedulingError,
  onSetOverrideEnabled,
  onSetOverrideCount,
  onResetOverride,
  onOpenChange,
}: {
  open: boolean;
  producer: ProducerDetails;
  producerId: string;
  override?: {
    enabled?: boolean;
    count?: number;
  };
  scheduling?: ProducerSchedulingSummary;
  schedulingLoading?: boolean;
  schedulingError?: string | null;
  onSetOverrideEnabled?: (producerId: string, enabled: boolean) => void;
  onSetOverrideCount?: (producerId: string, count: number | null) => void;
  onResetOverride?: (producerId: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [activeTab, setActiveTab] = useState<DialogTab>("overview");
  const [showRawRefs, setShowRawRefs] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setActiveTab("overview");
      setShowRawRefs(false);
    }
    onOpenChange(nextOpen);
  };

  const summaryItems = [
    { label: "Inputs", value: producer.inputBindings.length },
    { label: "Outputs", value: producer.outputBindings.length },
    { label: "Status", value: formatStatusLabel(producer.status) },
  ];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl overflow-hidden p-0 gap-0 flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle className="text-sm normal-case tracking-normal">
              {producer.label}
            </DialogTitle>
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${getStatusBadgeClasses(producer.status)}`}>
              {formatStatusLabel(producer.status)}
            </span>
          </div>
          <DialogDescription className="sr-only">
            Producer inputs, outputs, and latest execution status.
          </DialogDescription>
          <p className="text-left text-xs text-muted-foreground">
            {producer.description ?? "Producer wiring and run status."}
          </p>
        </DialogHeader>

        <div className="border-b border-border/40 h-[40px] flex items-center px-2 shrink-0 dark:border-border/25">
          <div className="flex items-center h-full">
            <TabButton
              label="Overview"
              active={activeTab === "overview"}
              onClick={() => setActiveTab("overview")}
            />
            <TabButton
              label={`Inputs (${producer.inputBindings.length})`}
              active={activeTab === "inputs"}
              onClick={() => setActiveTab("inputs")}
            />
            <TabButton
              label={`Outputs (${producer.outputBindings.length})`}
              active={activeTab === "outputs"}
              onClick={() => setActiveTab("outputs")}
            />
          </div>
        </div>

        <div className="h-[430px] px-6 pb-6 pt-4 overflow-y-auto">
          {activeTab === "overview" && (
            <div className="h-full space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {summaryItems.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-lg bg-card px-3 py-2.5"
                  >
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {item.label}
                    </p>
                    <p className="mt-1 text-base font-semibold text-foreground">{item.value}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-lg bg-card p-3 text-sm text-muted-foreground">
                {producer.producerType && (
                  <p>
                    <span className="text-foreground/90">Type:</span> {producer.producerType}
                  </p>
                )}
                {producer.loop && (
                  <p className="mt-1">
                    <span className="text-foreground/90">Loop:</span> {producer.loop}
                  </p>
                )}
                <p className="mt-2 text-xs">
                  Open <span className="font-medium text-foreground/90">Inputs</span> or{" "}
                  <span className="font-medium text-foreground/90">Outputs</span> for connection details.
                </p>
              </div>
              {producer.runnable === false ? (
                <div className="rounded-lg bg-card p-3 text-sm text-muted-foreground">
                  <p className="font-semibold text-foreground">
                    Composite Blueprint Container
                  </p>
                  <p className="mt-1 text-xs">
                    This node groups inner producers. Scheduling and run controls
                    apply to the inner leaf producers, not to this container.
                  </p>
                </div>
              ) : (
                <SchedulingOverridesSection
                  producer={producer}
                  producerId={producerId}
                  override={override}
                  scheduling={scheduling}
                  schedulingLoading={schedulingLoading}
                  schedulingError={schedulingError}
                  onSetOverrideEnabled={onSetOverrideEnabled}
                  onSetOverrideCount={onSetOverrideCount}
                  onResetOverride={onResetOverride}
                />
              )}
            </div>
          )}

          {activeTab === "inputs" && (
            <ConnectionsPanel
              title="Incoming Bindings"
              emptyLabel="No incoming bindings."
              bindings={producer.inputBindings}
              showRawRefs={showRawRefs}
              onToggleRawRefs={() => setShowRawRefs((prev) => !prev)}
              currentProducerLabel={producer.label}
            />
          )}

          {activeTab === "outputs" && (
            <ConnectionsPanel
              title="Outgoing Bindings"
              emptyLabel="No outgoing bindings."
              bindings={producer.outputBindings}
              showRawRefs={showRawRefs}
              onToggleRawRefs={() => setShowRawRefs((prev) => !prev)}
              currentProducerLabel={producer.label}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ProducerDetailsDialog({
  open,
  producer,
  producerId,
  override,
  scheduling,
  schedulingLoading,
  schedulingError,
  onSetOverrideEnabled,
  onSetOverrideCount,
  onResetOverride,
  onOpenChange,
}: ProducerDetailsDialogProps) {
  if (!producer) {
    return null;
  }

  return (
    <ProducerDetailsDialogBody
      key={producer.nodeId}
      open={open}
      producer={producer}
      producerId={producerId ?? producer.nodeId}
      override={override}
      scheduling={scheduling}
      schedulingLoading={schedulingLoading}
      schedulingError={schedulingError}
      onSetOverrideEnabled={onSetOverrideEnabled}
      onSetOverrideCount={onSetOverrideCount}
      onResetOverride={onResetOverride}
      onOpenChange={onOpenChange}
    />
  );
}

export type { ProducerDetails };
