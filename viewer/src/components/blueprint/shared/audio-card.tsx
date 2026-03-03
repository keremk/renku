/**
 * Shared AudioCard component for displaying audio content with player controls.
 * Used by both Inputs and Outputs panels.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize2 } from 'lucide-react';
import { MediaCard } from './media-card';
import { MediaExpandDialog } from './media-expand-dialog';
import { useMediaPrompt } from './use-media-prompt';
import { cn } from '@/lib/utils';

export interface AudioCardProps {
  /** URL of the audio to play */
  url: string;
  /** Title for the card (not displayed but used for consistency) */
  title: string;
  /** Footer content (panel provides its own footer) */
  footer: React.ReactNode;
  /** Whether the card is selected */
  isSelected?: boolean;
  /** Whether the card is pinned */
  isPinned?: boolean;
  /** Whether this card opens an expanded dialog instead of inline playback */
  expandable?: boolean;
  /** Optional prompt artifact label for expanded view */
  promptTitle?: string;
  /** Optional prompt artifact URL for expanded view */
  promptUrl?: string;
}

/**
 * Format seconds to MM:SS display
 */
function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Audio player surface used both in card and expanded dialog.
 */
function AudioPlayerSurface({
  url,
  title,
  interactive = true,
}: {
  url: string;
  title: string;
  interactive?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const progress =
    interactive && duration > 0 ? (currentTime / duration) * 100 : 0;

  const togglePlay = useCallback(() => {
    if (!interactive) return;
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
  }, [interactive, isPlaying]);

  const toggleMute = useCallback(() => {
    if (!interactive) return;
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setIsMuted(!isMuted);
  }, [interactive, isMuted]);

  const seekTo = useCallback(
    (clientX: number) => {
      if (!interactive) return;
      const audio = audioRef.current;
      const progressBar = progressRef.current;
      if (!audio || !progressBar || !isFinite(audio.duration)) return;

      const rect = progressBar.getBoundingClientRect();
      const percent = Math.max(
        0,
        Math.min(1, (clientX - rect.left) / rect.width)
      );
      audio.currentTime = percent * audio.duration;
    },
    [interactive]
  );

  const handleProgressClick = useCallback(
    (e: React.MouseEvent) => {
      if (!interactive) return;
      seekTo(e.clientX);
    },
    [interactive, seekTo]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!interactive) return;
      setIsDragging(true);
      seekTo(e.clientX);
    },
    [interactive, seekTo]
  );

  useEffect(() => {
    if (!interactive) return;
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      seekTo(e.clientX);
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
  }, [interactive, isDragging, seekTo]);

  useEffect(() => {
    if (!interactive) return;
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleLoadedMetadata = () => setDuration(audio.duration);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [interactive]);

  return (
    <div className='aspect-video bg-linear-to-br from-muted/70 via-muted/50 to-muted/30 dark:from-black/60 dark:via-black/40 dark:to-black/20 flex flex-col items-center justify-center p-6'>
      <audio ref={audioRef} src={url} preload='metadata' title={title} />

      <div className='flex-1 flex items-center justify-center w-full mb-4'>
        <div className='flex items-end gap-[3px] h-16'>
          {Array.from({ length: 32 }).map((_, i) => {
            const baseHeight = Math.sin((i / 32) * Math.PI) * 0.7 + 0.3;
            const variance = Math.sin(i * 0.8) * 0.2;
            const height = Math.max(0.15, Math.min(1, baseHeight + variance));
            const isActive = (i / 32) * 100 <= progress;
            return (
              <div
                key={i}
                className={cn(
                  'w-1 rounded-full transition-all duration-150',
                  isActive
                    ? 'bg-primary'
                    : 'bg-border dark:bg-muted-foreground/30'
                )}
                style={{
                  height: `${height * 100}%`,
                  opacity: isActive ? 1 : 0.6,
                }}
              />
            );
          })}
        </div>
      </div>

      <div
        ref={progressRef}
        className={cn(
          'w-full h-1.5 bg-border dark:bg-muted-foreground/20 rounded-full group mb-4',
          interactive ? 'cursor-pointer' : 'cursor-default'
        )}
        onClick={interactive ? handleProgressClick : undefined}
        onMouseDown={interactive ? handleMouseDown : undefined}
      >
        <div
          className='h-full bg-primary rounded-full relative transition-all'
          style={{ width: `${progress}%` }}
        >
          <div
            className={cn(
              'absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-primary rounded-full shadow-md transition-transform',
              interactive ? 'opacity-0 group-hover:opacity-100' : 'opacity-0',
              isDragging && interactive && 'opacity-100 scale-125'
            )}
          />
        </div>
      </div>

      <div className='w-full flex items-center gap-3'>
        {interactive ? (
          <button
            type='button'
            onClick={togglePlay}
            className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center transition-all',
              'bg-primary text-primary-foreground shadow-md',
              'hover:bg-primary/90 hover:scale-105 active:scale-95'
            )}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className='size-5' fill='currentColor' />
            ) : (
              <Play className='size-5 ml-0.5' fill='currentColor' />
            )}
          </button>
        ) : (
          <div className='w-10 h-10 rounded-full flex items-center justify-center bg-primary text-primary-foreground shadow-md opacity-85'>
            <Play className='size-5 ml-0.5' fill='currentColor' />
          </div>
        )}

        <div className='flex-1 flex items-center gap-2 text-xs font-mono text-muted-foreground'>
          <span className='min-w-[3ch]'>{formatTime(currentTime)}</span>
          <span className='text-border'>/</span>
          <span className='min-w-[3ch]'>{formatTime(duration)}</span>
        </div>

        {interactive ? (
          <button
            type='button'
            onClick={toggleMute}
            className='w-8 h-8 rounded-full flex items-center justify-center transition-all text-muted-foreground hover:text-foreground hover:bg-muted dark:hover:bg-muted/50'
            aria-label={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? (
              <VolumeX className='size-4' />
            ) : (
              <Volume2 className='size-4' />
            )}
          </button>
        ) : (
          <div className='w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground/70'>
            <Volume2 className='size-4' />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Audio card with custom styled player controls.
 */
export function AudioCard({
  url,
  title,
  footer,
  isSelected = false,
  isPinned = false,
  expandable = false,
  promptTitle,
  promptUrl,
}: AudioCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { promptText, promptError, isPromptLoading } = useMediaPrompt(
    promptUrl,
    isExpanded
  );

  if (expandable) {
    return (
      <>
        <MediaCard isSelected={isSelected} isPinned={isPinned} footer={footer}>
          <button
            type='button'
            onClick={() => setIsExpanded(true)}
            className='w-full group relative overflow-hidden text-left'
          >
            <div className='pointer-events-none'>
              <AudioPlayerSurface url={url} title={title} interactive={false} />
            </div>
            <div className='absolute inset-0 bg-black/0 group-hover:bg-black/12 transition-colors flex items-center justify-center'>
              <Maximize2 className='size-8 text-white drop-shadow-md opacity-0 group-hover:opacity-100 transition-opacity' />
            </div>
          </button>
        </MediaCard>

        <MediaExpandDialog
          open={isExpanded}
          onOpenChange={setIsExpanded}
          title={title}
          url={url}
          mediaType='audio'
          customMedia={
            <AudioPlayerSurface url={url} title={title} interactive />
          }
          promptTitle={promptTitle}
          promptText={promptText}
          isPromptLoading={isPromptLoading}
          promptError={promptError}
        />
      </>
    );
  }

  return (
    <MediaCard isSelected={isSelected} isPinned={isPinned} footer={footer}>
      <AudioPlayerSurface url={url} title={title} interactive />
    </MediaCard>
  );
}
