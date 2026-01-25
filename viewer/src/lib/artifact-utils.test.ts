import { describe, it, expect } from "vitest";
import {
  extractProducerFromArtifactId,
  shortenArtifactDisplayName,
  groupArtifactsByProducer,
  sortProducersByTopology,
} from "./artifact-utils";
import type { ArtifactInfo } from "@/types/builds";
import type { BlueprintGraphData } from "@/types/blueprint-graph";

describe("extractProducerFromArtifactId", () => {
  it("extracts producer name from simple artifact ID", () => {
    expect(extractProducerFromArtifactId("Artifact:ScriptProducer.NarrationScript[0]"))
      .toBe("ScriptProducer");
  });

  it("extracts producer name from nested artifact ID", () => {
    expect(extractProducerFromArtifactId("Artifact:EduScriptProducer.VideoScript.Characters[0].CharacterImagePrompt"))
      .toBe("EduScriptProducer");
  });

  it("extracts producer name with index", () => {
    expect(extractProducerFromArtifactId("Artifact:CharacterImageProducer.GeneratedImage[1]"))
      .toBe("CharacterImageProducer");
  });

  it("returns null for invalid format", () => {
    expect(extractProducerFromArtifactId("InvalidFormat")).toBeNull();
  });

  it("returns null for missing prefix", () => {
    expect(extractProducerFromArtifactId("Producer.Output")).toBeNull();
  });

  it("returns null for artifact ID without dot", () => {
    expect(extractProducerFromArtifactId("Artifact:ProducerOnly")).toBeNull();
  });
});

describe("shortenArtifactDisplayName", () => {
  it("removes Artifact prefix and producer name", () => {
    expect(shortenArtifactDisplayName("Artifact:ScriptProducer.NarrationScript[0]"))
      .toBe("NarrationScript[0]");
  });

  it("handles nested paths correctly", () => {
    expect(shortenArtifactDisplayName("Artifact:EduScriptProducer.VideoScript.Characters[0].CharacterImagePrompt"))
      .toBe("VideoScript.Characters[0].CharacterImagePrompt");
  });

  it("handles simple output name", () => {
    expect(shortenArtifactDisplayName("Artifact:DocProducer.Script"))
      .toBe("Script");
  });

  it("handles artifact ID without dot", () => {
    expect(shortenArtifactDisplayName("Artifact:ProducerOnly"))
      .toBe("ProducerOnly");
  });

  it("handles artifact ID without Artifact prefix", () => {
    expect(shortenArtifactDisplayName("Producer.Output"))
      .toBe("Output");
  });
});

describe("groupArtifactsByProducer", () => {
  const makeArtifact = (id: string): ArtifactInfo => ({
    id,
    name: "test",
    hash: "abc123",
    size: 100,
    mimeType: "text/plain",
    status: "succeeded",
    createdAt: null,
  });

  it("groups artifacts by producer name", () => {
    const artifacts: ArtifactInfo[] = [
      makeArtifact("Artifact:ProducerA.Output1"),
      makeArtifact("Artifact:ProducerA.Output2"),
      makeArtifact("Artifact:ProducerB.Output1"),
    ];

    const groups = groupArtifactsByProducer(artifacts);

    expect(groups.size).toBe(2);
    expect(groups.get("ProducerA")?.length).toBe(2);
    expect(groups.get("ProducerB")?.length).toBe(1);
  });

  it("groups unrecognized artifacts under [Unknown]", () => {
    const artifacts: ArtifactInfo[] = [
      makeArtifact("Artifact:ValidProducer.Output"),
      makeArtifact("InvalidFormat"),
    ];

    const groups = groupArtifactsByProducer(artifacts);

    expect(groups.size).toBe(2);
    expect(groups.get("ValidProducer")?.length).toBe(1);
    expect(groups.get("[Unknown]")?.length).toBe(1);
  });

  it("handles empty array", () => {
    const groups = groupArtifactsByProducer([]);
    expect(groups.size).toBe(0);
  });
});

describe("sortProducersByTopology", () => {
  const makeGraphData = (nodeLabels: string[]): BlueprintGraphData => ({
    meta: { id: "test", name: "Test" },
    nodes: nodeLabels.map((label, index) => ({
      id: `node-${index}`,
      type: "producer" as const,
      label,
    })),
    edges: [],
    inputs: [],
    outputs: [],
  });

  it("sorts producers by graph node order", () => {
    const graphData = makeGraphData(["ProducerA", "ProducerB", "ProducerC"]);
    const producers = ["ProducerC", "ProducerA", "ProducerB"];

    const sorted = sortProducersByTopology(producers, graphData);

    expect(sorted).toEqual(["ProducerA", "ProducerB", "ProducerC"]);
  });

  it("puts unknown producers at the end", () => {
    const graphData = makeGraphData(["ProducerA", "ProducerB"]);
    const producers = ["UnknownProducer", "ProducerB", "ProducerA"];

    const sorted = sortProducersByTopology(producers, graphData);

    expect(sorted).toEqual(["ProducerA", "ProducerB", "UnknownProducer"]);
  });

  it("returns original order when no graph data", () => {
    const producers = ["ProducerC", "ProducerA", "ProducerB"];

    const sorted = sortProducersByTopology(producers, undefined);

    expect(sorted).toEqual(["ProducerC", "ProducerA", "ProducerB"]);
  });

  it("handles empty producer list", () => {
    const graphData = makeGraphData(["ProducerA"]);
    const sorted = sortProducersByTopology([], graphData);
    expect(sorted).toEqual([]);
  });
});
