import type {
  TimelineDocument,
  TranscriptionClip,
  TranscriptionTrack,
} from '@gorenku/compositions';
import { createProducerHandlerFactory } from '../../sdk/handler-factory.js';
import { createProviderError, SdkErrorCode } from '../../sdk/errors.js';
import type { HandlerFactory, ProviderJobContext } from '../../types.js';
import type {
  FanInValue,
  TimestampedTranscript,
  TranscriptionArtifact,
} from './types.js';

export function createSubtitlesComposerHandler(): HandlerFactory {
  return createProducerHandlerFactory({
    domain: 'transcription',
    invoke: async ({ request, runtime }) => {
      const outputArtifactId = request.produces[0];
      if (!outputArtifactId) {
        throw createProviderError(
          SdkErrorCode.INVALID_CONFIG,
          'Subtitles composer requires a declared output artifact.',
          { kind: 'user_input', causedByUser: true },
        );
      }

      const timelineBindingId = resolveBoundInputId(request, 'Timeline');
      const durationBindingId = resolveBoundInputId(request, 'Duration');

      const timeline = runtime.inputs.getByNodeId<TimelineDocument>(timelineBindingId);
      if (!timeline || !isTimelineDocument(timeline)) {
        throw createProviderError(
          SdkErrorCode.MISSING_TIMELINE,
          'Subtitles composer requires a Timeline input.',
          {
            kind: 'user_input',
            causedByUser: true,
            metadata: { timelineBindingId },
          },
        );
      }

      const totalDuration = runtime.inputs.getByNodeId<unknown>(durationBindingId);
      if (typeof totalDuration !== 'number' || Number.isNaN(totalDuration)) {
        throw createProviderError(
          SdkErrorCode.MISSING_DURATION,
          'Subtitles composer requires a numeric Duration input.',
          {
            kind: 'user_input',
            causedByUser: true,
            metadata: { durationBindingId, value: totalDuration },
          },
        );
      }

      const transcriptionTrack = findTranscriptionTrack(timeline);
      const transcriptFanIn = resolveTranscriptFanIn(request, runtime.inputs.all());
      const segments = buildSegments(transcriptionTrack, transcriptFanIn, runtime);

      const words = segments.flatMap(({ clip, transcription }) =>
        transcription.words
          .filter((word) => word.startTime >= 0 && word.endTime <= clip.duration)
          .map((word) => ({
            text: word.text,
            startTime: clip.startTime + word.startTime,
            endTime: clip.startTime + word.endTime,
            clipId: clip.id,
          })),
      );

      const segmentArtifacts = segments.map(({ clip, transcription }) => ({
        clipId: clip.id,
        assetId: clip.properties.assetId,
        clipStartTime: clip.startTime,
        clipDuration: clip.duration,
        text: transcription.words
          .filter((word) => word.startTime >= 0 && word.endTime <= clip.duration)
          .map((word) => word.text)
          .join(' '),
      }));

      const languages = new Set(
        segments.map(({ transcription }) => transcription.language),
      );
      if (languages.size > 1) {
        throw createProviderError(
          SdkErrorCode.INVALID_CONFIG,
          'Subtitles composer requires all normalized transcripts to use the same language.',
          {
            kind: 'user_input',
            causedByUser: true,
            metadata: { languages: Array.from(languages) },
          },
        );
      }

      const text = segmentArtifacts
        .map((segment) => segment.text)
        .filter((value) => value.length > 0)
        .join(' ')
        .trim();
      const artifact: TranscriptionArtifact = {
        text,
        words,
        segments: segmentArtifacts,
        language: Array.from(languages)[0] ?? '',
        totalDuration,
      };

      return {
        status: 'succeeded',
        artifacts: [
          {
            artifactId: runtime.artifacts.expectBlob(outputArtifactId),
            status: 'succeeded',
            blob: {
              data: JSON.stringify(artifact, null, 2),
              mimeType: 'application/json',
            },
          },
        ],
      };
    },
  });
}

function findTranscriptionTrack(timeline: TimelineDocument): TranscriptionTrack {
  const transcriptionTrack = timeline.tracks.find(
    (track): track is TranscriptionTrack => track.kind === 'Transcription',
  );
  if (!transcriptionTrack) {
    throw createProviderError(
      SdkErrorCode.MISSING_TIMELINE,
      'Timeline does not contain a Transcription track.',
      { kind: 'user_input', causedByUser: true },
    );
  }

  return {
    ...transcriptionTrack,
    clips: [...transcriptionTrack.clips].sort((a, b) => a.startTime - b.startTime),
  };
}

function resolveBoundInputId(
  request: ProviderJobContext,
  alias: string,
): string {
  const jobContext = request.context.extras?.jobContext;
  if (!isRecord(jobContext)) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      'Subtitles composer requires jobContext metadata.',
      { kind: 'user_input', causedByUser: true },
    );
  }

  const inputBindings = jobContext.inputBindings;
  if (!isRecord(inputBindings)) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      'Subtitles composer requires inputBindings metadata.',
      { kind: 'user_input', causedByUser: true },
    );
  }

  const canonicalId = inputBindings[alias];
  if (typeof canonicalId !== 'string') {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      `Subtitles composer is missing the "${alias}" input binding.`,
      {
        kind: 'user_input',
        causedByUser: true,
        metadata: { alias, knownBindings: Object.keys(inputBindings) },
      },
    );
  }

  return canonicalId;
}

function resolveTranscriptFanIn(
  request: ProviderJobContext,
  resolvedInputs: Record<string, unknown>,
): FanInValue {
  const jobContext = request.context.extras?.jobContext;
  if (!isRecord(jobContext) || !isRecord(jobContext.fanIn)) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      'Subtitles composer requires fan-in metadata for normalized transcripts.',
      { kind: 'user_input', causedByUser: true },
    );
  }

  const fanInEntries = Object.keys(jobContext.fanIn);
  if (fanInEntries.length !== 1) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      'Subtitles composer expected exactly one fan-in input.',
      {
        kind: 'user_input',
        causedByUser: true,
        metadata: { fanInEntries },
      },
    );
  }

  const canonicalInputId = fanInEntries[0]!;
  const fanInValue = resolvedInputs[canonicalInputId];
  if (!isFanInValue(fanInValue)) {
    throw createProviderError(
      SdkErrorCode.MISSING_FANIN_DATA,
      `Subtitles composer could not resolve fan-in input "${canonicalInputId}".`,
      {
        kind: 'user_input',
        causedByUser: true,
        metadata: { canonicalInputId },
      },
    );
  }

  return fanInValue;
}

function buildSegments(
  transcriptionTrack: TranscriptionTrack,
  transcriptFanIn: FanInValue,
  runtime: { inputs: { getByNodeId<T = unknown>(canonicalId: string): T | undefined } },
): Array<{ clip: TranscriptionClip; transcription: TimestampedTranscript }> {
  const segments: Array<{ clip: TranscriptionClip; transcription: TimestampedTranscript }> = [];
  const clipGroups = new Set<number>();

  for (const clip of transcriptionTrack.clips) {
    const groupIndex = readGroupIndex(clip);
    if (clipGroups.has(groupIndex)) {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Timeline contains duplicate transcription clips for group ${groupIndex}.`,
        {
          kind: 'user_input',
          causedByUser: true,
          metadata: { clipId: clip.id, groupIndex },
        },
      );
    }
    clipGroups.add(groupIndex);
  }

  for (const [groupIndex, group] of transcriptFanIn.groups.entries()) {
    if (group.length === 0) {
      continue;
    }
    if (!clipGroups.has(groupIndex)) {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Subtitles composer received normalized transcripts for group ${groupIndex}, but the timeline has no matching transcription clip.`,
        {
          kind: 'user_input',
          causedByUser: true,
          metadata: { groupIndex, group },
        },
      );
    }
  }

  for (const clip of transcriptionTrack.clips) {
    const groupIndex = readGroupIndex(clip);
    const group = transcriptFanIn.groups[groupIndex] ?? [];
    if (group.length !== 1) {
      throw createProviderError(
        SdkErrorCode.INVALID_CONFIG,
        `Subtitles composer expected exactly one normalized transcript for group ${groupIndex}.`,
        {
          kind: 'user_input',
          causedByUser: true,
          metadata: { groupIndex, group },
        },
      );
    }

    const transcriptArtifactId = group[0]!;
    const transcription =
      runtime.inputs.getByNodeId<TimestampedTranscript>(transcriptArtifactId);
    if (!transcription) {
      throw createProviderError(
        SdkErrorCode.MISSING_FANIN_DATA,
        `Subtitles composer could not resolve normalized transcript "${transcriptArtifactId}".`,
        {
          kind: 'user_input',
          causedByUser: true,
          metadata: { transcriptArtifactId, groupIndex },
        },
      );
    }

    segments.push({ clip, transcription });
  }

  return segments;
}

function readGroupIndex(clip: TranscriptionClip): number {
  const properties = clip.properties as Record<string, unknown>;
  const groupIndex = properties.groupIndex;
  if (typeof groupIndex !== 'number' || Number.isNaN(groupIndex)) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      `Transcription clip "${clip.id}" is missing a numeric groupIndex property.`,
      {
        kind: 'user_input',
        causedByUser: true,
        metadata: { clipId: clip.id, properties: clip.properties },
      },
    );
  }
  return groupIndex;
}

function isFanInValue(value: unknown): value is FanInValue {
  if (!isRecord(value)) {
    return false;
  }
  return Array.isArray(value.groups) && typeof value.groupBy === 'string';
}

function isTimelineDocument(value: unknown): value is TimelineDocument {
  if (!isRecord(value)) {
    return false;
  }
  return Array.isArray(value.tracks) && typeof value.duration === 'number';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
