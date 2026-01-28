/**
 * Tests for blueprint graph converter.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeProducerName,
  resolveEndpoint,
  resolveEdgeEndpoints,
} from "./graph-converter.js";

describe("normalizeProducerName", () => {
  it("removes loop index suffixes", () => {
    expect(normalizeProducerName("VideoProducer[segment]")).toBe("VideoProducer");
    expect(normalizeProducerName("VideoProducer[segment-1]")).toBe("VideoProducer");
    expect(normalizeProducerName("VideoProducer[0]")).toBe("VideoProducer");
  });

  it("preserves names without suffixes", () => {
    expect(normalizeProducerName("VideoProducer")).toBe("VideoProducer");
    expect(normalizeProducerName("SimpleProducer")).toBe("SimpleProducer");
  });

  it("preserves empty brackets (not valid loop syntax)", () => {
    // Empty brackets are not valid loop syntax, so they are preserved
    expect(normalizeProducerName("Producer[]")).toBe("Producer[]");
  });
});

describe("resolveEndpoint", () => {
  const inputNames = new Set(["Title", "Count", "Message"]);
  const producerNames = new Set(["AudioGen", "VideoGen", "TextProducer"]);
  const artifactNames = new Set(["FinalVideo", "GeneratedAudio"]);

  it("resolves input references", () => {
    expect(resolveEndpoint("Title", inputNames, producerNames, artifactNames)).toEqual({
      type: "input",
    });
    expect(resolveEndpoint("Input.Title", inputNames, producerNames, artifactNames)).toEqual({
      type: "input",
    });
  });

  it("resolves producer references", () => {
    expect(resolveEndpoint("AudioGen", inputNames, producerNames, artifactNames)).toEqual({
      type: "producer",
      producer: "AudioGen",
    });
    expect(resolveEndpoint("AudioGen.Output", inputNames, producerNames, artifactNames)).toEqual({
      type: "producer",
      producer: "AudioGen",
    });
  });

  it("resolves output/artifact references", () => {
    expect(resolveEndpoint("FinalVideo", inputNames, producerNames, artifactNames)).toEqual({
      type: "output",
    });
    expect(resolveEndpoint("Output.FinalVideo", inputNames, producerNames, artifactNames)).toEqual({
      type: "output",
    });
  });

  it("handles loop-indexed producer names", () => {
    expect(resolveEndpoint("VideoGen[0]", inputNames, producerNames, artifactNames)).toEqual({
      type: "producer",
      producer: "VideoGen[0]",
    });
  });

  it("returns unknown for unrecognized references", () => {
    expect(resolveEndpoint("SomeOther.Thing", inputNames, producerNames, artifactNames)).toEqual({
      type: "unknown",
    });
  });
});

describe("resolveEdgeEndpoints", () => {
  const inputNames = new Set(["Title", "Count"]);
  const producerNames = new Set(["AudioGen", "VideoGen"]);
  const artifactNames = new Set(["FinalVideo"]);

  it("resolves input to producer edge", () => {
    const result = resolveEdgeEndpoints("Title", "AudioGen.Input", inputNames, producerNames, artifactNames);
    expect(result.sourceType).toBe("input");
    expect(result.targetType).toBe("producer");
    expect(result.targetProducer).toBe("AudioGen");
  });

  it("resolves producer to producer edge", () => {
    const result = resolveEdgeEndpoints("AudioGen.Output", "VideoGen.Input", inputNames, producerNames, artifactNames);
    expect(result.sourceType).toBe("producer");
    expect(result.sourceProducer).toBe("AudioGen");
    expect(result.targetType).toBe("producer");
    expect(result.targetProducer).toBe("VideoGen");
  });

  it("resolves producer to output edge", () => {
    const result = resolveEdgeEndpoints("VideoGen.Output", "FinalVideo", inputNames, producerNames, artifactNames);
    expect(result.sourceType).toBe("producer");
    expect(result.sourceProducer).toBe("VideoGen");
    expect(result.targetType).toBe("output");
  });
});
