/**
 * Shared VideoCard component for displaying video content with player controls.
 * Used by both Inputs and Outputs panels.
 */

import { useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { MediaCard } from './media-card';
import { MediaExpandDialog } from './media-expand-dialog';
import { useMediaPrompt } from './use-media-prompt';

export interface VideoCardProps {
  /** URL of the video to display */
  url: string;
  /** Title for the card and expanded dialog */
  title: string;
  /** Footer content (panel provides its own footer) */
  footer: React.ReactNode;
  /** Whether the card is selected */
  isSelected?: boolean;
  /** Whether the card is pinned */
  isPinned?: boolean;
  /** Whether this card opens an expanded dialog instead of inline playback */
  expandable?: boolean;
  /** Optional prompt artifact label for expanded view */
  promptTitle?: string;
  /** Optional prompt artifact URL for expanded view */
  promptUrl?: string;
}

/**
 * Video card with either inline playback or expanded-dialog preview mode.
 */
export function VideoCard({
  url,
  title,
  footer,
  isSelected = false,
  isPinned = false,
  expandable = false,
  promptTitle,
  promptUrl,
}: VideoCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { promptText, promptError, isPromptLoading } = useMediaPrompt(
    promptUrl,
    isExpanded
  );

  if (expandable) {
    return (
      <>
        <MediaCard isSelected={isSelected} isPinned={isPinned} footer={footer}>
          <div className='aspect-video w-full bg-muted/50 dark:bg-black/50 flex items-center justify-center group relative overflow-hidden'>
            <video
              src={url}
              controls
              className='w-full h-full object-contain'
              preload='metadata'
            >
              Your browser does not support the video tag.
            </video>
            <div className='absolute inset-0 pointer-events-none bg-black/0 group-hover:bg-black/10 transition-colors' />
            <button
              type='button'
              onClick={() => setIsExpanded(true)}
              className='absolute top-3 right-3 z-10 rounded-full border border-border/40 bg-background/80 p-2 text-foreground shadow-sm backdrop-blur-sm opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity'
              aria-label='Expand video preview'
            >
              <Maximize2 className='size-4' />
            </button>
          </div>
        </MediaCard>

        <MediaExpandDialog
          open={isExpanded}
          onOpenChange={setIsExpanded}
          title={title}
          url={url}
          mediaType='video'
          promptTitle={promptTitle}
          promptText={promptText}
          isPromptLoading={isPromptLoading}
          promptError={promptError}
        />
      </>
    );
  }

  return (
    <MediaCard isSelected={isSelected} isPinned={isPinned} footer={footer}>
      <div className='aspect-video bg-muted/50 dark:bg-black/50 flex items-center justify-center'>
        <video
          src={url}
          controls
          className='w-full h-full object-contain'
          preload='metadata'
        >
          Your browser does not support the video tag.
        </video>
      </div>
    </MediaCard>
  );
}
