/**
 * Builds module exports.
 */

// Types
export type {
  CreateBuildRequest,
  CreateBuildResponse,
  BuildInputsRequest,
  BuildInputsResponse,
  BuildMetadataRequest,
  EnableEditingRequest,
  BuildInfo,
  BuildsListResponse,
  ArtifactInfo,
  BuildManifestResponse,
  UploadedFileInfo,
  UploadFilesResponse,
  MediaInputType,
} from "./types.js";
// Re-export MovieMetadata from core for convenience
export { type MovieMetadata } from "@gorenku/core";

// Handlers
export { generateMovieId, createBuild } from "./create-handler.js";
export { getBuildInputs, saveBuildInputs } from "./inputs-handler.js";
export { updateBuildMetadata } from "./metadata-handler.js";
export { enableBuildEditing } from "./enable-editing-handler.js";
export { listBuilds } from "./list-handler.js";
export { getBuildManifest, getBuildTimeline } from "./manifest-handler.js";
export { handleBuildsSubRoute } from "./builds-handler.js";
export { handleFileUpload, streamInputFile } from "./upload-handler.js";
export {
  handleArtifactFileEdit,
  handleArtifactTextEdit,
  handleArtifactRestore,
  type ArtifactEditResponse,
  type ArtifactRestoreResponse,
  type TextArtifactEditRequest,
  type ArtifactRestoreRequest,
} from "./artifact-edit-handler.js";
export {
  getProducerPrompts,
  saveProducerPrompts,
  restoreProducerPrompts,
  type ProducerPromptsResponse,
  type SavePromptsRequest,
  type RestorePromptsRequest,
} from "./prompts-handler.js";
// Re-export PromptFileData from core for convenience
export { type PromptFileData } from "@gorenku/core";
