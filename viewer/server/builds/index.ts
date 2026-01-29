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
  MovieMetadata,
  BuildInfo,
  BuildsListResponse,
  ArtifactInfo,
  BuildManifestResponse,
  UploadedFileInfo,
  UploadFilesResponse,
  MediaInputType,
} from "./types.js";

// Handlers
export { generateMovieId, createBuild } from "./create-handler.js";
export { getBuildInputs, saveBuildInputs } from "./inputs-handler.js";
export { updateBuildMetadata } from "./metadata-handler.js";
export { enableBuildEditing } from "./enable-editing-handler.js";
export { listBuilds } from "./list-handler.js";
export { getBuildManifest, getBuildTimeline } from "./manifest-handler.js";
export { handleBuildsSubRoute } from "./builds-handler.js";
export { handleFileUpload, streamInputFile } from "./upload-handler.js";
