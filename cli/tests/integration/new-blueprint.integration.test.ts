import { access, readdir, readFile, rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runNewBlueprint } from '../../src/commands/new-blueprint.js';
import { CATALOG_ROOT } from '../test-catalog-paths.js';
import { isRenkuError, RuntimeErrorCode } from '@gorenku/core';

describe('new:blueprint command', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'renku-new-blueprint-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('scaffold mode (without --using)', () => {
    it('creates blueprint folder with correct files', async () => {
      const result = await runNewBlueprint({
        name: 'history-video',
        outputDir: tempDir,
      });

      // Check folder was created
      expect(result.folderPath).toBe(join(tempDir, 'history-video'));
      expect(result.copiedFromCatalog).toBe(false);
      await expect(access(result.folderPath)).resolves.toBeUndefined();

      // Check files exist
      const files = await readdir(result.folderPath);
      expect(files).toContain('history-video.yaml');
      expect(files).toContain('input-template.yaml');
    });

    it('generates blueprint YAML with correct structure', async () => {
      const result = await runNewBlueprint({
        name: 'history-video',
        outputDir: tempDir,
      });

      const blueprintContent = await readFile(result.blueprintPath, 'utf8');

      // Check meta section
      expect(blueprintContent).toContain('meta:');
      expect(blueprintContent).toContain('name: history-video');
      expect(blueprintContent).toContain('id: HistoryVideo');
      expect(blueprintContent).toContain('version: 0.1.0');

      // Check main sections exist
      expect(blueprintContent).toContain('inputs:');
      expect(blueprintContent).toContain('artifacts:');
      expect(blueprintContent).toContain('loops:');
      expect(blueprintContent).toContain('producers:');
      expect(blueprintContent).toContain('connections:');
      expect(blueprintContent).toContain('collectors:');
    });

    it('generates input-template YAML with correct structure', async () => {
      const result = await runNewBlueprint({
        name: 'history-video',
        outputDir: tempDir,
      });

      const inputTemplateContent = await readFile(result.inputTemplatePath, 'utf8');

      // Check sections exist
      expect(inputTemplateContent).toContain('inputs:');
      expect(inputTemplateContent).toContain('models:');
    });

    it('converts kebab-case name to PascalCase id', async () => {
      const result = await runNewBlueprint({
        name: 'my-awesome-blueprint',
        outputDir: tempDir,
      });

      const blueprintContent = await readFile(result.blueprintPath, 'utf8');
      expect(blueprintContent).toContain('id: MyAwesomeBlueprint');
    });

    it('throws error for empty name', async () => {
      await expect(
        runNewBlueprint({
          name: '',
          outputDir: tempDir,
        }),
      ).rejects.toThrow('Blueprint name is required');
    });

    it('throws error for invalid name format', async () => {
      await expect(
        runNewBlueprint({
          name: 'InvalidName',
          outputDir: tempDir,
        }),
      ).rejects.toThrow('Blueprint name must be in kebab-case');

      await expect(
        runNewBlueprint({
          name: '123-invalid',
          outputDir: tempDir,
        }),
      ).rejects.toThrow('Blueprint name must be in kebab-case');
    });

    it('throws error if folder already exists', async () => {
      // Create the folder first
      await runNewBlueprint({
        name: 'existing-blueprint',
        outputDir: tempDir,
      });

      // Try to create again
      await expect(
        runNewBlueprint({
          name: 'existing-blueprint',
          outputDir: tempDir,
        }),
      ).rejects.toThrow('already exists');
    });

    it('handles single-word names correctly', async () => {
      const result = await runNewBlueprint({
        name: 'simple',
        outputDir: tempDir,
      });

      const blueprintContent = await readFile(result.blueprintPath, 'utf8');
      expect(blueprintContent).toContain('name: simple');
      expect(blueprintContent).toContain('id: Simple');
    });
  });

  describe('--using flag (copy from catalog)', () => {
    it('copies blueprint from catalog with all files and renames blueprint YAML', async () => {
      const result = await runNewBlueprint({
        name: 'my-ken-burns',
        outputDir: tempDir,
        using: 'ken-burns',
        catalogRoot: CATALOG_ROOT,
      });

      expect(result.copiedFromCatalog).toBe(true);
      expect(result.folderPath).toBe(join(tempDir, 'my-ken-burns'));

      // Check folder was created
      await expect(access(result.folderPath)).resolves.toBeUndefined();

      // Check files exist (ken-burns has subdirectories)
      const files = await readdir(result.folderPath);
      expect(files).toContain('input-template.yaml');

      // Blueprint YAML should be renamed to match the new name
      expect(files).toContain('my-ken-burns.yaml');
      expect(result.blueprintPath).toBe(join(tempDir, 'my-ken-burns', 'my-ken-burns.yaml'));

      // Original file should not exist
      expect(files).not.toContain('image-audio.yaml');
    });

    it('copies subdirectories from catalog blueprint', async () => {
      const result = await runNewBlueprint({
        name: 'my-ken-burns',
        outputDir: tempDir,
        using: 'ken-burns',
        catalogRoot: CATALOG_ROOT,
      });

      const files = await readdir(result.folderPath);
      // ken-burns has subdirectories like 'script' and 'image'
      expect(files).toContain('script');
      expect(files).toContain('image');
    });

    it('throws error when blueprint not found in catalog', async () => {
      try {
        await runNewBlueprint({
          name: 'my-blueprint',
          outputDir: tempDir,
          using: 'non-existent-blueprint',
          catalogRoot: CATALOG_ROOT,
        });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(isRenkuError(error)).toBe(true);
        if (isRenkuError(error)) {
          expect(error.code).toBe(RuntimeErrorCode.CATALOG_BLUEPRINT_NOT_FOUND);
          expect(error.message).toContain('non-existent-blueprint');
          expect(error.suggestion).toContain('Available blueprints');
        }
      }
    });

    it('throws error when using flag provided without catalog root', async () => {
      await expect(
        runNewBlueprint({
          name: 'my-blueprint',
          outputDir: tempDir,
          using: 'ken-burns',
          // catalogRoot not provided
        }),
      ).rejects.toThrow('Catalog root is required');
    });
  });
});
