import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createProducerHandlerFactory } from '../../sdk/handler-factory.js';
import { createProviderError, SdkErrorCode } from '../../sdk/errors.js';
import type { HandlerFactory, HandlerFactoryInit, ProviderJobContext } from '../../types.js';
import type { TimelineDocument, TranscriptionClip, TranscriptionTrack } from '@gorenku/compositions';
import type { StorageContext } from '@gorenku/core';
import { concatenateWithSilence } from './audio-concatenator.js';
import { alignTranscriptionToTimeline } from './timestamp-aligner.js';
import type {
  AudioSegment,
  STTOutput,
} from './types.js';

const TIMELINE_ARTEFACT_ID = 'Artifact:TimelineComposer.Timeline';

/**
 * Nested model config structure for STT backend.
 */
interface NestedModelConfig {
  provider: string;
  model: string;
  /** Additional model-specific config properties forwarded to the backend */
  [key: string]: unknown;
}

interface TranscriptionHandlerConfig {
  languageCode?: string;
  /** Required: Nested STT model configuration */
  stt: NestedModelConfig;
}

/**
 * Create the transcription producer handler.
 *
 * This handler:
 * 1. Loads the timeline and finds the Transcription track
 * 2. Loads audio buffers from asset blob paths (auto-resolved by the runner)
 * 3. Concatenates audio with silence gaps to match timeline positions
 * 4. Calls STT API to transcribe the concatenated audio
 * 5. Aligns timestamps to the original timeline positions
 * 6. Returns a JSON artifact with word-level transcription
 */
export function createTranscriptionHandler(): HandlerFactory {
  return (init: HandlerFactoryInit) => {
    // Capture handlerResolver and getModelSchema from init - allows delegation to other provider handlers
    const { handlerResolver, getModelSchema } = init;

    return createProducerHandlerFactory({
      domain: 'transcription',
      configValidator: parseTranscriptionConfig,
      invoke: async ({ request, runtime }) => {
        const notify = (type: 'progress' | 'success' | 'error', message: string) => {
          runtime.notifications?.publish({
            type,
            message,
            timestamp: new Date().toISOString(),
          });
        };

        notify('progress', `Starting transcription for job ${request.jobId}`);

        const config = runtime.config.parse<TranscriptionHandlerConfig>(parseTranscriptionConfig);
        const produceId = request.produces[0];

        if (!produceId) {
          throw createProviderError(
            SdkErrorCode.INVALID_CONFIG,
            'Transcription producer requires at least one declared artefact output.',
            { kind: 'user_input', causedByUser: true },
          );
        }

        // Load timeline from input artifact
        const timeline = runtime.inputs.getByNodeId<TimelineDocument>(TIMELINE_ARTEFACT_ID);
        if (!timeline) {
          throw createProviderError(
            SdkErrorCode.MISSING_TIMELINE,
            'Transcription producer requires Timeline input. Ensure TimelineComposer.Timeline is connected.',
            { kind: 'user_input', causedByUser: true },
          );
        }

        // Get language code from config or input
        const languageCode = config.languageCode ??
          runtime.inputs.getByNodeId<string>('Input:TranscriptionProducer.LanguageCode') ??
          'eng';

        // Find the Transcription track in the timeline
        const transcriptionTrack = timeline.tracks.find(
          (track): track is TranscriptionTrack => track.kind === 'Transcription',
        );
        if (!transcriptionTrack) {
          throw createProviderError(
            SdkErrorCode.MISSING_TIMELINE,
            'Timeline has no Transcription track. Add a Transcription track to the TimelineComposer config ' +
              'and wire TranscriptionAudio to TimelineComposer.',
            { kind: 'user_input', causedByUser: true },
          );
        }

        const transcriptionClips = [...transcriptionTrack.clips]
          .sort((a, b) => a.startTime - b.startTime);

        if (transcriptionClips.length === 0) {
          throw createProviderError(
            SdkErrorCode.MISSING_ASSET,
            'Transcription track is empty — no audio clips to transcribe. ' +
              'Ensure audio is wired to TimelineComposer.TranscriptionAudio.',
            { kind: 'user_input', causedByUser: true },
          );
        }

        notify('progress', `Found ${transcriptionClips.length} clips in Transcription track`);

        // Load audio buffers from asset blob paths or resolved inputs
        const allInputs = runtime.inputs.all();
        const assetBlobPaths = request.context.extras?.assetBlobPaths as Record<string, string> | undefined;

        // Diagnostic logging: trace asset resolution pipeline
        const clipAssetIds = transcriptionClips.map(c => c.properties.assetId);
        notify('progress',
          `Audio resolution diagnostics:\n` +
          `  clipAssetIds: ${JSON.stringify(clipAssetIds)}\n` +
          `  assetBlobPaths keys: ${assetBlobPaths ? JSON.stringify(Object.keys(assetBlobPaths)) : 'undefined'}\n` +
          `  allInputs keys (Artifact:*): ${JSON.stringify(Object.keys(allInputs).filter(k => k.startsWith('Artifact:')))}`
        );

        const { segments: audioSegments, skippedAssetIds } = await loadAudioSegmentsFromTranscriptionTrack(
          transcriptionClips,
          assetBlobPaths,
          allInputs,
        );

        for (const skippedId of skippedAssetIds) {
          notify('progress', `Warning: could not load audio for asset "${skippedId}" — skipped`);
        }

        if (runtime.mode !== 'simulated' && audioSegments.length === 0 && transcriptionClips.length > 0) {
          throw createProviderError(
            SdkErrorCode.EMPTY_AUDIO_SEGMENTS,
            `All ${transcriptionClips.length} transcription clips failed to load audio. ` +
              `Skipped asset IDs: ${skippedAssetIds.join(', ')}. ` +
              'Ensure audio artifacts are wired to TimelineComposer.TranscriptionAudio and available in assetBlobPaths or resolved inputs.',
            { kind: 'user_input', causedByUser: true, metadata: { skippedAssetIds } },
          );
        }

        notify('progress', `Loaded ${audioSegments.length} audio segments`);

        // Validate STT delegation requirements early (applies to both modes)
        if (!handlerResolver) {
          throw createProviderError(
            SdkErrorCode.INVALID_CONFIG,
            'TranscriptionProducer requires handlerResolver to delegate to STT provider. ' +
              'Ensure the registry passes handlerResolver to internal handlers.',
            { kind: 'unknown' },
          );
        }

        // Load the STT model's input schema for delegation (both modes)
        let sttSchema: string | null = null;
        if (getModelSchema) {
          sttSchema = await getModelSchema(config.stt.provider, config.stt.model);
        }

        // Resolve the STT handler from the registry (validates handler exists)
        const sttHandler = handlerResolver({
          provider: config.stt.provider,
          model: config.stt.model,
          environment: 'local',
        });

        // Get audio URL - either from cloud upload (live) or placeholder (simulated)
        let audioUrl: string;
        if (runtime.mode === 'simulated') {
          audioUrl = 'https://simulated.example.com/audio.wav';
          notify('progress', 'Using placeholder audio URL (simulated mode)');
        } else {
          notify('progress', 'Concatenating audio segments...');
          const concatenatedAudio = await concatenateWithSilence(audioSegments, timeline.duration);

          if (!runtime.cloudStorage) {
            throw createProviderError(
              SdkErrorCode.BLOB_INPUT_NO_STORAGE,
              'Transcription producer requires cloud storage for uploading audio. ' +
                'Set S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, and S3_BUCKET_NAME environment variables.',
              { kind: 'user_input', causedByUser: true },
            );
          }

          notify('progress', 'Uploading audio to cloud storage...');
          audioUrl = await uploadAudioAndGetUrl(concatenatedAudio, runtime.cloudStorage);
        }

        // Delegate STT call to the configured provider's handler
        notify('progress', `Calling speech-to-text API (${config.stt.provider}/${config.stt.model})...`);

        const { provider: _sttProvider, model: _sttModel, ...sttConfigProps } = config.stt;

        const sttJobContext: ProviderJobContext = {
          jobId: `${request.jobId}-stt`,
          provider: config.stt.provider,
          model: config.stt.model,
          revision: request.revision,
          layerIndex: request.layerIndex,
          attempt: request.attempt,
          inputs: [],
          produces: ['stt-transcription'],
          context: {
            providerConfig: {},
            extras: {
              resolvedInputs: {
                audio_url: audioUrl,
                language_code: languageCode,
                ...sttConfigProps,
              },
              jobContext: {
                sdkMapping: {
                  audio_url: { field: 'audio_url' },
                  language_code: { field: 'language_code' },
                  ...Object.fromEntries(
                    Object.keys(sttConfigProps).map(key => [key, { field: key }])
                  ),
                },
                inputBindings: {
                  audio_url: 'audio_url',
                  language_code: 'language_code',
                  ...Object.fromEntries(
                    Object.keys(sttConfigProps).map(key => [key, key])
                  ),
                },
              },
              ...(sttSchema && { schema: { raw: sttSchema } }),
            },
          },
        };

        const sttResult = await sttHandler.invoke(sttJobContext);
        const sttRawOutput = extractSttOutputFromResult(sttResult);

        notify('progress', 'Aligning transcription timestamps...');
        const sttParsed = sttRawOutput as { data?: STTOutput } | STTOutput;
        const sttOutput: STTOutput = 'data' in sttParsed && sttParsed.data
          ? sttParsed.data
          : sttParsed as STTOutput;

        if (runtime.mode !== 'simulated') {
          const wordCount = sttOutput.words.filter(w => w.type === 'word').length;
          if (wordCount === 0) {
            throw createProviderError(
              SdkErrorCode.EMPTY_TRANSCRIPTION_RESULT,
              'Speech-to-text returned 0 words. The audio may be silent, corrupted, or the STT model failed to detect speech.',
              { kind: 'unknown', metadata: { audioSegmentsLoaded: audioSegments.length } },
            );
          }
        }

        const transcription = alignTranscriptionToTimeline(sttOutput, audioSegments);

        notify('success', `Transcription completed for job ${request.jobId}`);

        return {
          status: 'succeeded',
          artefacts: [{
            artefactId: runtime.artefacts.expectBlob(produceId),
            status: 'succeeded',
            blob: {
              data: Buffer.from(JSON.stringify(transcription, null, 2)),
              mimeType: 'application/json',
            },
            diagnostics: {
              wordCount: transcription.words.length,
              segmentCount: transcription.segments.length,
              language: transcription.language,
              audioSegmentsLoaded: audioSegments.length,
              audioSegmentsExpected: transcriptionClips.length,
              skippedAssetIds,
            },
          }],
        };
      },
    })(init);
  };
}

function parseTranscriptionConfig(raw: unknown): TranscriptionHandlerConfig {
  const config = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};

  const stt = config.stt as Record<string, unknown> | undefined;

  if (!stt || typeof stt !== 'object') {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      'TranscriptionProducer requires config.stt with provider and model. ' +
        'Add config.stt: { provider: "fal-ai", model: "elevenlabs/speech-to-text" }',
      { kind: 'user_input', causedByUser: true },
    );
  }

  if (typeof stt.provider !== 'string' || !stt.provider) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      'TranscriptionProducer requires config.stt.provider (e.g., "fal-ai", "replicate")',
      { kind: 'user_input', causedByUser: true },
    );
  }

  if (typeof stt.model !== 'string' || !stt.model) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      'TranscriptionProducer requires config.stt.model (e.g., "elevenlabs/speech-to-text")',
      { kind: 'user_input', causedByUser: true },
    );
  }

  const { provider, model, ...sttConfigProps } = stt;

  return {
    languageCode: typeof config.languageCode === 'string' ? config.languageCode : undefined,
    stt: {
      provider: provider as string,
      model: model as string,
      ...sttConfigProps,
    },
  };
}

/**
 * Extract STT output from the handler result.
 */
function extractSttOutputFromResult(result: import('../../types.js').ProviderResult): unknown {
  if (result.status === 'failed') {
    throw createProviderError(
      SdkErrorCode.PROVIDER_PREDICTION_FAILED,
      'STT handler failed: ' + (result.diagnostics?.error ?? 'unknown error'),
      { kind: 'transient', retryable: true },
    );
  }

  const firstArtifact = result.artefacts?.[0];
  if (!firstArtifact) {
    throw createProviderError(
      SdkErrorCode.PROVIDER_PREDICTION_FAILED,
      'STT handler returned no artifacts',
      { kind: 'unknown' },
    );
  }

  const diagnostics = firstArtifact.diagnostics as Record<string, unknown> | undefined;
  if (diagnostics?.rawOutput) {
    return diagnostics.rawOutput;
  }

  if (firstArtifact.blob?.data) {
    try {
      return JSON.parse(firstArtifact.blob.data.toString());
    } catch {
      return firstArtifact.blob.data;
    }
  }

  return diagnostics ?? {};
}

/**
 * Load audio segments from the Transcription track clips.
 * Uses asset blob paths (file paths resolved by the runner) or falls back to resolved inputs.
 */
async function loadAudioSegmentsFromTranscriptionTrack(
  clips: TranscriptionClip[],
  assetBlobPaths: Record<string, string> | undefined,
  allInputs: Record<string, unknown>,
): Promise<{ segments: AudioSegment[]; skippedAssetIds: string[] }> {
  const segments: AudioSegment[] = [];
  const skippedAssetIds: string[] = [];

  for (const clip of clips) {
    const assetId = clip.properties.assetId;
    let buffer: Buffer | undefined;

    // Try loading from asset blob paths (file system)
    if (assetBlobPaths) {
      const filePath = assetBlobPaths[assetId];
      if (filePath) {
        try {
          buffer = await readFile(filePath);
        } catch {
          // File may not exist in simulation/dry-run mode
        }
      }
    }

    // Fallback: try loading from resolved inputs (in-memory)
    if (!buffer) {
      buffer = extractBufferFromInput(allInputs[assetId]);
    }

    // Fallback: try without "Artifact:" prefix
    if (!buffer && assetId.startsWith('Artifact:')) {
      const shortId = assetId.replace('Artifact:', '');
      if (assetBlobPaths) {
        const filePath = assetBlobPaths[shortId];
        if (filePath) {
          try {
            buffer = await readFile(filePath);
          } catch {
            // File may not exist in simulation/dry-run mode
          }
        }
      }
      if (!buffer) {
        buffer = extractBufferFromInput(allInputs[shortId]);
      }
    }

    if (!buffer || buffer.length === 0) {
      skippedAssetIds.push(assetId);
      continue;
    }

    segments.push({
      buffer,
      startTime: clip.startTime,
      duration: clip.duration,
      clipId: clip.id,
      assetId,
    });
  }

  return { segments, skippedAssetIds };
}

/**
 * Extract a Buffer from various input formats.
 */
function extractBufferFromInput(value: unknown): Buffer | undefined {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }

  if (typeof value === 'object' && value !== null && 'data' in value) {
    const obj = value as { data?: unknown; mimeType?: string };
    if (Buffer.isBuffer(obj.data)) {
      return obj.data;
    }
    if (obj.data instanceof Uint8Array) {
      return Buffer.from(obj.data);
    }
  }

  if (typeof value === 'object' && value !== null && 'blob' in value) {
    const obj = value as { blob?: { data?: unknown } };
    if (obj.blob && Buffer.isBuffer(obj.blob.data)) {
      return obj.blob.data;
    }
    if (obj.blob && obj.blob.data instanceof Uint8Array) {
      return Buffer.from(obj.blob.data);
    }
  }

  return undefined;
}

/**
 * Upload audio buffer to cloud storage and return a signed URL.
 */
async function uploadAudioAndGetUrl(
  audioBuffer: Buffer,
  cloudStorage: StorageContext,
): Promise<string> {
  const hash = createHash('sha256').update(audioBuffer).digest('hex');
  const prefix = hash.slice(0, 2);
  const key = `blobs/${prefix}/${hash}.wav`;

  await cloudStorage.storage.write(key, audioBuffer, { mimeType: 'audio/wav' });

  if (!cloudStorage.temporaryUrl) {
    throw createProviderError(
      SdkErrorCode.CLOUD_STORAGE_URL_FAILED,
      'Cloud storage does not support temporaryUrl - ensure you are using cloud storage kind.',
      { kind: 'user_input', causedByUser: true },
    );
  }

  return cloudStorage.temporaryUrl(key, 3600);
}

// Export for testing
export const __test__ = {
  parseTranscriptionConfig,
  loadAudioSegmentsFromTranscriptionTrack,
  extractBufferFromInput,
  uploadAudioAndGetUrl,
};
