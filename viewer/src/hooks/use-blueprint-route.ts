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
  inputsPath: string | null;
  movieId: string | null;
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
    const inputsPath = url.searchParams.get("in");
    const movieId = url.searchParams.get("movie");
    const useLast = url.searchParams.get("last") === "1";
    const catalogRoot = url.searchParams.get("catalog");

    if (!blueprintPath) {
      return null;
    }

    return {
      blueprintPath,
      inputsPath,
      movieId,
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
