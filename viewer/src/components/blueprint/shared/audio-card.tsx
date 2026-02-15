/**
 * Shared AudioCard component for displaying audio content with player controls.
 * Used by both Inputs and Outputs panels.
 *
 * Returns MediaCard directly. Audio doesn't need expand/fullscreen functionality.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Play, Pause, Volume2, VolumeX } from "lucide-react";
import { MediaCard } from "./media-card";
import { cn } from "@/lib/utils";

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
}

/**
 * Format seconds to MM:SS display
 */
function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Audio card with custom styled player controls.
 * Renders a polished audio player that respects light/dark themes.
 */
export function AudioCard({
  url,
  title,
  footer,
  isSelected = false,
  isPinned = false,
}: AudioCardProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
  }, [isPlaying]);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setIsMuted(!isMuted);
  }, [isMuted]);

  const seekTo = useCallback((clientX: number) => {
    const audio = audioRef.current;
    const progressBar = progressRef.current;
    if (!audio || !progressBar || !isFinite(audio.duration)) return;

    const rect = progressBar.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    audio.currentTime = percent * audio.duration;
  }, []);

  const handleProgressClick = useCallback((e: React.MouseEvent) => {
    seekTo(e.clientX);
  }, [seekTo]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    seekTo(e.clientX);
  }, [seekTo]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      seekTo(e.clientX);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, seekTo]);

  useEffect(() => {
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

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
    };
  }, []);

  return (
    <MediaCard isSelected={isSelected} isPinned={isPinned} footer={footer}>
      <div className="aspect-video bg-linear-to-br from-muted/70 via-muted/50 to-muted/30 dark:from-black/60 dark:via-black/40 dark:to-black/20 flex flex-col items-center justify-center p-6">
        {/* Hidden audio element */}
        <audio ref={audioRef} src={url} preload="metadata" title={title} />

        {/* Waveform visualization placeholder */}
        <div className="flex-1 flex items-center justify-center w-full mb-4">
          <div className="flex items-end gap-[3px] h-16">
            {Array.from({ length: 32 }).map((_, i) => {
              const baseHeight = Math.sin((i / 32) * Math.PI) * 0.7 + 0.3;
              const variance = Math.sin(i * 0.8) * 0.2;
              const height = Math.max(0.15, Math.min(1, baseHeight + variance));
              const isActive = (i / 32) * 100 <= progress;
              return (
                <div
                  key={i}
                  className={cn(
                    "w-1 rounded-full transition-all duration-150",
                    isActive
                      ? "bg-primary"
                      : "bg-border dark:bg-muted-foreground/30"
                  )}
                  style={{
                    height: `${height * 100}%`,
                    opacity: isActive ? 1 : 0.6
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Progress bar */}
        <div
          ref={progressRef}
          className="w-full h-1.5 bg-border dark:bg-muted-foreground/20 rounded-full cursor-pointer group mb-4"
          onClick={handleProgressClick}
          onMouseDown={handleMouseDown}
        >
          <div
            className="h-full bg-primary rounded-full relative transition-all"
            style={{ width: `${progress}%` }}
          >
            <div
              className={cn(
                "absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-primary rounded-full shadow-md transition-transform",
                "opacity-0 group-hover:opacity-100",
                isDragging && "opacity-100 scale-125"
              )}
            />
          </div>
        </div>

        {/* Controls row */}
        <div className="w-full flex items-center gap-3">
          {/* Play/Pause button */}
          <button
            type="button"
            onClick={togglePlay}
            className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center transition-all",
              "bg-primary text-primary-foreground",
              "hover:bg-primary/90 hover:scale-105 active:scale-95",
              "shadow-md"
            )}
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause className="size-5" fill="currentColor" />
            ) : (
              <Play className="size-5 ml-0.5" fill="currentColor" />
            )}
          </button>

          {/* Time display */}
          <div className="flex-1 flex items-center gap-2 text-xs font-mono text-muted-foreground">
            <span className="min-w-[3ch]">{formatTime(currentTime)}</span>
            <span className="text-border">/</span>
            <span className="min-w-[3ch]">{formatTime(duration)}</span>
          </div>

          {/* Mute button */}
          <button
            type="button"
            onClick={toggleMute}
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center transition-all",
              "text-muted-foreground hover:text-foreground",
              "hover:bg-muted dark:hover:bg-muted/50"
            )}
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? (
              <VolumeX className="size-4" />
            ) : (
              <Volume2 className="size-4" />
            )}
          </button>
        </div>
      </div>
    </MediaCard>
  );
}
