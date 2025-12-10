import { createMockProducerHandler } from './mock-producers.js';
import { createOpenAiLlmHandler } from './producers/llm/openai.js';
import { createMp4ExporterHandler } from './producers/export/mp4-exporter.js';
import { createTimelineProducerHandler } from './producers/timeline/ordered-timeline.js';
import { createUnifiedHandler } from './sdk/unified/index.js';
import { replicateAdapter } from './sdk/replicate/adapter.js';
import { falAdapter } from './sdk/fal/adapter.js';
import { wavespeedAdapter } from './sdk/wavespeed/adapter.js';
import type { ProviderImplementationRegistry } from './types.js';

const wildcard = '*' as const;

// Reusable handler factories for each provider
const replicateImage = () => createUnifiedHandler({ adapter: replicateAdapter, outputMimeType: 'image/png' });
const replicateVideo = () => createUnifiedHandler({ adapter: replicateAdapter, outputMimeType: 'video/mp4' });
const replicateAudio = () => createUnifiedHandler({ adapter: replicateAdapter, outputMimeType: 'audio/mpeg' });
const replicateMusic = () => createUnifiedHandler({ adapter: replicateAdapter, outputMimeType: 'audio/mpeg' });

const falImage = () => createUnifiedHandler({ adapter: falAdapter, outputMimeType: 'image/png' });
const falVideo = () => createUnifiedHandler({ adapter: falAdapter, outputMimeType: 'video/mp4' });
const falAudio = () => createUnifiedHandler({ adapter: falAdapter, outputMimeType: 'audio/mpeg' });

const wavespeedImage = () => createUnifiedHandler({ adapter: wavespeedAdapter, outputMimeType: 'image/jpeg' });

export const providerImplementations: ProviderImplementationRegistry = [
  // OpenAI LLM
  {
    match: { provider: 'openai', model: wildcard, environment: wildcard },
    mode: 'live',
    factory: createOpenAiLlmHandler(),
  },
  {
    match: { provider: 'openai', model: wildcard, environment: wildcard },
    mode: 'simulated',
    factory: createOpenAiLlmHandler(),
  },

  // Replicate Image Models
  {
    match: { provider: 'replicate', model: 'bytedance/seedream-4', environment: wildcard },
    mode: 'live',
    factory: replicateImage(),
  },
  {
    match: { provider: 'replicate', model: 'bytedance/seedream-4', environment: wildcard },
    mode: 'simulated',
    factory: replicateImage(),
  },
  {
    match: { provider: 'replicate', model: 'google/imagen-4', environment: wildcard },
    mode: 'live',
    factory: replicateImage(),
  },
  {
    match: { provider: 'replicate', model: 'google/imagen-4', environment: wildcard },
    mode: 'simulated',
    factory: replicateImage(),
  },
  {
    match: { provider: 'replicate', model: 'google/nano-banana', environment: wildcard },
    mode: 'live',
    factory: replicateImage(),
  },
  {
    match: { provider: 'replicate', model: 'google/nano-banana', environment: wildcard },
    mode: 'simulated',
    factory: replicateImage(),
  },
  {
    match: { provider: 'replicate', model: 'tencent/hunyuan-image-3', environment: wildcard },
    mode: 'live',
    factory: replicateImage(),
  },
  {
    match: { provider: 'replicate', model: 'tencent/hunyuan-image-3', environment: wildcard },
    mode: 'simulated',
    factory: replicateImage(),
  },
  {
    match: { provider: 'replicate', model: 'qwen/qwen-image', environment: wildcard },
    mode: 'live',
    factory: replicateImage(),
  },
  {
    match: { provider: 'replicate', model: 'qwen/qwen-image', environment: wildcard },
    mode: 'simulated',
    factory: replicateImage(),
  },

  // Replicate Audio Models
  {
    match: { provider: 'replicate', model: 'minimax/speech-02-hd', environment: wildcard },
    mode: 'live',
    factory: replicateAudio(),
  },
  {
    match: { provider: 'replicate', model: 'minimax/speech-02-hd', environment: wildcard },
    mode: 'simulated',
    factory: replicateAudio(),
  },
  {
    match: { provider: 'replicate', model: 'minimax/speech-2.6-hd', environment: wildcard },
    mode: 'live',
    factory: replicateAudio(),
  },
  {
    match: { provider: 'replicate', model: 'minimax/speech-2.6-hd', environment: wildcard },
    mode: 'simulated',
    factory: replicateAudio(),
  },
  {
    match: { provider: 'replicate', model: 'elevenlabs/v3', environment: wildcard },
    mode: 'live',
    factory: replicateAudio(),
  },
  {
    match: { provider: 'replicate', model: 'elevenlabs/v3', environment: wildcard },
    mode: 'simulated',
    factory: replicateAudio(),
  },

  // Replicate Video Models
  {
    match: { provider: 'replicate', model: 'bytedance/seedance-1-pro-fast', environment: wildcard },
    mode: 'live',
    factory: replicateVideo(),
  },
  {
    match: { provider: 'replicate', model: 'bytedance/seedance-1-pro-fast', environment: wildcard },
    mode: 'simulated',
    factory: replicateVideo(),
  },
  {
    match: { provider: 'replicate', model: 'bytedance/seedance-1-lite', environment: wildcard },
    mode: 'live',
    factory: replicateVideo(),
  },
  {
    match: { provider: 'replicate', model: 'bytedance/seedance-1-lite', environment: wildcard },
    mode: 'simulated',
    factory: replicateVideo(),
  },
  {
    match: { provider: 'replicate', model: 'google/veo-3.1-fast', environment: wildcard },
    mode: 'live',
    factory: replicateVideo(),
  },
  {
    match: { provider: 'replicate', model: 'google/veo-3.1-fast', environment: wildcard },
    mode: 'simulated',
    factory: replicateVideo(),
  },

  // Replicate Music Models
  {
    match: { provider: 'replicate', model: 'stability-ai/stable-audio-2.5', environment: wildcard },
    mode: 'live',
    factory: replicateMusic(),
  },
  {
    match: { provider: 'replicate', model: 'stability-ai/stable-audio-2.5', environment: wildcard },
    mode: 'simulated',
    factory: replicateMusic(),
  },
  {
    match: { provider: 'replicate', model: 'elevenlabs/music', environment: wildcard },
    mode: 'live',
    factory: replicateMusic(),
  },
  {
    match: { provider: 'replicate', model: 'elevenlabs/music', environment: wildcard },
    mode: 'simulated',
    factory: replicateMusic(),
  },

  // Fal.ai Image Models
  {
    match: { provider: 'fal-ai', model: 'bytedance/seedream/v4.5/text-to-image', environment: wildcard },
    mode: 'live',
    factory: falImage(),
  },
  {
    match: { provider: 'fal-ai', model: 'bytedance/seedream/v4.5/text-to-image', environment: wildcard },
    mode: 'simulated',
    factory: falImage(),
  },

  // Fal.ai Video Models
  {
    match: { provider: 'fal-ai', model: 'veo3.1', environment: wildcard },
    mode: 'live',
    factory: falVideo(),
  },
  {
    match: { provider: 'fal-ai', model: 'veo3.1', environment: wildcard },
    mode: 'simulated',
    factory: falVideo(),
  },

  // Fal.ai fallback (wildcard for future models)
  {
    match: { provider: 'fal-ai', model: wildcard, environment: wildcard },
    mode: 'live',
    factory: falAudio(),
  },
  {
    match: { provider: 'fal-ai', model: wildcard, environment: wildcard },
    mode: 'simulated',
    factory: falAudio(),
  },

  // Wavespeed-ai Image Models
  {
    match: { provider: 'wavespeed-ai', model: 'bytedance/seedream-v4.5', environment: wildcard },
    mode: 'live',
    factory: wavespeedImage(),
  },
  {
    match: { provider: 'wavespeed-ai', model: 'bytedance/seedream-v4.5', environment: wildcard },
    mode: 'simulated',
    factory: wavespeedImage(),
  },

  // Renku internal producers
  {
    match: { provider: 'renku', model: 'OrderedTimeline', environment: wildcard },
    mode: 'mock',
    factory: createTimelineProducerHandler(),
  },
  {
    match: { provider: 'renku', model: 'OrderedTimeline', environment: wildcard },
    mode: 'live',
    factory: createTimelineProducerHandler(),
  },
  {
    match: { provider: 'renku', model: 'OrderedTimeline', environment: wildcard },
    mode: 'simulated',
    factory: createTimelineProducerHandler(),
  },
  {
    match: { provider: 'renku', model: 'Mp4Exporter', environment: wildcard },
    mode: 'live',
    factory: createMp4ExporterHandler(),
  },
  {
    match: { provider: 'renku', model: 'Mp4Exporter', environment: wildcard },
    mode: 'simulated',
    factory: createMp4ExporterHandler(),
  },

  // Mock fallback for all unmatched providers
  {
    match: { provider: wildcard, model: wildcard, environment: wildcard },
    mode: 'mock',
    factory: createMockProducerHandler(),
  },
];
