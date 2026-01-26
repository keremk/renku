/**
 * Utility for building plan requests from user selections.
 * Combines artifact selection and layer limit into a plan request.
 */

export interface PlanRequestOptions {
  blueprintName: string;
  movieId?: string;
  /** Artifact IDs selected for regeneration (from selectedForRegeneration Set) */
  selectedArtifacts: string[];
  /** Layer limit - only run up to this layer (0-indexed) */
  upToLayer?: number;
  /** Dirty/failed producers that need regeneration */
  dirtyProducers?: string[];
}

export interface PlanRequestResult {
  blueprint: string;
  movieId?: string;
  /** Surgical regeneration targets - only set if artifacts are explicitly selected */
  artifactIds?: string[];
  /** Layer limit for planning - only include jobs up to this layer */
  upToLayer?: number;
}

/**
 * Build a plan request based on user selections.
 *
 * Rules:
 * - If artifacts are selected -> surgical regeneration mode (artifactIds set)
 * - If no artifacts selected + dirty producers -> use dirty artifacts as targets
 * - If no artifacts selected + no dirty -> run all (no artifactIds)
 * - upToLayer is always passed through when provided
 *
 * @param options - The plan request options
 * @returns The plan request result suitable for API call
 */
export function buildPlanRequest(options: PlanRequestOptions): PlanRequestResult {
  const {
    blueprintName,
    movieId,
    selectedArtifacts,
    upToLayer,
  } = options;

  const result: PlanRequestResult = {
    blueprint: blueprintName,
  };

  // Add movieId if provided
  if (movieId) {
    result.movieId = movieId;
  }

  // Determine artifact selection
  // Priority: explicit selection > nothing (run all based on dirty detection)
  if (selectedArtifacts.length > 0) {
    result.artifactIds = selectedArtifacts;
  }
  // Note: We don't use dirtyProducers here because the planner handles
  // dirty detection internally. We only pass explicit selections.

  // Add upToLayer if provided
  if (upToLayer !== undefined) {
    result.upToLayer = upToLayer;
  }

  return result;
}

/**
 * Check if the plan request indicates surgical mode.
 * Surgical mode means only selected artifacts and their downstream will run.
 */
export function isSurgicalMode(request: PlanRequestResult): boolean {
  return request.artifactIds !== undefined && request.artifactIds.length > 0;
}

/**
 * Get a human-readable summary of what the plan will do.
 */
export function getPlanSummary(request: PlanRequestResult): string {
  const parts: string[] = [];

  if (request.artifactIds && request.artifactIds.length > 0) {
    parts.push(`regenerate ${request.artifactIds.length} artifact(s)`);
  } else {
    parts.push('run all dirty jobs');
  }

  if (request.upToLayer !== undefined) {
    parts.push(`up to layer ${request.upToLayer}`);
  }

  return parts.join(' ');
}
