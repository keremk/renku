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
import {
  RotateCcw,
  Scissors,
  Upload,
  Loader2,
  RefreshCw,
  Play,
  Pause,
} from 'lucide-react';
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

export interface MusicClipParams {
  startTimeSeconds: number;
  endTimeSeconds: number;
}

export interface MusicRegenerateParams {
  mode: 'rerun' | 'clip';
  prompt: string;
  model?: AvailableModelOption;
  clipParams?: MusicClipParams;
  sourceTempId?: string;
}

export interface MusicRegenerateResult {
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

export interface MusicEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  musicUrl: string;
  title: string;
  availableModels: AvailableModelOption[];
  initialModel?: AvailableModelOption;
  promptUrl?: string;
  onFileUpload: (files: File[]) => Promise<void>;
  onEstimateCost?: (
    params: MusicRegenerateParams
  ) => Promise<MusicRegenerateResult['estimatedCost']>;
  onRegenerate?: (
    params: MusicRegenerateParams
  ) => Promise<MusicRegenerateResult>;
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
  estimatedCost: MusicRegenerateResult['estimatedCost']
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

function probeAudioDurationSeconds(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';

    const cleanup = () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('error', handleError);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    };

    const handleLoadedMetadata = () => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
        cleanup();
        reject(new Error(`Could not read clip duration from ${url}.`));
        return;
      }

      const durationSeconds = audio.duration;
      cleanup();
      resolve(durationSeconds);
    };

    const handleError = () => {
      cleanup();
      reject(new Error(`Could not load clip metadata from ${url}.`));
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('error', handleError);
    audio.src = url;
    audio.load();
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

const DEFAULT_WAVEFORM_PEAKS = Array.from({ length: 180 }, (_, index) => {
  const base = Math.sin((index / 180) * Math.PI * 6) * 0.22 + 0.58;
  const variation = Math.sin(index * 0.35) * 0.1;
  return clamp(base + variation, 0.08, 0.98);
});

const WAVEFORM_BAR_COUNT = 520;

function sampleWaveformPeaks(peaks: number[], barCount: number): number[] {
  if (barCount <= 0) {
    return [];
  }

  if (peaks.length === 0) {
    return Array.from({ length: barCount }, () => 0.35);
  }

  if (peaks.length === 1) {
    return Array.from({ length: barCount }, () => peaks[0] ?? 0.35);
  }

  const lastPeakIndex = peaks.length - 1;

  return Array.from({ length: barCount }, (_, barIndex) => {
    const position =
      barCount === 1 ? 0 : (barIndex / (barCount - 1)) * lastPeakIndex;
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.min(lastPeakIndex, Math.ceil(position));
    const lowerPeak = peaks[lowerIndex] ?? 0;
    const upperPeak = peaks[upperIndex] ?? lowerPeak;
    const mix = position - lowerIndex;

    return lowerPeak + (upperPeak - lowerPeak) * mix;
  });
}

function boostMusicContrast(peaks: number[], windowRadius: number): number[] {
  return peaks.map((peak, index) => {
    const start = Math.max(0, index - windowRadius);
    const end = Math.min(peaks.length, index + windowRadius + 1);

    let localMin = 1;
    let localMax = 0;
    for (let i = start; i < end; i += 1) {
      if (peaks[i] < localMin) localMin = peaks[i];
      if (peaks[i] > localMax) localMax = peaks[i];
    }

    const localRange = localMax - localMin;
    if (localRange < 0.01) {
      return 0.5;
    }

    return (peak - localMin) / localRange;
  });
}

function buildWaveformPeaks(
  audioBuffer: AudioBuffer,
  segments: number
): number[] {
  const channelCount = audioBuffer.numberOfChannels;
  if (channelCount <= 0 || segments <= 0) {
    return DEFAULT_WAVEFORM_PEAKS;
  }

  const channels = Array.from({ length: channelCount }, (_, index) =>
    audioBuffer.getChannelData(index)
  );
  const sampleLength = audioBuffer.length;
  const segmentSize = Math.max(1, Math.floor(sampleLength / segments));

  const rawPeaks = Array.from({ length: segments }, (_, segmentIndex) => {
    const start = segmentIndex * segmentSize;
    const end = Math.min(sampleLength, start + segmentSize);

    let squareSum = 0;
    let maxSample = 0;
    let sampleCount = 0;

    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      let sampleValue = 0;

      for (const channel of channels) {
        sampleValue += Math.abs(channel[sampleIndex] ?? 0);
      }

      const averagedSample = sampleValue / channelCount;
      squareSum += averagedSample * averagedSample;
      sampleCount += 1;

      if (averagedSample > maxSample) {
        maxSample = averagedSample;
      }
    }

    if (sampleCount === 0) {
      return 0;
    }

    const rms = Math.sqrt(squareSum / sampleCount);
    return Math.max(rms, maxSample * 0.65);
  });

  const smoothedPeaks = rawPeaks.map((peak, index) => {
    const previous = rawPeaks[index - 1] ?? peak;
    const next = rawPeaks[index + 1] ?? peak;
    return (previous + peak + next) / 3;
  });

  const maxPeak = Math.max(...smoothedPeaks, 0.0001);
  const normalizedPeaks = smoothedPeaks.map((peak) =>
    Math.max(0.05, peak / maxPeak)
  );
  return boostMusicContrast(normalizedPeaks, 12);
}

async function extractWaveformData(
  url: string,
  segments: number
): Promise<number[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed loading audio waveform source: ${url}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const AudioContextClass =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error('AudioContext is not available in this browser.');
  }

  const audioContext = new AudioContextClass();
  try {
    const audioBuffer = await audioContext.decodeAudioData(
      arrayBuffer.slice(0)
    );
    return buildWaveformPeaks(audioBuffer, segments);
  } finally {
    void audioContext.close();
  }
}

function useMusicWaveformPeaks(url: string): number[] {
  const [peaks, setPeaks] = useState<number[]>(() => DEFAULT_WAVEFORM_PEAKS);

  useEffect(() => {
    let cancelled = false;

    const loadWaveform = async () => {
      try {
        const decodedPeaks = await extractWaveformData(url, WAVEFORM_BAR_COUNT);
        if (!cancelled && decodedPeaks.length > 0) {
          setPeaks(sampleWaveformPeaks(decodedPeaks, WAVEFORM_BAR_COUNT));
        }
      } catch {
        if (!cancelled) {
          setPeaks(DEFAULT_WAVEFORM_PEAKS);
        }
      }
    };

    void loadWaveform();

    return () => {
      cancelled = true;
    };
  }, [url]);

  return peaks;
}

function MusicWaveformLines({
  peaks,
  stroke,
}: {
  peaks: number[];
  stroke: string;
}) {
  return (
    <svg
      className='w-full h-full'
      viewBox={`0 0 ${peaks.length} 100`}
      preserveAspectRatio='none'
      aria-hidden='true'
    >
      <line
        x1={0}
        x2={peaks.length}
        y1={50}
        y2={50}
        stroke='rgba(255, 255, 255, 0.18)'
        strokeWidth={0.7}
      />
      {peaks.map((peak, index) => {
        const amplitude = peak * 45;
        const yTop = 50 - amplitude;
        const yBottom = 50 + amplitude;
        const x = index + 0.5;

        return (
          <line
            key={`music-wave-${index}`}
            x1={x}
            x2={x}
            y1={yTop}
            y2={yBottom}
            stroke={stroke}
            strokeWidth={0.35}
            strokeLinecap='round'
          />
        );
      })}
    </svg>
  );
}

function MusicPreview({
  url,
  title,
  audioRef,
  onPlay,
  onPause,
  onScrubRequest,
  showClipBounds,
  clipStartSeconds,
  clipEndSeconds,
}: {
  url: string;
  title: string;
  audioRef?: RefObject<HTMLAudioElement | null>;
  onPlay?: () => void;
  onPause?: () => void;
  onScrubRequest?: (timeSeconds: number) => void;
  showClipBounds?: boolean;
  clipStartSeconds?: number;
  clipEndSeconds?: number;
}) {
  const localAudioRef = useRef<HTMLAudioElement | null>(null);
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const effectiveAudioRef = audioRef ?? localAudioRef;
  const peaks = useMusicWaveformPeaks(url);

  useEffect(() => {
    const audio = effectiveAudioRef.current;
    if (!audio) {
      return;
    }

    const handleLoadedMetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };
    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };
    const handleAudioPlay = () => {
      setIsPlaying(true);
      onPlay?.();
    };
    const handleAudioPause = () => {
      setIsPlaying(false);
      onPause?.();
    };
    const handleAudioEnded = () => {
      setIsPlaying(false);
    };
    const handleAudioLoadStart = () => {
      setCurrentTime(0);
      setDuration(0);
      setIsPlaying(false);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('play', handleAudioPlay);
    audio.addEventListener('pause', handleAudioPause);
    audio.addEventListener('ended', handleAudioEnded);
    audio.addEventListener('loadstart', handleAudioLoadStart);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('play', handleAudioPlay);
      audio.removeEventListener('pause', handleAudioPause);
      audio.removeEventListener('ended', handleAudioEnded);
      audio.removeEventListener('loadstart', handleAudioLoadStart);
    };
  }, [effectiveAudioRef, onPause, onPlay, url]);

  const progressPercent =
    duration > 0 ? clamp((currentTime / duration) * 100, 0, 100) : 0;

  const clipStartPercent =
    showClipBounds && duration > 0 && Number.isFinite(clipStartSeconds)
      ? clamp(((clipStartSeconds ?? 0) / duration) * 100, 0, 100)
      : 0;

  const clipEndPercent =
    showClipBounds && duration > 0 && Number.isFinite(clipEndSeconds)
      ? clamp(((clipEndSeconds ?? 0) / duration) * 100, 0, 100)
      : 100;

  const seekToClientX = (clientX: number) => {
    const waveform = waveformRef.current;
    const audio = effectiveAudioRef.current;
    if (!waveform || !audio) {
      return;
    }

    const seekDuration =
      duration > 0
        ? duration
        : Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : 0;

    if (seekDuration <= 0) {
      return;
    }

    const rect = waveform.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    const timeSeconds = ratio * seekDuration;

    if (onScrubRequest) {
      onScrubRequest(timeSeconds);
    } else {
      audio.currentTime = timeSeconds;
      const playPromise = audio.play();
      if (playPromise) {
        void playPromise.catch(() => {});
      }
    }
  };

  const handleWaveformClick = (event: React.MouseEvent<HTMLDivElement>) => {
    seekToClientX(event.clientX);
  };

  const handleWaveformMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    seekToClientX(event.clientX);
  };

  useEffect(() => {
    if (!isDragging) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const waveform = waveformRef.current;
      const audio = effectiveAudioRef.current;
      if (!waveform || !audio) {
        return;
      }

      const seekDuration =
        duration > 0
          ? duration
          : Number.isFinite(audio.duration) && audio.duration > 0
            ? audio.duration
            : 0;

      if (seekDuration <= 0) {
        return;
      }

      const rect = waveform.getBoundingClientRect();
      const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const timeSeconds = ratio * seekDuration;

      if (onScrubRequest) {
        onScrubRequest(timeSeconds);
      } else {
        audio.currentTime = timeSeconds;
        const playPromise = audio.play();
        if (playPromise) {
          void playPromise.catch(() => {});
        }
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [duration, effectiveAudioRef, isDragging, onScrubRequest]);

  const togglePlayPause = () => {
    const audio = effectiveAudioRef.current;
    if (!audio) {
      return;
    }

    if (audio.paused) {
      const hasClipBounds =
        showClipBounds &&
        Number.isFinite(clipStartSeconds) &&
        Number.isFinite(clipEndSeconds) &&
        (clipEndSeconds ?? 0) > (clipStartSeconds ?? 0);

      if (
        hasClipBounds &&
        (audio.currentTime < (clipStartSeconds ?? 0) ||
          audio.currentTime >= (clipEndSeconds ?? 0))
      ) {
        audio.currentTime = clipStartSeconds ?? 0;
      }

      const playPromise = audio.play();
      if (playPromise) {
        void playPromise.catch(() => {});
      }
      return;
    }

    audio.pause();
  };

  return (
    <div className='flex-1 rounded-xl bg-muted/30 dark:bg-black/50 overflow-hidden flex items-center justify-center min-h-[220px] p-4'>
      <audio
        ref={effectiveAudioRef}
        src={url}
        className='sr-only'
        preload='metadata'
        aria-label={title}
      >
        Your browser does not support the audio tag.
      </audio>

      <div className='w-full rounded-lg border border-border/40 bg-linear-to-br from-emerald-950/45 via-emerald-900/35 to-zinc-900/45 p-3'>
        <div
          ref={waveformRef}
          data-testid='music-waveform-surface'
          className='relative h-40 rounded-md border border-white/10 bg-black/30 overflow-hidden cursor-pointer select-none group'
          onClick={handleWaveformClick}
          onMouseDown={handleWaveformMouseDown}
        >
          <MusicWaveformLines
            peaks={peaks}
            stroke='rgba(255, 255, 255, 0.55)'
          />

          <div
            className='absolute inset-y-0 left-0 overflow-hidden pointer-events-none'
            style={{ width: `${progressPercent}%` }}
          >
            <MusicWaveformLines
              peaks={peaks}
              stroke='rgba(110, 231, 183, 0.95)'
            />
          </div>

          {showClipBounds && (
            <>
              <div
                className='absolute inset-y-0 left-0 bg-black/45 pointer-events-none'
                style={{ width: `${clipStartPercent}%` }}
              />
              <div
                className='absolute inset-y-0 right-0 bg-black/45 pointer-events-none'
                style={{ width: `${Math.max(0, 100 - clipEndPercent)}%` }}
              />
              <div
                className='absolute inset-y-0 border-l border-emerald-300/80 pointer-events-none'
                style={{ left: `${clipStartPercent}%` }}
              />
              <div
                className='absolute inset-y-0 border-l border-emerald-300/80 pointer-events-none'
                style={{ left: `${clipEndPercent}%` }}
              />
            </>
          )}

          <div
            className='absolute inset-y-0 w-px bg-white/85 pointer-events-none'
            style={{ left: `${progressPercent}%` }}
          />
          <div
            className='absolute top-1/2 -translate-y-1/2 -ml-1.5 w-3 h-3 rounded-full bg-white/95 shadow-[0_0_10px_rgba(255,255,255,0.45)] pointer-events-none'
            style={{ left: `${progressPercent}%` }}
          />
        </div>

        <div className='mt-3 flex items-center gap-3'>
          <button
            type='button'
            onClick={togglePlayPause}
            className='w-9 h-9 rounded-full bg-emerald-400/90 text-emerald-950 flex items-center justify-center hover:bg-emerald-300 transition-colors'
            aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
          >
            {isPlaying ? (
              <Pause className='size-4.5' />
            ) : (
              <Play className='size-4.5 ml-0.5' fill='currentColor' />
            )}
          </button>

          <div className='flex-1 flex items-center justify-between text-[11px] text-emerald-50/90 tabular-nums'>
            <span>{formatTimelineSeconds(currentTime)}</span>
            <span>{formatTimelineSeconds(duration)}</span>
          </div>
        </div>
      </div>
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
    params: MusicRegenerateParams
  ) => Promise<MusicRegenerateResult['estimatedCost']>;
  setEstimatedCost: Dispatch<
    SetStateAction<MusicRegenerateResult['estimatedCost'] | null>
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

    const params: MusicRegenerateParams = {
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

export function MusicEditDialog({
  open,
  onOpenChange,
  musicUrl,
  title,
  availableModels,
  initialModel,
  promptUrl,
  onFileUpload,
  onEstimateCost,
  onRegenerate,
  onApplyGenerated,
  onCleanupGenerated,
}: MusicEditDialogProps) {
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
    MusicRegenerateResult['estimatedCost'] | null
  >(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [isEstimatingCost, setIsEstimatingCost] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isApplyingGenerated, setIsApplyingGenerated] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const clipBoundsRef = useRef({ start: 0, end: 0 });
  const previousClipRangeRef = useRef<{ start: number; end: number } | null>(
    null
  );
  const clipLoopFrameRef = useRef<number | null>(null);
  const wasOpenRef = useRef(false);

  const stopClipPlaybackLoop = useCallback(() => {
    if (clipLoopFrameRef.current !== null) {
      window.cancelAnimationFrame(clipLoopFrameRef.current);
      clipLoopFrameRef.current = null;
    }
  }, []);

  const previewMusicUrl = generatedPreviewUrl ?? musicUrl;

  const { promptText } = useMediaPrompt(promptUrl, open);

  useEffect(() => {
    if (!open) {
      return;
    }

    setSourceDurationSeconds(null);

    let cancelled = false;
    const audio = document.createElement('audio');
    audio.preload = 'metadata';

    const handleLoadedMetadata = () => {
      if (cancelled) {
        return;
      }
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
        setSourceDurationSeconds(null);
        return;
      }
      setSourceDurationSeconds(audio.duration);
    };

    const handleError = () => {
      if (cancelled) {
        return;
      }
      setSourceDurationSeconds(null);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('error', handleError);
    audio.src = previewMusicUrl;
    audio.load();

    return () => {
      cancelled = true;
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('error', handleError);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    };
  }, [open, previewMusicUrl]);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setActiveTab('rerun');
      setRerunPrompt('');
      const matchingModelIndex = initialModel
        ? availableModels.findIndex(
            (model) =>
              model.provider === initialModel.provider &&
              model.model === initialModel.model
          )
        : -1;
      setSelectedModelIndex(matchingModelIndex >= 0 ? matchingModelIndex : 0);
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
    }

    wasOpenRef.current = open;
  }, [open, stopClipPlaybackLoop, availableModels, initialModel]);

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

    const audio = previewAudioRef.current;
    if (!audio || audio.paused || clipEndSeconds <= clipStartSeconds) {
      return;
    }

    if (
      audio.currentTime < clipStartSeconds ||
      audio.currentTime >= clipEndSeconds
    ) {
      audio.currentTime = clipStartSeconds;
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
      : previewMusicUrl;

  const syncClipPreviewToTime = useCallback((timeSeconds: number) => {
    const audio = previewAudioRef.current;
    if (!audio) {
      return;
    }

    const nextTime =
      Number.isFinite(audio.duration) && audio.duration > 0
        ? clamp(timeSeconds, 0, audio.duration)
        : Math.max(0, timeSeconds);
    audio.currentTime = nextTime;
  }, []);

  const runClipPlaybackLoop = useCallback(() => {
    const audio = previewAudioRef.current;

    if (!audio || audio.paused || activeTab !== 'clip') {
      stopClipPlaybackLoop();
      return;
    }

    const { start, end } = clipBoundsRef.current;
    if (end <= start) {
      stopClipPlaybackLoop();
      return;
    }

    if (audio.currentTime < start || audio.currentTime >= end) {
      audio.currentTime = start;
    }

    clipLoopFrameRef.current =
      window.requestAnimationFrame(runClipPlaybackLoop);
  }, [activeTab, stopClipPlaybackLoop]);

  const startClipPlaybackLoop = useCallback(() => {
    stopClipPlaybackLoop();
    clipLoopFrameRef.current =
      window.requestAnimationFrame(runClipPlaybackLoop);
  }, [runClipPlaybackLoop, stopClipPlaybackLoop]);

  const playClipPreviewFromTime = useCallback(
    (timeSeconds: number) => {
      if (activeTab !== 'clip') {
        return;
      }

      const audio = previewAudioRef.current;
      if (!audio) {
        return;
      }

      const { start, end } = clipBoundsRef.current;
      if (end <= start) {
        return;
      }

      const boundedTime = clamp(
        timeSeconds,
        start,
        Math.max(start, end - 0.01)
      );
      audio.currentTime = boundedTime;

      const playPromise = audio.play();
      if (playPromise) {
        void playPromise.catch(() => {});
      }

      startClipPlaybackLoop();
    },
    [activeTab, startClipPlaybackLoop]
  );

  const handlePreviewScrub = useCallback(
    (timeSeconds: number) => {
      if (activeTab === 'clip') {
        playClipPreviewFromTime(timeSeconds);
        return;
      }

      const audio = previewAudioRef.current;
      if (!audio) {
        return;
      }

      const boundedTime =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? clamp(timeSeconds, 0, audio.duration)
          : Math.max(0, timeSeconds);

      audio.currentTime = boundedTime;
      const playPromise = audio.play();
      if (playPromise) {
        void playPromise.catch(() => {});
      }
    },
    [activeTab, playClipPreviewFromTime]
  );

  const handleClipPreviewPlay = useCallback(() => {
    if (activeTab !== 'clip') {
      return;
    }

    const audio = previewAudioRef.current;
    if (!audio) {
      return;
    }

    const { start, end } = clipBoundsRef.current;
    if (end <= start) {
      return;
    }

    if (audio.currentTime < start || audio.currentTime >= end) {
      audio.currentTime = start;
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
      const clipSpan = Math.max(end - start, MIN_CLIP_DURATION_SECONDS);
      const tailPreviewWindow = Math.min(1.5, clipSpan);
      const scrubTargetSeconds =
        startDelta >= endDelta
          ? start
          : Math.max(start, end - tailPreviewWindow);

      setClipStartSeconds(start);
      setClipEndSeconds(end);
      previousClipRangeRef.current = {
        start,
        end,
      };
      playClipPreviewFromTime(scrubTargetSeconds);
    },
    [playClipPreviewFromTime, sourceDurationSeconds]
  );

  const getParamsForTab = useCallback(
    (tab: Exclude<TabId, 'upload'>): MusicRegenerateParams | null => {
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
      setGenerationError('Could not load source audio duration for clip trim.');
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
        nextClipDurationSeconds = await probeAudioDurationSeconds(
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

  const isClipTimelineReady =
    sourceDurationSeconds !== null && sourceDurationSeconds > 0;

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
            Re-run, trim, or upload replacement music.
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
              <MusicPreview
                key={displayedPreviewUrl}
                url={displayedPreviewUrl}
                title={title}
                audioRef={previewAudioRef}
                onPlay={handleClipPreviewPlay}
                onPause={handleClipPreviewPause}
                onScrubRequest={handlePreviewScrub}
                showClipBounds
                clipStartSeconds={clipStartSeconds}
                clipEndSeconds={clipEndSeconds}
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

                {isClipTimelineReady ? (
                  <>
                    <Slider
                      min={0}
                      max={sourceDurationSeconds}
                      step={0.01}
                      value={[clipStartSeconds, clipEndSeconds]}
                      onValueChange={handleClipRangeChange}
                      className='[&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-track]]:bg-muted/60 [&_[data-slot=slider-range]]:bg-linear-to-r [&_[data-slot=slider-range]]:from-orange-400 [&_[data-slot=slider-range]]:to-yellow-500'
                    />

                    <div className='flex items-center justify-between text-xs text-muted-foreground tabular-nums'>
                      <span>
                        Start: {formatTimelineSeconds(clipStartSeconds)}
                      </span>
                      <span>End: {formatTimelineSeconds(clipEndSeconds)}</span>
                    </div>
                  </>
                ) : (
                  <div className='h-9 rounded-md border border-border/40 bg-muted/30 flex items-center px-3 text-xs text-muted-foreground'>
                    Loading source duration...
                  </div>
                )}

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
              <MusicPreview
                key={displayedPreviewUrl}
                url={displayedPreviewUrl}
                title={title}
                audioRef={previewAudioRef}
                onPlay={handleClipPreviewPlay}
                onPause={handleClipPreviewPause}
                onScrubRequest={handlePreviewScrub}
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
                        No music models available for this producer.
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
