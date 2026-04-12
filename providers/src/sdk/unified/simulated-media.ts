import { Buffer } from 'node:buffer';
import { createProviderError, SdkErrorCode } from '../errors.js';
import { generateAudioWithDuration } from './audio-generator.js';
import { generateMp4WithDuration } from './mp4-generator.js';
import { generateMockPng } from './png-generator.js';

export async function generateSimulatedDataForMimeType(args: {
  mimeType: string;
  durationSeconds: number;
}): Promise<Buffer> {
  const { mimeType, durationSeconds } = args;

  if (mimeType.startsWith('image/')) {
    return generateMockPng(100, 100);
  }

  if (mimeType.startsWith('video/')) {
    return generateMp4WithDuration(durationSeconds);
  }

  if (mimeType.startsWith('audio/')) {
    return generateAudioWithDuration({ durationSeconds, mimeType });
  }

  throw createProviderError(
    SdkErrorCode.INVALID_CONFIG,
    `Simulated media generation does not support mime type "${mimeType}".`,
    {
      kind: 'user_input',
      causedByUser: true,
      metadata: { mimeType },
    }
  );
}

export function resolveDurationForSimulatedMedia(args: {
  durationInputId?: string;
  resolvedInputs: Record<string, unknown> | undefined;
}): number {
  const { durationInputId, resolvedInputs } = args;
  if (!resolvedInputs) {
    throw createProviderError(
      SdkErrorCode.MISSING_DURATION,
      'Simulated media generation requires resolved inputs for the explicitly bound Duration input.',
      { kind: 'user_input', causedByUser: true }
    );
  }

  if (!durationInputId) {
    throw createProviderError(
      SdkErrorCode.MISSING_DURATION,
      'Simulated media generation requires an explicit binding for the producer Duration input.',
      {
        kind: 'user_input',
        causedByUser: true,
        metadata: {
          binding: 'Duration',
        },
      }
    );
  }

  if (!durationInputId.startsWith('Input:')) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      `Simulated media generation received a non-canonical Duration binding "${durationInputId}".`,
      {
        kind: 'user_input',
        causedByUser: true,
        metadata: { durationInputId },
      }
    );
  }

  const durationValue = resolvedInputs[durationInputId];
  if (
    typeof durationValue === 'number' &&
    Number.isFinite(durationValue) &&
    durationValue > 0
  ) {
    return durationValue;
  }

  throw createProviderError(
    SdkErrorCode.MISSING_DURATION,
    `Simulated media generation requires a positive numeric value for bound Duration input "${durationInputId}".`,
    {
      kind: 'user_input',
      causedByUser: true,
      metadata: { durationInputId, durationValue },
    }
  );
}
