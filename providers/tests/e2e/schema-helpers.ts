import { readFileSync } from 'node:fs';
import type { ProviderJobContext } from '../../src/types.js';
import {
  loadModelCatalog,
  lookupModel,
  resolveSchemaPath as resolveSchemaPathFromCatalog,
  type LoadedModelCatalog,
} from '../../src/model-catalog.js';
import { CATALOG_MODELS_ROOT } from '../test-catalog-paths.js';

// Catalog directory - uses shared test utility
const CATALOG_DIR = CATALOG_MODELS_ROOT;

// Cached catalog instance
let catalogCache: LoadedModelCatalog | null = null;

/**
 * Get the model catalog (cached singleton).
 */
async function getCatalog(): Promise<LoadedModelCatalog> {
  if (!catalogCache) {
    catalogCache = await loadModelCatalog(CATALOG_DIR);
  }
  return catalogCache;
}

/**
 * Load schema from the model catalog dynamically.
 * Uses the same path resolution logic as production code.
 */
async function loadSchemaFromCatalog(
  provider: string,
  model: string,
): Promise<string> {
  const catalog = await getCatalog();
  const modelDef = lookupModel(catalog, provider, model);

  if (!modelDef) {
    throw new Error(`Model not found in catalog: ${provider}/${model}`);
  }

  const schemaPath = resolveSchemaPathFromCatalog(CATALOG_DIR, provider, model, modelDef);
  return readFileSync(schemaPath, 'utf-8');
}

// Model type definitions
export type VideoModel =
  | 'bytedance/seedance-1-pro-fast'
  | 'bytedance/seedance-1-lite'
  | 'google/veo-3.1-fast';

export type AudioModel =
  | 'minimax/speech-2.6-hd'
  | 'minimax/speech-02-hd'
  | 'elevenlabs/v3';

export type MusicModel = 'stability-ai/stable-audio-2.5' | 'elevenlabs/music';

export type ImageModel = 'bytedance/seedream-4' | 'google/nano-banana' | 'qwen/qwen-image';

// Fal.ai model types
export type FalImageModel = 'bytedance/seedream/v4.5/text-to-image';
export type FalVideoModel = 'veo3.1';

// Wavespeed-ai model types
export type WavespeedImageModel = 'bytedance/seedream-v4.5';

type MappingEntry = { field: string; required?: boolean };

type ModelMapping = Record<string, MappingEntry>;

// Provider mapping for each model type
const VIDEO_MODEL_PROVIDERS: Record<VideoModel, string> = {
  'bytedance/seedance-1-pro-fast': 'replicate',
  'bytedance/seedance-1-lite': 'replicate',
  'google/veo-3.1-fast': 'replicate',
};

const AUDIO_MODEL_PROVIDERS: Record<AudioModel, string> = {
  'minimax/speech-2.6-hd': 'replicate',
  'minimax/speech-02-hd': 'replicate',
  'elevenlabs/v3': 'fal-ai',
};

const MUSIC_MODEL_PROVIDERS: Record<MusicModel, string> = {
  'stability-ai/stable-audio-2.5': 'replicate',
  'elevenlabs/music': 'fal-ai',
};

const IMAGE_MODEL_PROVIDERS: Record<ImageModel, string> = {
  'bytedance/seedream-4': 'replicate',
  'google/nano-banana': 'replicate',
  'qwen/qwen-image': 'replicate',
};

// Input field mappings (test-specific configuration)
const videoModelMappings: Record<VideoModel, ModelMapping> = {
  'bytedance/seedance-1-pro-fast': {
    Prompt: { field: 'prompt', required: true },
    AspectRatio: { field: 'aspect_ratio', required: true },
    Resolution: { field: 'resolution', required: false },
    SegmentDuration: { field: 'duration', required: false },
  },
  'bytedance/seedance-1-lite': {
    Prompt: { field: 'prompt', required: true },
    AspectRatio: { field: 'aspect_ratio', required: true },
    Resolution: { field: 'resolution', required: false },
    SegmentDuration: { field: 'duration', required: false },
  },
  'google/veo-3.1-fast': {
    Prompt: { field: 'prompt', required: true },
    AspectRatio: { field: 'aspect_ratio', required: true },
    Resolution: { field: 'resolution', required: false },
    SegmentDuration: { field: 'duration', required: false },
  },
};

const audioModelMappings: Record<AudioModel, ModelMapping> = {
  'minimax/speech-2.6-hd': {
    TextInput: { field: 'text', required: true },
    Emotion: { field: 'emotion', required: false },
    VoiceId: { field: 'voice_id', required: true },
  },
  'minimax/speech-02-hd': {
    TextInput: { field: 'text', required: true },
    Emotion: { field: 'emotion', required: false },
    VoiceId: { field: 'voice_id', required: true },
  },
  'elevenlabs/v3': {
    TextInput: { field: 'prompt', required: true },
    VoiceId: { field: 'voice', required: true },
  },
};

const musicModelMappings: Record<MusicModel, ModelMapping> = {
  'stability-ai/stable-audio-2.5': {
    Prompt: { field: 'prompt', required: true },
    Duration: { field: 'duration', required: true },
  },
  'elevenlabs/music': {
    Prompt: { field: 'prompt', required: true },
    Duration: { field: 'music_length_ms', required: true },
  },
};

const imageModelMappings: Record<ImageModel, ModelMapping> = {
  'bytedance/seedream-4': {
    Prompt: { field: 'prompt', required: true },
    AspectRatio: { field: 'aspect_ratio', required: false },
    Size: { field: 'output_size', required: false },
  },
  'google/nano-banana': {
    Prompt: { field: 'prompt', required: true },
    AspectRatio: { field: 'aspect_ratio', required: false },
  },
  'qwen/qwen-image': {
    Prompt: { field: 'prompt', required: true },
    AspectRatio: { field: 'aspect_ratio', required: false },
    ImageInput: { field: 'image_input', required: false },
  },
};

// Fal.ai model mappings
const falImageModelMappings: Record<FalImageModel, ModelMapping> = {
  'bytedance/seedream/v4.5/text-to-image': {
    Prompt: { field: 'prompt', required: true },
    Size: { field: 'image_size', required: false },
    NumImages: { field: 'num_images', required: false },
  },
};

const falVideoModelMappings: Record<FalVideoModel, ModelMapping> = {
  'veo3.1': {
    Prompt: { field: 'prompt', required: true },
    AspectRatio: { field: 'aspect_ratio', required: false },
    Resolution: { field: 'resolution', required: false },
    SegmentDuration: { field: 'duration', required: false },
  },
};

// Wavespeed-ai model mappings
const wavespeedImageModelMappings: Record<WavespeedImageModel, ModelMapping> = {
  'bytedance/seedream-v4.5': {
    Prompt: { field: 'prompt', required: true },
    Size: { field: 'size', required: false },
  },
};

function mergeMappings(base: ModelMapping, extra?: ModelMapping): ModelMapping {
  return { ...base, ...(extra ?? {}) };
}

function computeMappingFromSchema(
  schemaText: string,
  mapping: ModelMapping,
  requiredAliases: string[] = [],
): Record<string, MappingEntry> {
  const schema = JSON.parse(schemaText) as { properties?: Record<string, unknown> };
  const properties = schema.properties ?? {};

  const resolved: Record<string, MappingEntry> = {};
  for (const [alias, spec] of Object.entries(mapping)) {
    if (!(spec.field in properties)) {
      throw new Error(`Schema is missing expected field "${spec.field}" for alias "${alias}".`);
    }
    resolved[alias] = spec;
  }

  for (const alias of requiredAliases) {
    if (!resolved[alias]) {
      throw new Error(`${alias} mapping is required for this test.`);
    }
  }

  return resolved;
}

async function buildExtras(
  args: {
    provider: string;
    model: string;
    resolvedInputs: Record<string, unknown>;
    modelMappings: ModelMapping;
    requiredAliases: string[];
    plannerIndex?: { segment?: number; image?: number };
    extraMapping?: ModelMapping;
  },
): Promise<ProviderJobContext['context']['extras']> {
  const schemaText = await loadSchemaFromCatalog(args.provider, args.model);
  const mapping = mergeMappings(args.modelMappings, args.extraMapping);
  const sdkMapping = computeMappingFromSchema(schemaText, mapping, args.requiredAliases);

  const inputBindings: Record<string, string> = {};
  for (const alias of Object.keys(sdkMapping)) {
    inputBindings[alias] = `Input:${alias}`;
  }

  return {
    resolvedInputs: args.resolvedInputs,
    jobContext: {
      inputBindings,
      sdkMapping,
    },
    plannerContext: { index: args.plannerIndex ?? { segment: 0 } },
    schema: { input: schemaText },
  };
}

// Video helpers
export async function loadSchema(model: VideoModel): Promise<string> {
  const provider = VIDEO_MODEL_PROVIDERS[model];
  return loadSchemaFromCatalog(provider, model);
}

export function getVideoMapping(model: VideoModel): ModelMapping {
  const mapping = videoModelMappings[model];
  if (!mapping) {
    throw new Error(`No mapping registered for model: ${model}`);
  }
  return mapping;
}

export async function buildVideoExtras(
  model: VideoModel,
  resolvedInputs: Record<string, unknown>,
  extraMapping?: ModelMapping,
): Promise<ProviderJobContext['context']['extras']> {
  const provider = VIDEO_MODEL_PROVIDERS[model];
  return buildExtras({
    provider,
    model,
    resolvedInputs,
    modelMappings: videoModelMappings[model],
    requiredAliases: ['Prompt'],
    extraMapping,
  });
}

// Audio helpers
export async function loadAudioSchema(model: AudioModel): Promise<string> {
  const provider = AUDIO_MODEL_PROVIDERS[model];
  return loadSchemaFromCatalog(provider, model);
}

export function getAudioMapping(model: AudioModel): ModelMapping {
  const mapping = audioModelMappings[model];
  if (!mapping) {
    throw new Error(`No mapping registered for model: ${model}`);
  }
  return mapping;
}

export async function buildAudioExtras(
  model: AudioModel,
  resolvedInputs: Record<string, unknown>,
  extraMapping?: ModelMapping,
): Promise<ProviderJobContext['context']['extras']> {
  const provider = AUDIO_MODEL_PROVIDERS[model];
  return buildExtras({
    provider,
    model,
    resolvedInputs,
    modelMappings: audioModelMappings[model],
    requiredAliases: ['TextInput', 'VoiceId'],
    plannerIndex: { segment: 0 },
    extraMapping,
  });
}

// Music helpers
export async function loadMusicSchema(model: MusicModel): Promise<string> {
  const provider = MUSIC_MODEL_PROVIDERS[model];
  return loadSchemaFromCatalog(provider, model);
}

export function getMusicMapping(model: MusicModel): ModelMapping {
  const mapping = musicModelMappings[model];
  if (!mapping) {
    throw new Error(`No mapping registered for model: ${model}`);
  }
  return mapping;
}

export async function buildMusicExtras(
  model: MusicModel,
  resolvedInputs: Record<string, unknown>,
  extraMapping?: ModelMapping,
): Promise<ProviderJobContext['context']['extras']> {
  const provider = MUSIC_MODEL_PROVIDERS[model];
  return buildExtras({
    provider,
    model,
    resolvedInputs,
    modelMappings: musicModelMappings[model],
    requiredAliases: ['Prompt', 'Duration'],
    plannerIndex: { segment: 0 },
    extraMapping,
  });
}

// Image helpers
export async function loadImageSchema(model: ImageModel): Promise<string> {
  const provider = IMAGE_MODEL_PROVIDERS[model];
  return loadSchemaFromCatalog(provider, model);
}

export function getImageMapping(model: ImageModel): ModelMapping {
  const mapping = imageModelMappings[model];
  if (!mapping) {
    throw new Error(`No mapping registered for model: ${model}`);
  }
  return mapping;
}

export async function buildImageExtras(
  model: ImageModel,
  resolvedInputs: Record<string, unknown>,
  extraMapping?: ModelMapping,
): Promise<ProviderJobContext['context']['extras']> {
  const provider = IMAGE_MODEL_PROVIDERS[model];
  return buildExtras({
    provider,
    model,
    resolvedInputs,
    modelMappings: imageModelMappings[model],
    requiredAliases: ['Prompt'],
    plannerIndex: { segment: 0, image: 0 },
    extraMapping,
  });
}

// Fal.ai image helpers
export async function loadFalImageSchema(model: FalImageModel): Promise<string> {
  return loadSchemaFromCatalog('fal-ai', model);
}

export function getFalImageMapping(model: FalImageModel): ModelMapping {
  const mapping = falImageModelMappings[model];
  if (!mapping) {
    throw new Error(`No mapping registered for fal.ai model: ${model}`);
  }
  return mapping;
}

export async function buildFalImageExtras(
  model: FalImageModel,
  resolvedInputs: Record<string, unknown>,
  extraMapping?: ModelMapping,
): Promise<ProviderJobContext['context']['extras']> {
  return buildExtras({
    provider: 'fal-ai',
    model,
    resolvedInputs,
    modelMappings: falImageModelMappings[model],
    requiredAliases: ['Prompt'],
    plannerIndex: { segment: 0, image: 0 },
    extraMapping,
  });
}

// Fal.ai video helpers
export async function loadFalVideoSchema(model: FalVideoModel): Promise<string> {
  return loadSchemaFromCatalog('fal-ai', model);
}

export function getFalVideoMapping(model: FalVideoModel): ModelMapping {
  const mapping = falVideoModelMappings[model];
  if (!mapping) {
    throw new Error(`No mapping registered for fal.ai model: ${model}`);
  }
  return mapping;
}

export async function buildFalVideoExtras(
  model: FalVideoModel,
  resolvedInputs: Record<string, unknown>,
  extraMapping?: ModelMapping,
): Promise<ProviderJobContext['context']['extras']> {
  return buildExtras({
    provider: 'fal-ai',
    model,
    resolvedInputs,
    modelMappings: falVideoModelMappings[model],
    requiredAliases: ['Prompt'],
    plannerIndex: { segment: 0 },
    extraMapping,
  });
}

// Wavespeed-ai image helpers
export async function loadWavespeedImageSchema(model: WavespeedImageModel): Promise<string> {
  return loadSchemaFromCatalog('wavespeed-ai', model);
}

export function getWavespeedImageMapping(model: WavespeedImageModel): ModelMapping {
  const mapping = wavespeedImageModelMappings[model];
  if (!mapping) {
    throw new Error(`No mapping registered for wavespeed-ai model: ${model}`);
  }
  return mapping;
}

export async function buildWavespeedImageExtras(
  model: WavespeedImageModel,
  resolvedInputs: Record<string, unknown>,
  extraMapping?: ModelMapping,
): Promise<ProviderJobContext['context']['extras']> {
  return buildExtras({
    provider: 'wavespeed-ai',
    model,
    resolvedInputs,
    modelMappings: wavespeedImageModelMappings[model],
    requiredAliases: ['Prompt'],
    plannerIndex: { segment: 0, image: 0 },
    extraMapping,
  });
}
