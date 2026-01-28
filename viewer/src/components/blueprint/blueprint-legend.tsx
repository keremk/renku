/**
 * Legend component for the blueprint flow visualization.
 * Shows node types (Input, Producer, Output) and edge types (Connection, Conditional).
 */

interface LegendItemProps {
  icon: React.ReactNode;
  label: string;
  className?: string;
}

function LegendItem({ icon, label, className }: LegendItemProps) {
  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      {icon}
      <span>{label}</span>
    </div>
  );
}

export function BlueprintLegend() {
  return (
    <div className="flex items-center text-xs text-muted-foreground px-4 py-2 border-t border-border/30 shrink-0">
      <div className="flex items-center gap-6">
        <LegendItem
          icon={<div className="w-4 h-4 rounded-full bg-blue-500/30 border border-blue-500/50" />}
          label="Input"
        />
        <LegendItem
          icon={<div className="w-4 h-3 rounded bg-card border border-border/60" />}
          label="Producer"
        />
        <LegendItem
          icon={<div className="w-4 h-4 rounded-full bg-purple-500/30 border border-purple-500/50" />}
          label="Output"
        />
        <LegendItem
          icon={<div className="w-8 h-0 border-t border-gray-400" />}
          label="Connection"
          className="ml-4"
        />
        <LegendItem
          icon={<div className="w-8 h-0 border-t border-dashed border-amber-400" />}
          label="Conditional"
        />
      </div>
    </div>
  );
}
