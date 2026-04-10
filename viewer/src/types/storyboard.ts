export interface StoryboardProjection {
  meta: {
    blueprintId: string;
    blueprintName: string;
    axisLabel: string;
    axisDimension: string;
    axisCount: number;
    hasProducedStoryState: boolean;
  };
  columns: StoryboardColumn[];
  connectors: StoryboardConnector[];
}

export interface StoryboardColumn {
  id: string;
  title: string;
  dimension: {
    symbol: string;
    index: number;
  };
  groups: StoryboardItemGroup[];
}

export interface StoryboardItemGroup {
  id: string;
  label?: string;
  items: StoryboardItem[];
}

export interface StoryboardItem {
  id: string;
  kind:
    | 'input-text'
    | 'artifact-text'
    | 'input-image'
    | 'artifact-image'
    | 'input-audio'
    | 'artifact-audio'
    | 'input-video'
    | 'artifact-video'
    | 'placeholder';
  mediaType: 'text' | 'image' | 'audio' | 'video';
  identity: {
    canonicalInputId?: string;
    canonicalArtifactId?: string;
    canonicalProducerId?: string;
  };
  label: string;
  description?: string;
  state: 'input' | 'succeeded' | 'pending' | 'failed' | 'skipped';
  placeholderReason?: 'not-run' | 'error' | 'conditional-skip';
  placeholderMessage?: string;
  dependencyClass: 'local-upstream' | 'carry-over' | 'local-output';
  media?: {
    mimeType: string;
    hash?: string;
    value?: string;
  };
  text?: {
    value: string;
    language?: 'markdown' | 'json';
  };
  actions: {
    canExpand: boolean;
    canEdit: boolean;
    canUpload: boolean;
  };
}

export interface StoryboardConnector {
  id: string;
  fromItemId: string;
  toItemId: string;
  kind: 'local' | 'carry-over';
}
