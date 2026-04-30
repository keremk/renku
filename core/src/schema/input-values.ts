import { z } from 'zod';

export const InputIdList = [
  'InquiryPrompt',
  'MovieDirectionPromptInput',
  'MusicPromptInput',
  'SegmentNarrationInput',
  'VoiceId',
  'Emotion',
  'Audience',
  'Language',
  'Duration',
  'ClipDuration',
  'ImagesPerSegment',
  'SegmentImagePromptInput',
  'Style',
  'Size',
  'AspectRatio',
  'StartingImagePromptInput',
  'SegmentAnimations',
  'AssemblyStrategy',
] as const;

export type InputId = typeof InputIdList[number];

type InputValueTypeMap = {
  InquiryPrompt: string;
  MovieDirectionPromptInput: string;
  MusicPromptInput: string;
  SegmentNarrationInput: string[];
  VoiceId: string;
  Emotion: string;
  Audience: string;
  Language: string;
  Duration: number;
  ClipDuration: number;
  ImagesPerSegment: number;
  SegmentImagePromptInput: string[];
  Style: string;
  Size: string;
  AspectRatio: string;
  StartingImagePromptInput: string;
  SegmentAnimations: Record<string, unknown>;
  AssemblyStrategy: string;
};

const InputValueShape = z
  .object({
    InquiryPrompt: z.string(),
    MovieDirectionPromptInput: z.string(),
    MusicPromptInput: z.string(),
    SegmentNarrationInput: z.array(z.string()),
    VoiceId: z.string(),
    Emotion: z.string(),
    Audience: z.string(),
    Language: z.string(),
    Duration: z.number().positive(),
    ClipDuration: z.number().positive(),
    ImagesPerSegment: z.number().int().nonnegative(),
    SegmentImagePromptInput: z.array(z.string()),
    Style: z.string(),
    Size: z.string(),
    AspectRatio: z.string(),
    StartingImagePromptInput: z.string(),
    SegmentAnimations: z.record(z.string(), z.unknown()),
    AssemblyStrategy: z.string(),
  })
  .partial()
  .strict();

export const InputValuesSchema = InputValueShape;

export type InputValues = z.infer<typeof InputValuesSchema>;

export type InputValueFor<Id extends InputId> = InputValueTypeMap[Id];
