import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowRight, Layers, MapPin } from "lucide-react";
import type { ProducerBinding } from "@/types/blueprint-graph";
import type { ProducerStatus } from "@/types/generation";

interface ProducerDetails {
  nodeId: string;
  label: string;
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
      return "border-l-sky-500 bg-background/85 dark:bg-background/70";
    case "producer":
      return "border-l-emerald-500 bg-background/85 dark:bg-background/70";
    case "output":
      return "border-l-fuchsia-500 bg-background/85 dark:bg-background/70";
    case "unknown":
    default:
      return "border-l-border/60 bg-background/85 dark:bg-background/70";
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
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-transparent text-muted-foreground hover:bg-muted/35 hover:text-foreground"
      }`}
    >
      {label}
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
    <li className="rounded-lg border border-border/45 bg-background/65 px-3 py-2.5 dark:border-border/30 dark:bg-background/35">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <div className={`min-w-0 rounded-md border border-border/50 border-l-2 px-2.5 py-2 dark:border-border/35 ${getEndpointTypeCardClasses(binding.sourceType)}`}>
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
                    title="Current producer"
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
            <p className="mt-1 truncate border-t border-border/30 pt-1 font-mono text-[11px] text-muted-foreground" title={binding.from}>
              {binding.from}
            </p>
          )}
        </div>

        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/80" aria-hidden="true" />

        <div className={`min-w-0 rounded-md border border-border/50 border-l-2 px-2.5 py-2 dark:border-border/35 ${getEndpointTypeCardClasses(binding.targetType)}`}>
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
                    title="Current producer"
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
            <p className="mt-1 truncate border-t border-border/30 pt-1 font-mono text-[11px] text-muted-foreground" title={binding.to}>
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
    <section className="flex h-full flex-col rounded-xl border border-border/45 bg-background/72 p-4 dark:border-border/35 dark:bg-background/45">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <span className="rounded-full border border-border/45 bg-background/80 px-2 py-0.5 text-xs text-muted-foreground dark:border-border/35 dark:bg-background/70">
            {bindings.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onToggleRawRefs}
          className="rounded-md border border-border/50 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
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

function ProducerDetailsDialogBody({
  open,
  producer,
  onOpenChange,
}: {
  open: boolean;
  producer: ProducerDetails;
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
      <DialogContent className="max-w-2xl overflow-hidden bg-card p-0">
        <DialogHeader className="border-b border-border/45 px-6 py-5 dark:border-border/30">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getStatusBadgeClasses(producer.status)}`}>
              {formatStatusLabel(producer.status)}
            </span>
            <span className="rounded-md border border-border/60 bg-background/70 px-2 py-1 font-mono text-[11px] text-muted-foreground">
              {producer.nodeId}
            </span>
          </div>
          <DialogTitle className="text-xl">{producer.label}</DialogTitle>
          <DialogDescription className="sr-only">
            Producer inputs, outputs, and latest execution status.
          </DialogDescription>
          <p className="text-left text-sm text-muted-foreground">
            {producer.description ?? "Producer wiring and run status."}
          </p>
        </DialogHeader>

        <div className="border-b border-border/40 px-6 py-3 dark:border-border/25">
          <div className="flex items-center gap-2">
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

        <div className="h-[430px] px-6 pb-6 pt-4">
          {activeTab === "overview" && (
            <div className="h-full space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {summaryItems.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-lg border border-border/45 bg-background/60 px-3 py-2.5 dark:border-border/35 dark:bg-background/45"
                  >
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {item.label}
                    </p>
                    <p className="mt-1 text-base font-semibold text-foreground">{item.value}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-border/45 bg-background/60 p-3 text-sm text-muted-foreground dark:border-border/35 dark:bg-background/45">
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

export function ProducerDetailsDialog({ open, producer, onOpenChange }: ProducerDetailsDialogProps) {
  if (!producer) {
    return null;
  }

  return (
    <ProducerDetailsDialogBody
      key={producer.nodeId}
      open={open}
      producer={producer}
      onOpenChange={onOpenChange}
    />
  );
}

export type { ProducerDetails };
