import readline from 'node:readline';
import process from 'node:process';
import { resolve } from 'node:path';
import { readdir, rm, stat } from 'node:fs/promises';
import { getProjectLocalStorage, readCliConfig } from '../lib/cli-config.js';
import { formatMovieId } from './execute.js';
import type { Logger } from '@gorenku/core';

export interface CleanOptions {
  /** Specific movie ID to clean */
  movieId?: string;
  /** Clean all builds (including those with artifacts) */
  all?: boolean;
  /** Show what would be cleaned without actually deleting */
  dryRun?: boolean;
  /** Skip confirmation prompt */
  nonInteractive?: boolean;
  logger?: Logger;
}

export interface CleanResult {
  cleaned: string[];
  protected: string[];
  dryRun: boolean;
}

export async function runClean(options: CleanOptions): Promise<CleanResult> {
  const logger = options.logger ?? globalThis.console;
  const globalConfig = await readCliConfig();
  if (!globalConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }

  const projectStorage = getProjectLocalStorage();
  const buildsRoot = resolve(projectStorage.root, projectStorage.basePath);
  const artifactsRoot = resolve(projectStorage.root, 'artifacts');

  // If specific movieId provided, clean that one (old behavior with artifacts naming)
  if (options.movieId) {
    const storageMovieId = formatMovieId(options.movieId);
    const buildPath = resolve(buildsRoot, storageMovieId);
    const artifactPath = resolve(artifactsRoot, storageMovieId);

    if (!(await pathExists(buildPath))) {
      logger.info(`No build found for ${storageMovieId}`);
      return { cleaned: [], protected: [], dryRun: Boolean(options.dryRun) };
    }

    const hasArtifacts = await pathExists(artifactPath);
    if (hasArtifacts && !options.all) {
      logger.info(`Build ${storageMovieId} has artifacts and is protected. Use --all to force clean.`);
      return { cleaned: [], protected: [storageMovieId], dryRun: Boolean(options.dryRun) };
    }

    if (options.dryRun) {
      logger.info(`Would clean: ${storageMovieId}`);
      return { cleaned: [storageMovieId], protected: [], dryRun: true };
    }

    const confirmed = options.nonInteractive || await promptConfirm(
      logger,
      `This will delete ${buildPath}${hasArtifacts ? ` and ${artifactPath}` : ''}. Proceed? (y/n): `,
    );
    if (!confirmed) {
      return { cleaned: [], protected: [], dryRun: false };
    }

    await rm(buildPath, { recursive: true, force: true });
    if (hasArtifacts) {
      await rm(artifactPath, { recursive: true, force: true });
    }
    logger.info(`Cleaned ${storageMovieId}`);
    return { cleaned: [storageMovieId], protected: [], dryRun: false };
  }

  // Smart clean: scan builds folder and clean those without artifacts
  const builds = await listMovieIds(buildsRoot);
  if (builds.length === 0) {
    logger.info('No builds found in current directory.');
    return { cleaned: [], protected: [], dryRun: Boolean(options.dryRun) };
  }

  const cleanable: string[] = [];
  const protectedBuilds: string[] = [];

  for (const movieId of builds) {
    const artifactPath = resolve(artifactsRoot, movieId);
    const hasArtifacts = await pathExists(artifactPath);
    if (hasArtifacts && !options.all) {
      protectedBuilds.push(movieId);
    } else {
      cleanable.push(movieId);
    }
  }

  if (cleanable.length === 0) {
    logger.info('No dry-run builds to clean.');
    if (protectedBuilds.length > 0) {
      logger.info(`${protectedBuilds.length} build(s) with artifacts are protected.`);
    }
    return { cleaned: [], protected: protectedBuilds, dryRun: Boolean(options.dryRun) };
  }

  logger.info('\nBuilds to clean (no artifacts):');
  for (const movieId of cleanable) {
    logger.info(`  ○ ${movieId}`);
  }
  if (protectedBuilds.length > 0) {
    logger.info('\nProtected builds (have artifacts):');
    for (const movieId of protectedBuilds) {
      logger.info(`  ✓ ${movieId}`);
    }
  }

  if (options.dryRun) {
    logger.info(`\nWould clean ${cleanable.length} build(s).`);
    return { cleaned: cleanable, protected: protectedBuilds, dryRun: true };
  }

  const confirmed = options.nonInteractive || await promptConfirm(
    logger,
    `\nClean ${cleanable.length} dry-run build(s)? (y/n): `,
  );
  if (!confirmed) {
    return { cleaned: [], protected: protectedBuilds, dryRun: false };
  }

  for (const movieId of cleanable) {
    const buildPath = resolve(buildsRoot, movieId);
    await rm(buildPath, { recursive: true, force: true });
    // Also remove artifacts if --all was used and they exist
    if (options.all) {
      const artifactPath = resolve(artifactsRoot, movieId);
      await rm(artifactPath, { recursive: true, force: true });
    }
  }

  logger.info(`Cleaned ${cleanable.length} build(s).`);
  return { cleaned: cleanable, protected: protectedBuilds, dryRun: false };
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

function promptConfirm(logger: Logger, message: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      const ok = normalized === 'y' || normalized === 'yes';
      if (!ok) {
        logger.info('Operation aborted by user.');
      }
      resolvePromise(ok);
    });
  });
}
