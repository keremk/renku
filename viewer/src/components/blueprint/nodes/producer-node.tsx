import { Handle, Position } from "@xyflow/react";
import type { ProducerStatus } from "@/types/generation";
import type { ProducerBinding } from "@/types/blueprint-graph";

interface ProducerNodeData {
  label: string;
  compositeName?: string;
  loop?: string;
  producerType?: string;
  description?: string;
  inputBindings: ProducerBinding[];
  outputBindings: ProducerBinding[];
  status?: ProducerStatus;
}

interface ProducerNodeProps {
  data: ProducerNodeData;
  selected?: boolean;
}

/**
 * Get CSS classes for status-based styling.
 */
function getStatusStyles(status: ProducerStatus | undefined, selected: boolean): {
  border: string;
  bg: string;
  dot: string;
  dotPulse: boolean;
  ring: string;
} {
  const ring = selected ? "ring-2 ring-primary/35" : "";

  switch (status) {
    case 'success':
      return {
        border: "border-emerald-500/70",
        bg: "bg-emerald-500/5",
        dot: "bg-emerald-500",
        dotPulse: false,
        ring,
      };
    case 'error':
      return {
        border: "border-red-500/70",
        bg: "bg-red-500/5",
        dot: "bg-red-500",
        dotPulse: false,
        ring,
      };
    case 'skipped':
      return {
        border: "border-slate-500/70",
        bg: "bg-slate-500/5",
        dot: "bg-slate-500",
        dotPulse: false,
        ring,
      };
    case 'running':
      return {
        border: "border-blue-500/70",
        bg: "bg-blue-500/5",
        dot: "bg-blue-500",
        dotPulse: true,
        ring,
      };
    case 'pending':
      return {
        border: "border-amber-500/70",
        bg: "bg-amber-500/5",
        dot: "bg-amber-500",
        dotPulse: false,
        ring,
      };
    case 'not-run-yet':
    default:
      return {
        border: "border-border/60",
        bg: "",
        dot: "",
        dotPulse: false,
        ring,
      };
  }
}

function formatProducerLabel(label: string): string {
  return label
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

export function ProducerNode({ data, selected }: ProducerNodeProps) {
  const nodeData = data;
  const styles = getStatusStyles(nodeData.status, selected ?? false);
  const showStatusDot = nodeData.status && nodeData.status !== 'not-run-yet';
  const displayLabel = formatProducerLabel(nodeData.label);
  const title = nodeData.description
    ? `${nodeData.label}\n${nodeData.description}`
    : nodeData.label;

  return (
    <div
      className={`
        relative flex min-h-[96px] w-full flex-col items-center justify-center overflow-hidden
        px-4 py-4 rounded-xl
        bg-card border-2
        ${styles.border}
        ${styles.bg}
        ${styles.ring}
        transition-all duration-200
      `}
      title={title}
    >
      {/* Status indicator dot */}
      {showStatusDot && (
        <div
          className={`
            absolute -top-1 -right-1 w-3 h-3 rounded-full
            ${styles.dot}
            ${styles.dotPulse ? "animate-pulse" : ""}
          `}
        />
      )}

      <Handle
        type="target"
        position={Position.Left}
        className="bg-gray-400! w-2! h-2!"
      />
      <span className="line-clamp-2 max-w-full text-center text-sm font-semibold leading-tight text-foreground break-words [overflow-wrap:anywhere]">
        {displayLabel}
      </span>
      {nodeData.compositeName && (
        <span className="mt-1 line-clamp-1 max-w-full text-center text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80 break-words [overflow-wrap:anywhere]">
          {formatProducerLabel(nodeData.compositeName)}
        </span>
      )}
      {nodeData.loop && (
        <span className="mt-1 max-w-full truncate text-xs text-muted-foreground">
          [{nodeData.loop}]
        </span>
      )}
      {nodeData.producerType && (
        <span className="mt-1 line-clamp-1 max-w-full text-center text-[10px] text-muted-foreground/70 break-words [overflow-wrap:anywhere]">
          {nodeData.producerType}
        </span>
      )}
      <Handle
        type="source"
        position={Position.Right}
        className="bg-gray-400! w-2! h-2!"
      />
    </div>
  );
}
