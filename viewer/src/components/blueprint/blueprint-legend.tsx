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
    <div className="flex flex-wrap items-center gap-6 text-xs text-muted-foreground px-4 py-2 border-t border-border/30 shrink-0">
      <div className="flex flex-wrap items-center gap-6">
        <LegendItem
          icon={<div className="w-4 h-4 rounded-full bg-blue-500/30 dark:bg-blue-500/45 border border-blue-500/50 dark:border-blue-400/60" />}
          label="Input"
        />
        <LegendItem
          icon={<div className="w-4 h-3 rounded bg-card border border-border/60" />}
          label="Producer"
        />
        <LegendItem
          icon={<div className="w-4 h-4 rounded-full bg-purple-500/30 dark:bg-purple-500/45 border border-purple-500/50 dark:border-purple-400/60" />}
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
      <div className="h-4 w-px bg-border/40" />
      <div className="flex flex-wrap items-center gap-3">
        <LegendItem
          icon={<div className="w-3 h-3 rounded border border-emerald-500/70 bg-emerald-500/20" />}
          label="Success"
        />
        <LegendItem
          icon={<div className="w-3 h-3 rounded border border-red-500/70 bg-red-500/20" />}
          label="Error"
        />
        <LegendItem
          icon={<div className="w-3 h-3 rounded border border-blue-500/70 bg-blue-500/20" />}
          label="Running"
        />
        <LegendItem
          icon={<div className="w-3 h-3 rounded border border-amber-500/70 bg-amber-500/20" />}
          label="Pending"
        />
        <LegendItem
          icon={<div className="w-3 h-3 rounded border border-slate-500/70 bg-slate-500/20" />}
          label="Skipped"
        />
      </div>
    </div>
  );
}
