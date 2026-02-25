import type {
  BlueprintGraphData,
  InputTemplateData,
  ProducerModelsResponse,
  ProducerConfigSchemasResponse,
  ProducerPromptsResponse,
  PromptData,
  ModelSelectionValue,
} from "@/types/blueprint-graph";
import type { BuildsListResponse, BuildManifestResponse } from "@/types/builds";
import type { TimelineDocument } from "@/types/timeline";

const API_BASE = "/viewer-api";

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Request failed (${response.status}): ${errorText}`);
  }
  return response.json() as Promise<T>;
}

/**
 * A blueprint entry returned by the list endpoint.
 */
export interface BlueprintListItem {
  name: string;
}

/**
 * Response from GET /blueprints/list.
 */
export interface BlueprintListResponse {
  blueprints: BlueprintListItem[];
}

/**
 * Lists all blueprints in the storage root.
 */
export function fetchBlueprintsList(): Promise<BlueprintListResponse> {
  return fetchJson<BlueprintListResponse>(`${API_BASE}/blueprints/list`);
}

/**
 * Resolved blueprint paths from the server.
 */
export interface ResolvedBlueprintPaths {
  blueprintPath: string;
  blueprintFolder: string;
  inputsPath: string;
  buildsFolder: string;
  catalogRoot?: string;
}

/**
 * Resolves a blueprint name to full paths using CLI config on the server.
 */
export function resolveBlueprintName(name: string): Promise<ResolvedBlueprintPaths> {
  const url = new URL(`${API_BASE}/blueprints/resolve`, window.location.origin);
  url.searchParams.set("name", name);
  return fetchJson<ResolvedBlueprintPaths>(url.toString());
}

export function fetchBlueprintGraph(
  blueprintPath: string,
  catalogRoot?: string | null
): Promise<BlueprintGraphData> {
  const url = new URL(`${API_BASE}/blueprints/parse`, window.location.origin);
  url.searchParams.set("path", blueprintPath);
  if (catalogRoot) {
    url.searchParams.set("catalog", catalogRoot);
  }
  return fetchJson<BlueprintGraphData>(url.toString());
}

export function fetchInputTemplate(inputsPath: string): Promise<InputTemplateData> {
  return fetchJson<InputTemplateData>(
    `${API_BASE}/blueprints/inputs?path=${encodeURIComponent(inputsPath)}`
  );
}

/**
 * Fetches available models for each producer in a blueprint.
 * Models are extracted from the producer's mappings section.
 */
export function fetchProducerModels(
  blueprintPath: string,
  catalogRoot?: string | null
): Promise<ProducerModelsResponse> {
  const url = new URL(`${API_BASE}/blueprints/producer-models`, window.location.origin);
  url.searchParams.set("path", blueprintPath);
  if (catalogRoot) {
    url.searchParams.set("catalog", catalogRoot);
  }
  return fetchJson<ProducerModelsResponse>(url.toString());
}

/**
 * Fetches config schemas for each producer in a blueprint.
 * Returns JSON schema properties that are NOT mapped through connections.
 */
export function fetchProducerConfigSchemas(
  blueprintPath: string,
  catalogRoot?: string | null
): Promise<ProducerConfigSchemasResponse> {
  const url = new URL(`${API_BASE}/blueprints/producer-config-schemas`, window.location.origin);
  url.searchParams.set("path", blueprintPath);
  if (catalogRoot) {
    url.searchParams.set("catalog", catalogRoot);
  }
  return fetchJson<ProducerConfigSchemasResponse>(url.toString());
}

export function fetchBuildsList(blueprintFolder: string): Promise<BuildsListResponse> {
  const url = new URL(`${API_BASE}/blueprints/builds`, window.location.origin);
  url.searchParams.set("folder", blueprintFolder);
  return fetchJson<BuildsListResponse>(url.toString());
}

export function fetchBuildManifest(
  blueprintFolder: string,
  movieId: string
): Promise<BuildManifestResponse> {
  const url = new URL(`${API_BASE}/blueprints/manifest`, window.location.origin);
  url.searchParams.set("folder", blueprintFolder);
  url.searchParams.set("movieId", movieId);
  return fetchJson<BuildManifestResponse>(url.toString());
}

// --- Build management API functions ---

export interface CreateBuildResponse {
  movieId: string;
  inputsPath: string;
}

/**
 * Response from GET /blueprints/builds/inputs.
 * Returns parsed inputs and model selections as structured JSON.
 */
export interface BuildInputsResponse {
  inputs: Record<string, unknown>;
  models: ModelSelectionValue[];
  inputsPath: string;
}

/**
 * Creates a new build with inputs.yaml copied from input-template.yaml.
 */
export async function createBuild(
  blueprintFolder: string,
  displayName?: string
): Promise<CreateBuildResponse> {
  const response = await fetch(`${API_BASE}/blueprints/builds/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blueprintFolder, displayName }),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Failed to create build: ${errorText}`);
  }
  return response.json() as Promise<CreateBuildResponse>;
}

/**
 * Fetches the parsed inputs for a specific build.
 * Returns structured JSON (inputs + models) instead of raw YAML.
 */
export function fetchBuildInputs(
  blueprintFolder: string,
  movieId: string,
  blueprintPath: string,
  catalogRoot?: string | null,
): Promise<BuildInputsResponse> {
  const url = new URL(`${API_BASE}/blueprints/builds/inputs`, window.location.origin);
  url.searchParams.set("folder", blueprintFolder);
  url.searchParams.set("movieId", movieId);
  url.searchParams.set("blueprintPath", blueprintPath);
  if (catalogRoot) {
    url.searchParams.set("catalog", catalogRoot);
  }
  return fetchJson<BuildInputsResponse>(url.toString());
}

/**
 * Saves the inputs for a specific build.
 * Accepts structured JSON (inputs + models) which server serializes to YAML.
 */
export async function saveBuildInputs(
  blueprintFolder: string,
  blueprintPath: string,
  movieId: string,
  inputs: Record<string, unknown>,
  models: ModelSelectionValue[],
): Promise<void> {
  const response = await fetch(`${API_BASE}/blueprints/builds/inputs`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blueprintFolder, blueprintPath, movieId, inputs, models }),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Failed to save inputs: ${errorText}`);
  }
}

/**
 * Updates the display name for a specific build.
 */
export async function updateBuildMetadata(
  blueprintFolder: string,
  movieId: string,
  displayName: string
): Promise<void> {
  const response = await fetch(`${API_BASE}/blueprints/builds/metadata`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blueprintFolder, movieId, displayName }),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Failed to update metadata: ${errorText}`);
  }
}

/**
 * Enables editing for an existing build by copying input-template.yaml to the build folder.
 */
export async function enableBuildEditing(
  blueprintFolder: string,
  movieId: string
): Promise<void> {
  const response = await fetch(`${API_BASE}/blueprints/builds/enable-editing`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blueprintFolder, movieId }),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Failed to enable editing: ${errorText}`);
  }
}

/**
 * Fetches the timeline for a specific build.
 */
export function fetchBuildTimeline(
  blueprintFolder: string,
  movieId: string
): Promise<TimelineDocument> {
  const url = new URL(`${API_BASE}/blueprints/timeline`, window.location.origin);
  url.searchParams.set("folder", blueprintFolder);
  url.searchParams.set("movieId", movieId);
  return fetchJson<TimelineDocument>(url.toString());
}

/**
 * Builds the URL for fetching an asset from a blueprint build.
 */
export function buildBlueprintAssetUrl(
  blueprintFolder: string,
  movieId: string,
  assetId: string
): string {
  const url = new URL(`${API_BASE}/blueprints/asset`, window.location.origin);
  url.searchParams.set("folder", blueprintFolder);
  url.searchParams.set("movieId", movieId);
  url.searchParams.set("assetId", assetId);
  return url.toString();
}

/**
 * Deletes a build and its storage directory.
 */
export async function deleteBuild(
  blueprintFolder: string,
  movieId: string,
): Promise<void> {
  const response = await fetch(`${API_BASE}/blueprints/builds/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blueprintFolder, movieId }),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Failed to delete build: ${errorText}`);
  }
}

// --- File upload API functions ---

/**
 * Information about an uploaded input file.
 */
export interface UploadedFileInfo {
  filename: string;
  originalName: string;
  size: number;
  mimeType: string;
  fileRef: string;
}

/**
 * Response from file upload endpoint.
 */
export interface UploadFilesResponse {
  files: UploadedFileInfo[];
  errors?: string[];
}

/**
 * Supported media types for file inputs.
 */
export type MediaInputType = "image" | "video" | "audio";

/**
 * Uploads input files for a specific build.
 * Returns file references that can be used in inputs.yaml.
 */
export async function uploadInputFiles(
  blueprintFolder: string,
  movieId: string,
  files: File[],
  inputType?: MediaInputType,
): Promise<UploadFilesResponse> {
  const url = new URL(`${API_BASE}/blueprints/builds/upload`, window.location.origin);
  url.searchParams.set("folder", blueprintFolder);
  url.searchParams.set("movieId", movieId);
  if (inputType) {
    url.searchParams.set("inputType", inputType);
  }

  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }

  const response = await fetch(url.toString(), {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    let errorMessage = `Upload failed (${response.status})`;
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.error) {
        errorMessage = errorJson.error;
      }
    } catch {
      errorMessage = errorText || errorMessage;
    }
    throw new Error(errorMessage);
  }

  return response.json() as Promise<UploadFilesResponse>;
}

/**
 * Builds the URL for fetching an input file from a blueprint build.
 */
export function buildInputFileUrl(
  blueprintFolder: string,
  movieId: string,
  filename: string,
): string {
  const url = new URL(`${API_BASE}/blueprints/input-file`, window.location.origin);
  url.searchParams.set("folder", blueprintFolder);
  url.searchParams.set("movieId", movieId);
  url.searchParams.set("filename", filename);
  return url.toString();
}

/**
 * Extracts filename from a file reference (file:./input-files/filename).
 * Returns null if the value is not a valid file reference.
 */
export function parseFileRef(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^file:\.\/input-files\/(.+)$/);
  return match ? match[1] : null;
}

// --- Artifact editing API functions ---

/**
 * Response from artifact edit operation.
 */
export interface ArtifactEditResponse {
  success: boolean;
  newHash: string;
  originalHash?: string;
  editedBy: "user";
}

/**
 * Response from artifact restore operation.
 */
export interface ArtifactRestoreResponse {
  success: boolean;
  restoredHash: string;
}

/**
 * Edits an artifact by uploading a new file (for media artifacts).
 */
export async function editArtifactFile(
  blueprintFolder: string,
  movieId: string,
  artifactId: string,
  file: File,
): Promise<ArtifactEditResponse> {
  const url = new URL(`${API_BASE}/blueprints/builds/artifacts/edit`, window.location.origin);
  url.searchParams.set("folder", blueprintFolder);
  url.searchParams.set("movieId", movieId);
  url.searchParams.set("artifactId", artifactId);

  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(url.toString(), {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    let errorMessage = `Edit failed (${response.status})`;
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.error) {
        errorMessage = errorJson.error;
      }
    } catch {
      errorMessage = errorText || errorMessage;
    }
    throw new Error(errorMessage);
  }

  return response.json() as Promise<ArtifactEditResponse>;
}

/**
 * Edits a text artifact by providing new content (for JSON/text artifacts).
 */
export async function editArtifactText(
  blueprintFolder: string,
  movieId: string,
  artifactId: string,
  content: string,
  mimeType: string,
): Promise<ArtifactEditResponse> {
  const response = await fetch(`${API_BASE}/blueprints/builds/artifacts/edit-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      blueprintFolder,
      movieId,
      artifactId,
      content,
      mimeType,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Edit failed: ${errorText}`);
  }

  return response.json() as Promise<ArtifactEditResponse>;
}

/**
 * Restores an artifact to its original producer-generated version.
 */
export async function restoreArtifact(
  blueprintFolder: string,
  movieId: string,
  artifactId: string,
): Promise<ArtifactRestoreResponse> {
  const response = await fetch(`${API_BASE}/blueprints/builds/artifacts/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      blueprintFolder,
      movieId,
      artifactId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Restore failed: ${errorText}`);
  }

  return response.json() as Promise<ArtifactRestoreResponse>;
}

/**
 * Response from artifact recheck operation.
 */
export interface ArtifactRecheckResponse {
  status: "recovered" | "still_pending" | "failed" | "not_recoverable";
  artifact?: import("@/types/builds").ArtifactInfo;
  message: string;
}

/**
 * Rechecks a failed artifact's status with the provider.
 * Useful for recovering from client-side timeouts where the job
 * may have completed on the provider's servers.
 */
export async function recheckArtifact(
  blueprintFolder: string,
  movieId: string,
  artifactId: string,
): Promise<ArtifactRecheckResponse> {
  const response = await fetch(`${API_BASE}/blueprints/builds/artifacts/recheck`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      blueprintFolder,
      movieId,
      artifactId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Recheck failed: ${errorText}`);
  }

  return response.json() as Promise<ArtifactRecheckResponse>;
}

// --- Prompts API functions ---

/**
 * Fetches prompts for a producer.
 * Returns the edited version from build folder if it exists, otherwise the template.
 */
export function fetchProducerPrompts(
  blueprintFolder: string,
  movieId: string,
  blueprintPath: string,
  producerId: string,
  catalogRoot?: string | null,
): Promise<ProducerPromptsResponse> {
  const url = new URL(`${API_BASE}/blueprints/builds/prompts`, window.location.origin);
  url.searchParams.set("folder", blueprintFolder);
  url.searchParams.set("movieId", movieId);
  url.searchParams.set("blueprintPath", blueprintPath);
  url.searchParams.set("producerId", producerId);
  if (catalogRoot) {
    url.searchParams.set("catalog", catalogRoot);
  }
  return fetchJson<ProducerPromptsResponse>(url.toString());
}

/**
 * Saves edited prompts to the build folder.
 */
export async function saveProducerPrompts(
  blueprintFolder: string,
  movieId: string,
  blueprintPath: string,
  producerId: string,
  prompts: PromptData,
): Promise<void> {
  const response = await fetch(`${API_BASE}/blueprints/builds/prompts`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      blueprintFolder,
      movieId,
      blueprintPath,
      producerId,
      prompts,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Failed to save prompts: ${errorText}`);
  }
}

/**
 * Restores prompts to the template version by deleting the build copy.
 */
export async function restoreProducerPrompts(
  blueprintFolder: string,
  movieId: string,
  producerId: string,
): Promise<void> {
  const response = await fetch(`${API_BASE}/blueprints/builds/prompts/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      blueprintFolder,
      movieId,
      producerId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Failed to restore prompts: ${errorText}`);
  }
}
