export type CastDesignTab = 'description' | 'character-sheet' | 'voice-design';

export type CastAssetKind = 'image' | 'sheet' | 'voice' | 'text';

export interface CastTake {
  id: string;
  title: string;
  model: string;
  kind: CastAssetKind;
  imageUrl?: string;
  text?: string;
  selected?: boolean;
  aspect:
    | 'portrait'
    | 'square'
    | 'sheet'
    | 'wide'
    | 'ratio-4-3'
    | 'ratio-9-16'
    | 'voice'
    | 'text';
}

export interface GenerationField {
  label: string;
  value: string;
  multiline?: boolean;
}

export interface GenerationSettings {
  title: string;
  fields: GenerationField[];
  actionLabel: string;
}

export interface CastTabContent {
  title: string;
  selectedAssets: CastTake[];
  takes: CastTake[];
  emptySelected: string;
  emptyTakes: string;
  settings: GenerationSettings;
}
