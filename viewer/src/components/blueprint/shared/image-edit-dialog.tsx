/**
 * Image editing dialog with three tabs: Manual, Camera, and Upload.
 * Manual: image preview + prompt textarea + model selector + regenerate.
 * Camera: image preview (left) + isometric camera tool (right) + regenerate.
 * Upload: dropzone for replacing the image file.
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
  DialogDescription,
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
  mode: 'manual' | 'camera';
  prompt: string;
  model?: AvailableModelOption;
  cameraParams?: CameraParams;
}

export interface RegenerateResult {
  previewUrl: string;
  tempId: string;
  estimatedCost: {
    cost: number;
    minCost: number;
    maxCost: number;
    isPlaceholder: boolean;
    note?: string;
  };
}

export interface ImageEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  title: string;
  availableModels: AvailableModelOption[];
  promptUrl?: string;
  onFileUpload: (files: File[]) => Promise<void>;
  onEstimateCost?: (
    params: RegenerateParams
  ) => Promise<RegenerateResult['estimatedCost']>;
  onRegenerate?: (params: RegenerateParams) => Promise<RegenerateResult>;
  onApplyGenerated?: (tempId: string) => Promise<void>;
  onCleanupGenerated?: (tempId: string) => Promise<void>;
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

function formatCurrency(value: number): string {
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatEstimatedCost(
  estimatedCost: RegenerateResult['estimatedCost']
): string {
  const min = estimatedCost.minCost;
  const max = estimatedCost.maxCost;
  if (min !== max) {
    return `${formatCurrency(min)}-${formatCurrency(max)}`;
  }
  return formatCurrency(estimatedCost.cost);
}

// ============================================================================
// Regenerate Button
// ============================================================================

function RegenerateButton({
  onClick,
  isRegenerating,
  disabled,
  className,
}: {
  onClick: () => void;
  isRegenerating: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={isRegenerating || disabled}
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
  canRegenerate,
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
  canRegenerate: boolean;
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
          disabled={!canRegenerate}
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
  canRegenerate,
  onRegenerate,
}: {
  imageUrl: string;
  title: string;
  cameraParams: CameraParams;
  onCameraChange: (params: CameraParams) => void;
  isRegenerating: boolean;
  canRegenerate: boolean;
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
            disabled={!canRegenerate}
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
  onEstimateCost,
  onRegenerate,
  onApplyGenerated,
  onCleanupGenerated,
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
  const [previewImageUrl, setPreviewImageUrl] = useState(imageUrl);
  const [generatedTempId, setGeneratedTempId] = useState<string | null>(null);
  const [estimatedCost, setEstimatedCost] = useState<
    RegenerateResult['estimatedCost'] | null
  >(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [isEstimatingCost, setIsEstimatingCost] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isApplyingGenerated, setIsApplyingGenerated] = useState(false);

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
      setPreviewImageUrl(imageUrl);
      setGeneratedTempId(null);
      setEstimatedCost(null);
      setGenerationError(null);
      setIsEstimatingCost(false);
      setIsRegenerating(false);
      setIsUploading(false);
      setIsApplyingGenerated(false);
    }
  }, [open, imageUrl]);

  useEffect(() => {
    if (!open || generatedTempId) {
      return;
    }
    setPreviewImageUrl(imageUrl);
  }, [open, generatedTempId, imageUrl]);

  useEffect(() => {
    if (!open || activeTab === 'upload' || !onEstimateCost) {
      setIsEstimatingCost(false);
      return;
    }

    let params: RegenerateParams;
    if (activeTab === 'manual') {
      const selectedModel = availableModels[selectedModelIndex];
      if (!selectedModel) {
        setEstimatedCost(null);
        setIsEstimatingCost(false);
        return;
      }
      params = {
        mode: 'manual',
        prompt: '',
        model: selectedModel,
      };
    } else {
      params = {
        mode: 'camera',
        prompt: '',
        cameraParams: DEFAULT_CAMERA_PARAMS,
      };
    }

    let cancelled = false;
    setIsEstimatingCost(true);

    const estimateCost = async () => {
      try {
        const nextEstimatedCost = await onEstimateCost(params);
        if (cancelled) {
          return;
        }
        setEstimatedCost(nextEstimatedCost);
      } catch {
        if (cancelled) {
          return;
        }
        setEstimatedCost(null);
      } finally {
        if (!cancelled) {
          setIsEstimatingCost(false);
        }
      }
    };

    void estimateCost();

    return () => {
      cancelled = true;
    };
  }, [activeTab, availableModels, onEstimateCost, open, selectedModelIndex]);

  const handleRegenerate = useCallback(async () => {
    if (!onRegenerate) {
      return;
    }

    if (activeTab === 'manual' && availableModels.length === 0) {
      setGenerationError('No models are available for manual regeneration.');
      return;
    }

    setIsRegenerating(true);
    setGenerationError(null);

    try {
      if (generatedTempId) {
        if (!onCleanupGenerated) {
          throw new Error(
            'Cannot regenerate because preview cleanup is not configured.'
          );
        }
        await onCleanupGenerated(generatedTempId);
        setGeneratedTempId(null);
        setPreviewImageUrl(imageUrl);
      }

      let params: RegenerateParams;
      if (activeTab === 'manual') {
        const selectedModel = availableModels[selectedModelIndex];
        if (!selectedModel) {
          throw new Error('Selected model is not available.');
        }
        params = {
          mode: 'manual',
          prompt,
          model: selectedModel,
        };
      } else {
        params = {
          mode: 'camera',
          prompt,
          cameraParams,
        };
      }

      const result = await onRegenerate(params);
      setPreviewImageUrl(result.previewUrl);
      setGeneratedTempId(result.tempId);
      setEstimatedCost(result.estimatedCost);
    } catch (error) {
      setPreviewImageUrl(imageUrl);
      setGeneratedTempId(null);
      setGenerationError(
        error instanceof Error ? error.message : 'Regeneration failed'
      );
    } finally {
      setIsRegenerating(false);
    }
  }, [
    activeTab,
    availableModels,
    cameraParams,
    generatedTempId,
    imageUrl,
    onCleanupGenerated,
    onRegenerate,
    prompt,
    selectedModelIndex,
  ]);

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
        if (generatedTempId) {
          if (!onCleanupGenerated) {
            throw new Error(
              'Cannot upload while generated preview cleanup is unavailable.'
            );
          }
          await onCleanupGenerated(generatedTempId);
          setGeneratedTempId(null);
        }
        await onFileUpload(selectedFiles);
        setSelectedFiles([]);
        onOpenChange(false);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setIsUploading(false);
      }
      return;
    }

    if ((activeTab === 'manual' || activeTab === 'camera') && generatedTempId) {
      setIsApplyingGenerated(true);
      setGenerationError(null);
      try {
        if (!onApplyGenerated) {
          throw new Error('Generated preview apply handler is not configured.');
        }
        await onApplyGenerated(generatedTempId);
        if (onCleanupGenerated) {
          await onCleanupGenerated(generatedTempId);
        }
        setGeneratedTempId(null);
        onOpenChange(false);
      } catch (error) {
        setGenerationError(
          error instanceof Error ? error.message : 'Failed to apply preview'
        );
      } finally {
        setIsApplyingGenerated(false);
      }
    }
  }, [
    activeTab,
    generatedTempId,
    onApplyGenerated,
    onCleanupGenerated,
    onFileUpload,
    onOpenChange,
    selectedFiles,
  ]);

  const handleClose = useCallback(() => {
    if (isUploading || isApplyingGenerated) {
      return;
    }

    const closeWithCleanup = async () => {
      try {
        if (generatedTempId) {
          if (!onCleanupGenerated) {
            throw new Error(
              'Cannot close with pending preview because cleanup is not configured.'
            );
          }
          await onCleanupGenerated(generatedTempId);
          setGeneratedTempId(null);
          setPreviewImageUrl(imageUrl);
        }
        onOpenChange(false);
      } catch (error) {
        setGenerationError(
          error instanceof Error ? error.message : 'Failed to clean up preview'
        );
      }
    };

    void closeWithCleanup();
  }, [
    generatedTempId,
    imageUrl,
    isApplyingGenerated,
    isUploading,
    onCleanupGenerated,
    onOpenChange,
  ]);

  const canRegenerateManual =
    Boolean(onRegenerate) &&
    availableModels.length > 0 &&
    !isApplyingGenerated &&
    !isUploading;

  const canRegenerateCamera =
    Boolean(onRegenerate) && !isApplyingGenerated && !isUploading;

  const isUpdateDisabled =
    activeTab === 'upload'
      ? selectedFiles.length === 0 || isUploading || isApplyingGenerated
      : generatedTempId === null ||
        isRegenerating ||
        isApplyingGenerated ||
        isUploading;

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
          <DialogDescription className='sr-only'>
            Edit this image manually, with camera controls, or by uploading a
            replacement file.
          </DialogDescription>
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
              imageUrl={previewImageUrl}
              title={title}
              prompt={prompt}
              onPromptChange={setPrompt}
              availableModels={availableModels}
              selectedModel={selectedModelIndex}
              onModelChange={setSelectedModelIndex}
              isRegenerating={isRegenerating}
              canRegenerate={canRegenerateManual}
              onRegenerate={handleRegenerate}
            />
          )}
          {activeTab === 'camera' && (
            <CameraTab
              imageUrl={previewImageUrl}
              title={title}
              cameraParams={cameraParams}
              onCameraChange={setCameraParams}
              isRegenerating={isRegenerating}
              canRegenerate={canRegenerateCamera}
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

        {activeTab !== 'upload' && generationError && (
          <div className='px-3 pb-2'>
            <div className='bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2 text-xs text-destructive'>
              {generationError}
            </div>
          </div>
        )}

        <DialogFooter className='justify-between'>
          <div className='text-[11px] text-muted-foreground min-h-[1rem]'>
            {activeTab !== 'upload'
              ? estimatedCost
                ? `Estimated cost: ${formatEstimatedCost(estimatedCost)}`
                : isEstimatingCost
                  ? 'Estimating cost...'
                  : 'Estimated cost unavailable'
              : ''}
          </div>
          <div className='flex items-center gap-2'>
            <Button
              variant='ghost'
              onClick={handleClose}
              disabled={isUploading || isApplyingGenerated}
            >
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={isUpdateDisabled}>
              {isUploading ? (
                <>
                  <Loader2 className='size-4 animate-spin' />
                  Uploading...
                </>
              ) : isApplyingGenerated ? (
                <>
                  <Loader2 className='size-4 animate-spin' />
                  Updating...
                </>
              ) : (
                'Update'
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
