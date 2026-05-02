import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import type {
  CastEntry,
  MovieClip,
  MovieMetadata,
  MovieProjectTotals,
  MovieScene,
  MovieSequence,
  MovieStudioProject,
} from './types.js';

const SUPPORTED_KIND = 'renku.movie';
const SUPPORTED_VERSION = '0.1.0';

export class MovieProjectValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'MovieProjectValidationError';
  }
}

export function loadMovieProject(projectFolderInput: string): MovieStudioProject {
  const projectFolder = resolveProjectFolder(projectFolderInput);
  const movieYamlPath = path.join(projectFolder, 'movie.yaml');

  if (!fs.existsSync(movieYamlPath)) {
    throw new MovieProjectValidationError(
      'M001',
      `Missing required movie.yaml at ${movieYamlPath}.`
    );
  }

  const document = parseMovieYaml(movieYamlPath);
  const record = requireRecord(document, 'movie.yaml root');

  requireStringField(record, 'kind', 'M003', 'movie.yaml kind is required.');
  if (record.kind !== SUPPORTED_KIND) {
    throw new MovieProjectValidationError(
      'M003',
      `Unsupported movie.yaml kind "${String(record.kind)}". Expected ${SUPPORTED_KIND}.`
    );
  }

  requireStringField(record, 'version', 'M004', 'movie.yaml version is required.');
  if (record.version !== SUPPORTED_VERSION) {
    throw new MovieProjectValidationError(
      'M004',
      `Unsupported movie.yaml version "${String(record.version)}". Expected ${SUPPORTED_VERSION}.`
    );
  }

  const movie = readMovieMetadata(record.movie);
  const narrativePath = path.resolve(projectFolder, movie.narrativeFile);
  if (!isPathInside(projectFolder, narrativePath)) {
    throw new MovieProjectValidationError(
      'M005',
      `movie.narrativeFile must resolve inside the movie project folder: ${movie.narrativeFile}.`
    );
  }
  if (!fs.existsSync(narrativePath)) {
    throw new MovieProjectValidationError(
      'M002',
      `Missing required narrative file at ${narrativePath}.`
    );
  }

  const ids = new Set<string>();
  registerId(ids, movie.id, 'movie.id');

  const cast = readCastEntries(record.cast, ids);
  const sequences = readSequences(record.sequences, ids);
  validateClipCastReferences(cast, sequences);
  const totals = computeTotals(cast, sequences);

  return {
    projectFolder,
    movieYamlPath,
    narrativePath,
    kind: SUPPORTED_KIND,
    version: SUPPORTED_VERSION,
    movie,
    cast,
    sequences,
    totals,
  };
}

function resolveProjectFolder(input: string): string {
  if (!input.trim()) {
    throw new MovieProjectValidationError(
      'M010',
      'projectFolder is required.'
    );
  }
  const expanded = input.startsWith('~/')
    ? path.join(os.homedir(), input.slice(2))
    : input;
  return path.resolve(expanded);
}

function parseMovieYaml(movieYamlPath: string): unknown {
  try {
    return parse(fs.readFileSync(movieYamlPath, 'utf8'));
  } catch (error) {
    throw new MovieProjectValidationError(
      'M011',
      `Unable to parse movie.yaml: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function readMovieMetadata(input: unknown): MovieMetadata {
  const record = requireRecord(input, 'movie');
  const id = requireStringField(record, 'id', 'M006', 'movie.id is required.');
  const title = requireStringField(
    record,
    'title',
    'M006',
    'movie.title is required.'
  );
  const narrativeFile = requireStringField(
    record,
    'narrativeFile',
    'M005',
    'movie.narrativeFile is required.'
  );

  const movie: MovieMetadata = {
    id,
    title,
    narrativeFile,
  };

  copyOptionalString(record, movie, 'format');
  copyOptionalString(record, movie, 'language');
  copyOptionalString(record, movie, 'aspectRatio');
  copyOptionalString(record, movie, 'logline');
  copyOptionalString(record, movie, 'narrativeRef');
  copyOptionalNumber(record, movie, 'targetDurationSeconds');

  if (record.resolution !== undefined) {
    const resolution = requireRecord(record.resolution, 'movie.resolution');
    movie.resolution = {
      width: requireNumberField(
        resolution,
        'width',
        'M006',
        'movie.resolution.width is required.'
      ),
      height: requireNumberField(
        resolution,
        'height',
        'M006',
        'movie.resolution.height is required.'
      ),
    };
  }

  return movie;
}

function readCastEntries(input: unknown, ids: Set<string>): CastEntry[] {
  if (!Array.isArray(input)) {
    throw new MovieProjectValidationError(
      'M006',
      'cast must be an array.'
    );
  }

  return input.map((entry, index) => {
    const record = requireRecord(entry, `cast[${index}]`);
    const id = requireStringField(
      record,
      'id',
      'M006',
      `cast[${index}].id is required.`
    );
    registerId(ids, id, `cast[${index}].id`);

    const castEntry: CastEntry = {
      id,
      name: requireStringField(
        record,
        'name',
        'M006',
        `cast[${index}].name is required.`
      ),
    };

    copyOptionalString(record, castEntry, 'kind');
    copyOptionalString(record, castEntry, 'role');
    copyOptionalString(record, castEntry, 'shortDescription');
    copyOptionalString(record, castEntry, 'visualDescription');
    copyOptionalString(record, castEntry, 'voiceDescription');
    if (record.aliases !== undefined) {
      castEntry.aliases = requireStringArray(
        record.aliases,
        `cast[${index}].aliases`
      );
    }
    return castEntry;
  });
}

function readSequences(input: unknown, ids: Set<string>): MovieSequence[] {
  if (!Array.isArray(input)) {
    throw new MovieProjectValidationError(
      'M006',
      'sequences must be an array.'
    );
  }

  return input.map((entry, sequenceIndex) => {
    const record = requireRecord(entry, `sequences[${sequenceIndex}]`);
    const id = requireStringField(
      record,
      'id',
      'M006',
      `sequences[${sequenceIndex}].id is required.`
    );
    registerId(ids, id, `sequences[${sequenceIndex}].id`);

    if (!Array.isArray(record.scenes)) {
      throw new MovieProjectValidationError(
        'M008',
        `sequences[${sequenceIndex}].scenes must be an array.`
      );
    }

    const sequence: MovieSequence = {
      id,
      title: requireStringField(
        record,
        'title',
        'M006',
        `sequences[${sequenceIndex}].title is required.`
      ),
      scenes: readScenes(record.scenes, ids, sequenceIndex),
    };

    copyOptionalNumber(record, sequence, 'number');
    copyOptionalString(record, sequence, 'shortTitle');
    copyOptionalNumber(record, sequence, 'targetDurationSeconds');
    copyOptionalString(record, sequence, 'summary');
    return sequence;
  });
}

function readScenes(
  input: unknown[],
  ids: Set<string>,
  sequenceIndex: number
): MovieScene[] {
  return input.map((entry, sceneIndex) => {
    const label = `sequences[${sequenceIndex}].scenes[${sceneIndex}]`;
    const record = requireRecord(entry, label);
    const id = requireStringField(
      record,
      'id',
      'M006',
      `${label}.id is required.`
    );
    registerId(ids, id, `${label}.id`);

    if (!Array.isArray(record.clips)) {
      throw new MovieProjectValidationError(
        'M009',
        `${label}.clips must be an array.`
      );
    }

    const scene: MovieScene = {
      id,
      title: requireStringField(
        record,
        'title',
        'M006',
        `${label}.title is required.`
      ),
      clips: readClips(record.clips, ids, label),
    };

    copyOptionalString(record, scene, 'summary');
    return scene;
  });
}

function readClips(
  input: unknown[],
  ids: Set<string>,
  sceneLabel: string
): MovieClip[] {
  return input.map((entry, clipIndex) => {
    const label = `${sceneLabel}.clips[${clipIndex}]`;
    const record = requireRecord(entry, label);
    const id = requireStringField(record, 'id', 'M006', `${label}.id is required.`);
    registerId(ids, id, `${label}.id`);

    const clip: MovieClip = {
      id,
      title: requireStringField(
        record,
        'title',
        'M006',
        `${label}.title is required.`
      ),
    };

    copyOptionalString(record, clip, 'summary');
    copyOptionalString(record, clip, 'narrativeRef');
    if (record.cast !== undefined) {
      clip.cast = requireStringArray(record.cast, `${label}.cast`);
    }
    return clip;
  });
}

function computeTotals(
  cast: CastEntry[],
  sequences: MovieSequence[]
): MovieProjectTotals {
  let scenes = 0;
  let clips = 0;
  for (const sequence of sequences) {
    scenes += sequence.scenes.length;
    for (const scene of sequence.scenes) {
      clips += scene.clips.length;
    }
  }
  return {
    cast: cast.length,
    sequences: sequences.length,
    scenes,
    clips,
  };
}

function validateClipCastReferences(
  cast: CastEntry[],
  sequences: MovieSequence[]
): void {
  const castIds = new Set(cast.map((entry) => entry.id));
  for (const sequence of sequences) {
    for (const scene of sequence.scenes) {
      for (const clip of scene.clips) {
        for (const castId of clip.cast ?? []) {
          if (!castIds.has(castId)) {
            throw new MovieProjectValidationError(
              'M012',
              `Clip "${clip.id}" references missing cast id "${castId}".`
            );
          }
        }
      }
    }
  }
}

function registerId(ids: Set<string>, id: string, label: string): void {
  if (ids.has(id)) {
    throw new MovieProjectValidationError(
      'M007',
      `Duplicate id "${id}" at ${label}.`
    );
  }
  ids.add(id);
}

function requireRecord(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new MovieProjectValidationError(
      'M006',
      `${label} must be an object.`
    );
  }
  return input as Record<string, unknown>;
}

function requireStringField(
  record: Record<string, unknown>,
  key: string,
  code: string,
  message: string
): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MovieProjectValidationError(code, message);
  }
  return value;
}

function requireNumberField(
  record: Record<string, unknown>,
  key: string,
  code: string,
  message: string
): number {
  const value = record[key];
  if (typeof value !== 'number') {
    throw new MovieProjectValidationError(code, message);
  }
  return value;
}

function requireStringArray(input: unknown, label: string): string[] {
  if (!Array.isArray(input) || input.some((item) => typeof item !== 'string')) {
    throw new MovieProjectValidationError(
      'M006',
      `${label} must be an array of strings.`
    );
  }
  return input;
}

function copyOptionalString(
  source: Record<string, unknown>,
  target: object,
  key: string
): void {
  if (source[key] !== undefined) {
    if (typeof source[key] !== 'string') {
      throw new MovieProjectValidationError(
        'M006',
        `${key} must be a string.`
      );
    }
    (target as Record<string, unknown>)[key] = source[key];
  }
}

function copyOptionalNumber(
  source: Record<string, unknown>,
  target: object,
  key: string
): void {
  if (source[key] !== undefined) {
    if (typeof source[key] !== 'number') {
      throw new MovieProjectValidationError(
        'M006',
        `${key} must be a number.`
      );
    }
    (target as Record<string, unknown>)[key] = source[key];
  }
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
