import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseBlueprintDocument } from '../lib/blueprint-loader/index.js';
import { getBundledBlueprintsRoot } from '../lib/config-assets.js';

const DEFAULT_BLUEPRINT_DIR = getBundledBlueprintsRoot();

export interface BlueprintsListResult {
  blueprints: Array<{
    path: string;
    name: string;
    description?: string;
    version?: string;
    inputCount: number;
    outputCount: number;
  }>;
}

export async function runBlueprintsList(
  directory: string = DEFAULT_BLUEPRINT_DIR,
): Promise<BlueprintsListResult> {
  const entries = await collectBlueprintFiles(directory);
  const blueprints: BlueprintsListResult['blueprints'] = [];

  for (const fullPath of entries) {
    const blueprint = await parseBlueprintDocument(fullPath);
    blueprints.push({
      path: fullPath,
      name: blueprint.meta.name,
      description: blueprint.meta.description,
      version: blueprint.meta.version,
      inputCount: blueprint.inputs.length,
      outputCount: blueprint.artefacts.length,
    });
  }

  return { blueprints };
}

async function collectBlueprintFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isFile()) {
      if (!entry.name.endsWith('.yaml') || entry.name === 'input-template.yaml') {
        continue;
      }
      files.push(resolve(root, entry.name));
      continue;
    }
    if (entry.isDirectory()) {
      const nestedRoot = resolve(root, entry.name);
      files.push(...(await collectBlueprintFiles(nestedRoot)));
    }
  }
  return files;
}
