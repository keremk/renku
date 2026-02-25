/**
 * Blueprint list handler.
 * Scans the storage root for blueprint directories.
 */

import { readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { readCliConfig } from '../generation/index.js';
import type { BlueprintListResponse } from './types.js';

/**
 * Lists all blueprint directories in the storage root.
 * A directory is considered a blueprint if it contains a YAML file
 * matching the directory name (e.g., `my-blueprint/my-blueprint.yaml`).
 */
export async function listBlueprints(): Promise<BlueprintListResponse> {
  const cliConfig = await readCliConfig();
  if (!cliConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }

  const storageRoot = cliConfig.storage.root;
  const entries = await readdir(storageRoot, { withFileTypes: true });

  const blueprintNames: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const yamlPath = join(storageRoot, entry.name, `${entry.name}.yaml`);
    try {
      await access(yamlPath);
      blueprintNames.push(entry.name);
    } catch {
      // Not a blueprint directory — skip
    }
  }

  blueprintNames.sort((a, b) => a.localeCompare(b));

  return { blueprints: blueprintNames.map((name) => ({ name })) };
}
