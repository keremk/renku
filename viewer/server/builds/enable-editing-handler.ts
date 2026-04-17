/**
 * Enable editing handler for builds.
 */

import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createRuntimeError,
  createStorageContext,
  resolveCurrentBuildContext,
  RuntimeErrorCode,
} from "@gorenku/core";

/**
 * Enables editing for an existing build by materializing its saved input snapshot
 * into builds/<movieId>/inputs.yaml.
 */
export async function enableBuildEditing(
  blueprintFolder: string,
  movieId: string,
): Promise<void> {
  const buildDir = path.join(blueprintFolder, "builds", movieId);
  const inputsPath = path.join(buildDir, "inputs.yaml");

  // Don't overwrite if inputs.yaml already exists
  if (existsSync(inputsPath)) {
    return;
  }

  const storage = createStorageContext({
    kind: "local",
    rootDir: blueprintFolder,
    basePath: "builds",
  });
  const { snapshotSourceRun } = await resolveCurrentBuildContext({
    storage,
    movieId,
  });

  if (!snapshotSourceRun) {
    throw createRuntimeError(
      RuntimeErrorCode.MISSING_REQUIRED_INPUT,
      `Build "${movieId}" has no editable inputs.yaml and no saved input snapshot.`,
      {
        suggestion:
          `Expected either "${inputsPath}" or a persisted run snapshot for the current build.`,
      },
    );
  }

  const snapshotPath = path.join(buildDir, snapshotSourceRun.inputSnapshotPath);
  if (!existsSync(snapshotPath)) {
    throw createRuntimeError(
      RuntimeErrorCode.MISSING_REQUIRED_INPUT,
      `Build "${movieId}" is missing its saved input snapshot for revision "${snapshotSourceRun.revision}".`,
      {
        suggestion:
          `Expected snapshot at "${snapshotPath}". Re-run the build or restore its run snapshot before enabling editing.`,
      },
    );
  }

  await fs.mkdir(buildDir, { recursive: true });
  await fs.copyFile(snapshotPath, inputsPath);
}
