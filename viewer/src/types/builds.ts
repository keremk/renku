/**
 * Types for builds list and manifest data.
 */

export interface BuildInfo {
  movieId: string;
  updatedAt: string;
  revision: string | null;
  hasManifest: boolean;
  hasInputsFile: boolean;     // Has builds/{movieId}/inputs.yaml
  displayName: string | null; // User-friendly name from movie-metadata.json
}

export interface BuildsListResponse {
  builds: BuildInfo[];
  blueprintFolder: string;
}

/**
 * Why an artifact failed or was skipped.
 */
export type ArtifactFailureReason =
  | 'timeout' // Provider request timed out
  | 'connection_error' // Network connection failed
  | 'upstream_failure' // Dependency producer failed
  | 'conditions_not_met'; // Conditional producer skipped

export interface ArtifactInfo {
  id: string;
  name: string;
  hash: string;
  size: number;
  mimeType: string;
  /** Artifact status: succeeded, failed, or skipped */
  status: 'succeeded' | 'failed' | 'skipped' | string;
  createdAt: string | null;
  /** Source of this artifact - 'producer' for generated, 'user' for edited */
  editedBy?: 'producer' | 'user';
  /** The first producer-generated blob hash (preserved across edits for restore) */
  originalHash?: string;
  /** Why the artifact failed or was skipped */
  failureReason?: ArtifactFailureReason;
  /** Whether failed artifact can be recovered via recheck (e.g., job still running on provider) */
  recoverable?: boolean;
  /** Provider request ID for recovery (e.g., fal.ai requestId) */
  providerRequestId?: string;
  /** Human-readable skip message */
  skipMessage?: string;
  /** Provider name (e.g., 'fal-ai', 'replicate') */
  provider?: string;
  /** Model name (e.g., 'kling-video') */
  model?: string;
}

/**
 * Model selection extracted from manifest inputs.
 */
export interface ManifestModelSelection {
  producerId: string;
  provider: string;
  model: string;
  config?: Record<string, unknown>;
}

export interface BuildManifestResponse {
  movieId: string;
  revision: string | null;
  inputs: Record<string, unknown>;
  models?: ManifestModelSelection[];
  artefacts: ArtifactInfo[];
  createdAt: string | null;
}
