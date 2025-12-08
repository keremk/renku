import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ProviderJobContext } from '../../src/types.js';

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

type MappingEntry = { field: string; required?: boolean };

type ModelMapping = Record<string, MappingEntry>;

const videoSchemaPaths: Record<VideoModel, string> = {
  'bytedance/seedance-1-pro-fast': '../../../catalog/producers/video/bytedance-seedance-1-pro-fast.json',
  'bytedance/seedance-1-lite': '../../../catalog/producers/video/bytedance-seedance-1-lite.json',
  'google/veo-3.1-fast': '../../../catalog/producers/video/google-veo-3-1-fast.json',
};

const audioSchemaPaths: Record<AudioModel, string> = {
  'minimax/speech-2.6-hd': '../../../catalog/producers/audio/minimax-speech.json',
  'minimax/speech-02-hd': '../../../catalog/producers/audio/minimax-speech.json',
  'elevenlabs/v3': '../../../catalog/producers/audio/elevenlabs-speech-v3.json',
};

const musicSchemaPaths: Record<MusicModel, string> = {
  'stability-ai/stable-audio-2.5': '../../../catalog/producers/music/stable-audio.json',
  'elevenlabs/music': '../../../catalog/producers/music/elevenlabs-music.json',
};

const imageSchemaPaths: Record<ImageModel, string> = {
  'bytedance/seedream-4': '../../../catalog/producers/image/bytedance-seedream-4.json',
  'google/nano-banana': '../../../catalog/producers/image/google-nano-banana.json',
  'qwen/qwen-image': '../../../catalog/producers/image/qwen-image.json',
};

// Fal.ai schema paths
const falImageSchemaPaths: Record<FalImageModel, string> = {
  'bytedance/seedream/v4.5/text-to-image': '../../../catalog/producers/image/fal-seedream4-5.json',
};

const falVideoSchemaPaths: Record<FalVideoModel, string> = {
  'veo3.1': '../../../catalog/producers/video/falai-veo3-1.json',
};

// Mirrors catalog/producers/video/video.yaml input mappings
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

// Mirrors catalog/producers/audio/audio.yaml input mappings
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

// Mirrors catalog/producers/music/music.yaml input mappings
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

// Mirrors catalog/producers/image/image.yaml input mappings
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

function resolveSchemaPath(relative: string): string {
  return resolve(new URL('.', import.meta.url).pathname, relative);
}

function loadSchemaForModel<TModel extends string>(
  schemaPaths: Record<TModel, string>,
  model: TModel,
): string {
  const relative = schemaPaths[model];
  if (!relative) {
    throw new Error(`No schema path registered for model: ${model}`);
  }
  return readFileSync(resolveSchemaPath(relative), 'utf-8');
}

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

function buildExtras<TModel extends string>(
  args: {
    model: TModel;
    resolvedInputs: Record<string, unknown>;
    schemaPaths: Record<TModel, string>;
    modelMappings: Record<TModel, ModelMapping>;
    requiredAliases: string[];
    plannerIndex?: { segment?: number; image?: number };
    extraMapping?: ModelMapping;
  },
): ProviderJobContext['context']['extras'] {
  const schemaText = loadSchemaForModel(args.schemaPaths, args.model);
  const mapping = mergeMappings(args.modelMappings[args.model], args.extraMapping);
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

export function loadSchema(model: VideoModel): string {
  return loadSchemaForModel(videoSchemaPaths, model);
}

export function getVideoMapping(model: VideoModel): ModelMapping {
  const mapping = videoModelMappings[model];
  if (!mapping) {
    throw new Error(`No mapping registered for model: ${model}`);
  }
  return mapping;
}

export function buildVideoExtras(
  model: VideoModel,
  resolvedInputs: Record<string, unknown>,
  extraMapping?: ModelMapping,
): ProviderJobContext['context']['extras'] {
  return buildExtras({
    model,
    resolvedInputs,
    schemaPaths: videoSchemaPaths,
    modelMappings: videoModelMappings,
    requiredAliases: ['Prompt'],
    extraMapping,
  });
}

export function loadAudioSchema(model: AudioModel): string {
  return loadSchemaForModel(audioSchemaPaths, model);
}

export function getAudioMapping(model: AudioModel): ModelMapping {
  const mapping = audioModelMappings[model];
  if (!mapping) {
    throw new Error(`No mapping registered for model: ${model}`);
  }
  return mapping;
}

export function buildAudioExtras(
  model: AudioModel,
  resolvedInputs: Record<string, unknown>,
  extraMapping?: ModelMapping,
): ProviderJobContext['context']['extras'] {
  return buildExtras({
    model,
    resolvedInputs,
    schemaPaths: audioSchemaPaths,
    modelMappings: audioModelMappings,
    requiredAliases: ['TextInput', 'VoiceId'],
    plannerIndex: { segment: 0 },
    extraMapping,
  });
}

export function loadMusicSchema(model: MusicModel): string {
  return loadSchemaForModel(musicSchemaPaths, model);
}

export function getMusicMapping(model: MusicModel): ModelMapping {
  const mapping = musicModelMappings[model];
  if (!mapping) {
    throw new Error(`No mapping registered for model: ${model}`);
  }
  return mapping;
}

export function buildMusicExtras(
  model: MusicModel,
  resolvedInputs: Record<string, unknown>,
  extraMapping?: ModelMapping,
): ProviderJobContext['context']['extras'] {
  return buildExtras({
    model,
    resolvedInputs,
    schemaPaths: musicSchemaPaths,
    modelMappings: musicModelMappings,
    requiredAliases: ['Prompt', 'Duration'],
    plannerIndex: { segment: 0 },
    extraMapping,
  });
}

export function loadImageSchema(model: ImageModel): string {
  return loadSchemaForModel(imageSchemaPaths, model);
}

export function getImageMapping(model: ImageModel): ModelMapping {
  const mapping = imageModelMappings[model];
  if (!mapping) {
    throw new Error(`No mapping registered for model: ${model}`);
  }
  return mapping;
}

export function buildImageExtras(
  model: ImageModel,
  resolvedInputs: Record<string, unknown>,
  extraMapping?: ModelMapping,
): ProviderJobContext['context']['extras'] {
  return buildExtras({
    model,
    resolvedInputs,
    schemaPaths: imageSchemaPaths,
    modelMappings: imageModelMappings,
    requiredAliases: ['Prompt'],
    plannerIndex: { segment: 0, image: 0 },
    extraMapping,
  });
}

// Fal.ai helper functions
export function loadFalImageSchema(model: FalImageModel): string {
  return loadSchemaForModel(falImageSchemaPaths, model);
}

export function getFalImageMapping(model: FalImageModel): ModelMapping {
  const mapping = falImageModelMappings[model];
  if (!mapping) {
    throw new Error(`No mapping registered for fal.ai model: ${model}`);
  }
  return mapping;
}

export function buildFalImageExtras(
  model: FalImageModel,
  resolvedInputs: Record<string, unknown>,
  extraMapping?: ModelMapping,
): ProviderJobContext['context']['extras'] {
  return buildExtras({
    model,
    resolvedInputs,
    schemaPaths: falImageSchemaPaths,
    modelMappings: falImageModelMappings,
    requiredAliases: ['Prompt'],
    plannerIndex: { segment: 0, image: 0 },
    extraMapping,
  });
}

export function loadFalVideoSchema(model: FalVideoModel): string {
  return loadSchemaForModel(falVideoSchemaPaths, model);
}

export function getFalVideoMapping(model: FalVideoModel): ModelMapping {
  const mapping = falVideoModelMappings[model];
  if (!mapping) {
    throw new Error(`No mapping registered for fal.ai model: ${model}`);
  }
  return mapping;
}

export function buildFalVideoExtras(
  model: FalVideoModel,
  resolvedInputs: Record<string, unknown>,
  extraMapping?: ModelMapping,
): ProviderJobContext['context']['extras'] {
  return buildExtras({
    model,
    resolvedInputs,
    schemaPaths: falVideoSchemaPaths,
    modelMappings: falVideoModelMappings,
    requiredAliases: ['Prompt'],
    plannerIndex: { segment: 0 },
    extraMapping,
  });
}
