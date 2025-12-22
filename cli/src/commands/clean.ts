import readline from 'node:readline';
import process from 'node:process';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { readCliConfig } from '../lib/cli-config.js';
import { formatMovieId } from './execute.js';
import type { Logger } from '@gorenku/core';

export async function runClean(options: { movieId: string; logger?: Logger }): Promise<void> {
  const logger = options.logger ?? globalThis.console;
  const cliConfig = await readCliConfig();
  if (!cliConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }
  if (!options.movieId) {
    throw new Error('Movie ID is required for clean.');
  }
  const storageMovieId = formatMovieId(options.movieId);
  const friendlyRoot = resolve(cliConfig.storage.root, 'movies', storageMovieId);
  const buildsRoot = resolve(cliConfig.storage.root, cliConfig.storage.basePath, storageMovieId);

  const confirmed = await promptConfirm(
    logger,
    `This will delete ${friendlyRoot} and ${buildsRoot}. Proceed? (y/n): `,
  );
  if (!confirmed) {
    logger.info('Clean cancelled.');
    return;
  }

  await rm(friendlyRoot, { recursive: true, force: true });
  await rm(buildsRoot, { recursive: true, force: true });
  logger.info('Removed friendly view and build artefacts.');
}

function promptConfirm(logger: Logger, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      const ok = normalized === 'y' || normalized === 'yes';
      if (!ok) {
        logger.info('Operation aborted by user.');
      }
      resolve(ok);
    });
  });
}
