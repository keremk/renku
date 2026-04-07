import { formatMovieId } from '../commands/execute.js';
import { createRuntimeError, RuntimeErrorCode } from '@gorenku/core';

/**
 * Resolve and normalize an explicitly provided movie ID.
 */
export function resolveTargetMovieId(args: {
  explicitMovieId?: string;
}): string {
  if (!args.explicitMovieId) {
    throw createRuntimeError(
      RuntimeErrorCode.MISSING_REQUIRED_INPUT,
      'Movie ID resolution failed: --movie-id/--id is required.',
      {
        suggestion: 'Provide --movie-id=<id> (or --id=<id>) to target an existing movie.',
      }
    );
  }

  return formatMovieId(args.explicitMovieId);
}
