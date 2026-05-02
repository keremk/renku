import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadMovieProject,
  MovieProjectValidationError,
} from './movie-loader.js';

describe('loadMovieProject', () => {
  it('loads a valid movie project', () => {
    const projectFolder = createMovieProject();

    const project = loadMovieProject(projectFolder);

    expect(project.movie.title).toBe('Preparation of the Siege');
    expect(project.cast).toHaveLength(1);
    expect(project.sequences).toHaveLength(1);
    expect(project.totals).toEqual({
      cast: 1,
      sequences: 1,
      scenes: 1,
      clips: 1,
    });
  });

  it('rejects a missing movie.yaml', () => {
    const projectFolder = createEmptyProjectFolder();
    fs.writeFileSync(path.join(projectFolder, 'narrative.md'), '# Narrative');

    expectValidationError(() => loadMovieProject(projectFolder), 'M001');
  });

  it('rejects a missing narrative file', () => {
    const projectFolder = createMovieProject({ writeNarrative: false });

    expectValidationError(() => loadMovieProject(projectFolder), 'M002');
  });

  it('rejects an unsupported kind', () => {
    const projectFolder = createMovieProject({
      yamlPatch: 'kind: renku.blueprint',
    });

    expectValidationError(() => loadMovieProject(projectFolder), 'M003');
  });

  it('rejects a missing version', () => {
    const projectFolder = createMovieProject({
      yamlPatch: 'version: null',
    });

    expectValidationError(() => loadMovieProject(projectFolder), 'M004');
  });

  it('rejects duplicate IDs', () => {
    const projectFolder = createMovieProject({
      clipId: 'cast_narrator',
    });

    expectValidationError(() => loadMovieProject(projectFolder), 'M007');
  });

  it('rejects a sequence without scenes', () => {
    const projectFolder = createMovieProject({
      sequenceScenes: '',
    });

    expectValidationError(() => loadMovieProject(projectFolder), 'M008');
  });

  it('rejects a scene without clips', () => {
    const projectFolder = createMovieProject({
      sceneClips: '',
    });

    expectValidationError(() => loadMovieProject(projectFolder), 'M009');
  });

  it('rejects clip cast references that do not match a declared cast id', () => {
    const projectFolder = createMovieProject({
      clipCast: 'cast_missing',
    });

    expectValidationError(() => loadMovieProject(projectFolder), 'M012');
  });
});

interface CreateMovieProjectOptions {
  writeNarrative?: boolean;
  yamlPatch?: string;
  clipId?: string;
  clipCast?: string;
  sequenceScenes?: string;
  sceneClips?: string;
}

function createEmptyProjectFolder(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'renku-movie-studio-'));
}

function createMovieProject(options: CreateMovieProjectOptions = {}): string {
  const projectFolder = createEmptyProjectFolder();
  if (options.writeNarrative !== false) {
    fs.writeFileSync(path.join(projectFolder, 'narrative.md'), '# Narrative');
  }

  fs.writeFileSync(
    path.join(projectFolder, 'movie.yaml'),
    createMovieYaml(options)
  );
  return projectFolder;
}

function createMovieYaml(options: CreateMovieProjectOptions): string {
  const clipId = options.clipId ?? 'clip_1_1_1';
  const clipCast = options.clipCast ?? 'cast_narrator';
  const sceneClips =
    options.sceneClips ??
    `        clips:
          - id: ${clipId}
            title: Opening Image
            summary: Establish the movie.
            cast:
              - ${clipCast}`;
  const sequenceScenes =
    options.sequenceScenes ??
    `    scenes:
      - id: scene_1_1
        title: Opening Scene
        summary: The movie begins.
${sceneClips}`;

  const yaml = `kind: renku.movie
version: 0.1.0

movie:
  id: movie_constantinople_preparation
  title: Preparation of the Siege
  format: historical_documentary
  language: en
  targetDurationSeconds: 1500
  narrativeFile: narrative.md

cast:
  - id: cast_narrator
    name: Narrator
    kind: narrator
    role: voiceover
    shortDescription: Documentary narrator.

sequences:
  - id: seq_opening
    title: Opening
    shortTitle: Opening
    summary: The opening sequence.
${sequenceScenes}
`;

  if (!options.yamlPatch) {
    return yaml;
  }

  const [key] = options.yamlPatch.split(':');
  return yaml.replace(new RegExp(`^${key}:.*$`, 'm'), options.yamlPatch);
}

function expectValidationError(action: () => void, code: string): void {
  expect(action).toThrow(MovieProjectValidationError);
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(MovieProjectValidationError);
    expect((error as MovieProjectValidationError).code).toBe(code);
  }
}
