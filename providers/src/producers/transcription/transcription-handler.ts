import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createProducerHandlerFactory } from '../../sdk/handler-factory.js';
import { createProviderError, SdkErrorCode } from '../../sdk/errors.js';
import type { HandlerFactory, HandlerFactoryInit, ProviderJobContext } from '../../types.js';
import type { TimelineDocument, TranscriptionClip, TranscriptionTrack } from '@gorenku/compositions';
import { concatenateWithSilence } from './audio-concatenator.js';
import { alignTranscriptionToTimeline } from './timestamp-aligner.js';
import type {
  AudioSegment,
  STTOutput,
} from './types.js';

const TIMELINE_ARTIFACT_ID = 'Artifact:TimelineComposer.Timeline';
const STT_DELEGATE_ARTIFACT_ID = 'Artifact:TranscriptionProducer.SttTranscription';

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
 * 2. Loads audio buffers from asset blob paths resolved by the runner
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
            'Transcription producer requires at least one declared artifact output.',
            { kind: 'user_input', causedByUser: true },
          );
        }

        // Load timeline from input artifact
        const timeline = runtime.inputs.getByNodeId<TimelineDocument>(TIMELINE_ARTIFACT_ID);
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

        const storageRoot = runtime.inputs.getByNodeId<string>('Input:StorageRoot');
        if (typeof storageRoot !== 'string' || storageRoot.trim().length === 0) {
          throw createProviderError(
            SdkErrorCode.MISSING_STORAGE_ROOT,
            'Transcription producer is missing storage root (Input:StorageRoot).',
            { kind: 'user_input', causedByUser: true },
          );
        }

        const assetBlobPaths = request.context.extras?.assetBlobPaths as Record<string, string> | undefined;
        if (!assetBlobPaths) {
          throw createProviderError(
            SdkErrorCode.MISSING_ASSET,
            'Transcription producer is missing asset blob paths in context extras.',
            { kind: 'user_input', causedByUser: true },
          );
        }

        const audioSegments = await loadAudioSegmentsFromTranscriptionTrack(
          transcriptionClips,
          assetBlobPaths,
          storageRoot,
        );

        if (audioSegments.length === 0) {
          throw createProviderError(
            SdkErrorCode.EMPTY_AUDIO_SEGMENTS,
            `Transcription producer loaded 0 audio segments from ${transcriptionClips.length} clips.`,
            { kind: 'user_input', causedByUser: true },
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

        notify('progress', 'Concatenating audio segments...');
        const concatenatedAudio = await concatenateWithSilence(audioSegments, timeline.duration);

        // Delegate STT call to the configured provider's handler
        notify('progress', `Calling speech-to-text API (${config.stt.provider}/${config.stt.model})...`);

        const { provider: _sttProvider, model: _sttModel, ...sttConfigProps } = config.stt;
        const sttResolvedInputs: Record<string, unknown> = {
          'Input:audio_url': {
            data: concatenatedAudio,
            mimeType: 'audio/wav',
          },
          'Input:language_code': languageCode,
        };
        const sttInputBindings: Record<string, string> = {
          audio_url: 'Input:audio_url',
          language_code: 'Input:language_code',
        };
        for (const [key, value] of Object.entries(sttConfigProps)) {
          const canonicalId = `Input:${key}`;
          sttResolvedInputs[canonicalId] = value;
          sttInputBindings[key] = canonicalId;
        }

        const sttJobContext: ProviderJobContext = {
          jobId: `${request.jobId}-stt`,
          provider: config.stt.provider,
          model: config.stt.model,
          revision: request.revision,
          layerIndex: request.layerIndex,
          attempt: request.attempt,
          inputs: [],
          produces: [STT_DELEGATE_ARTIFACT_ID],
          context: {
            providerConfig: {},
            extras: {
              resolvedInputs: sttResolvedInputs,
              jobContext: {
                sdkMapping: {
                  audio_url: { field: 'audio_url' },
                  language_code: { field: 'language_code' },
                  ...Object.fromEntries(
                    Object.keys(sttConfigProps).map(key => [key, { field: key }])
                  ),
                },
                inputBindings: sttInputBindings,
              },
              ...(sttSchema && { schema: { raw: sttSchema } }),
            },
          },
        };

        const sttResult = await sttHandler.invoke(sttJobContext);
        const sttOutput = extractSttOutputFromResult(sttResult);

        notify('progress', 'Aligning transcription timestamps...');

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
          artifacts: [{
            artifactId: runtime.artifacts.expectBlob(produceId),
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
 * Extract STT output from the delegated handler result.
 * Successful delegated JSON handlers must persist the unwrapped result as the
 * artifact blob. That artifact blob is the only success-path source of truth.
 */
function extractSttOutputFromResult(result: import('../../types.js').ProviderResult): STTOutput {
  if (result.status === 'failed') {
    throw createProviderError(
      SdkErrorCode.PROVIDER_PREDICTION_FAILED,
      'STT handler failed: ' + (result.diagnostics?.error ?? 'unknown error'),
      { kind: 'transient', retryable: true },
    );
  }

  const firstArtifact = result.artifacts?.[0];
  if (!firstArtifact) {
    throw createProviderError(
      SdkErrorCode.PROVIDER_PREDICTION_FAILED,
      'STT handler returned no artifacts',
      { kind: 'unknown' },
    );
  }

  if (!firstArtifact.blob?.data) {
    throw createProviderError(
      SdkErrorCode.PROVIDER_PREDICTION_FAILED,
      'STT handler returned no artifact blob data',
      { kind: 'unknown' },
    );
  }

  try {
    return JSON.parse(firstArtifact.blob.data.toString()) as STTOutput;
  } catch (error) {
    throw createProviderError(
      SdkErrorCode.PROVIDER_PREDICTION_FAILED,
      'STT handler returned invalid JSON artifact data',
      { kind: 'unknown', raw: error },
    );
  }
}

/**
 * Load audio segments from the Transcription track clips.
 * Uses canonical asset IDs with runner-provided blob paths.
 */
async function loadAudioSegmentsFromTranscriptionTrack(
  clips: TranscriptionClip[],
  assetBlobPaths: Record<string, string>,
  storageRoot: string,
): Promise<AudioSegment[]> {
  const segments: AudioSegment[] = [];

  for (const clip of clips) {
    const assetId = clip.properties.assetId;
    const blobPath = assetBlobPaths[assetId];
    if (typeof blobPath !== 'string' || blobPath.length === 0) {
      throw createProviderError(
        SdkErrorCode.MISSING_ASSET,
        `Transcription clip "${clip.id}" is missing blob path for asset "${assetId}".`,
        { kind: 'user_input', causedByUser: true, metadata: { clipId: clip.id, assetId } },
      );
    }

    const absolutePath = path.resolve(storageRoot, blobPath);
    let buffer: Buffer;

    try {
      buffer = await readFile(absolutePath);
    } catch (error) {
      throw createProviderError(
        SdkErrorCode.MISSING_ASSET,
        `Transcription clip "${clip.id}" could not read audio file for asset "${assetId}" at "${absolutePath}".`,
        {
          kind: 'user_input',
          causedByUser: true,
          metadata: { clipId: clip.id, assetId, blobPath, absolutePath },
          raw: error,
        },
      );
    }

    segments.push({
      buffer,
      startTime: clip.startTime,
      duration: clip.duration,
      clipId: clip.id,
      assetId,
    });
  }

  return segments;
}

// Export for testing
export const __test__ = {
  parseTranscriptionConfig,
  extractSttOutputFromResult,
  loadAudioSegmentsFromTranscriptionTrack,
};
