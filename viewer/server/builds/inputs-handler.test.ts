/**
 * Tests for build inputs handler.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getBuildInputs, saveBuildInputs } from './inputs-handler.js';

describe('inputs-handler', () => {
  let tempDir: string;
  let blueprintFolder: string;
  let movieId: string;
  let buildDir: string;
  let inputsPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inputs-handler-test-'));
    blueprintFolder = tempDir;
    movieId = 'movie-test123';
    buildDir = path.join(blueprintFolder, 'builds', movieId);
    inputsPath = path.join(buildDir, 'inputs.yaml');
    await fs.mkdir(buildDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('throws when build inputs.yaml cannot be parsed', async () => {
    await fs.writeFile(inputsPath, 'inputs: [', 'utf8');

    await expect(
      getBuildInputs(blueprintFolder, movieId, '/tmp/blueprint.yaml')
    ).rejects.toThrow(/Failed to parse build inputs/);
  });

  it('refuses overwriting existing model selections with empty models', async () => {
    await fs.writeFile(
      inputsPath,
      [
        'inputs:',
        '  Theme: "Original"',
        'models:',
        '  - producerId: "DirectorProducer"',
        '    provider: "openai"',
        '    model: "gpt-5-mini"',
        '',
      ].join('\n'),
      'utf8'
    );

    await expect(
      saveBuildInputs(blueprintFolder, movieId, { Theme: 'Template' }, [])
    ).rejects.toThrow(/Refusing to overwrite/);

    const current = await fs.readFile(inputsPath, 'utf8');
    expect(current).toContain('models:');
    expect(current).toContain('gpt-5-mini');
  });

  it('allows saving when payload includes model selections', async () => {
    await saveBuildInputs(blueprintFolder, movieId, { Theme: 'Updated' }, [
      {
        producerId: 'DirectorProducer',
        provider: 'openai',
        model: 'gpt-5-mini',
      },
    ]);

    const content = await fs.readFile(inputsPath, 'utf8');
    expect(content).toContain('Theme: "Updated"');
    expect(content).toContain('models:');
    expect(content).toContain('producerId: "DirectorProducer"');
  });
});
