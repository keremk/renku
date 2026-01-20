import type { BlueprintGraphData, InputTemplateData } from "@/types/blueprint-graph";

const API_BASE = "/viewer-api";

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
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
