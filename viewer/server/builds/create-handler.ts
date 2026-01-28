/**
 * Build creation handler.
 */

import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { CreateBuildResponse, MovieMetadata } from "./types.js";

/**
 * Generates a unique movie ID.
 */
export function generateMovieId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `movie-${suffix}`;
}

/**
 * Creates a new build with inputs.yaml copied from input-template.yaml.
 */
export async function createBuild(
  blueprintFolder: string,
  displayName?: string,
): Promise<CreateBuildResponse> {
  const movieId = generateMovieId();
  const buildDir = path.join(blueprintFolder, "builds", movieId);

  // Create the build directory
  await fs.mkdir(buildDir, { recursive: true });

  // Copy input-template.yaml to inputs.yaml
  const templatePath = path.join(blueprintFolder, "input-template.yaml");
  const inputsPath = path.join(buildDir, "inputs.yaml");

  let templateContent = "";
  if (existsSync(templatePath)) {
    templateContent = await fs.readFile(templatePath, "utf8");
  }
  await fs.writeFile(inputsPath, templateContent, "utf8");

  // Create movie-metadata.json with displayName and createdAt
  const metadata: MovieMetadata = {
    displayName: displayName || undefined,
    createdAt: new Date().toISOString(),
  };
  const metadataPath = path.join(buildDir, "movie-metadata.json");
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");

  return { movieId, inputsPath };
}
