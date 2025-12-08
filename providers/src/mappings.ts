import { createMockProducerHandler } from './mock-producers.js';
import { createOpenAiLlmHandler } from './producers/llm/openai.js';
import { createReplicateTextToImageHandler } from './producers/image/replicate-text-to-image.js';
import { createReplicateAudioHandler } from './producers/audio/replicate-audio.js';
import { createReplicateVideoHandler } from './producers/video/replicate-video.js';
import { createMp4ExporterHandler } from './producers/export/mp4-exporter.js';
import { createReplicateMusicHandler } from './producers/music/replicate-music.js';
import { createTimelineProducerHandler } from './producers/timeline/ordered-timeline.js';
import { createFalImageHandler } from './producers/image/fal-image.js';
import { createFalVideoHandler } from './producers/video/fal-video.js';
import { createFalAudioHandler } from './producers/audio/fal-audio.js';
import { createFalMusicHandler } from './producers/music/fal-music.js';
import type { ProviderImplementationRegistry } from './types.js';

const wildcard = '*' as const;

export const providerImplementations: ProviderImplementationRegistry = [
  {
    match: {
      provider: 'renku',
      model: 'OrderedTimeline',
      environment: wildcard,
    },
    mode: 'mock',
    factory: createTimelineProducerHandler(),
  },
  {
    match: {
      provider: 'openai',
      model: wildcard,
      environment: wildcard,
    },
    mode: 'live',
    factory: createOpenAiLlmHandler(),
  },
  {
    match: {
      provider: 'openai',
      model: wildcard,
      environment: wildcard,
    },
    mode: 'simulated',
    factory: createOpenAiLlmHandler(),
  },
  // Replicate Image Models
  {
    match: {
      provider: 'replicate',
      model: 'bytedance/seedream-4',
      environment: wildcard,
    },
    mode: 'live',
    factory: createReplicateTextToImageHandler(),
  },
  {
    match: {
      provider: 'replicate',
      model: 'bytedance/seedream-4',
      environment: wildcard,
    },
    mode: 'simulated',
    factory: createReplicateTextToImageHandler(),
  },
  {
    match: {
      provider: 'replicate',
      model: 'google/imagen-4',
      environment: wildcard,
    },
    mode: 'live',
    factory: createReplicateTextToImageHandler(),
  },
  {
    match: {
      provider: 'replicate',
      model: 'google/imagen-4',
      environment: wildcard,
    },
    mode: 'simulated',
    factory: createReplicateTextToImageHandler(),
  },
  {
    match: {
      provider: 'replicate',
      model: 'google/nano-banana',
      environment: wildcard,
    },
    mode: 'live',
    factory: createReplicateTextToImageHandler(),
  },
  {
    match: {
      provider: 'replicate',
      model: 'google/nano-banana',
      environment: wildcard,
    },
    mode: 'simulated',
    factory: createReplicateTextToImageHandler(),
  },
  {
    match: {
      provider: 'replicate',
      model: 'tencent/hunyuan-image-3',
      environment: wildcard,
    },
    mode: 'live',
    factory: createReplicateTextToImageHandler(),
  },
  {
    match: {
      provider: 'replicate',
      model: 'tencent/hunyuan-image-3',
      environment: wildcard,
    },
    mode: 'simulated',
    factory: createReplicateTextToImageHandler(),
  },
  // Replicate Audio Models
  {
    match: {
      provider: 'replicate',
      model: 'minimax/speech-02-hd',
      environment: wildcard,
    },
    mode: 'live',
    factory: createReplicateAudioHandler(),
  },
  {
    match: {
      provider: 'replicate',
      model: 'minimax/speech-02-hd',
      environment: wildcard,
    },
    mode: 'simulated',
    factory: createReplicateAudioHandler(),
  },
  {
    match: {
      provider: 'replicate',
      model: 'minimax/speech-2.6-hd',
      environment: wildcard,
    },
    mode: 'live',
    factory: createReplicateAudioHandler(),
  },
  {
    match: {
      provider: 'replicate',
      model: 'minimax/speech-2.6-hd',
      environment: wildcard,
    },
    mode: 'simulated',
    factory: createReplicateAudioHandler(),
  },
  {
    match: {
      provider: 'replicate',
      model: 'elevenlabs/v3',
      environment: wildcard,
    },
    mode: 'live',
    factory: createReplicateAudioHandler(),
  },
  {
    match: {
      provider: 'replicate',
      model: 'elevenlabs/v3',
      environment: wildcard,
    },
    mode: 'simulated',
    factory: createReplicateAudioHandler(),
  },
  // Replicate Video Models
  {
    match: {
      provider: 'replicate',
      model: 'bytedance/seedance-1-pro-fast',
      environment: wildcard,
    },
    mode: 'live',
    factory: createReplicateVideoHandler(),
  },
  {
    match: {
      provider: 'replicate',
      model: 'bytedance/seedance-1-pro-fast',
      environment: wildcard,
    },
    mode: 'simulated',
    factory: createReplicateVideoHandler(),
  },
  {
    match: {
      provider: 'replicate',
      model: 'bytedance/seedance-1-lite',
      environment: wildcard,
    },
    mode: 'live',
    factory: createReplicateVideoHandler(),
  },
  {
    match: {
      provider: 'replicate',
      model: 'bytedance/seedance-1-lite',
      environment: wildcard,
    },
    mode: 'simulated',
    factory: createReplicateVideoHandler(),
  },
  {
    match: {
      provider: 'replicate',
      model: 'google/veo-3.1-fast',
      environment: wildcard,
    },
    mode: 'live',
    factory: createReplicateVideoHandler(),
  },
  {
    match: {
      provider: 'replicate',
      model: 'google/veo-3.1-fast',
      environment: wildcard,
    },
    mode: 'simulated',
    factory: createReplicateVideoHandler(),
  },
  // Replicate Music Models
  {
    match: {
      provider: 'replicate',
      model: 'stability-ai/stable-audio-2.5',
      environment: wildcard,
    },
    mode: 'live',
    factory: createReplicateMusicHandler(),
  },
  {
    match: {
      provider: 'replicate',
      model: 'stability-ai/stable-audio-2.5',
      environment: wildcard,
    },
    mode: 'simulated',
    factory: createReplicateMusicHandler(),
  },
  {
    match: {
      provider: 'replicate',
      model: 'elevenlabs/music',
      environment: wildcard,
    },
    mode: 'live',
    factory: createReplicateMusicHandler(),
  },
  {
    match: {
      provider: 'replicate',
      model: 'elevenlabs/music',
      environment: wildcard,
    },
    mode: 'simulated',
    factory: createReplicateMusicHandler(),
  },
  // Fal.ai Image Models
  {
    match: {
      provider: 'fal-ai',
      model: 'bytedance/seedream/v4.5/text-to-image',
      environment: wildcard,
    },
    mode: 'live',
    factory: createFalImageHandler(),
  },
  {
    match: {
      provider: 'fal-ai',
      model: 'bytedance/seedream/v4.5/text-to-image',
      environment: wildcard,
    },
    mode: 'simulated',
    factory: createFalImageHandler(),
  },
  // Fal.ai Video Models
  {
    match: {
      provider: 'fal-ai',
      model: 'veo3.1',
      environment: wildcard,
    },
    mode: 'live',
    factory: createFalVideoHandler(),
  },
  {
    match: {
      provider: 'fal-ai',
      model: 'veo3.1',
      environment: wildcard,
    },
    mode: 'simulated',
    factory: createFalVideoHandler(),
  },
  // Fal.ai Audio Models (placeholder for future schemas)
  {
    match: {
      provider: 'fal-ai',
      model: wildcard,
      environment: wildcard,
    },
    mode: 'live',
    factory: createFalAudioHandler(),
  },
  {
    match: {
      provider: 'fal-ai',
      model: wildcard,
      environment: wildcard,
    },
    mode: 'simulated',
    factory: createFalAudioHandler(),
  },
  {
    match: {
      provider: 'renku',
      model: 'OrderedTimeline',
      environment: wildcard,
    },
    mode: 'live',
    factory: createTimelineProducerHandler(),
  },
  {
    match: {
      provider: 'renku',
      model: 'OrderedTimeline',
      environment: wildcard,
    },
    mode: 'simulated',
    factory: createTimelineProducerHandler(),
  },
  {
    match: {
      provider: 'renku',
      model: 'Mp4Exporter',
      environment: wildcard,
    },
    mode: 'live',
    factory: createMp4ExporterHandler(),
  },
  {
    match: {
      provider: 'renku',
      model: 'Mp4Exporter',
      environment: wildcard,
    },
    mode: 'simulated',
    factory: createMp4ExporterHandler(),
  },
  {
    match: {
      provider: wildcard,
      model: wildcard,
      environment: wildcard,
    },
    mode: 'mock',
    factory: createMockProducerHandler(),
  },
];
