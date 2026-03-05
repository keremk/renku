import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { RotateCcw, Scissors, Upload, Loader2, RefreshCw } from 'lucide-react';
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
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropzoneArea, formatRejectionErrors } from '../inputs/dropzone-area';
import { SelectedFilePreview } from '../inputs/file-preview';
import { useMediaPrompt } from './use-media-prompt';
import type { AvailableModelOption } from '@/types/blueprint-graph';

const MIN_CLIP_DURATION_SECONDS = 0.1;

export interface VideoClipParams {
  startTimeSeconds: number;
  endTimeSeconds: number;
}

export interface VideoRegenerateParams {
  mode: 'rerun' | 'clip';
  prompt: string;
  model?: AvailableModelOption;
  clipParams?: VideoClipParams;
  sourceTempId?: string;
}

export interface VideoRegenerateResult {
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

export interface VideoEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoUrl: string;
  title: string;
  availableModels: AvailableModelOption[];
  promptUrl?: string;
  onFileUpload: (files: File[]) => Promise<void>;
  onEstimateCost?: (
    params: VideoRegenerateParams
  ) => Promise<VideoRegenerateResult['estimatedCost']>;
  onRegenerate?: (
    params: VideoRegenerateParams
  ) => Promise<VideoRegenerateResult>;
  onApplyGenerated?: (tempId: string) => Promise<void>;
  onCleanupGenerated?: (tempId: string) => Promise<void>;
}

type TabId = 'rerun' | 'clip' | 'upload';

const TABS: { id: TabId; label: string; icon: typeof RotateCcw }[] = [
  { id: 'rerun', label: 'Re-run', icon: RotateCcw },
  { id: 'clip', label: 'Clip', icon: Scissors },
  { id: 'upload', label: 'Upload', icon: Upload },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatCurrency(value: number): string {
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatEstimatedCost(
  estimatedCost: VideoRegenerateResult['estimatedCost']
): string {
  const min = estimatedCost.minCost;
  const max = estimatedCost.maxCost;
  if (min !== max) {
    return `${formatCurrency(min)}-${formatCurrency(max)}`;
  }
  return formatCurrency(estimatedCost.cost);
}

function formatTimelineSeconds(value: number): string {
  const total = Math.max(0, value);
  const minutes = Math.floor(total / 60)
    .toString()
    .padStart(2, '0');
  const seconds = Math.floor(total % 60)
    .toString()
    .padStart(2, '0');
  const millis = Math.round((total % 1) * 100)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${seconds}.${millis}`;
}

function probeVideoDurationSeconds(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    const cleanup = () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('error', handleError);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };

    const handleLoadedMetadata = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        cleanup();
        reject(new Error(`Could not read clip duration from ${url}.`));
        return;
      }

      const durationSeconds = video.duration;
      cleanup();
      resolve(durationSeconds);
    };

    const handleError = () => {
      cleanup();
      reject(new Error(`Could not load clip metadata from ${url}.`));
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('error', handleError);
    video.src = url;
    video.load();
  });
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

function VideoPreview({
  url,
  title,
  videoRef,
  onPlay,
  onPause,
}: {
  url: string;
  title: string;
  videoRef?: RefObject<HTMLVideoElement | null>;
  onPlay?: () => void;
  onPause?: () => void;
}) {
  return (
    <div className='flex-1 rounded-xl bg-muted/30 dark:bg-black/50 overflow-hidden flex items-center justify-center min-h-[160px]'>
      <video
        ref={videoRef}
        src={url}
        controls
        className='w-full h-full object-contain'
        preload='metadata'
        aria-label={title}
        onPlay={onPlay}
        onPause={onPause}
      >
        Your browser does not support the video tag.
      </video>
    </div>
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
        mediaType='video'
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
    params: VideoRegenerateParams
  ) => Promise<VideoRegenerateResult['estimatedCost']>;
  setEstimatedCost: Dispatch<
    SetStateAction<VideoRegenerateResult['estimatedCost'] | null>
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

    const params: VideoRegenerateParams = {
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

export function VideoEditDialog({
  open,
  onOpenChange,
  videoUrl,
  title,
  availableModels,
  promptUrl,
  onFileUpload,
  onEstimateCost,
  onRegenerate,
  onApplyGenerated,
  onCleanupGenerated,
}: VideoEditDialogProps) {
  const [activeTab, setActiveTab] = useState<TabId>('rerun');
  const [rerunPrompt, setRerunPrompt] = useState('');
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
  const [sourceDurationSeconds, setSourceDurationSeconds] = useState<
    number | null
  >(null);
  const [clipStartSeconds, setClipStartSeconds] = useState(0);
  const [clipEndSeconds, setClipEndSeconds] = useState(0);

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [generatedPreviewUrl, setGeneratedPreviewUrl] = useState<string | null>(
    null
  );
  const [generatedTempId, setGeneratedTempId] = useState<string | null>(null);
  const [estimatedCost, setEstimatedCost] = useState<
    VideoRegenerateResult['estimatedCost'] | null
  >(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [isEstimatingCost, setIsEstimatingCost] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isApplyingGenerated, setIsApplyingGenerated] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const clipBoundsRef = useRef({ start: 0, end: 0 });
  const previousClipRangeRef = useRef<{ start: number; end: number } | null>(
    null
  );
  const clipLoopFrameRef = useRef<number | null>(null);

  const stopClipPlaybackLoop = useCallback(() => {
    if (clipLoopFrameRef.current !== null) {
      window.cancelAnimationFrame(clipLoopFrameRef.current);
      clipLoopFrameRef.current = null;
    }
  }, []);

  const previewVideoUrl = generatedPreviewUrl ?? videoUrl;

  const { promptText } = useMediaPrompt(promptUrl, open);

  useEffect(() => {
    if (!open) {
      return;
    }

    setSourceDurationSeconds(null);

    let cancelled = false;
    const video = document.createElement('video');
    video.preload = 'metadata';

    const handleLoadedMetadata = () => {
      if (cancelled) {
        return;
      }
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        setSourceDurationSeconds(null);
        return;
      }
      setSourceDurationSeconds(video.duration);
    };

    const handleError = () => {
      if (cancelled) {
        return;
      }
      setSourceDurationSeconds(null);
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('error', handleError);
    video.src = previewVideoUrl;
    video.load();

    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('error', handleError);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [open, previewVideoUrl]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setActiveTab('rerun');
    setRerunPrompt('');
    setSelectedModelIndex(0);
    setClipStartSeconds(0);
    setClipEndSeconds(0);
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
    clipBoundsRef.current = { start: 0, end: 0 };
    previousClipRangeRef.current = null;
    stopClipPlaybackLoop();
  }, [open, stopClipPlaybackLoop, videoUrl]);

  useEffect(() => {
    if (!promptText) {
      return;
    }
    setRerunPrompt((prev) => (prev === '' ? promptText : prev));
  }, [promptText]);

  useEffect(() => {
    if (sourceDurationSeconds === null || sourceDurationSeconds <= 0) {
      return;
    }

    setClipStartSeconds((prev) =>
      clamp(
        prev,
        0,
        Math.max(0, sourceDurationSeconds - MIN_CLIP_DURATION_SECONDS)
      )
    );
    setClipEndSeconds((prev) => {
      if (prev <= 0) {
        return sourceDurationSeconds;
      }
      return clamp(prev, MIN_CLIP_DURATION_SECONDS, sourceDurationSeconds);
    });
  }, [sourceDurationSeconds]);

  useEffect(() => {
    clipBoundsRef.current = {
      start: clipStartSeconds,
      end: clipEndSeconds,
    };
    previousClipRangeRef.current = {
      start: clipStartSeconds,
      end: clipEndSeconds,
    };
  }, [clipStartSeconds, clipEndSeconds]);

  useEffect(() => {
    if (!open || activeTab !== 'clip') {
      stopClipPlaybackLoop();
      return;
    }

    const video = previewVideoRef.current;
    if (!video || video.paused || clipEndSeconds <= clipStartSeconds) {
      return;
    }

    if (
      video.currentTime < clipStartSeconds ||
      video.currentTime >= clipEndSeconds
    ) {
      video.currentTime = clipStartSeconds;
    }
  }, [activeTab, clipEndSeconds, clipStartSeconds, open, stopClipPlaybackLoop]);

  useEffect(() => {
    return () => {
      stopClipPlaybackLoop();
    };
  }, [stopClipPlaybackLoop]);

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

  const displayedPreviewUrl =
    activeTab === 'upload' && selectedUploadPreviewUrl
      ? selectedUploadPreviewUrl
      : previewVideoUrl;

  const syncClipPreviewToTime = useCallback((timeSeconds: number) => {
    const video = previewVideoRef.current;
    if (!video) {
      return;
    }

    const nextTime =
      Number.isFinite(video.duration) && video.duration > 0
        ? clamp(timeSeconds, 0, video.duration)
        : Math.max(0, timeSeconds);
    video.currentTime = nextTime;
  }, []);

  const runClipPlaybackLoop = useCallback(() => {
    const video = previewVideoRef.current;

    if (!video || video.paused || activeTab !== 'clip') {
      stopClipPlaybackLoop();
      return;
    }

    const { start, end } = clipBoundsRef.current;
    if (end <= start) {
      stopClipPlaybackLoop();
      return;
    }

    if (video.currentTime < start || video.currentTime >= end) {
      video.currentTime = start;
    }

    clipLoopFrameRef.current =
      window.requestAnimationFrame(runClipPlaybackLoop);
  }, [activeTab, stopClipPlaybackLoop]);

  const startClipPlaybackLoop = useCallback(() => {
    stopClipPlaybackLoop();
    clipLoopFrameRef.current =
      window.requestAnimationFrame(runClipPlaybackLoop);
  }, [runClipPlaybackLoop, stopClipPlaybackLoop]);

  const handleClipPreviewPlay = useCallback(() => {
    if (activeTab !== 'clip') {
      return;
    }

    const video = previewVideoRef.current;
    if (!video) {
      return;
    }

    const { start, end } = clipBoundsRef.current;
    if (end <= start) {
      return;
    }

    if (video.currentTime < start || video.currentTime >= end) {
      video.currentTime = start;
    }

    startClipPlaybackLoop();
  }, [activeTab, startClipPlaybackLoop]);

  const handleClipPreviewPause = useCallback(() => {
    stopClipPlaybackLoop();
  }, [stopClipPlaybackLoop]);

  const clipDurationSeconds = Math.max(0, clipEndSeconds - clipStartSeconds);

  const handleClipRangeChange = useCallback(
    (values: number[]) => {
      if (values.length !== 2) {
        return;
      }
      if (sourceDurationSeconds === null || sourceDurationSeconds <= 0) {
        return;
      }

      let start = values[0] ?? 0;
      let end = values[1] ?? sourceDurationSeconds;
      if (start > end) {
        [start, end] = [end, start];
      }

      start = clamp(start, 0, sourceDurationSeconds);
      end = clamp(end, 0, sourceDurationSeconds);

      if (end - start < MIN_CLIP_DURATION_SECONDS) {
        if (end >= sourceDurationSeconds) {
          start = clamp(
            end - MIN_CLIP_DURATION_SECONDS,
            0,
            sourceDurationSeconds
          );
        } else {
          end = clamp(
            start + MIN_CLIP_DURATION_SECONDS,
            0,
            sourceDurationSeconds
          );
        }
      }

      const previousRange = previousClipRangeRef.current ?? {
        start,
        end,
      };
      const startDelta = Math.abs(start - previousRange.start);
      const endDelta = Math.abs(end - previousRange.end);
      const scrubTargetSeconds = startDelta >= endDelta ? start : end;

      setClipStartSeconds(start);
      setClipEndSeconds(end);
      previousClipRangeRef.current = {
        start,
        end,
      };
      syncClipPreviewToTime(scrubTargetSeconds);
    },
    [sourceDurationSeconds, syncClipPreviewToTime]
  );

  const getParamsForTab = useCallback(
    (tab: Exclude<TabId, 'upload'>): VideoRegenerateParams | null => {
      if (tab === 'rerun') {
        const selectedModel = availableModels[selectedModelIndex];
        if (!selectedModel) {
          return null;
        }
        return {
          mode: 'rerun',
          prompt: rerunPrompt,
          model: selectedModel,
        };
      }

      return {
        mode: 'clip',
        prompt: '',
        clipParams: {
          startTimeSeconds: clipStartSeconds,
          endTimeSeconds: clipEndSeconds,
        },
      };
    },
    [
      availableModels,
      clipEndSeconds,
      clipStartSeconds,
      rerunPrompt,
      selectedModelIndex,
    ]
  );

  const handleRegenerate = useCallback(async () => {
    if (!onRegenerate || activeTab === 'upload') {
      return;
    }

    if (activeTab === 'rerun' && availableModels.length === 0) {
      setGenerationError('No models are available for re-run preview.');
      return;
    }

    if (
      activeTab === 'clip' &&
      (sourceDurationSeconds === null || sourceDurationSeconds <= 0)
    ) {
      setGenerationError('Could not load source video duration for clip trim.');
      return;
    }

    const params = getParamsForTab(activeTab);
    if (!params) {
      setGenerationError('Could not resolve preview parameters.');
      return;
    }

    setIsRegenerating(true);
    setGenerationError(null);

    try {
      if (activeTab === 'clip') {
        stopClipPlaybackLoop();
      }

      const previousGeneratedTempId = generatedTempId;
      if (previousGeneratedTempId && !onCleanupGenerated) {
        throw new Error(
          'Cannot regenerate because preview cleanup is not configured.'
        );
      }

      const regenerateParams =
        activeTab === 'clip' && previousGeneratedTempId
          ? { ...params, sourceTempId: previousGeneratedTempId }
          : params;

      const result = await onRegenerate(regenerateParams);

      if (
        previousGeneratedTempId &&
        onCleanupGenerated &&
        previousGeneratedTempId !== result.tempId
      ) {
        await onCleanupGenerated(previousGeneratedTempId);
      }

      let nextClipDurationSeconds: number | null = null;
      if (activeTab === 'clip') {
        nextClipDurationSeconds = await probeVideoDurationSeconds(
          result.previewUrl
        );
      }

      setGeneratedPreviewUrl(result.previewUrl);
      setGeneratedTempId(result.tempId);
      setEstimatedCost(result.estimatedCost);

      if (activeTab === 'clip' && nextClipDurationSeconds !== null) {
        clipBoundsRef.current = { start: 0, end: nextClipDurationSeconds };
        previousClipRangeRef.current = {
          start: 0,
          end: nextClipDurationSeconds,
        };
        setSourceDurationSeconds(nextClipDurationSeconds);
        setClipStartSeconds(0);
        setClipEndSeconds(nextClipDurationSeconds);
        syncClipPreviewToTime(0);
      }
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
    sourceDurationSeconds,
    stopClipPlaybackLoop,
    syncClipPreviewToTime,
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
        stopClipPlaybackLoop();
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
        stopClipPlaybackLoop();
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
    stopClipPlaybackLoop,
  ]);

  const handleClose = useCallback(() => {
    if (isUploading || isApplyingGenerated) {
      return;
    }

    stopClipPlaybackLoop();

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
    stopClipPlaybackLoop,
  ]);

  const canRegenerate =
    Boolean(onRegenerate) &&
    !isApplyingGenerated &&
    !isUploading &&
    activeTab !== 'upload' &&
    (activeTab !== 'rerun' || availableModels.length > 0) &&
    (activeTab !== 'clip' ||
      (sourceDurationSeconds !== null && sourceDurationSeconds > 0));

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
          'w-[960px] h-[800px] max-w-[960px] max-h-[900px]',
          'p-0 gap-0 overflow-hidden flex flex-col'
        )}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className='sr-only'>
            Re-run, trim, or upload a replacement video.
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

        {activeTab === 'clip' ? (
          <div className='flex-1 flex min-h-0 overflow-hidden'>
            <div className='flex-1 p-3 min-w-0 flex flex-col gap-3 overflow-y-auto'>
              <VideoPreview
                url={displayedPreviewUrl}
                title={title}
                videoRef={previewVideoRef}
                onPlay={handleClipPreviewPlay}
                onPause={handleClipPreviewPause}
              />

              <div className='rounded-lg border border-border/40 p-3 bg-muted/20 flex flex-col gap-3'>
                <div className='flex items-center justify-between'>
                  <span className='text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground'>
                    Clip Timeline
                  </span>
                  <span className='text-[11px] text-muted-foreground tabular-nums'>
                    Duration: {formatTimelineSeconds(clipDurationSeconds)}
                  </span>
                </div>

                <Slider
                  min={0}
                  max={Math.max(
                    sourceDurationSeconds ?? 0,
                    MIN_CLIP_DURATION_SECONDS
                  )}
                  step={0.01}
                  value={[clipStartSeconds, clipEndSeconds]}
                  onValueChange={handleClipRangeChange}
                  className='[&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-track]]:bg-muted/60 [&_[data-slot=slider-range]]:bg-linear-to-r [&_[data-slot=slider-range]]:from-orange-400 [&_[data-slot=slider-range]]:to-yellow-500'
                />

                <div className='flex items-center justify-between text-xs text-muted-foreground tabular-nums'>
                  <span>Start: {formatTimelineSeconds(clipStartSeconds)}</span>
                  <span>End: {formatTimelineSeconds(clipEndSeconds)}</span>
                </div>

                <RegenerateButton
                  onClick={handleRegenerate}
                  isRegenerating={isRegenerating}
                  disabled={!canRegenerate}
                  className='w-full'
                />
              </div>
            </div>
          </div>
        ) : (
          <div className='flex-1 flex min-h-0 overflow-hidden'>
            <div className='flex-1 p-3 min-w-0 flex'>
              <VideoPreview
                url={displayedPreviewUrl}
                title={title}
                videoRef={previewVideoRef}
                onPlay={handleClipPreviewPlay}
                onPause={handleClipPreviewPause}
              />
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
                        Prompt
                      </span>
                      <span className='text-[9px] text-muted-foreground/60 tabular-nums'>
                        {rerunPrompt.length} chars
                      </span>
                    </div>
                    <textarea
                      value={rerunPrompt}
                      onChange={(event) => setRerunPrompt(event.target.value)}
                      placeholder='Optional prompt tweak before re-running...'
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
                            {model.model}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className='text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-2.5 py-2'>
                        No video models available for this producer.
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
        )}

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
