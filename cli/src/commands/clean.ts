import readline from 'node:readline';
import process from 'node:process';
import { resolve } from 'node:path';
import { readdir, rm, stat } from 'node:fs/promises';
import {
  createStorageContext,
  deleteMovieStorage,
  resolveCurrentBuildContext,
  type Logger,
} from '@gorenku/core';
import { getProjectLocalStorage, readCliConfig } from '../lib/cli-config.js';
import { formatMovieId } from './execute.js';

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
  if (!(await readCliConfig())) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }

  const projectStorage = getProjectLocalStorage();
  const buildsRoot = resolve(projectStorage.root, projectStorage.basePath);
  const artifactsRoot = resolve(projectStorage.root, 'artifacts');

  const storageContext = createStorageContext({
    kind: 'local',
    rootDir: projectStorage.root,
    basePath: projectStorage.basePath,
  });

  if (options.movieId) {
    return cleanSpecificMovie({
      logger,
      options,
      buildsRoot,
      artifactsRoot,
      storageContext,
    });
  }

  const builds = await listMovieIds(buildsRoot);
  if (builds.length === 0) {
    logger.info('No builds found in current directory.');
    return { cleaned: [], protected: [], dryRun: Boolean(options.dryRun) };
  }

  const cleanable: string[] = [];
  const protectedBuilds: string[] = [];

  for (const movieId of builds) {
    const realBuild = await isRealBuild(storageContext, movieId);
    if (realBuild && !options.all) {
      protectedBuilds.push(movieId);
      continue;
    }
    cleanable.push(movieId);
  }

  if (cleanable.length === 0) {
    logger.info('No preview leftovers to clean.');
    if (protectedBuilds.length > 0) {
      logger.info(
        `${protectedBuilds.length} real build(s) are protected. Use --all to remove them.`
      );
    }
    return { cleaned: [], protected: protectedBuilds, dryRun: Boolean(options.dryRun) };
  }

  logger.info('\nBuilds to clean:');
  for (const movieId of cleanable) {
    logger.info(`  ○ ${movieId}`);
  }
  if (protectedBuilds.length > 0) {
    logger.info('\nProtected real builds:');
    for (const movieId of protectedBuilds) {
      logger.info(`  ✓ ${movieId}`);
    }
  }

  if (options.dryRun) {
    logger.info(`\nWould clean ${cleanable.length} build(s).`);
    return { cleaned: cleanable, protected: protectedBuilds, dryRun: true };
  }

  const confirmed =
    options.nonInteractive ||
    (await promptConfirm(
      logger,
      `\nClean ${cleanable.length} build(s)? (y/n): `,
    ));
  if (!confirmed) {
    return { cleaned: [], protected: protectedBuilds, dryRun: false };
  }

  for (const movieId of cleanable) {
    await deleteMovieStorage(storageContext, movieId);
    if (options.all) {
      const artifactPath = resolve(artifactsRoot, movieId);
      await rm(artifactPath, { recursive: true, force: true });
    }
  }

  logger.info(`Cleaned ${cleanable.length} build(s).`);
  return { cleaned: cleanable, protected: protectedBuilds, dryRun: false };
}

async function cleanSpecificMovie(args: {
  logger: Logger;
  options: CleanOptions;
  buildsRoot: string;
  artifactsRoot: string;
  storageContext: ReturnType<typeof createStorageContext>;
}): Promise<CleanResult> {
  const movieId = args.options.movieId;
  if (!movieId) {
    throw new Error('cleanSpecificMovie requires movieId.');
  }
  const storageMovieId = formatMovieId(movieId);
  const buildPath = resolve(args.buildsRoot, storageMovieId);
  const artifactPath = resolve(args.artifactsRoot, storageMovieId);

  if (!(await pathExists(buildPath))) {
    args.logger.info(`No build found for ${storageMovieId}`);
    return {
      cleaned: [],
      protected: [],
      dryRun: Boolean(args.options.dryRun),
    };
  }

  const hasArtifacts = await pathExists(artifactPath);
  if (hasArtifacts && !args.options.all) {
    args.logger.info(
      `Build ${storageMovieId} has artifacts and is protected. Use --all to force clean.`
    );
    return {
      cleaned: [],
      protected: [storageMovieId],
      dryRun: Boolean(args.options.dryRun),
    };
  }

  if (args.options.dryRun) {
    args.logger.info(`Would clean: ${storageMovieId}`);
    return { cleaned: [storageMovieId], protected: [], dryRun: true };
  }

  const confirmed =
    args.options.nonInteractive ||
    (await promptConfirm(
      args.logger,
      `This will delete ${buildPath}${hasArtifacts ? ` and ${artifactPath}` : ''}. Proceed? (y/n): `,
    ));
  if (!confirmed) {
    return { cleaned: [], protected: [], dryRun: false };
  }

  await deleteMovieStorage(args.storageContext, storageMovieId);
  if (hasArtifacts) {
    await rm(artifactPath, { recursive: true, force: true });
  }
  args.logger.info(`Cleaned ${storageMovieId}`);
  return { cleaned: [storageMovieId], protected: [], dryRun: false };
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

async function isRealBuild(
  storage: ReturnType<typeof createStorageContext>,
  movieId: string
): Promise<boolean> {
  const context = await resolveCurrentBuildContext({
    storage,
    movieId,
  });
  return context.currentBuildRevision !== null || context.latestRunRevision !== null;
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
