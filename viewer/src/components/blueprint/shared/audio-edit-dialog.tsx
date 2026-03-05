import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { RotateCcw, Upload, Loader2, RefreshCw } from 'lucide-react';
import type { FileRejection } from 'react-dropzone';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DropzoneArea, formatRejectionErrors } from '../inputs/dropzone-area';
import { SelectedFilePreview } from '../inputs/file-preview';
import { useMediaPrompt } from './use-media-prompt';
import { AudioPlayerSurface } from './audio-card';
import type { AvailableModelOption } from '@/types/blueprint-graph';

export interface AudioRegenerateParams {
  mode: 'rerun';
  prompt: string;
  model?: AvailableModelOption;
  inputOverrides?: Record<string, string>;
}

export interface AudioRegenerateResult {
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

export interface AudioEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  audioUrl: string;
  title: string;
  availableModels: AvailableModelOption[];
  promptUrl?: string;
  initialVoiceId?: string;
  initialEmotion?: string;
  onFileUpload: (files: File[]) => Promise<void>;
  onEstimateCost?: (
    params: AudioRegenerateParams
  ) => Promise<AudioRegenerateResult['estimatedCost']>;
  onRegenerate?: (
    params: AudioRegenerateParams
  ) => Promise<AudioRegenerateResult>;
  onApplyGenerated?: (tempId: string) => Promise<void>;
  onCleanupGenerated?: (tempId: string) => Promise<void>;
}

type TabId = 'rerun' | 'upload';

const TABS: { id: TabId; label: string; icon: typeof RotateCcw }[] = [
  { id: 'rerun', label: 'Re-run', icon: RotateCcw },
  { id: 'upload', label: 'Upload', icon: Upload },
];

function formatCurrency(value: number): string {
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatEstimatedCost(
  estimatedCost: AudioRegenerateResult['estimatedCost']
): string {
  const min = estimatedCost.minCost;
  const max = estimatedCost.maxCost;
  if (min !== max) {
    return `${formatCurrency(min)}-${formatCurrency(max)}`;
  }
  return formatCurrency(estimatedCost.cost);
}

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
        'font-semibold text-[10px] uppercase tracking-widest',
        'hover:bg-primary/25 transition-colors',
        'px-3.5 h-[34px] rounded-lg flex items-center gap-1.5 justify-center',
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
    <div className='flex flex-col gap-3'>
      <DropzoneArea
        mediaType='audio'
        multiple={false}
        onFilesSelected={onFilesSelected}
        onFilesRejected={onFilesRejected}
        className='w-full'
      />

      {error && (
        <div className='bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-sm text-destructive'>
          {error}
        </div>
      )}

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
                onRemove={() => onRemoveFile(index)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function useSelectedFilePreview(file: File | null): string | null {
  const previewUrl = useMemo(() => {
    if (!file) {
      return null;
    }

    return URL.createObjectURL(file);
  }, [file]);

  useEffect(() => {
    if (!previewUrl) {
      return;
    }

    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  return previewUrl;
}

function useRerunCostEstimate({
  open,
  activeTab,
  availableModels,
  selectedModelIndex,
  onEstimateCost,
  setEstimatedCost,
  setIsEstimatingCost,
}: {
  open: boolean;
  activeTab: TabId;
  availableModels: AvailableModelOption[];
  selectedModelIndex: number;
  onEstimateCost?: (
    params: AudioRegenerateParams
  ) => Promise<AudioRegenerateResult['estimatedCost']>;
  setEstimatedCost: Dispatch<
    SetStateAction<AudioRegenerateResult['estimatedCost'] | null>
  >;
  setIsEstimatingCost: Dispatch<SetStateAction<boolean>>;
}) {
  useEffect(() => {
    if (!open || activeTab !== 'rerun' || !onEstimateCost) {
      setIsEstimatingCost(false);
      return;
    }

    const selectedModel = availableModels[selectedModelIndex];
    if (!selectedModel) {
      setEstimatedCost(null);
      setIsEstimatingCost(false);
      return;
    }

    const params: AudioRegenerateParams = {
      mode: 'rerun',
      prompt: '',
      model: selectedModel,
    };

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
        if (!cancelled) {
          setEstimatedCost(null);
        }
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
  }, [
    activeTab,
    availableModels,
    onEstimateCost,
    open,
    selectedModelIndex,
    setEstimatedCost,
    setIsEstimatingCost,
  ]);
}

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function AudioEditDialog({
  open,
  onOpenChange,
  audioUrl,
  title,
  availableModels,
  promptUrl,
  initialVoiceId,
  initialEmotion,
  onFileUpload,
  onEstimateCost,
  onRegenerate,
  onApplyGenerated,
  onCleanupGenerated,
}: AudioEditDialogProps) {
  const [activeTab, setActiveTab] = useState<TabId>('rerun');
  const [rerunPrompt, setRerunPrompt] = useState('');
  const [voiceId, setVoiceId] = useState('');
  const [emotion, setEmotion] = useState('');
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [generatedPreviewUrl, setGeneratedPreviewUrl] = useState<string | null>(
    null
  );
  const [generatedTempId, setGeneratedTempId] = useState<string | null>(null);
  const [estimatedCost, setEstimatedCost] = useState<
    AudioRegenerateResult['estimatedCost'] | null
  >(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [isEstimatingCost, setIsEstimatingCost] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isApplyingGenerated, setIsApplyingGenerated] = useState(false);

  const previewAudioUrl = generatedPreviewUrl ?? audioUrl;

  const { promptText } = useMediaPrompt(promptUrl, open);

  useEffect(() => {
    if (!open) {
      return;
    }

    setActiveTab('rerun');
    setRerunPrompt('');
    setVoiceId(initialVoiceId ?? '');
    setEmotion(initialEmotion ?? '');
    setSelectedModelIndex(0);
    setSelectedFiles([]);
    setUploadError(null);
    setGeneratedPreviewUrl(null);
    setGeneratedTempId(null);
    setEstimatedCost(null);
    setGenerationError(null);
    setIsEstimatingCost(false);
    setIsRegenerating(false);
    setIsUploading(false);
    setIsApplyingGenerated(false);
  }, [open, audioUrl, initialVoiceId, initialEmotion]);

  useEffect(() => {
    if (!promptText) {
      return;
    }
    setRerunPrompt((prev) => (prev === '' ? promptText : prev));
  }, [promptText]);

  const selectedUploadPreviewUrl = useSelectedFilePreview(
    selectedFiles[0] ?? null
  );

  useRerunCostEstimate({
    open,
    activeTab,
    availableModels,
    selectedModelIndex,
    onEstimateCost,
    setEstimatedCost,
    setIsEstimatingCost,
  });

  const displayedAudioUrl =
    activeTab === 'upload' && selectedUploadPreviewUrl
      ? selectedUploadPreviewUrl
      : previewAudioUrl;

  const getParamsForTab = useCallback((): AudioRegenerateParams | null => {
    const selectedModel = availableModels[selectedModelIndex];
    if (!selectedModel) {
      return null;
    }

    const inputOverrides: Record<string, string> = {};
    if (voiceId.trim()) {
      inputOverrides['VoiceId'] = voiceId.trim();
    }
    if (emotion.trim()) {
      inputOverrides['Emotion'] = emotion.trim();
    }

    return {
      mode: 'rerun',
      prompt: rerunPrompt,
      model: selectedModel,
      ...(Object.keys(inputOverrides).length > 0 ? { inputOverrides } : {}),
    };
  }, [availableModels, rerunPrompt, selectedModelIndex, voiceId, emotion]);

  const handleRegenerate = useCallback(async () => {
    if (!onRegenerate || activeTab === 'upload') {
      return;
    }

    if (availableModels.length === 0) {
      setGenerationError('No models are available for re-run preview.');
      return;
    }

    const params = getParamsForTab();
    if (!params) {
      setGenerationError('Could not resolve preview parameters.');
      return;
    }

    setIsRegenerating(true);
    setGenerationError(null);

    try {
      const previousGeneratedTempId = generatedTempId;
      if (previousGeneratedTempId && !onCleanupGenerated) {
        throw new Error(
          'Cannot regenerate because preview cleanup is not configured.'
        );
      }

      const result = await onRegenerate(params);

      if (
        previousGeneratedTempId &&
        onCleanupGenerated &&
        previousGeneratedTempId !== result.tempId
      ) {
        await onCleanupGenerated(previousGeneratedTempId);
      }

      setGeneratedPreviewUrl(result.previewUrl);
      setGeneratedTempId(result.tempId);
      setEstimatedCost(result.estimatedCost);
    } catch (error) {
      setGenerationError(
        error instanceof Error ? error.message : 'Regeneration failed'
      );
    } finally {
      setIsRegenerating(false);
    }
  }, [
    activeTab,
    availableModels.length,
    generatedTempId,
    getParamsForTab,
    onCleanupGenerated,
    onRegenerate,
  ]);

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
          setGeneratedPreviewUrl(null);
        }

        await onFileUpload(selectedFiles);
        setSelectedFiles([]);
        onOpenChange(false);
      } catch (error) {
        setUploadError(
          error instanceof Error ? error.message : 'Upload failed'
        );
      } finally {
        setIsUploading(false);
      }
      return;
    }

    if (activeTab !== 'upload' && generatedTempId) {
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
        setGeneratedPreviewUrl(null);
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
          setGeneratedPreviewUrl(null);
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
    isApplyingGenerated,
    isUploading,
    onCleanupGenerated,
    onOpenChange,
  ]);

  const canRegenerate =
    Boolean(onRegenerate) &&
    !isApplyingGenerated &&
    !isUploading &&
    activeTab !== 'upload' &&
    availableModels.length > 0;

  const isUpdateDisabled =
    activeTab === 'upload'
      ? selectedFiles.length === 0 || isUploading || isApplyingGenerated
      : generatedTempId === null ||
        isRegenerating ||
        isApplyingGenerated ||
        isUploading;

  const costText = useMemo(() => {
    if (estimatedCost) {
      return `Estimated cost: ${formatEstimatedCost(estimatedCost)}`;
    }
    if (isEstimatingCost) {
      return 'Estimating cost...';
    }
    return 'Estimated cost unavailable';
  }, [estimatedCost, isEstimatingCost]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className={cn(
          'w-[800px] h-[650px] max-w-[960px] max-h-[650px]',
          'p-0 gap-0 overflow-hidden flex flex-col'
        )}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className='sr-only'>
            Re-run or upload a replacement audio.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as TabId)}
          className='gap-0'
        >
          <TabsList
            variant='line'
            className='flex w-full h-auto shrink-0 items-stretch justify-start rounded-none text-inherit border-b border-border/40 bg-panel-header-bg px-3 py-0 gap-0'
          >
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const Icon = tab.icon;
              return (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  data-tab={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'relative px-3.5 h-[38px] border-none bg-transparent rounded-none flex-none',
                    'font-[inherit] text-[10px] uppercase tracking-[0.12em] font-semibold',
                    'cursor-pointer flex items-center gap-1.5 transition-colors',
                    'text-muted-foreground hover:text-foreground',
                    'data-[state=active]:text-foreground data-[state=active]:bg-primary/8',
                    'data-[state=active]:border-none dark:data-[state=active]:border-none dark:data-[state=active]:bg-primary/8',
                    'focus-visible:ring-0 focus-visible:border-none focus-visible:outline-none shadow-none after:hidden'
                  )}
                >
                  <Icon className='size-3.5' />
                  {tab.label}
                  {isActive && (
                    <span className='absolute bottom-0 left-1.5 right-1.5 h-0.5 bg-primary rounded-t-sm' />
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        <div className='flex-1 flex min-h-0 overflow-hidden'>
          <div className='flex-1 p-3 min-w-0 flex'>
            <div className='flex-1 rounded-xl bg-muted/30 dark:bg-black/50 overflow-hidden flex items-center justify-center min-h-40'>
              <AudioPlayerSurface
                url={displayedAudioUrl}
                title={title}
                interactive
              />
            </div>
          </div>

          <aside className='w-[340px] shrink-0 border-l border-border/40 p-3 flex flex-col gap-3 overflow-y-auto'>
            {activeTab === 'upload' ? (
              <UploadTab
                selectedFiles={selectedFiles}
                onFilesSelected={handleFilesSelected}
                onFilesRejected={handleFilesRejected}
                onRemoveFile={handleRemoveFile}
                error={uploadError}
              />
            ) : (
              <>
                <div className='flex flex-col gap-1.5'>
                  <div className='flex items-center justify-between'>
                    <span className='text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground'>
                      Narration Text
                    </span>
                    <span className='text-[9px] text-muted-foreground/60 tabular-nums'>
                      {rerunPrompt.length} chars
                    </span>
                  </div>
                  <textarea
                    value={rerunPrompt}
                    onChange={(event) => setRerunPrompt(event.target.value)}
                    placeholder='Enter narration text for re-run...'
                    className={cn(
                      'w-full resize-none bg-muted/30 border border-border/40 text-foreground',
                      'font-[inherit] text-[11px] leading-relaxed px-2.5 py-2 rounded-lg outline-none',
                      'focus:border-primary/50 focus:ring-2 focus:ring-primary/20',
                      'overflow-y-auto min-h-[120px]'
                    )}
                  />
                </div>

                <div className='flex flex-col gap-1.5'>
                  <span className='text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground'>
                    Voice ID
                  </span>
                  <input
                    type='text'
                    value={voiceId}
                    onChange={(event) => setVoiceId(event.target.value)}
                    placeholder='e.g., Rachel, Liam...'
                    className={cn(
                      'bg-muted/30 border border-border/40 text-foreground',
                      'font-[inherit] text-[11px] px-2.5 h-[34px] rounded-lg outline-none',
                      'focus:border-primary/50 focus:ring-2 focus:ring-primary/20'
                    )}
                  />
                </div>

                <div className='flex flex-col gap-1.5'>
                  <span className='text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground'>
                    Emotion
                  </span>
                  <input
                    type='text'
                    value={emotion}
                    onChange={(event) => setEmotion(event.target.value)}
                    placeholder='e.g., happy, neutral, sad...'
                    className={cn(
                      'bg-muted/30 border border-border/40 text-foreground',
                      'font-[inherit] text-[11px] px-2.5 h-[34px] rounded-lg outline-none',
                      'focus:border-primary/50 focus:ring-2 focus:ring-primary/20'
                    )}
                  />
                </div>

                <div className='flex flex-col gap-1.5'>
                  <span className='text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground'>
                    Model
                  </span>
                  {availableModels.length > 0 ? (
                    <select
                      value={selectedModelIndex}
                      onChange={(event) =>
                        setSelectedModelIndex(Number(event.target.value))
                      }
                      className={cn(
                        'bg-muted/30 border border-border/40 text-foreground',
                        'font-[inherit] text-[11px] px-2 h-[34px] rounded-lg outline-none cursor-pointer',
                        'focus:border-primary/50'
                      )}
                    >
                      {availableModels.map((model, idx) => (
                        <option
                          key={`${model.provider}/${model.model}`}
                          value={idx}
                        >
                          {model.provider}/{model.model}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className='text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-2.5 py-2'>
                      No audio models available for this producer.
                    </div>
                  )}
                </div>

                <div className='text-[11px] text-muted-foreground min-h-4'>
                  {costText}
                </div>

                <RegenerateButton
                  onClick={handleRegenerate}
                  isRegenerating={isRegenerating}
                  disabled={!canRegenerate}
                  className='w-full'
                />
              </>
            )}
          </aside>
        </div>

        {activeTab !== 'upload' && generationError && (
          <div className='px-3 pb-2'>
            <div className='bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2 text-xs text-destructive'>
              {generationError}
            </div>
          </div>
        )}

        <DialogFooter className='justify-end'>
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
