import { TimelineSlider } from './timeline-slider';
import { TimelineTracks } from './timeline-tracks';
import type { TimelineDocument } from '@/types/timeline';

interface TimelineContentProps {
  timeline: TimelineDocument;
  currentTime: number;
  totalContentDuration: number;
  needsHorizontalScroll: boolean;
  effectiveWidth: number;
  pixelsPerSecond: number;
  onSeek: (time: number) => void;
  resolveAssetUrl?: (assetId: string) => string;
}

export const TimelineContent = ({
  timeline,
  currentTime,
  totalContentDuration,
  needsHorizontalScroll,
  effectiveWidth,
  pixelsPerSecond,
  onSeek,
  resolveAssetUrl,
}: TimelineContentProps) => {
  return (
    <div
      className='flex-1'
      style={{
        overflowX: 'scroll',
        overflowY: 'hidden',
        scrollbarWidth: 'thin',
      }}
    >
      <div
        style={{
          width: needsHorizontalScroll ? `${effectiveWidth}px` : '100%',
          minWidth: needsHorizontalScroll ? `${effectiveWidth}px` : 'auto',
        }}
      >
        <TimelineSlider
          currentTime={currentTime}
          totalContentDuration={totalContentDuration}
          needsHorizontalScroll={needsHorizontalScroll}
          effectiveWidth={effectiveWidth}
          onSeek={onSeek}
        />
        <TimelineTracks
          timeline={timeline}
          currentTime={currentTime}
          totalContentDuration={totalContentDuration}
          pixelsPerSecond={pixelsPerSecond}
          onSeek={onSeek}
          resolveAssetUrl={resolveAssetUrl}
        />
      </div>
    </div>
  );
};
