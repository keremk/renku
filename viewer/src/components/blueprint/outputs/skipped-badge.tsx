/**
 * Badge indicating an artifact was skipped during generation.
 */

import { cn } from "@/lib/utils";
import type { ArtifactFailureReason } from "@/types/builds";

interface SkippedBadgeProps {
  /** The reason for skipping */
  reason?: ArtifactFailureReason;
  className?: string;
}

/**
 * Badge showing skip status for artifacts that weren't generated.
 * Uses gray for conditional skips (informational) and red for failures.
 */
export function SkippedBadge({ reason, className }: SkippedBadgeProps) {
  const isConditional = reason === "conditions_not_met";
  const isUpstreamFailure = reason === "upstream_failure";

  // Determine label and styling
  let label: string;
  let colorClasses: string;

  if (isConditional) {
    label = "Skipped";
    colorClasses = "bg-muted text-muted-foreground";
  } else if (isUpstreamFailure) {
    label = "Dependency Failed";
    colorClasses = "bg-destructive/20 text-destructive";
  } else {
    label = "Failed";
    colorClasses = "bg-destructive/20 text-destructive";
  }

  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium",
        colorClasses,
        className
      )}
    >
      {label}
    </span>
  );
}
