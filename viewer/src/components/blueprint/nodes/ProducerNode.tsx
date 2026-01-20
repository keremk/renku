import { Handle, Position } from "@xyflow/react";

interface ProducerNodeData {
  label: string;
  loop?: string;
  producerType?: string;
  description?: string;
}

interface ProducerNodeProps {
  data: ProducerNodeData;
  selected?: boolean;
}

export function ProducerNode({ data, selected }: ProducerNodeProps) {
  const nodeData = data;

  return (
    <div
      className={`
        flex flex-col items-center justify-center
        min-w-[140px] px-4 py-3 rounded-xl
        bg-card border-2
        ${selected ? "border-green-400 ring-2 ring-green-400/30" : "border-border/60"}
        transition-all duration-200
      `}
      title={nodeData.description}
    >
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
