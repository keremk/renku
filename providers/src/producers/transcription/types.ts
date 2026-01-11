/**
 * A single word in the transcription with timing information.
 */
export interface TranscriptionWord {
  /** The transcribed word */
  text: string;
  /** Start time in seconds, aligned to video timeline */
  startTime: number;
  /** End time in seconds, aligned to video timeline */
  endTime: number;
  /** ID of the source audio clip for debugging */
  clipId: string;
}

/**
 * Per-segment transcription details for debugging.
 */
export interface TranscriptionSegment {
  /** ID of the audio clip */
  clipId: string;
  /** Asset ID of the audio file */
  assetId: string;
  /** Clip's start position in the timeline */
  clipStartTime: number;
  /** Clip's duration */
  clipDuration: number;
  /** Transcribed text for this segment */
  text: string;
}

/**
 * Complete transcription artifact with word-level timestamps.
 */
export interface TranscriptionArtifact {
  /** Full transcribed text */
  text: string;
  /** Word-level timestamps aligned to video timeline */
  words: TranscriptionWord[];
  /** Per-segment transcription for debugging */
  segments: TranscriptionSegment[];
  /** Detected or specified language code */
  language: string;
  /** Total duration of transcribed audio */
  totalDuration: number;
}

/**
 * Audio segment extracted from timeline with buffer and timing info.
 */
export interface AudioSegment {
  /** Audio buffer data */
  buffer: Buffer;
  /** Start position in timeline (seconds) */
  startTime: number;
  /** Duration of the audio segment (seconds) */
  duration: number;
  /** ID of the timeline clip this came from */
  clipId: string;
  /** Asset ID reference */
  assetId: string;
}

/**
 * Raw STT output from provider (e.g., fal-ai elevenlabs/speech-to-text).
 */
export interface STTWord {
  /** The transcribed word or audio event */
  text: string;
  /** Start time in seconds */
  start: number;
  /** End time in seconds */
  end: number;
  /** Type of element: word, spacing, or audio_event */
  type: string;
  /** Speaker ID if diarization was enabled */
  speaker_id?: string | null;
}

/**
 * Raw STT output from provider.
 */
export interface STTOutput {
  /** Full transcribed text */
  text: string;
  /** Detected language code */
  language_code: string;
  /** Confidence in language detection */
  language_probability: number;
  /** Word-level transcription details */
  words: STTWord[];
}
