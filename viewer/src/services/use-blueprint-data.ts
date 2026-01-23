import { startTransition, useEffect, useState } from "react";
import {
  resolveBlueprintName,
  fetchBlueprintGraph,
  fetchInputTemplate,
  type ResolvedBlueprintPaths,
} from "@/data/blueprint-client";
import type { BlueprintGraphData, InputTemplateData } from "@/types/blueprint-graph";

type Status = "idle" | "loading" | "success" | "error";

interface BlueprintDataState {
  graph: BlueprintGraphData | null;
  inputs: InputTemplateData | null;
  /** Resolved paths from server (for use in other components) */
  resolvedPaths: ResolvedBlueprintPaths | null;
  status: Status;
  error: Error | null;
}

const idleState: BlueprintDataState = {
  graph: null,
  inputs: null,
  resolvedPaths: null,
  status: "idle",
  error: null,
};

/**
 * Load blueprint data by name. Resolves the name to paths, then fetches data.
 * @param blueprintName - Blueprint folder name (e.g., "my-blueprint")
 * @param inputsFilename - Optional inputs filename (just filename, uses default if not provided)
 */
export function useBlueprintData(
  blueprintName: string | null,
  inputsFilename?: string | null
): BlueprintDataState {
  const [state, setState] = useState<BlueprintDataState>(idleState);

  useEffect(() => {
    if (!blueprintName) {
      return;
    }

    let cancelled = false;

    startTransition(() => {
      setState((prev) => ({
        ...prev,
        status: "loading",
        error: null,
      }));
    });

    const loadData = async () => {
      try {
        // First resolve the blueprint name to paths
        const resolvedPaths = await resolveBlueprintName(blueprintName);

        if (cancelled) return;

        // Determine which inputs path to use
        // If inputsFilename is provided, construct the path, otherwise use resolved default
        const inputsPath = inputsFilename
          ? `${resolvedPaths.blueprintFolder}/${inputsFilename}`
          : resolvedPaths.inputsPath;

        // Then fetch the blueprint and inputs data
        const [graphData, inputData] = await Promise.all([
          fetchBlueprintGraph(resolvedPaths.blueprintPath, resolvedPaths.catalogRoot),
          fetchInputTemplate(inputsPath),
        ]);

        if (cancelled) return;
        startTransition(() => {
          setState({
            graph: graphData,
            inputs: inputData,
            resolvedPaths,
            status: "success",
            error: null,
          });
        });
      } catch (err) {
        if (cancelled) return;
        startTransition(() => {
          setState({
            graph: null,
            inputs: null,
            resolvedPaths: null,
            status: "error",
            error: err instanceof Error ? err : new Error(String(err)),
          });
        });
      }
    };

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [blueprintName, inputsFilename]);

  return blueprintName ? state : idleState;
}
