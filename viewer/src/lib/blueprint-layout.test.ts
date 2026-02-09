import { describe, it, expect } from "vitest";
import { layoutBlueprintGraph } from "./blueprint-layout";
import type { BlueprintGraphData } from "@/types/blueprint-graph";

function createGraphData(overrides?: Partial<BlueprintGraphData>): BlueprintGraphData {
  return {
    meta: { id: "bp-1", name: "Blueprint" },
    nodes: [
      { id: "Inputs", type: "input", label: "Inputs" },
      {
        id: "Producer:AudioGen",
        type: "producer",
        label: "AudioGen",
        inputBindings: [],
        outputBindings: [],
      },
      { id: "Outputs", type: "output", label: "Outputs" },
    ],
    edges: [{ id: "Inputs->Producer:AudioGen", source: "Inputs", target: "Producer:AudioGen" }],
    inputs: [],
    outputs: [],
    layerAssignments: { "Producer:AudioGen": 0 },
    layerCount: 1,
    ...overrides,
  };
}

describe("layoutBlueprintGraph", () => {
  it("uses canonical producer node ID for status lookup", () => {
    const graphData = createGraphData();
    const { nodes } = layoutBlueprintGraph(graphData, undefined, {
      "Producer:AudioGen": "error",
    });

    const producerNode = nodes.find((node) => node.id === "Producer:AudioGen");
    expect((producerNode?.data as { status?: string } | undefined)?.status).toBe("error");
  });

  it("throws when producer binding metadata is missing", () => {
    const graphData = createGraphData({
      nodes: [
        { id: "Inputs", type: "input", label: "Inputs" },
        { id: "Producer:AudioGen", type: "producer", label: "AudioGen" },
        { id: "Outputs", type: "output", label: "Outputs" },
      ],
    });

    expect(() => layoutBlueprintGraph(graphData)).toThrow("Missing input bindings for producer node");
  });
});
