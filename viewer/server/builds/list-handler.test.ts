import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createEventLog,
  createRunLifecycleService,
  createStorageContext,
  initializeMovieStorage,
} from "@gorenku/core";
import { createBuild } from "./create-handler.js";
import { listBuilds } from "./list-handler.js";

describe("listBuilds", () => {
  it("hides preview-only folders that never became real builds", async () => {
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

      const result = await listBuilds(blueprintFolder);
      expect(result.builds).toHaveLength(0);
    } finally {
      await rm(blueprintFolder, { recursive: true, force: true });
    }
  });

  it("keeps newly created editable builds visible before first execution", async () => {
    const blueprintFolder = await mkdtemp(
      path.join(tmpdir(), "viewer-build-list-")
    );

    try {
      await writeFile(
        path.join(blueprintFolder, "input-template.yaml"),
        "inputs:\n  Prompt: hello\nmodels: []\n",
        "utf8"
      );

      const created = await createBuild(blueprintFolder, "First Draft");

      const result = await listBuilds(blueprintFolder);
      expect(result.builds).toHaveLength(1);
      expect(result.builds[0]).toMatchObject({
        movieId: created.movieId,
        revision: null,
        hasBuildState: false,
        hasInputSnapshot: false,
        hasInputsFile: true,
        displayName: "First Draft",
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
        producerJobId: "Producer:ImageProducer[0]",
        producerId: "Producer:ImageProducer",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastRevisionBy: "producer",
      });

      const runLifecycle = createRunLifecycleService(storage);
      await runLifecycle.appendStarted(movieId, {
        type: "run-started",
        revision: "rev-0002",
        startedAt: "2026-01-01T00:00:00.000Z",
        inputSnapshotPath: "runs/rev-0002-inputs.yaml",
        inputSnapshotHash: "snapshot-hash",
        planPath: "runs/rev-0002-plan.json",
        runConfig: {},
      });
      await runLifecycle.appendCompleted(movieId, {
        type: "run-completed",
        revision: "rev-0002",
        completedAt: "2026-01-01T00:10:00.000Z",
        status: "succeeded",
        summary: {
          jobCount: 1,
          counts: { succeeded: 1, failed: 0, skipped: 0 },
          layers: 1,
        },
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

      const runLifecycle = createRunLifecycleService(storage);
      await runLifecycle.writeInputSnapshot(
        movieId,
        "rev-0003",
        Buffer.from("Prompt: archived\n", "utf8")
      );
      await runLifecycle.appendStarted(movieId, {
        type: "run-started",
        revision: "rev-0003",
        startedAt: "2026-01-01T00:00:00.000Z",
        inputSnapshotPath: "runs/rev-0003-inputs.yaml",
        inputSnapshotHash: "snapshot-hash",
        planPath: "runs/rev-0003-plan.json",
        runConfig: {},
      });
      await runLifecycle.appendCompleted(movieId, {
        type: "run-completed",
        revision: "rev-0003",
        completedAt: "2026-01-01T00:05:00.000Z",
        status: "failed",
        summary: {
          jobCount: 1,
          counts: { succeeded: 0, failed: 1, skipped: 0 },
          layers: 1,
        },
      });

      const result = await listBuilds(blueprintFolder);
      expect(result.builds).toHaveLength(1);
      expect(result.builds[0]).toMatchObject({
        movieId,
        revision: null,
        hasBuildState: false,
        hasInputSnapshot: true,
        hasInputsFile: false,
      });
    } finally {
      await rm(blueprintFolder, { recursive: true, force: true });
    }
  });

  it("keeps the displayed revision pinned to the latest executed run when a newer draft exists", async () => {
    const blueprintFolder = await mkdtemp(
      path.join(tmpdir(), "viewer-build-list-")
    );

    try {
      const movieId = "movie-mixed";
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
        producerJobId: "Producer:ImageProducer[0]",
        producerId: "Producer:ImageProducer",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastRevisionBy: "producer",
      });
      await eventLog.appendInput(movieId, {
        id: "Input:Prompt",
        revision: "rev-0003",
        hash: "input-hash",
        payload: "planned only",
        editedBy: "user",
        createdAt: "2026-01-02T00:00:00.000Z",
      });

      const runLifecycle = createRunLifecycleService(storage);
      await runLifecycle.appendStarted(movieId, {
        type: "run-started",
        revision: "rev-0002",
        startedAt: "2026-01-01T00:00:00.000Z",
        inputSnapshotPath: "runs/rev-0002-inputs.yaml",
        inputSnapshotHash: "snapshot-hash-2",
        planPath: "runs/rev-0002-plan.json",
        runConfig: {},
      });
      await runLifecycle.appendCompleted(movieId, {
        type: "run-completed",
        revision: "rev-0002",
        completedAt: "2026-01-01T00:10:00.000Z",
        status: "succeeded",
        summary: {
          jobCount: 1,
          counts: { succeeded: 1, failed: 0, skipped: 0 },
          layers: 1,
        },
      });
      const result = await listBuilds(blueprintFolder);
      expect(result.builds).toHaveLength(1);
      expect(result.builds[0]).toMatchObject({
        movieId,
        revision: "rev-0002",
        hasBuildState: true,
      });
    } finally {
      await rm(blueprintFolder, { recursive: true, force: true });
    }
  });
});
