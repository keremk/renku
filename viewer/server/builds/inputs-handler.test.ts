/**
 * Tests for build inputs handler.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getBuildInputs, saveBuildInputs } from './inputs-handler.js';
import { parseInputsForDisplay } from '@gorenku/core';

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

  it('preserves existing model config when incoming payload omits it for the same producer/model', async () => {
    await fs.writeFile(
      inputsPath,
      [
        'inputs:',
        '  Theme: "Original"',
        'models:',
        '  - producerId: "DirectorProducer"',
        '    provider: "openai"',
        '    model: "gpt-5-mini"',
        '    config:',
        '      text_format: "json_schema"',
        '',
      ].join('\n'),
      'utf8'
    );

    await saveBuildInputs(blueprintFolder, movieId, { Theme: 'Updated' }, [
      {
        producerId: 'DirectorProducer',
        provider: 'openai',
        model: 'gpt-5-mini',
      },
    ]);

    const parsed = await parseInputsForDisplay(inputsPath);
    expect(parsed.models).toHaveLength(1);
    expect(parsed.models[0]).toMatchObject({
      producerId: 'DirectorProducer',
      provider: 'openai',
      model: 'gpt-5-mini',
      config: {
        text_format: 'json_schema',
      },
    });
  });

  it('replaces existing model config when incoming payload omits nested keys', async () => {
    await fs.writeFile(
      inputsPath,
      [
        'inputs:',
        '  Theme: "Original"',
        'models:',
        '  - producerId: "TimelineComposer"',
        '    provider: "renku"',
        '    model: "timeline/ordered"',
        '    config:',
        '      timeline:',
        '        tracks:',
        '          - "Video"',
        '          - "Music"',
        '        musicClip:',
        '          artifact: "Music"',
        '          volume: 0.4',
        '',
      ].join('\n'),
      'utf8'
    );

    await saveBuildInputs(
      blueprintFolder,
      movieId,
      { Theme: 'Updated' },
      [
        {
          producerId: 'TimelineComposer',
          provider: 'renku',
          model: 'timeline/ordered',
          config: {
            timeline: {
              musicClip: {
                volume: 0.8,
              },
            },
          },
        },
      ]
    );

    const parsed = await parseInputsForDisplay(inputsPath);
    const timeline = parsed.models.find(
      (model) => model.producerId === 'TimelineComposer'
    );
    expect(timeline?.config).toEqual({
      timeline: {
        musicClip: {
          volume: 0.8,
        },
      },
    });
  });

  it('removes existing model config when serialized PUT payload provides empty config object', async () => {
    await fs.writeFile(
      inputsPath,
      [
        'inputs:',
        '  Theme: "Original"',
        'models:',
        '  - producerId: "DirectorProducer"',
        '    provider: "openai"',
        '    model: "gpt-5-mini"',
        '    config:',
        '      text_format: "json_schema"',
        '',
      ].join('\n'),
      'utf8'
    );

    const putPayload = JSON.parse(
      JSON.stringify({
        blueprintFolder,
        blueprintPath: '/tmp/blueprint.yaml',
        movieId,
        inputs: { Theme: 'Updated' },
        models: [
          {
            producerId: 'DirectorProducer',
            provider: 'openai',
            model: 'gpt-5-mini',
            config: {},
          },
        ],
      })
    ) as {
      blueprintFolder: string;
      movieId: string;
      inputs: Record<string, unknown>;
      models: Array<{
        producerId: string;
        provider: string;
        model: string;
        config?: Record<string, unknown>;
      }>;
    };

    await saveBuildInputs(
      putPayload.blueprintFolder,
      putPayload.movieId,
      putPayload.inputs,
      putPayload.models
    );

    const parsed = await parseInputsForDisplay(inputsPath);
    expect(parsed.models).toHaveLength(1);
    expect(parsed.models[0]).toMatchObject({
      producerId: 'DirectorProducer',
      provider: 'openai',
      model: 'gpt-5-mini',
    });
    expect(parsed.models[0]?.config).toBeUndefined();
  });

  it('preserves existing producers when incoming model payload omits them', async () => {
    await fs.writeFile(
      inputsPath,
      [
        'inputs:',
        '  Theme: "Original"',
        'models:',
        '  - producerId: "DirectorProducer"',
        '    provider: "openai"',
        '    model: "gpt-5-mini"',
        '    config:',
        '      text_format: "json_schema"',
        '  - producerId: "ThenImageProducer"',
        '    provider: "fal-ai"',
        '    model: "xai/grok-imagine-image/edit"',
        '    config:',
        '      enable_safety_checker: false',
        '',
      ].join('\n'),
      'utf8'
    );

    await saveBuildInputs(blueprintFolder, movieId, { Theme: 'Updated' }, [
      {
        producerId: 'DirectorProducer',
        provider: 'openai',
        model: 'gpt-5-mini',
      },
    ]);

    const parsed = await parseInputsForDisplay(inputsPath);
    expect(parsed.models).toHaveLength(2);
    expect(
      parsed.models.find((model) => model.producerId === 'ThenImageProducer')
    ).toMatchObject({
      producerId: 'ThenImageProducer',
      provider: 'fal-ai',
      model: 'xai/grok-imagine-image/edit',
      config: {
        enable_safety_checker: false,
      },
    });
  });

  it('preserves existing input keys when incoming payload only updates a subset', async () => {
    await fs.writeFile(
      inputsPath,
      [
        'inputs:',
        '  Theme: "Original"',
        '  CelebrityThenImages:',
        '    - "file:./input-files/then-1.jpg"',
        '    - "file:./input-files/then-2.jpg"',
        'models:',
        '  - producerId: "DirectorProducer"',
        '    provider: "openai"',
        '    model: "gpt-5-mini"',
        '',
      ].join('\n'),
      'utf8'
    );

    await saveBuildInputs(blueprintFolder, movieId, { Theme: 'Updated' }, [
      {
        producerId: 'DirectorProducer',
        provider: 'openai',
        model: 'gpt-5-mini',
      },
    ]);

    const parsed = await parseInputsForDisplay(inputsPath);
    expect(parsed.inputs.Theme).toBe('Updated');
    expect(parsed.inputs.CelebrityThenImages).toEqual([
      'file:./input-files/then-1.jpg',
      'file:./input-files/then-2.jpg',
    ]);
  });

  it('throws when incoming models payload contains duplicate producer IDs', async () => {
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
      saveBuildInputs(blueprintFolder, movieId, { Theme: 'Updated' }, [
        {
          producerId: 'DirectorProducer',
          provider: 'openai',
          model: 'gpt-5-mini',
        },
        {
          producerId: 'DirectorProducer',
          provider: 'openai',
          model: 'gpt-5.2',
        },
      ])
    ).rejects.toThrow(/duplicate producer "DirectorProducer"/);
  });
});
