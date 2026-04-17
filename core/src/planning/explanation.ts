/**
 * Plan explanation types for debugging why jobs are scheduled.
 */

/**
 * Reason why a specific job was scheduled in the final plan.
 */
export interface JobDirtyReason {
  /** The job ID (e.g., "Producer:LipsyncVideoProducer[0]") */
  jobId: string;
  /** The producer name (e.g., "LipsyncVideoProducer") */
  producer: string;
  /** Why this job is dirty */
  reason:
    | 'initial' // Build state has no inputs (first run)
    | 'producesMissing' // Job produces artifacts not present in build state
    | 'latestAttemptFailed' // Job produced artifacts that most recently failed
    | 'touchesDirtyInput' // Job depends on dirty inputs
    | 'touchesDirtyArtifact' // Job depends on dirty upstream artifacts
    | 'inputsHashChanged' // Stored inputsHash differs from recomputed content hash
    | 'propagated' // Marked dirty because an upstream job is dirty
    | 'forcedBySurgicalTarget' // Included as a direct surgical target source job
    | 'forcedBySurgicalDependency' // Included as downstream dependency of surgical target
    | 'forcedByUserControl'; // Included by explicit user planning controls
  /** Missing artifact IDs if reason is 'producesMissing' */
  missingArtifacts?: string[];
  /** Failed artifact IDs if reason is 'latestAttemptFailed' */
  failedArtifacts?: string[];
  /** Dirty input IDs if reason is 'touchesDirtyInput' */
  dirtyInputs?: string[];
  /** Dirty artifact IDs if reason is 'touchesDirtyArtifact' */
  dirtyArtifacts?: string[];
  /** Artifact IDs with stale inputsHash if reason is 'inputsHashChanged' */
  staleArtifacts?: string[];
  /** Upstream job ID if reason is 'propagated' */
  propagatedFrom?: string;
}

/**
 * Complete explanation of why a plan was generated.
 */
export interface PlanExplanation {
  /** Movie ID */
  movieId: string;
  /** Target revision */
  revision: string;
  /** All inputs that were detected as dirty */
  dirtyInputs: string[];
  /** All artifacts that were detected as dirty */
  dirtyArtifacts: string[];
  /** Reasons why each scheduled job appears in the final plan */
  jobReasons: JobDirtyReason[];
  /** Scheduled job IDs that were initially dirty (before propagation) */
  initialDirtyJobs: string[];
  /** Scheduled job IDs that were marked dirty due to propagation */
  propagatedJobs: string[];
  /** Target artifact IDs if surgical regeneration mode */
  surgicalTargets?: string[];
  /** Pinned artifact IDs that were excluded from the plan */
  pinnedArtifactIds?: string[];
}
