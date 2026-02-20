/**
 * Integration test that validates all blueprints in the catalog.
 * This ensures the validation module correctly handles real-world blueprints.
 */
import { describe, it, expect } from 'vitest';
import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadYamlBlueprintTree } from '../parsing/blueprint-loader/yaml-parser.js';
import { validateBlueprintTree } from './blueprint-validator.js';

const REPO_CATALOG_ROOT = resolve(import.meta.dirname, '../../../catalog');
const REPO_CATALOG_BLUEPRINTS_ROOT = resolve(REPO_CATALOG_ROOT, 'blueprints');

async function findBlueprintFiles(): Promise<{ name: string; path: string }[]> {
  const blueprints: { name: string; path: string }[] = [];
  const entries = await readdir(REPO_CATALOG_BLUEPRINTS_ROOT);

  for (const entry of entries) {
    const dirPath = resolve(REPO_CATALOG_BLUEPRINTS_ROOT, entry);
    const dirStat = await stat(dirPath);

    if (!dirStat.isDirectory()) {
      continue;
    }

    // Find the main blueprint YAML file (not input-template.yaml)
    const files = await readdir(dirPath);
    const blueprintFile = files.find(
      (f) => f.endsWith('.yaml') && f !== 'input-template.yaml'
    );

    if (blueprintFile) {
      blueprints.push({
        name: entry,
        path: resolve(dirPath, blueprintFile),
      });
    }
  }

  return blueprints;
}

describe('catalog blueprint validation', () => {
  it('validates all catalog blueprints', async () => {
    const blueprints = await findBlueprintFiles();
    expect(blueprints.length).toBeGreaterThan(0);
    const failures: { name: string; errors: string[] }[] = [];

    for (const { name, path } of blueprints) {
      try {
        const { root } = await loadYamlBlueprintTree(path, {
          catalogRoot: REPO_CATALOG_ROOT,
        });
        const result = validateBlueprintTree(root);

        if (!result.valid) {
          failures.push({
            name,
            errors: result.errors.map((e) => `${e.code}: ${e.message}`),
          });
        }
      } catch (error) {
        failures.push({
          name,
          errors: [
            `Load error: ${error instanceof Error ? error.message : String(error)}`,
          ],
        });
      }
    }

    if (failures.length > 0) {
      const report = failures
        .map((f) => `${f.name}:\n  ${f.errors.join('\n  ')}`)
        .join('\n\n');
      expect.fail(
        `${failures.length} blueprint(s) failed validation:\n\n${report}`
      );
    }
  });

  it('finds blueprint manifests for each catalog blueprint directory', async () => {
    const blueprints = await findBlueprintFiles();
    expect(blueprints.length).toBeGreaterThan(0);
    for (const blueprint of blueprints) {
      expect(blueprint.name.length).toBeGreaterThan(0);
      expect(blueprint.path.endsWith('.yaml')).toBe(true);
      expect(blueprint.path.endsWith('input-template.yaml')).toBe(false);
    }
  });
});
