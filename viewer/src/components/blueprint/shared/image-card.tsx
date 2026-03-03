/**
 * Shared ImageCard component for displaying image content with expand functionality.
 * Used by both Inputs and Outputs panels.
 *
 * CRITICAL: Returns a fragment with MediaCard as first child.
 * This preserves MediaGrid layout (each direct child must be a card).
 */

import { useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { MediaCard } from './media-card';
import { MediaExpandDialog } from './media-expand-dialog';
import { useMediaPrompt } from './use-media-prompt';

export interface ImageCardProps {
  /** URL of the image to display */
  url: string;
  /** Title for the card (used as alt text and in expand dialog) */
  title: string;
  /** Footer content (panel provides its own footer) */
  footer: React.ReactNode;
  /** Whether the card is selected */
  isSelected?: boolean;
  /** Whether the card is pinned */
  isPinned?: boolean;
  /** Optional prompt artifact label for expanded view */
  promptTitle?: string;
  /** Optional prompt artifact URL for expanded view */
  promptUrl?: string;
}

/**
 * Image card with hover overlay and expand functionality.
 * Clicking anywhere on the image opens the fullscreen expand dialog.
 */
export function ImageCard({
  url,
  title,
  footer,
  isSelected = false,
  isPinned = false,
  promptTitle,
  promptUrl,
}: ImageCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { promptText, promptError, isPromptLoading } = useMediaPrompt(
    promptUrl,
    isExpanded
  );

  return (
    <>
      <MediaCard isSelected={isSelected} isPinned={isPinned} footer={footer}>
        <button
          type='button'
          onClick={() => setIsExpanded(true)}
          className='aspect-video w-full bg-muted/50 dark:bg-black/50 flex items-center justify-center group relative overflow-hidden'
        >
          <img
            src={url}
            alt={title}
            className='w-full h-full object-contain'
            loading='lazy'
          />
          <div className='absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center'>
            <Maximize2 className='size-8 text-white opacity-0 group-hover:opacity-100 transition-opacity' />
          </div>
        </button>
      </MediaCard>

      <MediaExpandDialog
        open={isExpanded}
        onOpenChange={setIsExpanded}
        title={title}
        url={url}
        mediaType='image'
        promptTitle={promptTitle}
        promptText={promptText}
        isPromptLoading={isPromptLoading}
        promptError={promptError}
      />
    </>
  );
}
