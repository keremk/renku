import { ImagePlus, VideoIcon, Music, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MediaType } from "@/lib/input-utils";

interface EmptyMediaPlaceholderProps {
  /** The media type for the placeholder */
  mediaType: MediaType;
  /** Callback when the add button is clicked */
  onClick: () => void;
  /** Whether the add action is disabled */
  disabled?: boolean;
  /** Optional class name */
  className?: string;
}

const mediaIcons = {
  image: ImagePlus,
  video: VideoIcon,
  audio: Music,
};

const mediaLabels = {
  image: "image",
  video: "video",
  audio: "audio",
};

/**
 * Placeholder card for empty media inputs.
 * Shows media type icon and an add button.
 */
export function EmptyMediaPlaceholder({
  mediaType,
  onClick,
  disabled = false,
  className,
}: EmptyMediaPlaceholderProps) {
  const Icon = mediaIcons[mediaType];
  const label = mediaLabels[mediaType];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full aspect-video rounded-xl border-2 border-dashed transition-all",
        "flex flex-col items-center justify-center gap-3",
        "bg-muted/30 text-muted-foreground",
        disabled
          ? "opacity-50 cursor-not-allowed"
          : "hover:border-primary hover:bg-primary/10 hover:text-foreground hover:shadow-md hover:-translate-y-0.5 cursor-pointer",
        className
      )}
    >
      <div className="w-14 h-14 rounded-full bg-muted/50 flex items-center justify-center">
        <Icon className="size-7" />
      </div>
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <Plus className="size-3.5" />
        <span>Add {label}</span>
      </div>
    </button>
  );
}
