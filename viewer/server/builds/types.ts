/**
 * Type definitions for the builds module.
 */

import type { SerializableModelSelection, ExtractedModelSelection } from "@gorenku/core";

/**
 * Request for POST /blueprints/builds/create
 */
export interface CreateBuildRequest {
  blueprintFolder: string;
  displayName?: string;
}

/**
 * Response from POST /blueprints/builds/create
 */
export interface CreateBuildResponse {
  movieId: string;
  inputsPath: string;
}

/**
 * Request for PUT /blueprints/builds/inputs
 */
export interface BuildInputsRequest {
  blueprintFolder: string;
  blueprintPath: string;
  movieId: string;
  inputs: Record<string, unknown>;
  models: SerializableModelSelection[];
}

/**
 * Response for GET /blueprints/builds/inputs
 */
export interface BuildInputsResponse {
  inputs: Record<string, unknown>;
  models: SerializableModelSelection[];
  inputsPath: string;
}

/**
 * Request for PUT /blueprints/builds/metadata
 */
export interface BuildMetadataRequest {
  blueprintFolder: string;
  movieId: string;
  displayName: string;
}

/**
 * Request for POST /blueprints/builds/enable-editing
 */
export interface EnableEditingRequest {
  blueprintFolder: string;
  movieId: string;
}

/**
 * Build information for list display.
 */
export interface BuildInfo {
  movieId: string;
  updatedAt: string;
  revision: string | null;
  hasManifest: boolean;
  hasInputsFile: boolean;
  displayName: string | null;
}

/**
 * Response from GET /blueprints/builds
 */
export interface BuildsListResponse {
  builds: BuildInfo[];
  blueprintFolder: string;
}

/**
 * Artifact information in a build manifest.
 */
export interface ArtifactInfo {
  id: string;
  name: string;
  hash: string;
  size: number;
  mimeType: string;
  status: string;
  createdAt: string | null;
  /** Source of this artifact - 'producer' for generated, 'user' for edited */
  editedBy?: 'producer' | 'user';
  /** The first producer-generated blob hash (preserved across edits for restore) */
  originalHash?: string;
}

/**
 * Response from GET /blueprints/manifest
 */
export interface BuildManifestResponse {
  movieId: string;
  revision: string | null;
  inputs: Record<string, unknown>;
  models?: ExtractedModelSelection[];
  artefacts: ArtifactInfo[];
  createdAt: string | null;
}

/**
 * Information about an uploaded input file.
 */
export interface UploadedFileInfo {
  /** Generated filename stored on disk */
  filename: string;
  /** Original filename from upload */
  originalName: string;
  /** File size in bytes */
  size: number;
  /** MIME type of the file */
  mimeType: string;
  /** File reference for use in inputs.yaml (file:./input-files/filename) */
  fileRef: string;
}

/**
 * Response from POST /blueprints/builds/upload
 */
export interface UploadFilesResponse {
  files: UploadedFileInfo[];
}

/**
 * Supported media types for file inputs.
 */
export type MediaInputType = "image" | "video" | "audio";
