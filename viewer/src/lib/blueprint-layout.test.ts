import { describe, it, expect } from "vitest";
import {
  defaultBlueprintLayoutConfig,
  layoutBlueprintGraph,
} from "./blueprint-layout";
import type { BlueprintGraphData } from "@/types/blueprint-graph";

function createGraphData(overrides?: Partial<BlueprintGraphData>): BlueprintGraphData {
  return {
    meta: { id: "bp-1", name: "Blueprint" },
    nodes: [
      {
        id: "Producer:AudioGen",
        type: "producer",
        label: "AudioGen",
        inputBindings: [],
        outputBindings: [],
      },
    ],
    edges: [],
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

  it("preserves runnable metadata on producer nodes", () => {
    const graphData = createGraphData({
      nodes: [
        {
          id: "Producer:CelebrityVideoProducer",
          type: "producer",
          label: "CelebrityVideoProducer",
          runnable: false,
          inputBindings: [],
          outputBindings: [],
        },
      ],
      edges: [],
      layerAssignments: { "Producer:CelebrityVideoProducer": 0 },
    });

    const { nodes } = layoutBlueprintGraph(graphData);
    const producerNode = nodes.find(
      (node) => node.id === "Producer:CelebrityVideoProducer"
    );

    expect(
      (producerNode?.data as { runnable?: boolean } | undefined)?.runnable
    ).toBe(false);
  });

  it("throws when producer binding metadata is missing", () => {
    const graphData = createGraphData({
      nodes: [
        { id: "Producer:AudioGen", type: "producer", label: "AudioGen" },
      ],
    });

    expect(() => layoutBlueprintGraph(graphData)).toThrow("Missing input bindings for producer node");
  });

  it("starts the first producer layer at x=0 without synthetic hub columns", () => {
    const graphData = createGraphData({
      nodes: [
        {
          id: "Producer:ScriptGen",
          type: "producer",
          label: "ScriptGen",
          inputBindings: [],
          outputBindings: [],
        },
        {
          id: "Producer:VideoGen",
          type: "producer",
          label: "VideoGen",
          inputBindings: [],
          outputBindings: [],
        },
      ],
      edges: [
        {
          id: "Producer:ScriptGen->Producer:VideoGen",
          source: "Producer:ScriptGen",
          target: "Producer:VideoGen",
        },
      ],
      layerAssignments: {
        "Producer:ScriptGen": 0,
        "Producer:VideoGen": 1,
      },
      layerCount: 2,
    });

    const { nodes } = layoutBlueprintGraph(graphData);
    const scriptNode = nodes.find((node) => node.id === "Producer:ScriptGen");
    const videoNode = nodes.find((node) => node.id === "Producer:VideoGen");

    expect(scriptNode?.position.x).toBe(0);
    expect(videoNode?.position.x).toBe(defaultBlueprintLayoutConfig.horizontalSpacing);
  });
});
