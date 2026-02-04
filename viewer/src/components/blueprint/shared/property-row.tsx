/**
 * Shared property row component for config properties (Models panel)
 * and other inputs (Inputs panel).
 *
 * Uses constrained width to prevent full-width stretch on wide screens.
 */

import { cn } from "@/lib/utils";

export interface PropertyRowProps {
  /** Property name */
  name: string;
  /** Property type (e.g., "string", "number", "boolean") */
  type?: string;
  /** Property description */
  description?: string;
  /** Whether the property is required */
  required?: boolean;
  /** The input control to render */
  children: React.ReactNode;
  /** Additional class name */
  className?: string;
  /** Whether the row is selected/highlighted */
  isSelected?: boolean;
}

/**
 * Renders a property row with label on left, input on right.
 * Uses max-w-2xl to prevent full-width stretch on wide screens.
 */
export function PropertyRow({
  name,
  type,
  description,
  required = false,
  children,
  className,
  isSelected = false,
}: PropertyRowProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-4 p-4 rounded-xl border max-w-2xl shadow-lg transition-all",
        isSelected
          ? "border-primary bg-primary/10 ring-2 ring-primary/40 shadow-xl -translate-y-0.5"
          : "bg-card border-border hover:border-primary/70 hover:shadow-xl hover:-translate-y-0.5",
        className
      )}
    >
      {/* Left: label area */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-sm text-foreground">{name}</span>
          {type && (
            <span className="text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded shrink-0">
              {type}
            </span>
          )}
          {required && (
            <span className="text-amber-500 text-xs shrink-0">*</span>
          )}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>

      {/* Right: input control */}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
