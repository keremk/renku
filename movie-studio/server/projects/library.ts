import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readCliConfig } from '@gorenku/core';
import {
  loadMovieProject,
  MovieProjectValidationError,
} from './movie-loader.js';
import type { MovieProjectLibrary, MovieProjectListItem } from './types.js';

const COVER_FILENAMES = [
  'cover.png',
  'cover.jpg',
  'cover.jpeg',
  'cover.webp',
  'poster.png',
  'poster.jpg',
  'poster.jpeg',
  'poster.webp',
  'thumbnail.png',
  'thumbnail.jpg',
  'thumbnail.jpeg',
  'thumbnail.webp',
];

export async function listMovieProjects(): Promise<MovieProjectLibrary> {
  const storageRoot = await resolveMovieStudioStorageRoot();
  await fs.mkdir(storageRoot, { recursive: true });

  const entries = await fs.readdir(storageRoot, { withFileTypes: true });
  const movies: MovieProjectListItem[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const projectFolder = path.resolve(storageRoot, entry.name);
    const movieYamlPath = path.join(projectFolder, 'movie.yaml');
    if (!(await fileExists(movieYamlPath))) {
      continue;
    }

    movies.push(await readLibraryItem(projectFolder, entry.name));
  }

  movies.sort((a, b) => a.title.localeCompare(b.title));

  return {
    storageRoot,
    movies,
  };
}

export async function resolveMovieStudioStorageRoot(): Promise<string> {
  const cliConfig = await readCliConfig();
  if (!cliConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }
  const configWithMovieStudio = cliConfig as typeof cliConfig & {
    movieStudio?: { storageRoot?: string };
  };
  return path.resolve(
    configWithMovieStudio.movieStudio?.storageRoot ??
      path.resolve(os.homedir(), 'renku-movies')
  );
}

export async function resolveCoverImagePath(
  projectFolderInput: string,
  coverFilename: string
): Promise<string> {
  const storageRoot = await resolveMovieStudioStorageRoot();
  const projectFolder = path.resolve(projectFolderInput);

  if (!isPathInside(storageRoot, projectFolder)) {
    throw new MovieProjectValidationError(
      'M013',
      'Cover image project folder is outside the configured Movie Studio storage root.'
    );
  }

  if (!COVER_FILENAMES.includes(coverFilename)) {
    throw new MovieProjectValidationError(
      'M014',
      `Unsupported cover image filename "${coverFilename}".`
    );
  }

  const coverPath = path.resolve(projectFolder, coverFilename);
  if (!isPathInside(projectFolder, coverPath) || !(await fileExists(coverPath))) {
    throw new MovieProjectValidationError(
      'M015',
      `Cover image not found: ${coverFilename}.`
    );
  }

  return coverPath;
}

async function readLibraryItem(
  projectFolder: string,
  folderName: string
): Promise<MovieProjectListItem> {
  const coverFilename = await findCoverFilename(projectFolder);
  const coverUrl = coverFilename
    ? `/movie-studio-api/projects/cover?projectFolder=${encodeURIComponent(
        projectFolder
      )}&file=${encodeURIComponent(coverFilename)}`
    : null;

  try {
    const project = loadMovieProject(projectFolder);
    return {
      projectFolder,
      folderName,
      title: project.movie.title,
      logline: project.movie.logline,
      format: project.movie.format,
      language: project.movie.language,
      coverUrl,
      totals: project.totals,
      validationError: null,
    };
  } catch (error) {
    const validationError =
      error instanceof MovieProjectValidationError
        ? {
            code: error.code,
            message: error.message,
          }
        : {
            code: 'M011',
            message: error instanceof Error ? error.message : String(error),
          };

    return {
      projectFolder,
      folderName,
      title: folderName,
      coverUrl,
      totals: null,
      validationError,
    };
  }
}

async function findCoverFilename(projectFolder: string): Promise<string | null> {
  for (const filename of COVER_FILENAMES) {
    if (await fileExists(path.join(projectFolder, filename))) {
      return filename;
    }
  }
  return null;
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(targetPath);
    return stats.isFile();
  } catch {
    return false;
  }
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
