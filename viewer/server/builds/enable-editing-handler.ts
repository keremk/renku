/**
 * Enable editing handler for builds.
 */

import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Enables editing for an existing build by copying input-template.yaml to the build folder.
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

  // Copy input-template.yaml to inputs.yaml
  const templatePath = path.join(blueprintFolder, "input-template.yaml");
  let templateContent = "";
  if (existsSync(templatePath)) {
    templateContent = await fs.readFile(templatePath, "utf8");
  }
  await fs.writeFile(inputsPath, templateContent, "utf8");
}
