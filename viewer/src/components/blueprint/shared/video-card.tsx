/**
 * Shared VideoCard component for displaying video content with player controls.
 * Used by both Inputs and Outputs panels.
 *
 * Returns MediaCard directly. Videos have native fullscreen via player controls,
 * so no expand dialog is needed.
 */

import { MediaCard } from "./media-card";

export interface VideoCardProps {
  /** URL of the video to display */
  url: string;
  /** Title for the card (unused but kept for interface consistency with other media cards) */
  title: string;
  /** Footer content (panel provides its own footer) */
  footer: React.ReactNode;
  /** Whether the card is selected */
  isSelected?: boolean;
}

/**
 * Video card with full player controls.
 * Videos have native fullscreen via player controls, so no expand dialog is needed.
 */
export function VideoCard({
  url,
  footer,
  isSelected = false,
}: VideoCardProps) {
  return (
    <MediaCard isSelected={isSelected} footer={footer}>
      <div className="aspect-video bg-muted/50 dark:bg-black/50 flex items-center justify-center">
        <video
          src={url}
          controls
          className="w-full h-full object-contain"
          preload="metadata"
        >
          Your browser does not support the video tag.
        </video>
      </div>
    </MediaCard>
  );
}

