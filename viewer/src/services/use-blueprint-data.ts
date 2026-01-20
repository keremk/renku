import { startTransition, useEffect, useState } from "react";
import { fetchBlueprintGraph, fetchInputTemplate } from "@/data/blueprint-client";
import type { BlueprintGraphData, InputTemplateData } from "@/types/blueprint-graph";

type Status = "idle" | "loading" | "success" | "error";

interface BlueprintDataState {
  graph: BlueprintGraphData | null;
  inputs: InputTemplateData | null;
  status: Status;
  error: Error | null;
}

const idleState: BlueprintDataState = {
  graph: null,
  inputs: null,
  status: "idle",
  error: null,
};

export function useBlueprintData(
  blueprintPath: string | null,
  inputsPath: string | null,
  catalogRoot?: string | null
): BlueprintDataState {
  const [state, setState] = useState<BlueprintDataState>(idleState);

  useEffect(() => {
    if (!blueprintPath) {
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
        const [graphData, inputData] = await Promise.all([
          fetchBlueprintGraph(blueprintPath, catalogRoot),
          inputsPath ? fetchInputTemplate(inputsPath) : Promise.resolve(null),
        ]);

        if (cancelled) return;
        startTransition(() => {
          setState({
            graph: graphData,
            inputs: inputData,
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
  }, [blueprintPath, inputsPath, catalogRoot]);

  return blueprintPath ? state : idleState;
}
