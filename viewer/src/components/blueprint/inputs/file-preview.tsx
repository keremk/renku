/**
 * File preview components for the upload dialog.
 */

import { useEffect, useMemo } from 'react';
import { FileText, Music, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UploadDialogMediaType } from './file-upload-dialog';

interface FilePreviewThumbnailProps {
  /** URL to the file */
  url: string;
  /** Media type for appropriate rendering */
  mediaType: UploadDialogMediaType;
  /** Alt text / filename for accessibility */
  filename: string;
  /** Optional class name for the container */
  className?: string;
}

/**
 * Renders a thumbnail preview for a file based on its media type.
 */
function FilePreviewThumbnail({
  url,
  mediaType,
  filename,
  className,
}: FilePreviewThumbnailProps) {
  if (mediaType === 'image') {
    return (
      <img
        src={url}
        alt={filename}
        className={cn('w-full h-full object-cover', className)}
        loading='lazy'
      />
    );
  }

  if (mediaType === 'video') {
    return (
      <video
        src={url}
        className={cn('w-full h-full object-cover', className)}
        preload='metadata'
      />
    );
  }

  if (mediaType === 'audio') {
    return (
      <div
        className={cn(
          'w-full h-full bg-linear-to-br from-muted to-muted/50 flex items-center justify-center',
          className
        )}
      >
        <div className='w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center'>
          <Music className='size-4 text-primary' />
        </div>
      </div>
    );
  }

  // Generic file icon
  return (
    <div
      className={cn(
        'w-full h-full bg-linear-to-br from-muted to-muted/50 flex items-center justify-center',
        className
      )}
    >
      <div className='w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center'>
        <FileText className='size-4 text-primary' />
      </div>
    </div>
  );
}

/**
 * Gets the media type from a MIME type string.
 */
function getMediaTypeFromMime(mimeType: string): UploadDialogMediaType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

interface SelectedFilePreviewProps {
  /** File object */
  file: File;
  /** Callback to remove this file */
  onRemove: () => void;
}

/**
 * Displays a preview of a selected file (before upload) with remove button.
 * Used in the upload dialog.
 */
export function SelectedFilePreview({
  file,
  onRemove,
}: SelectedFilePreviewProps) {
  const objectUrl = useMemo(() => URL.createObjectURL(file), [file]);

  useEffect(() => {
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  const mediaType = getMediaTypeFromMime(file.type);

  return (
    <div className='relative group'>
      <div className='aspect-square rounded-lg overflow-hidden bg-black/50'>
        <FilePreviewThumbnail
          url={objectUrl}
          mediaType={mediaType}
          filename={file.name}
        />
      </div>
      <button
        type='button'
        onClick={onRemove}
        className={cn(
          'absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full',
          'bg-destructive text-destructive-foreground',
          'flex items-center justify-center',
          'opacity-0 group-hover:opacity-100 transition-opacity',
          'hover:bg-destructive/90'
        )}
      >
        <X className='size-3' />
      </button>
      <p className='text-[10px] text-muted-foreground truncate mt-1 text-center'>
        {file.name}
      </p>
    </div>
  );
}
