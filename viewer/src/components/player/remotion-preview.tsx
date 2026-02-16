import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Player,
  type PlayerRef,
  type CallbackListener,
} from '@remotion/player';
import type { TimelineDocument, AssetMap } from '@gorenku/compositions/browser';
import { DocumentaryComposition } from '@gorenku/compositions/browser';
import { buildBlueprintAssetUrl } from '@/data/blueprint-client';
import {
  fitWithinBounds,
  parseAspectRatio,
  resolveCompositionDimensions,
  type DetectedVisualDimensions,
  type PreviewDimensions,
} from './preview-sizing';

interface RemotionPreviewProps {
  movieId: string;
  timeline: TimelineDocument;
  currentTime: number;
  isPlaying: boolean;
  onSeek?: (time: number) => void;
  onPlay?: () => void;
  onPause?: () => void;
  aspectRatio?: string;
  /** Blueprint folder for asset fetching (required). */
  blueprintFolder: string;
}

const FPS = 30;
const DIMENSION_DETECTION_TIMEOUT_MS = 5000;

export const RemotionPreview = ({
  movieId,
  timeline,
  currentTime,
  isPlaying,
  onSeek,
  onPlay,
  onPause,
  aspectRatio,
  blueprintFolder,
}: RemotionPreviewProps) => {
  const playerRef = useRef<PlayerRef>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const lastTimeRef = useRef<number>(currentTime);
  const onSeekRef = useRef(onSeek);
  const onPlayRef = useRef(onPlay);
  const onPauseRef = useRef(onPause);
  const [detectedVisualDimensions, setDetectedVisualDimensions] =
    useState<DetectedVisualDimensions | null>(null);
  const [viewportDimensions, setViewportDimensions] =
    useState<PreviewDimensions>({
      width: 0,
      height: 0,
    });

  useEffect(() => {
    onSeekRef.current = onSeek;
    onPlayRef.current = onPlay;
    onPauseRef.current = onPause;
  }, [onSeek, onPlay, onPause]);

  const explicitAspectDimensions = useMemo(() => {
    if (!aspectRatio) {
      return null;
    }
    return parseAspectRatio(aspectRatio);
  }, [aspectRatio]);

  const durationSeconds = Math.max(timeline.duration, 1);
  const durationInFrames = Math.max(1, Math.round(durationSeconds * FPS));
  const safeCurrentTime = Math.max(
    0,
    Math.min(currentTime, durationInFrames / FPS)
  );

  const assetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const track of timeline.tracks ?? []) {
      for (const clip of track.clips ?? []) {
        const props = (clip as { properties?: Record<string, unknown> })
          .properties;
        const assetId = props?.assetId;
        if (typeof assetId === 'string' && assetId.length > 0) {
          ids.add(assetId);
        }
        const effects = props?.effects;
        if (Array.isArray(effects)) {
          for (const effect of effects) {
            const effectAsset = (effect as { assetId?: string }).assetId;
            if (typeof effectAsset === 'string' && effectAsset.length > 0) {
              ids.add(effectAsset);
            }
          }
        }
      }
    }
    return Array.from(ids);
  }, [timeline.tracks]);

  const visualAssetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const track of timeline.tracks ?? []) {
      if (track.kind === 'Video') {
        for (const clip of track.clips ?? []) {
          const props = (clip as { properties?: Record<string, unknown> })
            .properties;
          const assetId = props?.assetId;
          if (typeof assetId === 'string' && assetId.length > 0) {
            ids.add(assetId);
          }
        }
        continue;
      }

      if (track.kind === 'Image') {
        for (const clip of track.clips ?? []) {
          const props = (clip as { properties?: Record<string, unknown> })
            .properties;
          const effects = props?.effects;
          if (!Array.isArray(effects)) {
            continue;
          }
          for (const effect of effects) {
            const effectAssetId = (effect as { assetId?: string }).assetId;
            if (typeof effectAssetId === 'string' && effectAssetId.length > 0) {
              ids.add(effectAssetId);
            }
          }
        }
      }
    }
    return Array.from(ids);
  }, [timeline.tracks]);

  const firstVisualAssetId = visualAssetIds[0] ?? null;

  const compositionDimensions = useMemo<PreviewDimensions>(() => {
    return resolveCompositionDimensions({
      explicitAspectDimensions,
      detectedVisualDimensions,
      firstVisualAssetId,
    });
  }, [detectedVisualDimensions, explicitAspectDimensions, firstVisualAssetId]);

  const { width, height } = compositionDimensions;

  // Build asset URL using the blueprints API
  const getAssetUrl = useMemo(() => {
    return (assetId: string) => {
      return buildBlueprintAssetUrl(blueprintFolder, movieId, assetId);
    };
  }, [blueprintFolder, movieId]);

  const assetMap = useMemo<AssetMap>(() => {
    const map: AssetMap = {};
    for (const assetId of assetIds) {
      map[assetId] = getAssetUrl(assetId);
    }
    return map;
  }, [assetIds, getAssetUrl]);

  useEffect(() => {
    if (explicitAspectDimensions || !firstVisualAssetId) {
      return;
    }

    let cancelled = false;
    const assetUrl = getAssetUrl(firstVisualAssetId);

    void readMediaDimensions(assetUrl)
      .then((dimensions) => {
        if (!cancelled) {
          setDetectedVisualDimensions({
            assetId: firstVisualAssetId,
            dimensions,
          });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [explicitAspectDimensions, firstVisualAssetId, getAssetUrl]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const updateViewportDimensions = () => {
      const rect = viewport.getBoundingClientRect();
      const nextWidth = Math.round(rect.width);
      const nextHeight = Math.round(rect.height);
      setViewportDimensions((previous) => {
        if (previous.width === nextWidth && previous.height === nextHeight) {
          return previous;
        }
        return {
          width: nextWidth,
          height: nextHeight,
        };
      });
    };

    updateViewportDimensions();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateViewportDimensions);
      return () => {
        window.removeEventListener('resize', updateViewportDimensions);
      };
    }

    const observer = new ResizeObserver(() => {
      updateViewportDimensions();
    });
    observer.observe(viewport);

    return () => {
      observer.disconnect();
    };
  }, []);

  const playerDimensions = useMemo(
    () => fitWithinBounds(compositionDimensions, viewportDimensions),
    [compositionDimensions, viewportDimensions]
  );

  const playerStyle = useMemo<CSSProperties>(() => {
    if (playerDimensions.width <= 0 || playerDimensions.height <= 0) {
      return {
        width: '100%',
        height: '100%',
      };
    }

    return {
      width: playerDimensions.width,
      height: playerDimensions.height,
    };
  }, [playerDimensions]);

  // Prefetch media aggressively to reduce clip boundary stalls
  useEffect(() => {
    const controller = new AbortController();
    const prefetch = async () => {
      await Promise.all(
        assetIds.map(async (assetId) => {
          try {
            const resp = await fetch(getAssetUrl(assetId), {
              method: 'GET',
              signal: controller.signal,
            });
            // Read the body to ensure it is cached; ignore contents
            await resp.arrayBuffer();
          } catch {
            // best effort prefetch
          }
        })
      );
    };
    void prefetch();
    return () => controller.abort();
  }, [assetIds, getAssetUrl]);

  useEffect(() => {
    if (!playerRef.current) {
      return;
    }
    if (Math.abs(safeCurrentTime - lastTimeRef.current) > 0.05) {
      playerRef.current.seekTo(Math.round(safeCurrentTime * FPS));
      lastTimeRef.current = safeCurrentTime;
    }
  }, [safeCurrentTime]);

  useEffect(() => {
    if (!playerRef.current) {
      return;
    }
    if (isPlaying) {
      playerRef.current.play();
    } else {
      playerRef.current.pause();
    }
  }, [isPlaying]);

  useEffect(() => {
    const attachListeners = () => {
      const player = playerRef.current;
      if (!player) {
        return null;
      }

      const handleFrameUpdate: CallbackListener<'frameupdate'> = (event) => {
        const time = event.detail.frame / FPS;
        if (onSeekRef.current && Math.abs(time - lastTimeRef.current) > 0.01) {
          lastTimeRef.current = time;
          onSeekRef.current(time);
        }
      };

      const handlePlay = () => {
        onPlayRef.current?.();
      };

      const handlePause = () => {
        onPauseRef.current?.();
      };

      player.addEventListener('frameupdate', handleFrameUpdate);
      player.addEventListener('play', handlePlay);
      player.addEventListener('pause', handlePause);

      return () => {
        player.removeEventListener('frameupdate', handleFrameUpdate);
        player.removeEventListener('play', handlePlay);
        player.removeEventListener('pause', handlePause);
      };
    };

    const cleanup = attachListeners();
    if (cleanup) {
      return cleanup;
    }

    const interval = setInterval(() => {
      const maybeCleanup = attachListeners();
      if (maybeCleanup) {
        clearInterval(interval);
      }
    }, 100);

    return () => clearInterval(interval);
  }, []);

  return (
    <div
      ref={viewportRef}
      className='bg-muted dark:bg-black rounded-xl overflow-hidden flex items-center justify-center h-full w-full'
    >
      <Player
        key={timeline.id}
        ref={playerRef}
        component={DocumentaryComposition as never}
        inputProps={{ timeline, assets: assetMap, width, height, fps: FPS }}
        durationInFrames={durationInFrames}
        fps={FPS}
        compositionWidth={width}
        compositionHeight={height}
        style={playerStyle}
        controls={false}
        loop={false}
        showVolumeControls={false}
        numberOfSharedAudioTags={0}
        acknowledgeRemotionLicense
      />
    </div>
  );
};

async function readMediaDimensions(url: string): Promise<PreviewDimensions> {
  try {
    return await readVideoDimensions(url);
  } catch {
    return readImageDimensions(url);
  }
}

function readVideoDimensions(url: string): Promise<PreviewDimensions> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out loading video metadata: ${url}`));
    }, DIMENSION_DETECTION_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('error', handleError);
      video.removeAttribute('src');
      video.load();
    };

    const handleLoadedMetadata = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      cleanup();

      if (width <= 0 || height <= 0) {
        reject(new Error(`Invalid video dimensions: ${url}`));
        return;
      }

      resolve({ width, height });
    };

    const handleError = () => {
      cleanup();
      reject(new Error(`Failed loading video metadata: ${url}`));
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('error', handleError);
    video.src = url;
  });
}

function readImageDimensions(url: string): Promise<PreviewDimensions> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out loading image metadata: ${url}`));
    }, DIMENSION_DETECTION_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      image.src = '';
    };

    image.onload = () => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      cleanup();

      if (width <= 0 || height <= 0) {
        reject(new Error(`Invalid image dimensions: ${url}`));
        return;
      }

      resolve({ width, height });
    };

    image.onerror = () => {
      cleanup();
      reject(new Error(`Failed loading image metadata: ${url}`));
    };

    image.src = url;
  });
}
