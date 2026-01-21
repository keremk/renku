import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  return () => {
    window.removeEventListener("popstate", callback);
  };
}

function getSnapshot() {
  return window.location.href;
}

export interface BlueprintRouteParams {
  blueprintPath: string | null;
  blueprintFolder: string | null;
  inputsPath: string | null;
  movieId: string | null;
  selectedBuildId: string | null;
  useLast: boolean;
  catalogRoot: string | null;
}

function parseBlueprintRoute(href: string): BlueprintRouteParams | null {
  try {
    const url = new URL(href);
    if (!url.pathname.startsWith("/blueprints")) {
      return null;
    }

    const blueprintPath = url.searchParams.get("bp");
    const blueprintFolder = url.searchParams.get("folder");
    const inputsPath = url.searchParams.get("in");
    const movieId = url.searchParams.get("movie");
    const selectedBuildId = url.searchParams.get("build");
    const useLast = url.searchParams.get("last") === "1";
    const catalogRoot = url.searchParams.get("catalog");

    if (!blueprintPath) {
      return null;
    }

    return {
      blueprintPath,
      blueprintFolder,
      inputsPath,
      movieId,
      selectedBuildId,
      useLast,
      catalogRoot,
    };
  } catch {
    return null;
  }
}

export function useBlueprintRoute(): BlueprintRouteParams | null {
  const href = useSyncExternalStore(subscribe, getSnapshot, () => "");
  return parseBlueprintRoute(href);
}

export function isBlueprintRoute(): boolean {
  return window.location.pathname.startsWith("/blueprints");
}

/**
 * Updates the blueprint route URL with a new build ID.
 * Uses history.pushState to avoid full page reload.
 */
export function updateBlueprintRoute(buildId: string | null): void {
  const url = new URL(window.location.href);
  if (buildId) {
    url.searchParams.set("build", buildId);
  } else {
    url.searchParams.delete("build");
  }
  window.history.pushState({}, "", url.toString());
  // Dispatch popstate to trigger re-render
  window.dispatchEvent(new PopStateEvent("popstate"));
}
