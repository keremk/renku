import { Handle, Position } from "@xyflow/react";

interface InputNodeData {
  label: string;
  description?: string;
}

interface InputNodeProps {
  data: InputNodeData;
  selected?: boolean;
}

export function InputNode({ data, selected }: InputNodeProps) {
  const nodeData = data;

  return (
    <div
      className={`
        flex items-center justify-center
        w-16 h-16 rounded-full
        bg-blue-500/20 dark:bg-blue-500/35 border-2
        ${selected ? "border-blue-400 ring-2 ring-blue-400/30" : "border-blue-500/50 dark:border-blue-400/60"}
        text-blue-200 text-xs font-medium
        transition-all duration-200
      `}
      title={nodeData.description}
    >
      <span className="truncate px-1 text-center leading-tight">
        {nodeData.label}
      </span>
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-blue-400 !w-2 !h-2"
      />
    </div>
  );
}
