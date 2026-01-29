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
        "flex flex-col items-center justify-center gap-2",
        "bg-muted/30 text-muted-foreground",
        disabled
          ? "opacity-50 cursor-not-allowed"
          : "hover:border-primary/50 hover:bg-primary/5 hover:text-foreground cursor-pointer",
        className
      )}
    >
      <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center">
        <Icon className="size-6" />
      </div>
      <div className="flex items-center gap-1 text-xs">
        <Plus className="size-3" />
        <span>Add {label}</span>
      </div>
    </button>
  );
}
