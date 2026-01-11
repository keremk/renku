import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { createProducerHandlerFactory } from '../../sdk/handler-factory.js';
import { createProviderError, SdkErrorCode } from '../../sdk/errors.js';
import type { HandlerFactory, HandlerFactoryInit, ProviderJobContext } from '../../types.js';
import type { TimelineDocument, AudioClip } from '@gorenku/compositions';
import type { StorageContext } from '@gorenku/core';
import { concatenateWithSilence } from './audio-concatenator.js';
import { alignTranscriptionToTimeline } from './timestamp-aligner.js';
import type {
  AudioSegment,
  STTOutput,
  TranscriptionArtifact,
} from './types.js';

const TIMELINE_ARTEFACT_ID = 'Artifact:TimelineComposer.Timeline';
// Input ID reserved for future explicit input lookup; currently we iterate all inputs
const _AUDIO_SEGMENTS_INPUT_ID = 'Input:TranscriptionProducer.AudioSegments';

interface TranscriptionHandlerConfig {
  languageCode?: string;
  /** Required: The provider for the STT model (e.g., 'fal-ai', 'replicate') */
  sttProvider: string;
  /** Required: The STT model to use (e.g., 'elevenlabs/speech-to-text') */
  sttModel: string;
}

/**
 * Create the transcription producer handler.
 *
 * This handler:
 * 1. Loads the timeline to get audio clip timing info
 * 2. Loads audio buffers from the AudioSegments fan-in input
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

        // Extract audio clips from timeline (Audio tracks only, skip Music)
        const audioClips = extractAudioClipsFromTimeline(timeline);
        notify('progress', `Found ${audioClips.length} audio clips in timeline`);

        // Debug: Log available input keys
        const allInputs = runtime.inputs.all();
        const inputKeys = Object.keys(allInputs);
        notify('progress', `Available input keys (${inputKeys.length}): ${inputKeys.slice(0, 5).join(', ')}${inputKeys.length > 5 ? '...' : ''}`);

        // If no audio clips, return empty transcription
        if (audioClips.length === 0) {
          const emptyTranscription: TranscriptionArtifact = {
            text: '',
            words: [],
            segments: [],
            language: languageCode,
            totalDuration: timeline.duration,
          };

          return {
            status: 'succeeded',
            artefacts: [{
              artefactId: runtime.artefacts.expectBlob(produceId),
              status: 'succeeded',
              blob: {
                data: Buffer.from(JSON.stringify(emptyTranscription, null, 2)),
                mimeType: 'application/json',
              },
              diagnostics: { reason: 'no_audio_clips' },
            }],
          };
        }

        // Load audio buffers from fan-in input
        notify('progress', `Looking for audio buffers with assetIds: ${audioClips.map(c => c.properties.assetId).join(', ')}`);
        const audioBuffers = loadAudioBuffersFromInput(allInputs, audioClips);

        // Debug: Log buffer sizes
        const bufferSizes = audioBuffers.map((b, i) => `${audioClips[i]?.properties.assetId}: ${b.length} bytes`);
        notify('progress', `Loaded buffers: ${bufferSizes.join(', ')}`);

        // Build audio segments with timing info
        const audioSegments: AudioSegment[] = audioClips.map((clip, index) => ({
          buffer: audioBuffers[index] ?? Buffer.alloc(0),
          startTime: clip.startTime,
          duration: clip.duration,
          clipId: clip.id,
          assetId: clip.properties.assetId,
        })).filter(seg => seg.buffer.length > 0);

        notify('progress', `Audio segments after filtering: ${audioSegments.length}`);

        // Validate STT delegation requirements early (applies to both modes)
        // This ensures dry-run catches configuration errors that would fail in live mode
        if (!handlerResolver) {
          throw createProviderError(
            SdkErrorCode.INVALID_CONFIG,
            'TranscriptionProducer requires handlerResolver to delegate to STT provider. ' +
              'Ensure the registry passes handlerResolver to internal handlers.',
            { kind: 'unknown' },
          );
        }

        // Load the STT model's input schema for delegation (both modes)
        // This validates the schema exists in the catalog
        let sttSchema: string | null = null;
        if (getModelSchema) {
          sttSchema = await getModelSchema(config.sttProvider, config.sttModel);
        }

        // Resolve the STT handler from the registry (validates handler exists)
        const sttHandler = handlerResolver({
          provider: config.sttProvider,
          model: config.sttModel,
          environment: 'local',
        });

        // Get audio URL - either from cloud upload (live) or placeholder (simulated)
        let audioUrl: string;
        if (runtime.mode === 'simulated') {
          // In simulated mode, use a placeholder URL
          // The STT handler will generate mock JSON output via the unified handler
          audioUrl = 'https://simulated.example.com/audio.wav';
          notify('progress', 'Using placeholder audio URL (simulated mode)');
        } else {
          // Live mode: concatenate audio, upload, get signed URL
          notify('progress', 'Concatenating audio segments...');
          const concatenatedAudio = await concatenateWithSilence(audioSegments, timeline.duration);

          // Upload to cloud storage and get signed URL
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
        notify('progress', `Calling speech-to-text API (${config.sttProvider}/${config.sttModel})...`);

        // Construct job context for the STT call
        // The handler will use its simulated mode logic in dry-run
        const sttJobContext: ProviderJobContext = {
          jobId: `${request.jobId}-stt`,
          provider: config.sttProvider,
          model: config.sttModel,
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
              },
              // SDK mapping tells buildPayload how to transform resolvedInputs into API payload
              // Maps input keys to their target field names in the provider's schema
              jobContext: {
                sdkMapping: {
                  audio_url: { field: 'audio_url' },
                  language_code: { field: 'language_code' },
                },
                // inputBindings maps input aliases to canonical IDs in resolvedInputs
                inputBindings: {
                  audio_url: 'audio_url',
                  language_code: 'language_code',
                },
              },
              // Pass the schema for the STT model - required by schema-first-handler
              ...(sttSchema && { schema: { raw: sttSchema } }),
            },
          },
        };

        // Invoke the STT handler (uses same code path for dry-run/live)
        const sttResult = await sttHandler.invoke(sttJobContext);

        // Extract STT output from handler result
        const sttRawOutput = extractSttOutputFromResult(sttResult);

        // Parse and align timestamps to timeline
        notify('progress', 'Aligning transcription timestamps...');
        const sttParsed = sttRawOutput as { data?: STTOutput } | STTOutput;
        const sttOutput: STTOutput = 'data' in sttParsed && sttParsed.data
          ? sttParsed.data
          : sttParsed as STTOutput;

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
            },
          }],
        };
      },
    })(init);
  };
}

function parseTranscriptionConfig(raw: unknown): TranscriptionHandlerConfig {
  const config = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};

  // Validate required sttProvider field
  if (typeof config.sttProvider !== 'string' || !config.sttProvider) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      'TranscriptionProducer requires config.sttProvider (e.g., "fal-ai", "replicate")',
      { kind: 'user_input', causedByUser: true },
    );
  }

  // Validate required sttModel field
  if (typeof config.sttModel !== 'string' || !config.sttModel) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      'TranscriptionProducer requires config.sttModel (e.g., "elevenlabs/speech-to-text")',
      { kind: 'user_input', causedByUser: true },
    );
  }

  return {
    languageCode: typeof config.languageCode === 'string' ? config.languageCode : undefined,
    sttProvider: config.sttProvider,
    sttModel: config.sttModel,
  };
}

/**
 * Extract STT output from the handler result.
 * The handler returns a ProviderResult with artifacts, we need to extract the actual STT data.
 */
function extractSttOutputFromResult(result: import('../../types.js').ProviderResult): unknown {
  // The STT handler should return the transcription in the first artifact's diagnostics
  // or in the raw output. This handles both simulated and live modes.
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

  // Try to extract from diagnostics.rawOutput (schema-first handler includes this)
  const diagnostics = firstArtifact.diagnostics as Record<string, unknown> | undefined;
  if (diagnostics?.rawOutput) {
    return diagnostics.rawOutput;
  }

  // Try to extract from blob data if present
  if (firstArtifact.blob?.data) {
    try {
      return JSON.parse(firstArtifact.blob.data.toString());
    } catch {
      // Not JSON, return as-is
      return firstArtifact.blob.data;
    }
  }

  // Fallback to diagnostics itself
  return diagnostics ?? {};
}

/**
 * Extract audio clips from timeline (Audio track only, skip Music).
 */
function extractAudioClipsFromTimeline(timeline: TimelineDocument): AudioClip[] {
  const audioClips: AudioClip[] = [];

  for (const track of timeline.tracks) {
    // Only process Audio tracks, skip Music tracks
    if (track.kind === 'Audio') {
      for (const clip of track.clips) {
        if (clip.kind === 'Audio') {
          audioClips.push(clip as AudioClip);
        }
      }
    }
  }

  // Sort by start time
  return audioClips.sort((a, b) => a.startTime - b.startTime);
}

/**
 * Load audio buffers from the fan-in input based on clip asset IDs.
 *
 * The resolved inputs contain artifact data keyed by artifact IDs.
 * We match them to clips using the assetId from timeline clip properties.
 */
function loadAudioBuffersFromInput(
  allInputs: Record<string, unknown>,
  clips: AudioClip[],
): Buffer[] {
  const buffers: Buffer[] = [];

  for (const clip of clips) {
    const assetId = clip.properties.assetId;
    let buffer: Buffer | undefined;

    // Look up the artifact data by asset ID
    const artifactData = allInputs[assetId];

    if (artifactData) {
      buffer = extractBufferFromInput(artifactData);
    }

    // If not found, try without the "Artifact:" prefix (some resolvers strip it)
    if (!buffer && assetId.startsWith('Artifact:')) {
      const shortId = assetId.replace('Artifact:', '');
      const shortData = allInputs[shortId];
      if (shortData) {
        buffer = extractBufferFromInput(shortData);
      }
    }

    buffers.push(buffer ?? Buffer.alloc(0));
  }

  return buffers;
}

/**
 * Extract a Buffer from various input formats.
 * Handles: raw Buffer, Uint8Array, BlobInput { data, mimeType }, or nested structures.
 */
function extractBufferFromInput(value: unknown): Buffer | undefined {
  // Direct Buffer
  if (Buffer.isBuffer(value)) {
    return value;
  }

  // Uint8Array (convert to Buffer)
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }

  // BlobInput structure: { data: Buffer|Uint8Array, mimeType: string }
  if (typeof value === 'object' && value !== null && 'data' in value) {
    const obj = value as { data?: unknown; mimeType?: string };
    if (Buffer.isBuffer(obj.data)) {
      return obj.data;
    }
    if (obj.data instanceof Uint8Array) {
      return Buffer.from(obj.data);
    }
  }

  // Nested blob structure: { blob: { data: Buffer } }
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
  // Generate content-addressed key
  const hash = createHash('sha256').update(audioBuffer).digest('hex');
  const prefix = hash.slice(0, 2);
  const key = `blobs/${prefix}/${hash}.wav`;

  // Upload to cloud storage
  await cloudStorage.storage.write(key, audioBuffer, { mimeType: 'audio/wav' });

  // Get signed URL
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
  extractAudioClipsFromTimeline,
  loadAudioBuffersFromInput,
  extractBufferFromInput,
  uploadAudioAndGetUrl,
};
