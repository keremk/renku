import type { CliConfig } from './cli-config.js';
import { formatMovieId } from '../commands/execute.js';

/**
 * Resolve a movie ID from either an explicit ID or the last recorded movie.
 * Used by generate, export, and viewer:view commands.
 */
export async function resolveTargetMovieId(args: {
  explicitMovieId?: string;
  useLast: boolean;
  cliConfig: CliConfig;
}): Promise<string> {
  if (args.explicitMovieId) {
    return formatMovieId(args.explicitMovieId);
  }

  if (!args.useLast) {
    throw new Error('Movie ID resolution failed: neither explicit movie ID nor --last provided.');
  }

  if (!args.cliConfig.lastMovieId) {
    throw new Error('No previous movie found. Run a generation first or provide --movie-id.');
  }

  return formatMovieId(args.cliConfig.lastMovieId);
}
