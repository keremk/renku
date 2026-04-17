import { readFile } from "node:fs/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createRunRecordService,
  createStorageContext,
  initializeMovieStorage,
  RuntimeErrorCode,
} from "@gorenku/core";
import { enableBuildEditing } from "./enable-editing-handler.js";

describe("enableBuildEditing", () => {
  it("copies the saved input snapshot into editable inputs.yaml", async () => {
    const blueprintFolder = await mkdtemp(
      path.join(tmpdir(), "viewer-enable-editing-"),
    );

    try {
      const movieId = "movie-snapshot";
      const storage = createStorageContext({
        kind: "local",
        rootDir: blueprintFolder,
        basePath: "builds",
      });
      await initializeMovieStorage(storage, movieId);

      const runRecordService = createRunRecordService(storage);
      const snapshot = await runRecordService.writeInputSnapshot(
        movieId,
        "rev-0001",
        Buffer.from("Prompt: snapshot-value\n", "utf8"),
      );
      await runRecordService.write(movieId, {
        revision: "rev-0001",
        createdAt: "2026-01-01T00:00:00.000Z",
        blueprintPath: "/tmp/blueprint.yaml",
        sourceInputsPath: "/tmp/inputs.yaml",
        inputSnapshotPath: snapshot.path,
        inputSnapshotHash: snapshot.hash,
        planPath: "runs/rev-0001-plan.json",
        runConfig: {},
        status: "planned",
      });

      await enableBuildEditing(blueprintFolder, movieId);

      const inputsPath = path.join(
        blueprintFolder,
        "builds",
        movieId,
        "inputs.yaml",
      );
      await expect(readFile(inputsPath, "utf8")).resolves.toBe(
        "Prompt: snapshot-value\n",
      );
    } finally {
      await rm(blueprintFolder, { recursive: true, force: true });
    }
  });

  it("does not overwrite existing editable inputs.yaml", async () => {
    const blueprintFolder = await mkdtemp(
      path.join(tmpdir(), "viewer-enable-editing-"),
    );

    try {
      const movieId = "movie-editable";
      const storage = createStorageContext({
        kind: "local",
        rootDir: blueprintFolder,
        basePath: "builds",
      });
      await initializeMovieStorage(storage, movieId);

      const buildDir = path.join(blueprintFolder, "builds", movieId);
      const inputsPath = path.join(buildDir, "inputs.yaml");
      await writeFile(inputsPath, "Prompt: keep-me\n", "utf8");

      const runRecordService = createRunRecordService(storage);
      const snapshot = await runRecordService.writeInputSnapshot(
        movieId,
        "rev-0002",
        Buffer.from("Prompt: snapshot-value\n", "utf8"),
      );
      await runRecordService.write(movieId, {
        revision: "rev-0002",
        createdAt: "2026-01-01T00:00:00.000Z",
        blueprintPath: "/tmp/blueprint.yaml",
        sourceInputsPath: "/tmp/inputs.yaml",
        inputSnapshotPath: snapshot.path,
        inputSnapshotHash: snapshot.hash,
        planPath: "runs/rev-0002-plan.json",
        runConfig: {},
        status: "planned",
      });

      await enableBuildEditing(blueprintFolder, movieId);

      await expect(readFile(inputsPath, "utf8")).resolves.toBe(
        "Prompt: keep-me\n",
      );
    } finally {
      await rm(blueprintFolder, { recursive: true, force: true });
    }
  });

  it("fails fast when the build has no saved run record", async () => {
    const blueprintFolder = await mkdtemp(
      path.join(tmpdir(), "viewer-enable-editing-"),
    );

    try {
      const movieId = "movie-missing-record";
      const storage = createStorageContext({
        kind: "local",
        rootDir: blueprintFolder,
        basePath: "builds",
      });
      await initializeMovieStorage(storage, movieId);

      await expect(enableBuildEditing(blueprintFolder, movieId)).rejects.toMatchObject(
        {
          code: RuntimeErrorCode.MISSING_REQUIRED_INPUT,
        },
      );
    } finally {
      await rm(blueprintFolder, { recursive: true, force: true });
    }
  });

  it("fails fast when the latest snapshot file is missing", async () => {
    const blueprintFolder = await mkdtemp(
      path.join(tmpdir(), "viewer-enable-editing-"),
    );

    try {
      const movieId = "movie-missing-snapshot";
      const storage = createStorageContext({
        kind: "local",
        rootDir: blueprintFolder,
        basePath: "builds",
      });
      await initializeMovieStorage(storage, movieId);

      const runRecordService = createRunRecordService(storage);
      await runRecordService.write(movieId, {
        revision: "rev-0003",
        createdAt: "2026-01-01T00:00:00.000Z",
        blueprintPath: "/tmp/blueprint.yaml",
        sourceInputsPath: "/tmp/inputs.yaml",
        inputSnapshotPath: "runs/rev-0003-inputs.yaml",
        inputSnapshotHash: "snapshot-hash",
        planPath: "runs/rev-0003-plan.json",
        runConfig: {},
        status: "planned",
      });

      await expect(enableBuildEditing(blueprintFolder, movieId)).rejects.toMatchObject(
        {
          code: RuntimeErrorCode.MISSING_REQUIRED_INPUT,
        },
      );
    } finally {
      await rm(blueprintFolder, { recursive: true, force: true });
    }
  });
});
