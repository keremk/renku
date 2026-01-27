/**
 * Generation API module exports.
 */

// Types
export * from './types.js';

// Configuration
export {
  type CliConfig,
  DEFAULT_CONCURRENCY,
  getDefaultCliConfigPath,
  readCliConfig,
  requireCliConfig,
  normalizeConcurrency,
  getCatalogModelsDir,
} from './config.js';

// Path resolution
export {
  type ResolvedPaths,
  resolveBlueprintPaths,
  resolveMovieDir,
  resolveBlueprintMovieDir,
  generateMovieId,
  normalizeMovieId,
  resolveBuildInputsPath,
} from './paths.js';

// Job management
export {
  getJobManager,
  resetJobManager,
} from './job-manager.js';

// HTTP utilities
export {
  parseJsonBody,
  sendJson,
  sendError,
  sendNotFound,
  sendMethodNotAllowed,
  setupSSE,
  sendSSEEvent,
  sendSSEComment,
} from './http-utils.js';

// Handlers
export { handlePlanRequest } from './plan-handler.js';
export { handleExecuteRequest } from './execute-handler.js';
export { handleJobsListRequest, handleJobStatusRequest } from './status-handler.js';
export { handleStreamRequest } from './stream-handler.js';
export { handleCancelRequest } from './cancel-handler.js';
