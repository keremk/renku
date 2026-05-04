import type {
  CastDesignTab,
  CastTabContent,
  GenerationSettings,
} from '../cast-types';
import baseSheetUrl from './assets/character-sheet-base.png';
import sheet16x9Url from './assets/character-sheet-16x9.png';
import campaignSheetUrl from './assets/character-sheet-campaign.png';
import courtSheetUrl from './assets/character-sheet-court.png';
import costume4x3Url from './assets/costume-reference-4x3.png';
import fullBody9x16Url from './assets/full-body-9x16.png';
import portrait1x1Url from './assets/portrait-reference-1x1.png';

const descriptionText = `Young Ottoman ruler, controlled and austere, with a court presence that should feel intelligent rather than theatrical.

- Carries authority through stillness rather than performance.
- Costume language should be royal, severe, and practical.
- Face references should stay young without becoming soft.`;

const sheetTakes = [
  {
    title: '16:9 sheet',
    imageUrl: sheet16x9Url,
    aspect: 'sheet' as const,
  },
  {
    title: '4:3 costume',
    imageUrl: costume4x3Url,
    aspect: 'ratio-4-3' as const,
  },
  {
    title: '1:1 portrait',
    imageUrl: portrait1x1Url,
    aspect: 'square' as const,
  },
  {
    title: '9:16 full body',
    imageUrl: fullBody9x16Url,
    aspect: 'ratio-9-16' as const,
  },
  {
    title: 'Wide sheet',
    imageUrl: baseSheetUrl,
    aspect: 'wide' as const,
  },
  {
    title: 'Court sheet',
    imageUrl: courtSheetUrl,
    aspect: 'sheet' as const,
  },
  {
    title: 'Campaign sheet',
    imageUrl: campaignSheetUrl,
    aspect: 'sheet' as const,
  },
];

const characterSheetSettings: GenerationSettings = {
  title: 'New Character Sheet Take',
  actionLabel: 'Generate Take',
  fields: [
    { label: 'Model', value: 'GPT-Image-2' },
    {
      label: 'Prompt',
      value: 'Create a clean character sheet for Mehmed II.',
      multiline: true,
    },
    { label: 'Negative prompt', value: '', multiline: true },
    { label: 'Size', value: '16:9' },
  ],
};

export const castDesignMocks: Record<CastDesignTab, CastTabContent> = {
  description: {
    title: 'Description',
    emptySelected:
      'No description selected yet. Add description text or select reference images when they are useful.',
    emptyTakes: 'Generated description and reference image takes will appear here.',
    settings: {
      title: 'New Description Take',
      actionLabel: 'Generate Take',
      fields: [
        { label: 'Model', value: 'GPT-Image-2' },
        {
          label: 'Prompt',
          value: 'Create visual description references for Mehmed II.',
          multiline: true,
        },
        { label: 'Negative prompt', value: '', multiline: true },
        { label: 'Size', value: 'Portrait' },
      ],
    },
    selectedAssets: [
      {
        id: 'description-text',
        title: 'Description text',
        model: 'Markdown',
        kind: 'text',
        text: descriptionText,
        aspect: 'text',
        selected: true,
      },
      {
        id: 'description-face',
        title: 'Face reference',
        model: 'GPT-Image-2',
        kind: 'image',
        imageUrl: portrait1x1Url,
        aspect: 'square',
        selected: true,
      },
      {
        id: 'description-costume',
        title: 'Costume reference',
        model: 'GPT-Image-2',
        kind: 'image',
        imageUrl: costume4x3Url,
        aspect: 'ratio-4-3',
        selected: true,
      },
    ],
    takes: [
      {
        id: 'description-text-take-01',
        title: 'Text take 01',
        model: 'Markdown',
        kind: 'text',
        text: descriptionText,
        aspect: 'text',
      },
      {
        id: 'description-take-01',
        title: '9:16 take',
        model: 'GPT-Image-2',
        kind: 'image',
        imageUrl: fullBody9x16Url,
        aspect: 'ratio-9-16',
      },
      {
        id: 'description-take-02',
        title: '1:1 take',
        model: 'NanoBanana',
        kind: 'image',
        imageUrl: portrait1x1Url,
        aspect: 'square',
      },
    ],
  },
  'character-sheet': {
    title: 'Character Sheet',
    emptySelected: 'No character sheets selected.',
    emptyTakes: 'Generated character sheet takes will appear here.',
    settings: characterSheetSettings,
    selectedAssets: [
      {
        id: 'sheet-base',
        title: 'Base sheet',
        model: 'GPT-Image-2',
        kind: 'sheet',
        imageUrl: sheet16x9Url,
        aspect: 'sheet',
        selected: true,
      },
      {
        id: 'sheet-alternate',
        title: 'Alternate costume',
        model: 'NanoBanana',
        kind: 'sheet',
        imageUrl: fullBody9x16Url,
        aspect: 'ratio-9-16',
        selected: true,
      },
    ],
    takes: Array.from({ length: 12 }, (_, index) => {
      const take = sheetTakes[index % sheetTakes.length];
      return {
        id: `sheet-take-${index + 1}`,
        title: take.title,
        model: ['GPT-Image-2', 'NanoBanana', 'XAI Image'][index % 3],
        kind: 'sheet',
        imageUrl: take.imageUrl,
        aspect: take.aspect,
      };
    }),
  },
  'voice-design': {
    title: 'Voice Design',
    emptySelected:
      'No voice selected. Add this only if the character speaks or needs narration continuity.',
    emptyTakes: 'Generated voice takes will appear here.',
    settings: {
      title: 'New Voice Take',
      actionLabel: 'Generate Take',
      fields: [
        { label: 'Model', value: 'ElevenLabs Voice Design' },
        {
          label: 'Voice direction',
          value: 'Controlled, young, formal, and restrained.',
          multiline: true,
        },
        { label: 'Voice parameters', value: 'Default' },
      ],
    },
    selectedAssets: [
      {
        id: 'voice-selected',
        title: 'Voice take',
        model: 'ElevenLabs',
        kind: 'voice',
        aspect: 'voice',
        selected: true,
      },
    ],
    takes: [
      {
        id: 'voice-take-01',
        title: 'Take 01',
        model: 'ElevenLabs',
        kind: 'voice',
        aspect: 'voice',
      },
      {
        id: 'voice-take-02',
        title: 'Take 02',
        model: 'ElevenLabs',
        kind: 'voice',
        aspect: 'voice',
      },
    ],
  },
};
