/**
 * Unified media expand dialog for viewing image, video, and audio media.
 * Used across Inputs panel (media inputs) and Outputs panel (media artifacts).
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export interface MediaExpandDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Title to display below the media */
  title: string;
  /** URL of the media to display */
  url: string;
  /** Type of media (image, video, or audio) */
  mediaType: 'image' | 'video' | 'audio';
  /** Alt text for images (optional, defaults to title) */
  alt?: string;
  /** Optional custom media content (used by audio to reuse card player UI) */
  customMedia?: React.ReactNode;
  /** Optional prompt section title */
  promptTitle?: string;
  /** Prompt text to render under expanded media */
  promptText?: string | null;
  /** Prompt loading state */
  isPromptLoading?: boolean;
  /** Prompt loading or fetch error */
  promptError?: string | null;
}

/**
 * Dialog for viewing media in an expanded view with a read-only prompt section.
 */
export function MediaExpandDialog({
  open,
  onOpenChange,
  title,
  url,
  mediaType,
  alt,
  customMedia,
  promptTitle,
  promptText,
  isPromptLoading = false,
  promptError,
}: MediaExpandDialogProps) {
  const [loadedImage, setLoadedImage] = useState<{
    url: string;
    aspectRatio: number;
  } | null>(null);
  const imageAspectRatio =
    mediaType === 'image' && open && loadedImage?.url === url
      ? loadedImage.aspectRatio
      : null;

  const mediaContainerClassName =
    mediaType === 'audio'
      ? 'min-h-[260px]'
      : 'h-[calc(92vh-14rem)] sm:h-[calc(92vh-16rem)] min-h-[220px]';

  const dialogSizeClassName =
    mediaType === 'audio'
      ? 'sm:max-w-[680px] max-h-[86vh]'
      : 'sm:max-w-[1020px] max-h-[92vh]';

  const renderMedia = () => {
    if (customMedia) {
      return customMedia;
    }

    if (mediaType === 'image') {
      const imageFrameStyle =
        imageAspectRatio === null
          ? { width: '100%', height: '100%' }
          : imageAspectRatio >= 1
            ? { width: '100%', aspectRatio: String(imageAspectRatio) }
            : { height: '100%', aspectRatio: String(imageAspectRatio) };

      return (
        <div className='w-full h-full flex items-center justify-center'>
          <div className='max-w-full max-h-full' style={imageFrameStyle}>
            <img
              src={url}
              alt={alt ?? title}
              onLoad={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget;
                if (naturalWidth > 0 && naturalHeight > 0) {
                  setLoadedImage({
                    url,
                    aspectRatio: naturalWidth / naturalHeight,
                  });
                }
              }}
              className='w-full h-full object-contain rounded-lg'
            />
          </div>
        </div>
      );
    }

    if (mediaType === 'video') {
      return (
        <video
          src={url}
          controls
          autoPlay
          className='w-full h-full object-contain rounded-lg'
        >
          Your browser does not support the video tag.
        </video>
      );
    }

    return null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          dialogSizeClassName,
          'w-[92vw] p-0 gap-0 overflow-hidden flex flex-col'
        )}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Expanded {mediaType} preview for {title}.
          </DialogDescription>
        </DialogHeader>

        <div className='flex-1 min-h-0 overflow-y-auto px-6 py-5 flex flex-col gap-5'>
          <div
            className={cn(
              'rounded-xl border border-border/40 bg-muted/30 p-3 flex items-center justify-center overflow-hidden',
              mediaContainerClassName
            )}
          >
            {renderMedia()}
          </div>

          <section className='space-y-2 shrink-0'>
            <div className='text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground'>
              {promptTitle ?? 'Prompt'}
            </div>
            <div className='rounded-lg border border-border/40 bg-background/70 p-3'>
              {isPromptLoading ? (
                <div className='flex items-center gap-2 text-xs text-muted-foreground h-[4.75rem]'>
                  <Loader2 className='size-4 animate-spin' />
                  <span>Loading prompt...</span>
                </div>
              ) : promptError ? (
                <div className='text-xs text-destructive whitespace-pre-wrap h-[4.75rem] overflow-y-auto'>
                  {promptError}
                </div>
              ) : promptText ? (
                <pre className='text-xs text-foreground/90 font-mono whitespace-pre-wrap leading-relaxed h-[4.75rem] overflow-y-auto'>
                  {promptText}
                </pre>
              ) : (
                <div className='text-xs text-muted-foreground h-[4.75rem] overflow-y-auto whitespace-pre-wrap'>
                  No upstream prompt artifact is available for this output.
                </div>
              )}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
