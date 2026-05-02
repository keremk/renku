export interface MovieStudioProject {
  projectFolder: string;
  movieYamlPath: string;
  narrativePath: string;
  kind: 'renku.movie';
  version: '0.1.0';
  movie: MovieMetadata;
  cast: CastEntry[];
  sequences: MovieSequence[];
  totals: MovieProjectTotals;
}

export interface MovieProjectLibrary {
  storageRoot: string;
  movies: MovieProjectListItem[];
}

export interface MovieProjectListItem {
  projectFolder: string;
  folderName: string;
  title: string;
  logline?: string;
  format?: string;
  language?: string;
  coverUrl: string | null;
  totals: MovieProjectTotals | null;
  validationError: {
    code: string;
    message: string;
  } | null;
}

export interface MovieMetadata {
  id: string;
  title: string;
  format?: string;
  language?: string;
  targetDurationSeconds?: number;
  aspectRatio?: string;
  resolution?: {
    width: number;
    height: number;
  };
  narrativeFile: string;
  logline?: string;
  narrativeRef?: string;
}

export interface CastEntry {
  id: string;
  name: string;
  kind?: string;
  role?: string;
  shortDescription?: string;
  visualDescription?: string;
  voiceDescription?: string;
  aliases?: string[];
}

export interface MovieSequence {
  id: string;
  number?: number;
  title: string;
  shortTitle?: string;
  targetDurationSeconds?: number;
  summary?: string;
  scenes: MovieScene[];
}

export interface MovieScene {
  id: string;
  title: string;
  summary?: string;
  clips: MovieClip[];
}

export interface MovieClip {
  id: string;
  title: string;
  summary?: string;
  cast?: string[];
  narrativeRef?: string;
}

export interface MovieProjectTotals {
  cast: number;
  sequences: number;
  scenes: number;
  clips: number;
}

export type Selection =
  | { type: 'storyboard' }
  | { type: 'sequence'; id: string }
  | { type: 'scene'; id: string }
  | { type: 'clip'; id: string }
  | { type: 'casting' }
  | { type: 'cast'; id: string };
