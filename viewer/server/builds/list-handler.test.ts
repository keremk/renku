import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createEventLog,
  createRunRecordService,
  createStorageContext,
  initializeMovieStorage,
} from "@gorenku/core";
import { listBuilds } from "./list-handler.js";

describe("listBuilds", () => {
  it("keeps planned builds in the inputs-only state", async () => {
    const blueprintFolder = await mkdtemp(
      path.join(tmpdir(), "viewer-build-list-")
    );

    try {
      const movieId = "movie-planned";
      const storage = createStorageContext({
        kind: "local",
        rootDir: blueprintFolder,
        basePath: "builds",
      });
      await initializeMovieStorage(storage, movieId);

      await writeFile(
        path.join(blueprintFolder, "builds", movieId, "inputs.yaml"),
        "Prompt: hello\n",
        "utf8"
      );

      const eventLog = createEventLog(storage);
      await eventLog.appendInput(movieId, {
        id: "Input:Prompt",
        revision: "rev-0001",
        hash: "input-hash",
        payload: "hello",
        editedBy: "user",
        createdAt: "2026-01-01T00:00:00.000Z",
      });

      const runRecords = createRunRecordService(storage);
      await runRecords.write(movieId, {
        revision: "rev-0001",
        createdAt: "2026-01-01T00:00:00.000Z",
        blueprintPath: "/tmp/blueprint.yaml",
        sourceInputsPath: "/tmp/inputs.yaml",
        inputSnapshotPath: "runs/rev-0001-inputs.yaml",
        inputSnapshotHash: "snapshot-hash",
        planPath: "runs/rev-0001-plan.json",
        runConfig: {},
        status: "planned",
      });

      const result = await listBuilds(blueprintFolder);
      expect(result.builds).toHaveLength(1);
      expect(result.builds[0]).toMatchObject({
        movieId,
        revision: "rev-0001",
        hasBuildState: false,
        hasInputSnapshot: false,
        hasInputsFile: true,
      });
    } finally {
      await rm(blueprintFolder, { recursive: true, force: true });
    }
  });

  it("marks builds as having build state only after succeeded artifacts exist", async () => {
    const blueprintFolder = await mkdtemp(
      path.join(tmpdir(), "viewer-build-list-")
    );

    try {
      const movieId = "movie-built";
      const storage = createStorageContext({
        kind: "local",
        rootDir: blueprintFolder,
        basePath: "builds",
      });
      await initializeMovieStorage(storage, movieId);

      const eventLog = createEventLog(storage);
      await eventLog.appendArtifact(movieId, {
        artifactId: "Artifact:Image.Output",
        revision: "rev-0002",
        inputsHash: "artifact-hash",
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
      });

      const runRecords = createRunRecordService(storage);
      await runRecords.write(movieId, {
        revision: "rev-0002",
        createdAt: "2026-01-01T00:00:00.000Z",
        blueprintPath: "/tmp/blueprint.yaml",
        sourceInputsPath: "/tmp/inputs.yaml",
        inputSnapshotPath: "runs/rev-0002-inputs.yaml",
        inputSnapshotHash: "snapshot-hash",
        planPath: "runs/rev-0002-plan.json",
        runConfig: {},
        status: "succeeded",
      });

      const result = await listBuilds(blueprintFolder);
      expect(result.builds).toHaveLength(1);
      expect(result.builds[0]).toMatchObject({
        movieId,
        revision: "rev-0002",
        hasBuildState: true,
        hasInputSnapshot: false,
        hasInputsFile: false,
      });
    } finally {
      await rm(blueprintFolder, { recursive: true, force: true });
    }
  });

  it("keeps snapshot-only builds visible when editable inputs are missing", async () => {
    const blueprintFolder = await mkdtemp(
      path.join(tmpdir(), "viewer-build-list-")
    );

    try {
      const movieId = "movie-snapshot";
      const storage = createStorageContext({
        kind: "local",
        rootDir: blueprintFolder,
        basePath: "builds",
      });
      await initializeMovieStorage(storage, movieId);

      const runRecords = createRunRecordService(storage);
      await runRecords.writeInputSnapshot(
        movieId,
        "rev-0003",
        Buffer.from("Prompt: archived\n", "utf8")
      );
      await runRecords.write(movieId, {
        revision: "rev-0003",
        createdAt: "2026-01-01T00:00:00.000Z",
        blueprintPath: "/tmp/blueprint.yaml",
        sourceInputsPath: "/tmp/inputs.yaml",
        inputSnapshotPath: "runs/rev-0003-inputs.yaml",
        inputSnapshotHash: "snapshot-hash",
        planPath: "runs/rev-0003-plan.json",
        runConfig: {},
        status: "failed",
      });

      const result = await listBuilds(blueprintFolder);
      expect(result.builds).toHaveLength(1);
      expect(result.builds[0]).toMatchObject({
        movieId,
        revision: "rev-0003",
        hasBuildState: false,
        hasInputSnapshot: true,
        hasInputsFile: false,
      });
    } finally {
      await rm(blueprintFolder, { recursive: true, force: true });
    }
  });
});
