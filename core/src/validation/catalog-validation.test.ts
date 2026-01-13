/**
 * Integration test that validates all blueprints in the catalog.
 * This ensures the validation module correctly handles real-world blueprints.
 */
import { describe, it, expect } from 'vitest';
import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  CATALOG_BLUEPRINTS_ROOT,
  CATALOG_ROOT,
} from '../testing/catalog-paths.js';
import { loadYamlBlueprintTree } from '../parsing/blueprint-loader/yaml-parser.js';
import { validateBlueprintTree } from './blueprint-validator.js';

async function findBlueprintFiles(): Promise<{ name: string; path: string }[]> {
  const blueprints: { name: string; path: string }[] = [];
  const entries = await readdir(CATALOG_BLUEPRINTS_ROOT);

  for (const entry of entries) {
    const dirPath = resolve(CATALOG_BLUEPRINTS_ROOT, entry);
    const dirStat = await stat(dirPath);

    if (!dirStat.isDirectory()) {
      continue;
    }

    // Find the main blueprint YAML file (not input-template.yaml)
    const files = await readdir(dirPath);
    const blueprintFile = files.find(
      (f) => f.endsWith('.yaml') && f !== 'input-template.yaml',
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
    const failures: { name: string; errors: string[] }[] = [];

    for (const { name, path } of blueprints) {
      try {
        const { root } = await loadYamlBlueprintTree(path, {
          catalogRoot: CATALOG_ROOT,
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
      expect.fail(`${failures.length} blueprint(s) failed validation:\n\n${report}`);
    }
  });

  it('finds expected blueprints in catalog', async () => {
    const blueprints = await findBlueprintFiles();
    const names = blueprints.map((b) => b.name);

    // Verify we're finding the expected blueprints
    expect(names).toContain('children-story');
    expect(names).toContain('documentary-talking-head');
    expect(blueprints.length).toBeGreaterThanOrEqual(5);
  });

  // Individual test for each blueprint to see detailed results
  describe('individual blueprints', () => {
    it.each([
      'ad-video',
      'children-story',
      'documentary-talking-head',
      'image-to-video',
      'kenn-burns',
    ])('%s blueprint is valid', async (blueprintName) => {
      const dirPath = resolve(CATALOG_BLUEPRINTS_ROOT, blueprintName);
      const files = await readdir(dirPath);
      const blueprintFile = files.find(
        (f) => f.endsWith('.yaml') && f !== 'input-template.yaml',
      );

      expect(blueprintFile).toBeDefined();

      const blueprintPath = resolve(dirPath, blueprintFile!);
      const { root } = await loadYamlBlueprintTree(blueprintPath, {
        catalogRoot: CATALOG_ROOT,
      });
      const result = validateBlueprintTree(root);

      if (!result.valid) {
        const errorDetails = result.errors
          .map((e) => `  ${e.code}: ${e.message}`)
          .join('\n');
        expect.fail(`Validation failed:\n${errorDetails}`);
      }

      expect(result.valid).toBe(true);
    });
  });
});
