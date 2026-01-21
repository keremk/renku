import { promises as fs } from 'node:fs';
import { resolve, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * Result of blueprint detection.
 */
export interface BlueprintDetectionResult {
  /** Absolute path to the detected blueprint file */
  blueprintPath: string;
  /** Absolute path to the folder containing the blueprint */
  blueprintFolder: string;
}

/**
 * Detects a blueprint file in the given directory.
 * Scans for YAML files with `meta.kind === 'blueprint'` in the directory.
 *
 * @param directory The directory to search in (defaults to current working directory)
 * @returns The detection result or null if no blueprint is found
 */
export async function detectBlueprintInDirectory(
  directory?: string,
): Promise<BlueprintDetectionResult | null> {
  const searchDir = directory ? resolve(directory) : process.cwd();

  try {
    const entries = await fs.readdir(searchDir, { withFileTypes: true });
    const yamlFiles = entries
      .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
      .map((entry) => join(searchDir, entry.name));

    for (const filePath of yamlFiles) {
      const isBlueprint = await isBlueprintFile(filePath);
      if (isBlueprint) {
        return {
          blueprintPath: filePath,
          blueprintFolder: searchDir,
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Checks if a YAML file is a blueprint (has meta.kind === 'blueprint' and producers section).
 * A blueprint is distinguished from a producer by having a `producers` section.
 */
async function isBlueprintFile(filePath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const doc = parseYaml(content);

    if (!doc || typeof doc !== 'object') {
      return false;
    }

    const docObj = doc as Record<string, unknown>;
    const meta = docObj.meta;
    if (!meta || typeof meta !== 'object') {
      return false;
    }

    const kind = (meta as Record<string, unknown>).kind;
    // Blueprints have kind === 'blueprint' OR no kind at all (default is blueprint)
    // Producers have kind === 'producer'
    if (kind === 'producer') {
      return false;
    }

    // A top-level blueprint (not a producer) has a `producers` section
    const hasProducers =
      Array.isArray(docObj.producers) && docObj.producers.length > 0;

    return hasProducers;
  } catch {
    return false;
  }
}
