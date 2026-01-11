import type {
  AudioSegment,
  STTOutput,
  TranscriptionArtifact,
  TranscriptionWord,
} from './types.js';

/**
 * Find the clip that contains the given timestamp.
 * Returns the clip ID, or the last clip's ID if timestamp is beyond all clips.
 */
export function findClipForTimestamp(timestamp: number, clips: AudioSegment[]): string {
  if (clips.length === 0) {
    return '';
  }

  for (const clip of clips) {
    const clipEnd = clip.startTime + clip.duration;
    if (timestamp >= clip.startTime && timestamp < clipEnd) {
      return clip.clipId;
    }
  }

  // If timestamp is beyond all clips, return the last clip
  return clips[clips.length - 1]?.clipId ?? '';
}

/**
 * Extract text from words that belong to a specific clip.
 */
export function extractTextForClip(
  words: TranscriptionWord[],
  clip: AudioSegment
): string {
  const clipEnd = clip.startTime + clip.duration;
  const clipWords = words.filter(
    (word) => word.startTime >= clip.startTime && word.startTime < clipEnd
  );
  return clipWords.map((w) => w.text).join(' ');
}

/**
 * Align STT output timestamps to the video timeline.
 *
 * Since we concatenate audio with silence gaps at the exact timeline positions,
 * the STT timestamps are already video-aligned. We just need to:
 * 1. Filter out non-word elements (spacing, audio events)
 * 2. Map words to their source clips
 * 3. Build the final transcription artifact
 */
export function alignTranscriptionToTimeline(
  sttResult: STTOutput,
  audioClips: AudioSegment[]
): TranscriptionArtifact {
  // Filter to only include actual words (not spacing or audio events)
  const wordElements = sttResult.words.filter((word) => word.type === 'word');

  const words: TranscriptionWord[] = wordElements.map((word) => ({
    text: word.text,
    startTime: word.start,
    endTime: word.end,
    clipId: findClipForTimestamp(word.start, audioClips),
  }));

  // Build segments with text per clip
  const segments = audioClips.map((clip) => ({
    clipId: clip.clipId,
    assetId: clip.assetId,
    clipStartTime: clip.startTime,
    clipDuration: clip.duration,
    text: extractTextForClip(words, clip),
  }));

  // Calculate total duration from the last word or last clip
  const lastWord = words[words.length - 1];
  const lastClip = audioClips[audioClips.length - 1];
  const totalDuration = lastWord
    ? lastWord.endTime
    : lastClip
      ? lastClip.startTime + lastClip.duration
      : 0;

  return {
    text: sttResult.text,
    words,
    segments,
    language: sttResult.language_code,
    totalDuration,
  };
}
