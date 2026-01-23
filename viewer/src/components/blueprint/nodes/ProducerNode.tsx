import { Handle, Position } from "@xyflow/react";
import type { ProducerStatus } from "@/types/generation";

interface ProducerNodeData {
  label: string;
  loop?: string;
  producerType?: string;
  description?: string;
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
} {
  if (selected) {
    return {
      border: "border-green-400 ring-2 ring-green-400/30",
      bg: "",
      dot: "",
      dotPulse: false,
    };
  }

  switch (status) {
    case 'success':
      return {
        border: "border-emerald-500/70",
        bg: "bg-emerald-500/5",
        dot: "bg-emerald-500",
        dotPulse: false,
      };
    case 'error':
      return {
        border: "border-red-500/70",
        bg: "bg-red-500/5",
        dot: "bg-red-500",
        dotPulse: false,
      };
    case 'running':
      return {
        border: "border-blue-500/70",
        bg: "bg-blue-500/5",
        dot: "bg-blue-500",
        dotPulse: true,
      };
    case 'pending':
      return {
        border: "border-amber-500/70",
        bg: "bg-amber-500/5",
        dot: "bg-amber-500",
        dotPulse: false,
      };
    case 'not-run-yet':
    default:
      return {
        border: "border-border/60",
        bg: "",
        dot: "",
        dotPulse: false,
      };
  }
}

export function ProducerNode({ data, selected }: ProducerNodeProps) {
  const nodeData = data;
  const styles = getStatusStyles(nodeData.status, selected ?? false);
  const showStatusDot = nodeData.status && nodeData.status !== 'not-run-yet';

  return (
    <div
      className={`
        relative flex flex-col items-center justify-center
        min-w-[140px] px-4 py-3 rounded-xl
        bg-card border-2
        ${styles.border}
        ${styles.bg}
        transition-all duration-200
      `}
      title={nodeData.description}
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
        className="!bg-gray-400 !w-2 !h-2"
      />
      <span className="text-sm font-semibold text-foreground truncate max-w-[160px]">
        {nodeData.label}
      </span>
      {nodeData.loop && (
        <span className="text-xs text-muted-foreground mt-0.5">
          [{nodeData.loop}]
        </span>
      )}
      {nodeData.producerType && (
        <span className="text-[10px] text-muted-foreground/70 mt-0.5 truncate max-w-[140px]">
          {nodeData.producerType}
        </span>
      )}
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-gray-400 !w-2 !h-2"
      />
    </div>
  );
}
