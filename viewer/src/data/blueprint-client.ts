import type { BlueprintGraphData, InputTemplateData } from "@/types/blueprint-graph";
import type { BuildsListResponse, BuildManifestResponse } from "@/types/builds";

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
