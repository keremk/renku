export { createTranscriptionHandler } from './transcription-handler.js';
export { concatenateWithSilence, buildMixCommand } from './audio-concatenator.js';
export {
  findClipForTimestamp,
  extractTextForClip,
  alignTranscriptionToTimeline,
} from './timestamp-aligner.js';
export type {
  AudioSegment,
  STTOutput,
  STTWord,
  TranscriptionArtifact,
  TranscriptionSegment,
  TranscriptionWord,
} from './types.js';
