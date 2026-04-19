import type { TimelineDocument } from '@gorenku/compositions';
import type { TranscriptionArtifact } from '../transcription/types.js';

export interface TimestampedTranscriptWord {
  text: string;
  startTime: number;
  endTime: number;
}

export interface TimestampedTranscript {
  text: string;
  language: string;
  words: TimestampedTranscriptWord[];
  sourceDuration: number;
}

export interface SttNormalizerAdapter {
  id: string;
  normalize(raw: unknown): TimestampedTranscript;
}

export interface FanInValue {
  groupBy: string;
  orderBy?: string;
  groups: string[][];
}

export interface SubtitleComposerSegment {
  groupIndex: number;
  transcription: TimestampedTranscript;
}

export type { TimelineDocument, TranscriptionArtifact };
