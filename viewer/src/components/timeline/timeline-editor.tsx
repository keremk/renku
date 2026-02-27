import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TimelineDocument } from '@/types/timeline';
import { calculateTimelineMetrics } from '@/lib/timeline-metrics';
import { TrackHeaders } from './track-headers';
import { TimelineContent } from './timeline-content';

const HIDDEN_TIMELINE_TRACK_KINDS = new Set(['Transcription', 'Text']);

interface TimelineEditorProps {
  timeline: TimelineDocument;
  currentTime: number;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (time: number) => void;
  resolveAssetUrl?: (assetId: string) => string;
}

export const TimelineEditor = ({
  timeline,
  currentTime,
  isPlaying,
  onPlay,
  onPause,
  onSeek,
  resolveAssetUrl,
}: TimelineEditorProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [timelineWidth, setTimelineWidth] = useState(800);

  const visibleTimeline = useMemo(
    () => ({
      ...timeline,
      tracks: timeline.tracks.filter(
        (track) => !HIDDEN_TIMELINE_TRACK_KINDS.has(track.kind)
      ),
    }),
    [timeline]
  );

  const updateWidth = useCallback(() => {
    if (!containerRef.current) {
      return;
    }
    const availableWidth = containerRef.current.clientWidth - 40;
    setTimelineWidth(Math.max(400, availableWidth));
  }, []);

  useEffect(() => {
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [updateWidth]);

  const metrics = useMemo(
    () => calculateTimelineMetrics(timeline, timelineWidth),
    [timeline, timelineWidth]
  );

  return (
    <div className='min-h-full flex flex-col pb-4' ref={containerRef}>
      <div className='bg-muted rounded-lg overflow-hidden flex flex-1'>
        <TrackHeaders
          isPlaying={isPlaying}
          onPlay={onPlay}
          onPause={onPause}
          tracks={visibleTimeline.tracks}
        />
        <TimelineContent
          timeline={visibleTimeline}
          currentTime={currentTime}
          totalContentDuration={metrics.totalContentDuration}
          needsHorizontalScroll={metrics.needsHorizontalScroll}
          effectiveWidth={metrics.effectiveWidth}
          pixelsPerSecond={metrics.pixelsPerSecond}
          onSeek={onSeek}
          resolveAssetUrl={resolveAssetUrl}
        />
      </div>
    </div>
  );
};
