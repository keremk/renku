export { createProviderRegistry, type CreateProviderRegistryOptions } from './registry.js';
export { SchemaRegistry } from './schema-registry.js';
export * from './sdk/index.js';
export * from './producers/cost-functions.js';
export { loadModelCatalog, lookupModel, loadModelInputSchema, loadModelSchemaFile, type LoadedModelCatalog, type ModelDefinition, type ModelType, type ProducerModelEntry, type SchemaFile } from './model-catalog.js';
export * from './produce/provider-produce.js';
export type {
  ProviderRegistry,
  ProviderRegistryOptions,
  ProviderDescriptor,
  ProviderMode,
  ProviderEnvironment,
  ProducerHandler,
  ProviderJobContext,
  ProviderResult,
  ProviderContextPayload,
  ProviderAttachment,
  ResolvedProviderHandler,
} from './types.js';

// Transcription exports for E2E testing
export {
  concatenateWithSilence,
  buildMixCommand,
  findClipForTimestamp,
  extractTextForClip,
  alignTranscriptionToTimeline,
  type AudioSegment,
  type STTOutput,
  type STTWord,
  type TranscriptionArtifact,
  type TranscriptionSegment,
  type TranscriptionWord,
} from './producers/transcription/index.js';

// Karaoke renderer exports for E2E testing
export {
  buildKaraokeFilter,
  buildKaraokeFilterChain,
  escapeDrawtext,
  type KaraokeRenderOptions,
  type HighlightAnimation,
} from './producers/export/ffmpeg/karaoke-renderer.js';

// FFmpeg exporter config types
export type {
  FfmpegExporterConfig,
  SubtitleConfig,
} from './producers/export/ffmpeg/types.js';
