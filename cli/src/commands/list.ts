import { resolve } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { getProjectLocalStorage, readCliConfig } from '../lib/cli-config.js';
import type { Logger } from '@gorenku/core';

export interface ListOptions {
  logger?: Logger;
}

export interface BuildInfo {
  movieId: string;
  hasArtifacts: boolean;
}

export interface ListResult {
  builds: BuildInfo[];
}

export async function runList(options: ListOptions = {}): Promise<ListResult> {
  const logger = options.logger ?? globalThis.console;
  const globalConfig = await readCliConfig();
  if (!globalConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }

  const projectStorage = getProjectLocalStorage();
  const buildsRoot = resolve(projectStorage.root, projectStorage.basePath);
  const artifactsRoot = resolve(projectStorage.root, 'artifacts');

  const movieIds = await listMovieIds(buildsRoot);
  if (movieIds.length === 0) {
    logger.info('No builds found in current directory.');
    return { builds: [] };
  }

  const builds: BuildInfo[] = [];
  for (const movieId of movieIds) {
    const artifactPath = resolve(artifactsRoot, movieId);
    const hasArtifacts = await pathExists(artifactPath);
    builds.push({ movieId, hasArtifacts });
  }

  // Sort: builds with artifacts first, then by name
  builds.sort((a, b) => {
    if (a.hasArtifacts !== b.hasArtifacts) {
      return a.hasArtifacts ? -1 : 1;
    }
    return a.movieId.localeCompare(b.movieId);
  });

  logger.info('Builds in current project:\n');
  for (const build of builds) {
    const icon = build.hasArtifacts ? '✓' : '○';
    const status = build.hasArtifacts ? '(has artifacts)' : '(dry-run, no artifacts)';
    logger.info(`  ${icon} ${build.movieId} ${status}`);
  }

  const withArtifacts = builds.filter((b) => b.hasArtifacts).length;
  const dryRuns = builds.length - withArtifacts;

  logger.info('');
  if (dryRuns > 0) {
    logger.info(`Run \`renku clean\` to remove ${dryRuns} dry-run build(s).`);
  }

  return { builds };
}

async function listMovieIds(buildsRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(buildsRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('movie-'))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}
