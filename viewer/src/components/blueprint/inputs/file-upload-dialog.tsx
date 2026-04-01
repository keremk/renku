/**
 * Dialog for uploading input files.
 */

import { useState, useCallback } from 'react';
import type { FileRejection } from 'react-dropzone';
import { Loader2, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DropzoneArea, formatRejectionErrors } from './dropzone-area';
import { SelectedFilePreview } from './file-preview';
import type { MediaInputType } from '@/data/blueprint-client';

export type UploadDialogMediaType = MediaInputType | 'file';

/** Titles for each media type */
const DIALOG_TITLES: Record<UploadDialogMediaType, string> = {
  image: 'Upload Images',
  video: 'Upload Videos',
  audio: 'Upload Audio Files',
  file: 'Upload Files',
};

/** Singular titles for single file upload */
const DIALOG_TITLES_SINGULAR: Record<UploadDialogMediaType, string> = {
  image: 'Upload Image',
  video: 'Upload Video',
  audio: 'Upload Audio File',
  file: 'Upload File',
};

interface FileUploadDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback to close the dialog */
  onOpenChange: (open: boolean) => void;
  /** Media type to accept */
  mediaType: UploadDialogMediaType;
  /** Whether to allow multiple files */
  multiple: boolean;
  /** Callback when upload is confirmed with selected files */
  onConfirm: (files: File[]) => Promise<void>;
  /** Optional callback to remove currently assigned file/value */
  onRemoveExisting?: () => void;
  /** Label for remove action */
  removeButtonLabel?: string;
  /** Disable remove action */
  removeButtonDisabled?: boolean;
}

export function FileUploadDialog({
  open,
  onOpenChange,
  mediaType,
  multiple,
  onConfirm,
  onRemoveExisting,
  removeButtonLabel,
  removeButtonDisabled = false,
}: FileUploadDialogProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFilesSelected = useCallback(
    (files: File[]) => {
      setError(null);
      if (multiple) {
        setSelectedFiles((prev) => [...prev, ...files]);
      } else {
        setSelectedFiles(files.slice(0, 1));
      }
    },
    [multiple]
  );

  const handleFilesRejected = useCallback((rejections: FileRejection[]) => {
    const message = formatRejectionErrors(rejections);
    setError(message);
  }, []);

  const handleRemoveFile = useCallback((index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleUpload = useCallback(async () => {
    if (selectedFiles.length === 0) return;

    setIsUploading(true);
    setError(null);

    try {
      await onConfirm(selectedFiles);
      // Clear state and close dialog on success
      setSelectedFiles([]);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  }, [selectedFiles, onConfirm, onOpenChange]);

  const handleClose = useCallback(() => {
    if (!isUploading) {
      setSelectedFiles([]);
      setError(null);
      onOpenChange(false);
    }
  }, [isUploading, onOpenChange]);

  const handleRemove = useCallback(() => {
    if (isUploading || removeButtonDisabled || !onRemoveExisting) {
      return;
    }

    onRemoveExisting();
    setSelectedFiles([]);
    setError(null);
    onOpenChange(false);
  }, [isUploading, onOpenChange, onRemoveExisting, removeButtonDisabled]);

  const title = multiple
    ? DIALOG_TITLES[mediaType]
    : DIALOG_TITLES_SINGULAR[mediaType];
  const uploadButtonText =
    selectedFiles.length === 1
      ? 'Upload 1 File'
      : `Upload ${selectedFiles.length} Files`;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className='max-w-2xl p-0 gap-0 overflow-hidden'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className='space-y-4 px-6 py-6'>
          {/* Dropzone */}
          <DropzoneArea
            mediaType={mediaType}
            multiple={multiple}
            onFilesSelected={handleFilesSelected}
            onFilesRejected={handleFilesRejected}
          />

          {/* Error message */}
          {error && (
            <div className='bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-sm text-destructive'>
              {error}
            </div>
          )}

          {/* Selected files preview */}
          {selectedFiles.length > 0 && (
            <div className='space-y-2'>
              <p className='text-sm text-muted-foreground'>
                Selected files ({selectedFiles.length}):
              </p>
              <div className='grid grid-cols-4 gap-3'>
                {selectedFiles.map((file, index) => (
                  <SelectedFilePreview
                    key={`${file.name}-${index}`}
                    file={file}
                    onRemove={() => handleRemoveFile(index)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className='justify-between'>
          <div>
            {onRemoveExisting && (
              <Button
                type='button'
                variant='ghost'
                onClick={handleRemove}
                disabled={isUploading || removeButtonDisabled}
              >
                <Trash2 className='size-4' />
                {removeButtonLabel ?? 'Remove'}
              </Button>
            )}
          </div>

          <div className='flex items-center gap-2'>
            <Button
              variant='ghost'
              onClick={handleClose}
              disabled={isUploading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              disabled={selectedFiles.length === 0 || isUploading}
            >
              {isUploading ? (
                <>
                  <Loader2 className='size-4 animate-spin' />
                  Uploading...
                </>
              ) : (
                uploadButtonText
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
