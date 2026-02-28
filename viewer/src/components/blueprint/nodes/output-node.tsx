import { Handle, Position } from "@xyflow/react";

interface OutputNodeData {
  label: string;
  description?: string;
}

interface OutputNodeProps {
  data: OutputNodeData;
  selected?: boolean;
}

export function OutputNode({ data, selected }: OutputNodeProps) {
  const nodeData = data;

  return (
    <div
      className={`
        flex items-center justify-center
        w-16 h-16 rounded-full
        bg-purple-500/20 dark:bg-purple-500/35 border-2
        ${selected ? "border-purple-400 ring-2 ring-purple-400/30" : "border-purple-500/50 dark:border-purple-400/60"}
        text-purple-200 text-xs font-medium
        transition-all duration-200
      `}
      title={nodeData.description}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-purple-400 !w-2 !h-2"
      />
      <span className="truncate px-1 text-center leading-tight">
        {nodeData.label}
      </span>
    </div>
  );
}
