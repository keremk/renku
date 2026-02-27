import { AbsoluteFill, Audio, Sequence, useVideoConfig } from 'remotion';
import type {
  AssetMap,
  AudioTrack,
  ImageTrack,
  MusicTrack,
  TimelineDocument,
  TimelineTrack,
  VideoTrack,
} from '../../types/timeline.js';
import { KenBurnsClip } from './KenBurnsClip.js';
import { VideoClipSequence } from './VideoClipSequence.js';

export interface DocumentaryCompositionProps {
  timeline: TimelineDocument;
  assets: AssetMap;
  width?: number;
  height?: number;
  fps?: number;
}

const secondsToStartFrame = (seconds: number, fps: number) =>
  Math.max(0, Math.round(seconds * fps));
const secondsToDurationFrames = (seconds: number, fps: number) =>
  Math.max(1, Math.round(seconds * fps));

export const DocumentaryComposition = ({
  timeline,
  assets,
}: DocumentaryCompositionProps) => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {timeline.tracks.map((track) => renderTrack(track, assets, fps))}
    </AbsoluteFill>
  );
};

function renderTrack(track: TimelineTrack, assets: AssetMap, fps: number) {
  if (isImageTrack(track)) {
    return renderImageTrack(track, assets, fps);
  }
  if (isAudioTrack(track)) {
    return renderAudioTrack(track, assets, fps);
  }
  if (isMusicTrack(track)) {
    return renderMusicTrack(track, assets, fps);
  }
  if (isVideoTrack(track)) {
    return renderVideoTrack(track, assets, fps);
  }
  return null;
}

function isImageTrack(track: TimelineTrack): track is ImageTrack {
  return track.kind === 'Image';
}

function isAudioTrack(track: TimelineTrack): track is AudioTrack {
  return track.kind === 'Audio';
}

function isMusicTrack(track: TimelineTrack): track is MusicTrack {
  return track.kind === 'Music';
}

function isVideoTrack(track: TimelineTrack): track is VideoTrack {
  return track.kind === 'Video';
}

function renderImageTrack(track: ImageTrack, assets: AssetMap, fps: number) {
  return track.clips.map((clip) => {
    const from = secondsToStartFrame(clip.startTime, fps);
    const durationInFrames = secondsToDurationFrames(clip.duration, fps);
    return (
      <Sequence key={clip.id} from={from} durationInFrames={durationInFrames}>
        <KenBurnsClip clip={clip} assets={assets} />
      </Sequence>
    );
  });
}

function renderAudioTrack(track: AudioTrack, assets: AssetMap, fps: number) {
  return track.clips.map((clip) => {
    const assetId = clip.properties.assetId;
    const src = assets[assetId];
    if (!assetId || !src) {
      return null;
    }
    const from = secondsToStartFrame(clip.startTime, fps);
    const durationInFrames = secondsToDurationFrames(clip.duration, fps);
    const volume = clip.properties.volume ?? 1;
    const premountFor = Math.max(1, Math.round(fps * 0.5));

    return (
      <Sequence
        key={clip.id}
        from={from}
        durationInFrames={durationInFrames}
        premountFor={premountFor}
      >
        <Audio src={src} volume={volume} />
      </Sequence>
    );
  });
}

function renderMusicTrack(track: MusicTrack, assets: AssetMap, fps: number) {
  return track.clips.map((clip) => {
    const assetId = clip.properties.assetId;
    const src = assets[assetId];
    if (!assetId || !src) {
      return null;
    }
    const from = secondsToStartFrame(clip.startTime, fps);
    const durationInFrames = secondsToDurationFrames(clip.duration, fps);
    const volume = clip.properties.volume ?? 1;
    const premountFor = Math.max(1, Math.round(fps * 0.5));

    return (
      <Sequence
        key={clip.id}
        from={from}
        durationInFrames={durationInFrames}
        premountFor={premountFor}
      >
        <Audio src={src} volume={volume} />
      </Sequence>
    );
  });
}

function renderVideoTrack(track: VideoTrack, assets: AssetMap, fps: number) {
  return track.clips.map((clip) => {
    const from = secondsToStartFrame(clip.startTime, fps);
    const durationInFrames = secondsToDurationFrames(clip.duration, fps);
    const premountFor = Math.max(1, Math.round(fps * 0.5));
    return (
      <VideoClipSequence
        key={clip.id}
        clip={clip}
        assets={assets}
        from={from}
        durationInFrames={durationInFrames}
        premountFor={premountFor}
      />
    );
  });
}
