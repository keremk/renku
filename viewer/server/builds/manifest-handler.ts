/**
 * Build manifest handler.
 */

import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { extractModelSelectionsFromInputs } from "@gorenku/core";
import type { ArtifactInfo, BuildManifestResponse } from "./types.js";

/**
 * Gets the manifest data for a specific build.
 */
export async function getBuildManifest(
  blueprintFolder: string,
  movieId: string,
): Promise<BuildManifestResponse> {
  const movieDir = path.join(blueprintFolder, "builds", movieId);
  const currentPath = path.join(movieDir, "current.json");

  const emptyResponse: BuildManifestResponse = {
    movieId,
    revision: null,
    inputs: {},
    artefacts: [],
    createdAt: null,
  };

  try {
    if (!existsSync(currentPath)) {
      return emptyResponse;
    }

    const currentContent = await fs.readFile(currentPath, "utf8");
    const current = JSON.parse(currentContent) as {
      revision?: string;
      manifestPath?: string | null;
    };

    const revision = current.revision ?? null;

    if (!current.manifestPath) {
      return { ...emptyResponse, revision };
    }

    const manifestPath = path.join(movieDir, current.manifestPath);
    if (!existsSync(manifestPath)) {
      return { ...emptyResponse, revision };
    }

    const manifestContent = await fs.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestContent) as {
      inputs?: Record<string, { payloadDigest?: unknown }>;
      artefacts?: Record<
        string,
        {
          hash?: string;
          blob?: { hash: string; size: number; mimeType?: string };
          status?: string;
          createdAt?: string;
        }
      >;
      createdAt?: string;
    };

    const stat = await fs.stat(manifestPath);

    // Parse inputs - extract values from payloadDigest and clean up names
    const parsedInputs: Record<string, unknown> = {};
    if (manifest.inputs) {
      for (const [key, entry] of Object.entries(manifest.inputs)) {
        // Remove "Input:" prefix if present
        const cleanName = key.startsWith("Input:") ? key.slice(6) : key;
        // Extract value from payloadDigest
        if (entry && typeof entry === "object" && "payloadDigest" in entry) {
          let value = entry.payloadDigest;
          // payloadDigest may contain JSON-encoded strings (e.g., "\"actual string\"")
          // Try to parse it if it's a string that looks like JSON
          if (typeof value === "string") {
            try {
              value = JSON.parse(value);
            } catch {
              // If parsing fails, use the raw string
            }
          }
          parsedInputs[cleanName] = value;
        }
      }
    }

    // Extract model selections from inputs
    const { modelSelections } = extractModelSelectionsFromInputs(parsedInputs);

    // Parse artifacts - extract blob info and clean up names
    const parsedArtifacts: ArtifactInfo[] = [];
    if (manifest.artefacts) {
      for (const [key, entry] of Object.entries(manifest.artefacts)) {
        if (!entry || !entry.blob) continue;

        // Extract name from artifact ID (e.g., "Artifact:Producer.Output" -> "Producer.Output")
        const cleanName = key.startsWith("Artifact:") ? key.slice(9) : key;

        parsedArtifacts.push({
          id: key,
          name: cleanName,
          hash: entry.blob.hash,
          size: entry.blob.size,
          mimeType: entry.blob.mimeType ?? "application/octet-stream",
          status: entry.status ?? "unknown",
          createdAt: entry.createdAt ?? null,
        });
      }
    }

    return {
      movieId,
      revision,
      inputs: parsedInputs,
      models: modelSelections.length > 0 ? modelSelections : undefined,
      artefacts: parsedArtifacts,
      createdAt: manifest.createdAt ?? stat.mtime.toISOString(),
    };
  } catch {
    return emptyResponse;
  }
}
