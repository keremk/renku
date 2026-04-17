/**
 * Enable editing handler for builds.
 */

import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createRunLifecycleService,
  createRuntimeError,
  createStorageContext,
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
  const runLifecycleService = createRunLifecycleService(storage);
  const latestRun = await runLifecycleService.loadLatest(movieId);

  if (!latestRun) {
    throw createRuntimeError(
      RuntimeErrorCode.MISSING_REQUIRED_INPUT,
      `Build "${movieId}" has no editable inputs.yaml and no saved input snapshot.`,
      {
        suggestion:
          `Expected either "${inputsPath}" or a latest run lifecycle entry with a valid input snapshot.`,
      },
    );
  }

  const snapshotPath = path.join(buildDir, latestRun.inputSnapshotPath);
  if (!existsSync(snapshotPath)) {
    throw createRuntimeError(
      RuntimeErrorCode.MISSING_REQUIRED_INPUT,
      `Build "${movieId}" is missing its saved input snapshot for revision "${latestRun.revision}".`,
      {
        suggestion:
          `Expected snapshot at "${snapshotPath}". Re-run the build or restore its run snapshot before enabling editing.`,
      },
    );
  }

  await fs.mkdir(buildDir, { recursive: true });
  await fs.copyFile(snapshotPath, inputsPath);
}
