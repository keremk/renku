import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRequestEmpty, createMockResponse } from "../generation/test-utils.js";

const { streamFileWithRangeMock } = vi.hoisted(() => ({
  streamFileWithRangeMock: vi.fn(),
}));

vi.mock("../shared/stream-utils.js", async () => {
  const actual = await vi.importActual("../shared/stream-utils.js");
  return {
    ...actual,
    streamFileWithRange: streamFileWithRangeMock,
  };
});

import { streamBuildAsset } from "./blob-handler.js";

describe("streamBuildAsset", () => {
  beforeEach(() => {
    streamFileWithRangeMock.mockReset();
    streamFileWithRangeMock.mockResolvedValue(undefined);
  });

  it("streams the latest succeeded blob when a later rerun failed", async () => {
    const blueprintFolder = await mkdtemp(
      path.join(tmpdir(), "viewer-blob-handler-")
    );

    try {
      const movieId = "movie-123";
      const movieDir = path.join(blueprintFolder, "builds", movieId);
      await mkdir(path.join(movieDir, "events"), { recursive: true });
      await mkdir(path.join(movieDir, "blobs", "ab"), { recursive: true });
      await writeFile(path.join(movieDir, "blobs", "ab", "ab123.png"), "png");
      await writeFile(
        path.join(movieDir, "events", "artifacts.log"),
        [
          JSON.stringify({
            artifactId: "Artifact:Image.Output",
            revision: "rev-0001",
            inputsHash: "hash-1",
            output: {
              blob: {
                hash: "ab123",
                size: 3,
                mimeType: "image/png",
              },
            },
            status: "succeeded",
            producedBy: "Producer:ImageProducer[0]",
            producerId: "Producer:ImageProducer",
            createdAt: "2026-01-01T00:00:00.000Z",
          }),
          JSON.stringify({
            artifactId: "Artifact:Image.Output",
            revision: "rev-0002",
            inputsHash: "hash-2",
            output: {},
            status: "failed",
            producedBy: "Producer:ImageProducer[0]",
            producerId: "Producer:ImageProducer",
            createdAt: "2026-01-01T00:01:00.000Z",
          }),
          "",
        ].join("\n"),
        "utf8"
      );

      const req = createMockRequestEmpty("GET");
      const res = createMockResponse();
      await streamBuildAsset(
        req,
        res,
        blueprintFolder,
        movieId,
        "Artifact:Image.Output"
      );

      expect(streamFileWithRangeMock).toHaveBeenCalledWith(
        req,
        res,
        path.join(movieDir, "blobs", "ab", "ab123.png"),
        "image/png",
        3
      );
      expect(res.statusCode).toBe(200);
    } finally {
      await rm(blueprintFolder, { recursive: true, force: true });
    }
  });

  it("returns 404 when the artifact never succeeded", async () => {
    const blueprintFolder = await mkdtemp(
      path.join(tmpdir(), "viewer-blob-handler-")
    );

    try {
      const movieId = "movie-456";
      const movieDir = path.join(blueprintFolder, "builds", movieId);
      await mkdir(path.join(movieDir, "events"), { recursive: true });
      await writeFile(
        path.join(movieDir, "events", "artifacts.log"),
        `${JSON.stringify({
          artifactId: "Artifact:Image.Output",
          revision: "rev-0001",
          inputsHash: "hash-1",
          output: {},
          status: "failed",
          producedBy: "Producer:ImageProducer[0]",
          producerId: "Producer:ImageProducer",
          createdAt: "2026-01-01T00:00:00.000Z",
        })}\n`,
        "utf8"
      );

      const req = createMockRequestEmpty("GET");
      const res = createMockResponse();
      await streamBuildAsset(
        req,
        res,
        blueprintFolder,
        movieId,
        "Artifact:Image.Output"
      );

      expect(streamFileWithRangeMock).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(404);
      expect(res.body).toBe("Asset not found");
    } finally {
      await rm(blueprintFolder, { recursive: true, force: true });
    }
  });
});
