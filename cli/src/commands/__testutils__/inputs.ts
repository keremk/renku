import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { INPUT_FILE_NAME } from '../../lib/input-files.js';

export interface CreateInputsFileOptions {
  root: string;
  prompt: string;
  fileName?: string;
  overrides?: Record<string, string | number>;
  includeDefaults?: boolean;
  models?: Array<{
    producerId: string;
    provider: string;
    model: string;
    config?: Record<string, unknown>;
  }>;
}

const DEFAULT_INPUT_VALUES: Record<string, string | number> = {
  Duration: 60,
  NumOfSegments: 3,
  AspectRatio: '16:9',
  Resolution: '480p',
  SegmentDuration: 10,
  Style: 'cinematic',
  Audience: 'Adult',
  VoiceId: 'default-voice',
  Language: 'en',
};

export async function createInputsFile(options: CreateInputsFileOptions): Promise<string> {
  const {
    root,
    prompt,
    fileName = INPUT_FILE_NAME,
    overrides,
    includeDefaults = true,
    models,
  } = options;
  const base = includeDefaults ? DEFAULT_INPUT_VALUES : {};
  const values: Record<string, string | number> = {
    InquiryPrompt: prompt,
    ...base,
    ...(overrides ?? {}),
  };

  const modelsList =
    models ??
    [
      { producerId: 'ScriptProducer', provider: 'openai', model: 'gpt-5-mini' },
      { producerId: 'VideoPromptProducer', provider: 'openai', model: 'gpt-5-mini' },
      { producerId: 'VideoProducer', provider: 'replicate', model: 'bytedance/seedance-1-pro-fast' },
      { producerId: 'AudioProducer', provider: 'replicate', model: 'minimax/speech-2.6-hd' },
      { producerId: 'MusicPromptProducer', provider: 'openai', model: 'gpt-5-mini' },
      { producerId: 'MusicProducer', provider: 'replicate', model: 'stability-ai/stable-audio-2.5' },
      {
        producerId: 'TimelineComposer',
        provider: 'renku',
        model: 'OrderedTimeline',
        config: {
          tracks: ['Video', 'Audio', 'Music'],
        },
      },
      { producerId: 'VideoExporter', provider: 'renku', model: 'Mp4Exporter' },
    ];

  const contents = stringifyYaml({
    inputs: values,
    models: modelsList,
  });

  const filePath = join(root, fileName);
  await writeFile(filePath, contents, 'utf8');
  return filePath;
}
