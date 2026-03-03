/**
 * Image editing dialog with three tabs: Manual, Camera, and Upload.
 * Manual: image preview + prompt textarea + model selector + regenerate.
 * Camera: image preview (left) + isometric camera tool (right) + regenerate.
 * Upload: dropzone for replacing the image file.
 *
 * AI generation is stubbed for now — the focus is on the UX.
 */

import { useState, useEffect, useCallback } from 'react';
import { Pencil, Video, Upload, Loader2, RefreshCw } from 'lucide-react';
import type { FileRejection } from 'react-dropzone';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DropzoneArea, formatRejectionErrors } from '../inputs/dropzone-area';
import { SelectedFilePreview } from '../inputs/file-preview';
import { useMediaPrompt } from './use-media-prompt';
import { CameraControl } from './camera-control';
import { generateShotDescription, type CameraParams } from './camera-utils';
import type { AvailableModelOption } from '@/types/blueprint-graph';

// ============================================================================
// Types
// ============================================================================

export interface RegenerateParams {
  prompt: string;
  model: AvailableModelOption;
  cameraParams?: CameraParams;
}

export interface ImageEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  title: string;
  availableModels: AvailableModelOption[];
  promptUrl?: string;
  onFileUpload: (files: File[]) => Promise<void>;
  onRegenerate?: (params: RegenerateParams) => Promise<void>;
}

// ============================================================================
// Tab Definitions
// ============================================================================

type TabId = 'manual' | 'camera' | 'upload';

const TABS: { id: TabId; label: string; icon: typeof Pencil }[] = [
  { id: 'manual', label: 'Manual', icon: Pencil },
  { id: 'camera', label: 'Camera', icon: Video },
  { id: 'upload', label: 'Upload', icon: Upload },
];

// ============================================================================
// Regenerate Button
// ============================================================================

function RegenerateButton({
  onClick,
  isRegenerating,
  className,
}: {
  onClick: () => void;
  isRegenerating: boolean;
  className?: string;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={isRegenerating}
      className={cn(
        'bg-primary/15 text-primary border border-primary/50',
        'font-semibold text-[10px] uppercase tracking-[0.1em]',
        'hover:bg-primary/25 transition-colors',
        'px-3.5 h-[34px] rounded-lg flex items-center gap-1.5',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className
      )}
    >
      {isRegenerating ? (
        <>
          <Loader2 className='size-3.5 animate-spin' />
          REGENERATING...
        </>
      ) : (
        <>
          <RefreshCw className='size-3.5' />
          REGENERATE
        </>
      )}
    </button>
  );
}

// ============================================================================
// Image Preview
// ============================================================================

function ImagePreview({
  url,
  title,
  className,
}: {
  url: string;
  title: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-xl bg-muted/30 dark:bg-black/50 overflow-hidden flex items-center justify-center',
        className
      )}
    >
      <img
        src={url}
        alt={title}
        className='w-full h-full object-contain'
        loading='lazy'
      />
    </div>
  );
}

// ============================================================================
// Manual Tab
// ============================================================================

function ManualTab({
  imageUrl,
  title,
  prompt,
  onPromptChange,
  availableModels,
  selectedModel,
  onModelChange,
  isRegenerating,
  onRegenerate,
}: {
  imageUrl: string;
  title: string;
  prompt: string;
  onPromptChange: (value: string) => void;
  availableModels: AvailableModelOption[];
  selectedModel: number;
  onModelChange: (index: number) => void;
  isRegenerating: boolean;
  onRegenerate: () => void;
}) {
  return (
    <div className='flex-1 flex flex-col overflow-hidden min-h-0'>
      {/* Image preview */}
      <ImagePreview
        url={imageUrl}
        title={title}
        className='flex-1 m-2.5 mb-0 min-h-[80px]'
      />

      {/* Prompt section */}
      <div className='border-t border-border/40 px-3 py-2.5 flex-shrink-0 flex flex-col gap-1'>
        <div className='flex items-center justify-between'>
          <span className='text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground'>
            Prompt
          </span>
          <span className='text-[9px] text-muted-foreground/60 tabular-nums'>
            {prompt.length} chars
          </span>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder='Describe the image edit...'
          className={cn(
            'w-full resize-none bg-muted/30 border border-border/40 text-foreground',
            'font-[inherit] text-[11px] leading-relaxed px-2.5 py-2 rounded-lg outline-none',
            'focus:border-primary/50 focus:ring-2 focus:ring-primary/20',
            'overflow-y-auto'
          )}
          style={{ height: 80 }}
        />
      </div>

      {/* Actions bar */}
      <div className='flex items-center gap-2 px-3 py-2 border-t border-border/40 flex-shrink-0'>
        {availableModels.length > 0 && (
          <select
            value={selectedModel}
            onChange={(e) => onModelChange(Number(e.target.value))}
            className={cn(
              'bg-muted/30 border border-border/40 text-foreground',
              'font-[inherit] text-[11px] px-2 h-[34px] rounded-lg outline-none cursor-pointer',
              'focus:border-primary/50'
            )}
          >
            {availableModels.map((model, idx) => (
              <option key={`${model.provider}/${model.model}`} value={idx}>
                {model.model}
              </option>
            ))}
          </select>
        )}
        <RegenerateButton
          onClick={onRegenerate}
          isRegenerating={isRegenerating}
          className='ml-auto'
        />
      </div>
    </div>
  );
}

// ============================================================================
// Camera Tab
// ============================================================================

function CameraTab({
  imageUrl,
  title,
  cameraParams,
  onCameraChange,
  isRegenerating,
  onRegenerate,
}: {
  imageUrl: string;
  title: string;
  cameraParams: CameraParams;
  onCameraChange: (params: CameraParams) => void;
  isRegenerating: boolean;
  onRegenerate: () => void;
}) {
  return (
    <div className='flex-1 flex overflow-hidden min-h-0'>
      {/* Left: image preview (full height) */}
      <div className='flex-1 flex flex-col min-w-0 overflow-hidden'>
        <ImagePreview
          url={imageUrl}
          title={title}
          className='flex-1 m-2.5 min-h-[80px]'
        />
      </div>

      {/* Right: camera tool */}
      <div
        className='flex flex-col overflow-y-auto border-l border-border/40'
        style={{ width: 300, minWidth: 300 }}
      >
        <div className='p-2.5 flex flex-col gap-2.5 flex-1'>
          <CameraControl params={cameraParams} onChange={onCameraChange} />
          <RegenerateButton
            onClick={onRegenerate}
            isRegenerating={isRegenerating}
            className='w-full justify-center'
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Upload Tab
// ============================================================================

function UploadTab({
  selectedFiles,
  onFilesSelected,
  onFilesRejected,
  onRemoveFile,
  error,
}: {
  selectedFiles: File[];
  onFilesSelected: (files: File[]) => void;
  onFilesRejected: (rejections: FileRejection[]) => void;
  onRemoveFile: (index: number) => void;
  error: string | null;
}) {
  return (
    <div className='flex-1 flex flex-col items-center justify-center px-8 py-6 gap-4'>
      <DropzoneArea
        mediaType='image'
        multiple={false}
        onFilesSelected={onFilesSelected}
        onFilesRejected={onFilesRejected}
        className='max-w-[400px] w-full'
      />

      {error && (
        <div className='bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-sm text-destructive max-w-[400px] w-full'>
          {error}
        </div>
      )}

      {selectedFiles.length > 0 && (
        <div className='max-w-[400px] w-full space-y-2'>
          <p className='text-sm text-muted-foreground'>
            Selected files ({selectedFiles.length}):
          </p>
          <div className='grid grid-cols-4 gap-3'>
            {selectedFiles.map((file, index) => (
              <SelectedFilePreview
                key={`${file.name}-${index}`}
                file={file}
                onRemove={() => onRemoveFile(index)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Dialog
// ============================================================================

const DEFAULT_CAMERA_PARAMS: CameraParams = {
  azimuth: 0,
  elevation: 0,
  distance: 1,
  shotDescription: generateShotDescription(0, 0, 1),
};

export function ImageEditDialog({
  open,
  onOpenChange,
  imageUrl,
  title,
  availableModels,
  promptUrl,
  onFileUpload,
  onRegenerate: _onRegenerate,
}: ImageEditDialogProps) {
  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>('manual');

  // Manual tab state
  const [prompt, setPrompt] = useState('');
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);

  // Camera tab state
  const [cameraParams, setCameraParams] = useState<CameraParams>(
    DEFAULT_CAMERA_PARAMS
  );

  // Upload tab state
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Shared state
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Load initial prompt from upstream artifact
  const { promptText } = useMediaPrompt(promptUrl, open);

  // Seed prompt textarea when loaded
  useEffect(() => {
    if (promptText && prompt === '') {
      setPrompt(promptText);
    }
  }, [promptText, prompt]);

  // Reset all state when dialog opens
  useEffect(() => {
    if (open) {
      setActiveTab('manual');
      setPrompt('');
      setSelectedModelIndex(0);
      setCameraParams(DEFAULT_CAMERA_PARAMS);
      setSelectedFiles([]);
      setUploadError(null);
      setIsRegenerating(false);
      setIsUploading(false);
    }
  }, [open]);

  // Stubbed regeneration
  const handleRegenerate = useCallback(() => {
    setIsRegenerating(true);
    setTimeout(() => setIsRegenerating(false), 1200);
  }, []);

  // Upload handlers
  const handleFilesSelected = useCallback((files: File[]) => {
    setUploadError(null);
    setSelectedFiles(files.slice(0, 1));
  }, []);

  const handleFilesRejected = useCallback((rejections: FileRejection[]) => {
    setUploadError(formatRejectionErrors(rejections));
  }, []);

  const handleRemoveFile = useCallback((index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleUpdate = useCallback(async () => {
    if (activeTab === 'upload' && selectedFiles.length > 0) {
      setIsUploading(true);
      setUploadError(null);
      try {
        await onFileUpload(selectedFiles);
        setSelectedFiles([]);
        onOpenChange(false);
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : 'Upload failed'
        );
      } finally {
        setIsUploading(false);
      }
    }
  }, [activeTab, selectedFiles, onFileUpload, onOpenChange]);

  const handleClose = useCallback(() => {
    if (!isUploading) {
      onOpenChange(false);
    }
  }, [isUploading, onOpenChange]);

  const isUpdateDisabled =
    activeTab === 'upload' && (selectedFiles.length === 0 || isUploading);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className={cn(
          'w-[860px] h-[700px] max-w-[860px] max-h-[700px]',
          'p-0 gap-0 overflow-hidden flex flex-col'
        )}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {/* Tab bar */}
        <div className='flex border-b border-border/40 bg-panel-header-bg shrink-0 px-3'>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type='button'
                data-tab={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'relative px-3.5 h-[38px] border-none bg-transparent',
                  'font-[inherit] text-[10px] uppercase tracking-[0.12em] font-semibold',
                  'cursor-pointer flex items-center gap-1.5 transition-colors',
                  isActive
                    ? 'text-foreground bg-primary/[0.08]'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className='size-3.5' />
                {tab.label}
                {isActive && (
                  <span className='absolute bottom-0 left-1.5 right-1.5 h-0.5 bg-primary rounded-t-sm' />
                )}
              </button>
            );
          })}
        </div>

        {/* Tab panels */}
        <div className='flex-1 flex flex-col overflow-hidden min-h-0'>
          {activeTab === 'manual' && (
            <ManualTab
              imageUrl={imageUrl}
              title={title}
              prompt={prompt}
              onPromptChange={setPrompt}
              availableModels={availableModels}
              selectedModel={selectedModelIndex}
              onModelChange={setSelectedModelIndex}
              isRegenerating={isRegenerating}
              onRegenerate={handleRegenerate}
            />
          )}
          {activeTab === 'camera' && (
            <CameraTab
              imageUrl={imageUrl}
              title={title}
              cameraParams={cameraParams}
              onCameraChange={setCameraParams}
              isRegenerating={isRegenerating}
              onRegenerate={handleRegenerate}
            />
          )}
          {activeTab === 'upload' && (
            <UploadTab
              selectedFiles={selectedFiles}
              onFilesSelected={handleFilesSelected}
              onFilesRejected={handleFilesRejected}
              onRemoveFile={handleRemoveFile}
              error={uploadError}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant='ghost' onClick={handleClose} disabled={isUploading}>
            Cancel
          </Button>
          <Button onClick={handleUpdate} disabled={isUpdateDisabled}>
            {isUploading ? (
              <>
                <Loader2 className='size-4 animate-spin' />
                Uploading...
              </>
            ) : (
              'Update'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
