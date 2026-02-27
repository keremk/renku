import { useEffect, useMemo, useRef, useState } from 'react';
import type { TimelineClip, TimelineDocument } from '@/types/timeline';
import { cn } from '@/lib/utils';

interface TimelineTracksProps {
  timeline: TimelineDocument;
  currentTime: number;
  totalContentDuration: number;
  pixelsPerSecond: number;
  onSeek: (time: number) => void;
  resolveAssetUrl?: (assetId: string) => string;
  className?: string;
}

const channelHeight = 48;
const trackHeight = 40;
const VIDEO_FRAME_CAPTURE_TIMEOUT_MS = 15000;
const VIDEO_FRAME_EPSILON_SECONDS = 1 / 60;
const WAVEFORM_SEGMENTS = 128;
const DEFAULT_WAVEFORM_PEAKS = Array.from(
  { length: WAVEFORM_SEGMENTS },
  () => 0.35
);
const COMPOSITION_ASPECT_RATIO = 16 / 9;
const THUMBNAIL_VERTICAL_PADDING_PX = 8;
const HOVER_PREVIEW_WIDTH_PX = 192;
const HOVER_PREVIEW_HEIGHT_PX = 108;
const HOVER_PREVIEW_OFFSET_PX = 12;

interface VideoPreviewTarget {
  clipKey: string;
  src: string;
  endTime: number;
}

interface VideoPreviewFrames {
  start: string;
  end: string;
}

interface WaveformData {
  peaks: number[];
  durationSeconds: number;
}

interface HoverPreviewState {
  src: string;
  x: number;
  y: number;
  label: string;
}

export const TimelineTracks = ({
  timeline,
  currentTime,
  totalContentDuration,
  pixelsPerSecond,
  onSeek,
  resolveAssetUrl,
  className,
}: TimelineTracksProps) => {
  const totalTimelineHeight =
    Math.max(timeline.tracks.length, 1) * channelHeight;
  const [videoPreviewsByClipId, setVideoPreviewsByClipId] = useState<
    Record<string, VideoPreviewFrames>
  >({});
  const [waveformsByAssetId, setWaveformsByAssetId] = useState<
    Record<string, WaveformData>
  >({});
  const [hoverPreview, setHoverPreview] = useState<HoverPreviewState | null>(
    null
  );
  const failedVideoPreviewIdsRef = useRef(new Set<string>());
  const failedWaveformAssetIdsRef = useRef(new Set<string>());

  const handleTimelineClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const time = x / pixelsPerSecond;
    onSeek(Math.max(0, Math.min(time, totalContentDuration)));
  };

  const playheadPercent =
    totalContentDuration > 0
      ? Math.min((currentTime / totalContentDuration) * 100, 100)
      : 0;

  const videoPreviewTargets = useMemo<VideoPreviewTarget[]>(() => {
    if (!resolveAssetUrl) {
      return [];
    }

    return timeline.tracks.flatMap((track) => {
      if (track.kind !== 'Video') {
        return [];
      }

      return track.clips.flatMap((clip) => {
        const props = clip.properties as {
          assetId?: string;
          originalDuration?: number;
        };
        if (typeof props.assetId !== 'string' || props.assetId.length === 0) {
          return [];
        }

        const src = resolveAssetUrl(props.assetId);
        const sourceDuration =
          typeof props.originalDuration === 'number'
            ? props.originalDuration
            : clip.duration;
        const endTime = Math.max(
          sourceDuration - VIDEO_FRAME_EPSILON_SECONDS,
          0
        );

        return [
          {
            clipKey: getClipPreviewKey(track.id, clip.id),
            src,
            endTime,
          },
        ];
      });
    });
  }, [resolveAssetUrl, timeline.tracks]);

  useEffect(() => {
    if (videoPreviewTargets.length === 0) {
      return;
    }

    const pendingTargets = videoPreviewTargets.filter((target) => {
      if (failedVideoPreviewIdsRef.current.has(target.clipKey)) {
        return false;
      }
      return !videoPreviewsByClipId[target.clipKey];
    });

    if (pendingTargets.length === 0) {
      return;
    }

    let cancelled = false;

    void Promise.all(
      pendingTargets.map(async (target) => {
        try {
          const start = await extractVideoFrameDataUrl(target.src, 0);
          const end =
            target.endTime <= 0.05
              ? start
              : await extractVideoFrameDataUrl(target.src, target.endTime);

          return {
            clipKey: target.clipKey,
            frames: {
              start,
              end,
            },
          };
        } catch {
          failedVideoPreviewIdsRef.current.add(target.clipKey);
          return null;
        }
      })
    ).then((loaded) => {
      if (cancelled) {
        return;
      }

      setVideoPreviewsByClipId((current) => {
        const next = { ...current };
        let changed = false;

        for (const entry of loaded) {
          if (!entry) {
            continue;
          }
          if (next[entry.clipKey]) {
            continue;
          }

          next[entry.clipKey] = entry.frames;
          changed = true;
        }

        return changed ? next : current;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [videoPreviewTargets, videoPreviewsByClipId]);

  const waveformAssetIds = useMemo(() => {
    if (!resolveAssetUrl) {
      return [];
    }

    const assetIds = new Set<string>();

    for (const track of timeline.tracks) {
      if (track.kind !== 'Audio' && track.kind !== 'Music') {
        continue;
      }

      for (const clip of track.clips) {
        const assetId = getClipAssetId(clip);
        if (assetId) {
          assetIds.add(assetId);
        }
      }
    }

    return Array.from(assetIds);
  }, [resolveAssetUrl, timeline.tracks]);

  useEffect(() => {
    if (!resolveAssetUrl || waveformAssetIds.length === 0) {
      return;
    }

    const pendingAssetIds = waveformAssetIds.filter((assetId) => {
      if (failedWaveformAssetIdsRef.current.has(assetId)) {
        return false;
      }
      return !waveformsByAssetId[assetId];
    });

    if (pendingAssetIds.length === 0) {
      return;
    }

    let cancelled = false;

    void Promise.all(
      pendingAssetIds.map(async (assetId) => {
        try {
          const src = resolveAssetUrl(assetId);
          const waveform = await extractWaveformData(src, WAVEFORM_SEGMENTS);
          return {
            assetId,
            waveform,
          };
        } catch {
          failedWaveformAssetIdsRef.current.add(assetId);
          return null;
        }
      })
    ).then((loaded) => {
      if (cancelled) {
        return;
      }

      setWaveformsByAssetId((current) => {
        const next = { ...current };
        let changed = false;

        for (const entry of loaded) {
          if (!entry) {
            continue;
          }
          if (next[entry.assetId]) {
            continue;
          }

          next[entry.assetId] = entry.waveform;
          changed = true;
        }

        return changed ? next : current;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [resolveAssetUrl, waveformAssetIds, waveformsByAssetId]);

  const handleThumbnailHover = (
    event: React.MouseEvent<HTMLElement>,
    src: string,
    label: string
  ) => {
    setHoverPreview({
      src,
      x: event.clientX,
      y: event.clientY,
      label,
    });
  };

  const handleThumbnailLeave = () => {
    setHoverPreview(null);
  };

  const hoverPreviewStyle = getHoverPreviewStyle(hoverPreview);

  return (
    <>
      <div
        className={cn('overflow-y-auto', className)}
        style={{ height: `${totalTimelineHeight + 32}px` }}
      >
        <div className='relative p-4'>
          <div className='px-2'>
            <div
              className='relative cursor-pointer select-none w-full'
              style={{ height: `${totalTimelineHeight}px` }}
              onClick={handleTimelineClick}
            >
              {timeline.tracks.map((track, index) => (
                <div
                  key={`bg-${track.id}-${index}`}
                  className='absolute inset-x-0 border-b border-border/30'
                  style={{
                    top: `${index * channelHeight}px`,
                    height: `${channelHeight}px`,
                  }}
                />
              ))}

              {timeline.tracks.map((track, index) =>
                track.clips
                  .slice()
                  .sort((a, b) => a.startTime - b.startTime)
                  .map((clip) => (
                    <div
                      key={`${track.id}-${clip.id}`}
                      className={cn(
                        'absolute rounded transition-all border border-white/20 text-white overflow-hidden',
                        getClipColor(track.kind)
                      )}
                      style={getClipStyle(clip, index, totalContentDuration)}
                      title={`${track.kind} ${formatClipTimeRange(clip)}`}
                    >
                      {renderClipVisual({
                        trackKind: track.kind,
                        clip,
                        clipWidthPx: Math.max(
                          clip.duration * pixelsPerSecond,
                          12
                        ),
                        resolveAssetUrl,
                        videoPreview:
                          videoPreviewsByClipId[
                            getClipPreviewKey(track.id, clip.id)
                          ],
                        waveformData:
                          waveformsByAssetId[getClipAssetId(clip) ?? ''] ??
                          null,
                        onThumbnailHover: handleThumbnailHover,
                        onThumbnailLeave: handleThumbnailLeave,
                      })}
                      {clip.duration * pixelsPerSecond >= 110 && (
                        <div className='absolute bottom-0.5 right-1 text-[10px] font-mono text-white/80 drop-shadow'>
                          {formatClipTimeRange(clip)}
                        </div>
                      )}
                    </div>
                  ))
              )}

              <div
                className='absolute top-0 w-0.5 bg-red-500 z-20 pointer-events-none inset-y-0'
                style={{ left: `${playheadPercent}%` }}
              />
            </div>
          </div>
        </div>
      </div>
      {hoverPreview && hoverPreviewStyle && (
        <div
          className='fixed z-[120] pointer-events-none'
          style={hoverPreviewStyle}
        >
          <div className='w-48 aspect-video rounded-md overflow-hidden border border-white/20 bg-black/85 shadow-2xl'>
            <img
              src={hoverPreview.src}
              alt=''
              className='w-full h-full object-contain'
              draggable={false}
            />
          </div>
          <div className='mt-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white/90 w-max'>
            {hoverPreview.label}
          </div>
        </div>
      )}
    </>
  );
};

function renderClipVisual(args: {
  trackKind: string;
  clip: TimelineClip;
  clipWidthPx: number;
  resolveAssetUrl?: (assetId: string) => string;
  videoPreview?: VideoPreviewFrames;
  waveformData: WaveformData | null;
  onThumbnailHover: (
    event: React.MouseEvent<HTMLElement>,
    src: string,
    label: string
  ) => void;
  onThumbnailLeave: () => void;
}) {
  const {
    trackKind,
    clip,
    clipWidthPx,
    resolveAssetUrl,
    videoPreview,
    waveformData,
    onThumbnailHover,
    onThumbnailLeave,
  } = args;

  if (trackKind === 'Image') {
    const imageEffects = getImageEffectThumbnails(clip);
    if (imageEffects.length === 0 || !resolveAssetUrl) {
      return <FallbackClipBody label='Image' />;
    }

    const maxThumbnails = Math.min(
      imageEffects.length,
      getImageThumbnailCount(clipWidthPx)
    );
    const visibleThumbnails = selectTimedImageThumbnails(
      imageEffects,
      maxThumbnails
    );
    const hiddenAssetCount = imageEffects.length - visibleThumbnails.length;
    const thumbnailWidthPx = getThumbnailWidthPx(clipWidthPx, maxThumbnails);
    const innerTrackWidthPx = Math.max(clipWidthPx - 8, 12);

    return (
      <div className='absolute inset-0 px-1 py-1'>
        <div className='relative h-full w-full overflow-hidden'>
          {visibleThumbnails.map((thumbnail) => {
            const src = resolveAssetUrl(thumbnail.assetId);
            const leftPercent = getThumbnailLeftPercent(
              thumbnail.startRatio,
              innerTrackWidthPx,
              thumbnailWidthPx
            );

            return (
              <div
                key={`${clip.id}-${thumbnail.assetId}-${thumbnail.effectIndex}`}
                className='absolute top-0 bottom-0 rounded-[4px] overflow-hidden border border-white/20 bg-black/25 transition-transform hover:scale-105'
                style={{
                  width: `${thumbnailWidthPx}px`,
                  left: `${leftPercent}%`,
                }}
                onMouseEnter={(event) => {
                  onThumbnailHover(
                    event,
                    src,
                    `Image ${thumbnail.effectIndex + 1}`
                  );
                }}
                onMouseMove={(event) => {
                  onThumbnailHover(
                    event,
                    src,
                    `Image ${thumbnail.effectIndex + 1}`
                  );
                }}
                onMouseLeave={onThumbnailLeave}
              >
                <img
                  src={src}
                  alt=''
                  className='w-full h-full object-contain bg-black/55'
                  loading='lazy'
                />
              </div>
            );
          })}
          {hiddenAssetCount > 0 && (
            <div className='absolute top-0.5 right-1 rounded bg-black/65 px-1 text-[10px] font-semibold text-white'>
              +{hiddenAssetCount}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (trackKind === 'Video') {
    const showStartAndEnd = clipWidthPx >= 220;
    const thumbnailWidthPx = getThumbnailWidthPx(
      clipWidthPx,
      showStartAndEnd ? 2 : 1
    );

    return (
      <div className='absolute inset-0 px-1 py-1'>
        <div className='relative h-full w-full'>
          <VideoFrameThumbnail
            frameSrc={videoPreview?.start ?? null}
            label='S'
            align='start'
            widthPx={thumbnailWidthPx}
            onThumbnailHover={onThumbnailHover}
            onThumbnailLeave={onThumbnailLeave}
          />
          {showStartAndEnd && (
            <VideoFrameThumbnail
              frameSrc={videoPreview?.end ?? null}
              label='E'
              align='end'
              widthPx={thumbnailWidthPx}
              onThumbnailHover={onThumbnailHover}
              onThumbnailLeave={onThumbnailLeave}
            />
          )}
        </div>
      </div>
    );
  }

  if (trackKind === 'Audio' || trackKind === 'Music') {
    const pointCount = getWaveformPointCount(clipWidthPx, trackKind);
    const sampledPeaks = sampleWaveformForClip(
      waveformData,
      clip,
      trackKind,
      pointCount
    );

    return (
      <div className='absolute inset-0 px-1.5 py-1'>
        {trackKind === 'Music' ? (
          <MusicWaveform peaks={sampledPeaks} />
        ) : (
          <NarrationWaveform peaks={sampledPeaks} clipId={clip.id} />
        )}
      </div>
    );
  }

  return <FallbackClipBody label={trackKind} />;
}

function FallbackClipBody({ label }: { label: string }) {
  return (
    <div className='absolute inset-0 px-2 flex items-center text-[11px] font-medium text-white/90'>
      {label}
    </div>
  );
}

function VideoFrameThumbnail({
  frameSrc,
  label,
  align,
  widthPx,
  onThumbnailHover,
  onThumbnailLeave,
}: {
  frameSrc: string | null;
  label: 'S' | 'E';
  align: 'start' | 'end';
  widthPx: number;
  onThumbnailHover: (
    event: React.MouseEvent<HTMLElement>,
    src: string,
    label: string
  ) => void;
  onThumbnailLeave: () => void;
}) {
  return (
    <div
      className={cn(
        'absolute top-0 bottom-0 rounded-[4px] overflow-hidden border border-white/20 bg-black/25 transition-transform hover:scale-105',
        align === 'start' ? 'left-0' : 'right-0'
      )}
      style={{ width: `${widthPx}px` }}
      onMouseLeave={onThumbnailLeave}
    >
      {frameSrc ? (
        <img
          src={frameSrc}
          alt=''
          className='w-full h-full object-contain bg-black/55'
          loading='lazy'
          onMouseEnter={(event) => {
            onThumbnailHover(
              event,
              frameSrc,
              label === 'S' ? 'Video start frame' : 'Video end frame'
            );
          }}
          onMouseMove={(event) => {
            onThumbnailHover(
              event,
              frameSrc,
              label === 'S' ? 'Video start frame' : 'Video end frame'
            );
          }}
        />
      ) : (
        <div className='w-full h-full bg-black/35' />
      )}
      <div className='absolute top-0.5 left-1 text-[9px] font-semibold text-white/90 drop-shadow'>
        {label}
      </div>
    </div>
  );
}

function MusicWaveform({ peaks }: { peaks: number[] }) {
  const enhancedPeaks = emphasizeMusicPeaks(peaks);

  return (
    <svg
      className='w-full h-full'
      viewBox={`0 0 ${enhancedPeaks.length} 100`}
      preserveAspectRatio='none'
      aria-hidden='true'
    >
      <line
        x1={0}
        x2={Math.max(0, enhancedPeaks.length)}
        y1={50}
        y2={50}
        stroke='rgba(255, 255, 255, 0.2)'
        strokeWidth={0.7}
      />
      {enhancedPeaks.map((peak, index) => {
        const amplitude = 6 + peak * 43;
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
            stroke='rgba(255, 255, 255, 0.92)'
            strokeWidth={0.72}
            strokeLinecap='round'
          />
        );
      })}
    </svg>
  );
}

function NarrationWaveform({
  peaks,
  clipId,
}: {
  peaks: number[];
  clipId: string;
}) {
  return (
    <svg
      className='w-full h-full'
      viewBox={`0 0 ${peaks.length} 100`}
      preserveAspectRatio='none'
      aria-hidden='true'
    >
      {peaks.map((peak, index) => {
        const amplitude = 5 + peak * 40;
        const yTop = 50 - amplitude;
        const yBottom = 50 + amplitude;
        const x = index + 0.5;

        return (
          <line
            key={`${clipId}-wave-${index}`}
            x1={x}
            x2={x}
            y1={yTop}
            y2={yBottom}
            stroke='rgba(255, 255, 255, 0.9)'
            strokeWidth={0.9}
            strokeLinecap='round'
          />
        );
      })}
    </svg>
  );
}

function getImageEffectThumbnails(clip: TimelineClip): Array<{
  assetId: string;
  effectIndex: number;
  startRatio: number;
}> {
  const clipProps = clip.properties as {
    effects?: Array<{ assetId?: string }>;
  };
  if (!Array.isArray(clipProps.effects)) {
    return [];
  }

  const effectCount = clipProps.effects.length;

  return clipProps.effects
    .map((effect, effectIndex) => {
      const startRatio = effectCount <= 0 ? 0 : effectIndex / effectCount;

      return {
        assetId: effect.assetId,
        effectIndex,
        startRatio,
      };
    })
    .filter(
      (
        effect
      ): effect is {
        assetId: string;
        effectIndex: number;
        startRatio: number;
      } => {
        return typeof effect.assetId === 'string' && effect.assetId.length > 0;
      }
    );
}

function getClipAssetId(clip: TimelineClip): string | null {
  const clipProps = clip.properties as {
    assetId?: string;
  };
  if (typeof clipProps.assetId !== 'string' || clipProps.assetId.length === 0) {
    return null;
  }
  return clipProps.assetId;
}

function getClipPreviewKey(trackId: string, clipId: string): string {
  return `${trackId}:${clipId}`;
}

function selectTimedImageThumbnails(
  effects: Array<{ assetId: string; effectIndex: number; startRatio: number }>,
  maxThumbnails: number
): Array<{ assetId: string; effectIndex: number; startRatio: number }> {
  if (effects.length <= maxThumbnails) {
    return effects;
  }

  const targetRatios =
    maxThumbnails <= 1 ? [0.5] : maxThumbnails === 2 ? [0, 1] : [0, 0.5, 1];

  const selected = new Set<number>();

  for (const target of targetRatios) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < effects.length; i += 1) {
      if (selected.has(i)) {
        continue;
      }

      const distance = Math.abs(effects[i].startRatio - target);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0) {
      selected.add(bestIndex);
    }
  }

  return Array.from(selected)
    .map((index) => effects[index])
    .sort((a, b) => a.startRatio - b.startRatio);
}

function getImageThumbnailCount(clipWidthPx: number): number {
  if (clipWidthPx < 140) {
    return 1;
  }
  if (clipWidthPx < 240) {
    return 2;
  }
  return 3;
}

function getThumbnailWidthPx(
  clipWidthPx: number,
  thumbnailCount: number
): number {
  if (thumbnailCount <= 0) {
    return 12;
  }

  const gapWidth = Math.max(0, thumbnailCount - 1) * 4;
  const availableWidth = Math.max(clipWidthPx - 8 - gapWidth, 12);
  const widthPerThumbnail = Math.floor(availableWidth / thumbnailCount);
  const thumbnailHeightPx = trackHeight - THUMBNAIL_VERTICAL_PADDING_PX;
  const preferredWidth = Math.round(
    thumbnailHeightPx * COMPOSITION_ASPECT_RATIO
  );

  return Math.max(12, Math.min(preferredWidth, widthPerThumbnail));
}

function getThumbnailLeftPercent(
  startRatio: number,
  innerTrackWidthPx: number,
  thumbnailWidthPx: number
): number {
  const thumbnailWidthPercent =
    (thumbnailWidthPx / Math.max(innerTrackWidthPx, 1)) * 100;
  const unclampedPercent = startRatio * 100;

  return clamp(unclampedPercent, 0, 100 - thumbnailWidthPercent);
}

function getWaveformPointCount(clipWidthPx: number, trackKind: string): number {
  if (trackKind === 'Music') {
    return Math.max(40, Math.min(180, Math.round(clipWidthPx / 4)));
  }

  return Math.max(28, Math.min(260, Math.round(clipWidthPx / 2.8)));
}

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

function sampleWaveformForClip(
  waveform: WaveformData | null,
  clip: TimelineClip,
  trackKind: string,
  pointCount: number
): number[] {
  if (!waveform) {
    return sampleWaveformPeaks(DEFAULT_WAVEFORM_PEAKS, pointCount);
  }

  if (waveform.durationSeconds <= 0 || waveform.peaks.length === 0) {
    return sampleWaveformPeaks(DEFAULT_WAVEFORM_PEAKS, pointCount);
  }

  const clipDuration = Math.max(clip.duration, 0.001);
  const sourceDuration = waveform.durationSeconds;
  const loop =
    trackKind === 'Music' &&
    (clip.properties as { play?: 'loop' | 'no-loop' }).play === 'loop';

  const mappedPeaks = Array.from({ length: pointCount }, (_, pointIndex) => {
    const clipRatio = pointCount <= 1 ? 0 : pointIndex / (pointCount - 1);
    const clipTime = clipRatio * clipDuration;

    let sourceTime = clipTime;
    if (loop) {
      sourceTime = clipTime % sourceDuration;
    } else {
      if (clipTime >= sourceDuration) {
        return 0;
      }
      sourceTime = clipTime;
    }

    const sourceRatio = clamp(sourceTime / sourceDuration, 0, 1);
    return samplePeakAtRatio(waveform.peaks, sourceRatio);
  });

  return sampleWaveformPeaks(mappedPeaks, pointCount);
}

function samplePeakAtRatio(peaks: number[], ratio: number): number {
  if (peaks.length === 0) {
    return 0.35;
  }

  if (peaks.length === 1) {
    return peaks[0] ?? 0.35;
  }

  const normalizedRatio = clamp(ratio, 0, 1);
  const position = normalizedRatio * (peaks.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(peaks.length - 1, Math.ceil(position));
  const lower = peaks[lowerIndex] ?? 0;
  const upper = peaks[upperIndex] ?? lower;
  const mix = position - lowerIndex;

  return lower + (upper - lower) * mix;
}

function emphasizeMusicPeaks(peaks: number[]): number[] {
  if (peaks.length <= 2) {
    return peaks;
  }

  return peaks.map((peak, index) => {
    const previous = peaks[index - 1] ?? peak;
    const next = peaks[index + 1] ?? peak;
    const localAverage = (previous + peak + next) / 3;
    const localDelta = Math.abs(peak - localAverage);
    const boosted = peak * 0.7 + localDelta * 1.9;
    return clamp(boosted, 0, 1);
  });
}

function getHoverPreviewStyle(hoverPreview: HoverPreviewState | null) {
  if (!hoverPreview || typeof window === 'undefined') {
    return null;
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const maxLeft = Math.max(8, viewportWidth - HOVER_PREVIEW_WIDTH_PX - 8);
  const maxTop = Math.max(8, viewportHeight - HOVER_PREVIEW_HEIGHT_PX - 34);

  const left = clamp(hoverPreview.x + HOVER_PREVIEW_OFFSET_PX, 8, maxLeft);
  const top = clamp(
    hoverPreview.y - HOVER_PREVIEW_HEIGHT_PX - HOVER_PREVIEW_OFFSET_PX,
    8,
    maxTop
  );

  return {
    left: `${left}px`,
    top: `${top}px`,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatClipTimeRange(clip: TimelineClip): string {
  const start = formatSeconds(clip.startTime);
  const end = formatSeconds(clip.startTime + clip.duration);
  return `${start}-${end}`;
}

function formatSeconds(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainderSeconds = safeSeconds % 60;
  return `${minutes}:${remainderSeconds.toString().padStart(2, '0')}`;
}

async function extractVideoFrameDataUrl(
  src: string,
  atSeconds: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';

    let settled = false;

    const timeout = setTimeout(() => {
      fail(new Error(`Timed out capturing video frame from ${src}`));
    }, VIDEO_FRAME_CAPTURE_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('error', handleError);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };

    const succeed = (frameDataUrl: string) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(frameDataUrl);
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const capture = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (width <= 0 || height <= 0) {
        fail(new Error(`Invalid video dimensions for ${src}`));
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext('2d');
      if (!context) {
        fail(
          new Error('Could not create canvas context for video frame capture')
        );
        return;
      }

      context.drawImage(video, 0, 0, width, height);
      succeed(canvas.toDataURL('image/jpeg', 0.8));
    };

    const handleSeeked = () => {
      capture();
    };

    const handleLoadedData = () => {
      const safeDuration = Number.isFinite(video.duration)
        ? video.duration
        : atSeconds;
      const boundedTime = Math.min(
        Math.max(atSeconds, 0),
        Math.max(safeDuration - VIDEO_FRAME_EPSILON_SECONDS, 0)
      );

      if (boundedTime <= 0.01) {
        capture();
        return;
      }

      video.currentTime = boundedTime;
    };

    const handleError = () => {
      fail(new Error(`Failed loading video for frame capture: ${src}`));
    };

    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('error', handleError);
    video.src = src;
    video.load();
  });
}

async function extractWaveformData(
  src: string,
  segments: number
): Promise<WaveformData> {
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Failed loading audio waveform source: ${src}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const AudioContextClass =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error('AudioContext is not available in this browser');
  }

  const audioContext = new AudioContextClass();
  try {
    const audioBuffer = await audioContext.decodeAudioData(
      arrayBuffer.slice(0)
    );
    return {
      peaks: buildWaveformPeaks(audioBuffer, segments),
      durationSeconds: audioBuffer.duration,
    };
  } finally {
    void audioContext.close();
  }
}

function buildWaveformPeaks(
  audioBuffer: AudioBuffer,
  segments: number
): number[] {
  const channelCount = audioBuffer.numberOfChannels;
  if (channelCount <= 0 || segments <= 0) {
    return DEFAULT_WAVEFORM_PEAKS;
  }

  const channels = Array.from({ length: channelCount }, (_, i) =>
    audioBuffer.getChannelData(i)
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
  return smoothedPeaks.map((peak) => Math.max(0.05, peak / maxPeak));
}

const getClipColor = (kind: string) => {
  switch (kind) {
    case 'Image':
      return 'bg-indigo-600/80 hover:bg-indigo-500';
    case 'Audio':
      return 'bg-purple-600/80 hover:bg-purple-500';
    case 'Music':
      return 'bg-emerald-600/80 hover:bg-emerald-500';
    case 'Video':
      return 'bg-blue-600/80 hover:bg-blue-500';
    case 'Captions':
      return 'bg-amber-600/80 hover:bg-amber-500';
    default:
      return 'bg-slate-600/80 hover:bg-slate-500';
  }
};

const getClipStyle = (
  clip: TimelineClip,
  trackIndex: number,
  totalContentDuration: number
) => {
  const leftPercent =
    totalContentDuration > 0
      ? (clip.startTime / totalContentDuration) * 100
      : 0;
  const widthPercent =
    totalContentDuration > 0 ? (clip.duration / totalContentDuration) * 100 : 0;
  const verticalPadding = (channelHeight - trackHeight) / 2;
  const top = trackIndex * channelHeight + verticalPadding;

  return {
    left: `${leftPercent}%`,
    top: `${top}px`,
    width: `${Math.max(widthPercent, 0.5)}%`,
    height: `${trackHeight}px`,
  };
};
