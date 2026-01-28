import type {
  BlueprintGraphData,
  InputTemplateData,
  ProducerModelsResponse,
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
