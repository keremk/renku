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

export interface ArtifactInfo {
  id: string;
  name: string;
  hash: string;
  size: number;
  mimeType: string;
  status: string;
  createdAt: string | null;
}

export interface BuildManifestResponse {
  movieId: string;
  revision: string | null;
  inputs: Record<string, unknown>;
  artefacts: ArtifactInfo[];
  createdAt: string | null;
}
