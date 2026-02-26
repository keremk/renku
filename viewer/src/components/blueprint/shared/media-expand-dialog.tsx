/**
 * Unified media expand dialog for viewing images and videos in fullscreen.
 * Used across Inputs panel (media inputs) and Outputs panel (media artifacts).
 */

import { X } from 'lucide-react';
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
  /** Type of media (image or video) */
  mediaType: 'image' | 'video';
  /** Alt text for images (optional, defaults to title) */
  alt?: string;
}

/**
 * Dialog for viewing media (images/videos) in an expanded view.
 * Preserves exact dimensions from existing implementations:
 * - max-w-5xl max-h-[90vh] for dialog
 * - max-h-[70vh] for media content
 */
export function MediaExpandDialog({
  open,
  onOpenChange,
  title,
  url,
  mediaType,
  alt,
}: MediaExpandDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-5xl max-h-[90vh] p-0 overflow-hidden'>
        <DialogHeader className='sr-only'>
          <DialogTitle>Media Preview</DialogTitle>
          <DialogDescription>
            Expanded {mediaType} preview for {title}.
          </DialogDescription>
        </DialogHeader>
        <div className='relative'>
          <button
            type='button'
            onClick={() => onOpenChange(false)}
            className='absolute top-4 right-4 z-10 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors'
          >
            <X className='size-5' />
          </button>
          <div className='p-4'>
            {mediaType === 'image' ? (
              <img
                src={url}
                alt={alt ?? title}
                className='w-full max-h-[70vh] object-contain rounded-lg'
              />
            ) : (
              <video
                src={url}
                controls
                autoPlay
                className='w-full max-h-[70vh] object-contain rounded-lg'
              >
                Your browser does not support the video tag.
              </video>
            )}
          </div>
          <div className='px-4 pb-4'>
            <p className='text-sm text-muted-foreground truncate'>{title}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
