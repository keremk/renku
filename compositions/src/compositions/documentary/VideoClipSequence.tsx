import { AbsoluteFill, OffthreadVideo, Sequence } from "remotion";
import type { AssetMap, VideoClip } from "../../types/timeline.js";

interface VideoClipSequenceProps {
  clip: VideoClip;
  assets: AssetMap;
  from: number;
  durationInFrames: number;
  premountFor: number;
}

export const VideoClipSequence = ({
  clip,
  assets,
  from,
  durationInFrames,
  premountFor,
}: VideoClipSequenceProps) => {
  const assetId = clip.properties.assetId;
  if (!assetId) {
    return null;
  }

  const assetSrc = assets[assetId];
  if (!assetSrc) {
    return null;
  }

  const sourceUrl = `${assetSrc}#disable`;
  const volume = typeof clip.properties.volume === "number" ? clip.properties.volume : 0;
  const originalDuration = clip.properties.originalDuration ?? clip.duration;

  // Always stretch video to match the master track (audio) duration
  const playbackRate =
    clip.duration > 0 && originalDuration > 0
      ? originalDuration / clip.duration
      : 1;

  return (
    <Sequence from={from} durationInFrames={durationInFrames} premountFor={premountFor}>
      <AbsoluteFill>
        <OffthreadVideo
          src={sourceUrl}
          muted={volume === 0}
          volume={volume}
          playbackRate={playbackRate}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </AbsoluteFill>
    </Sequence>
  );
};
