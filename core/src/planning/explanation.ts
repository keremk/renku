/**
 * Plan explanation types for debugging why jobs are scheduled.
 */

/**
 * Reason why a specific job was marked as dirty.
 */
export interface JobDirtyReason {
  /** The job ID (e.g., "Producer:LipsyncVideoProducer[0]") */
  jobId: string;
  /** The producer name (e.g., "LipsyncVideoProducer") */
  producer: string;
  /** Why this job is dirty */
  reason:
    | 'initial' // Manifest has no inputs (first run)
    | 'producesMissing' // Job produces artifacts not in manifest
    | 'touchesDirtyInput' // Job depends on dirty inputs
    | 'touchesDirtyArtefact' // Job depends on dirty upstream artifacts
    | 'inputsHashChanged' // Stored inputsHash differs from recomputed content hash
    | 'propagated'; // Marked dirty because an upstream job is dirty
  /** Missing artifact IDs if reason is 'producesMissing' */
  missingArtifacts?: string[];
  /** Dirty input IDs if reason is 'touchesDirtyInput' */
  dirtyInputs?: string[];
  /** Dirty artifact IDs if reason is 'touchesDirtyArtefact' */
  dirtyArtefacts?: string[];
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
  dirtyArtefacts: string[];
  /** Reasons why each job in the plan is dirty */
  jobReasons: JobDirtyReason[];
  /** Job IDs that were initially dirty (before propagation) */
  initialDirtyJobs: string[];
  /** Job IDs that were marked dirty due to propagation */
  propagatedJobs: string[];
  /** Target artifact IDs if surgical regeneration mode */
  surgicalTargets?: string[];
}
