/**
 * Tests for build inputs handler.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { getBuildInputs, saveBuildInputs } from './inputs-handler.js';
import { parseInputsForDisplay } from '@gorenku/core';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '../../..');
const VIEWER_FIXTURES_ROOT = path.join(TEST_DIR, '../fixtures/blueprints');

describe('inputs-handler', () => {
  let tempDir: string;
  let blueprintFolder: string;
  let blueprintPath: string;
  let catalogRoot: string;
  let movieId: string;
  let buildDir: string;
  let inputsPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inputs-handler-test-'));
    blueprintFolder = tempDir;
    catalogRoot = path.join(REPO_ROOT, 'catalog');
    blueprintPath = path.join(
      catalogRoot,
      'blueprints',
      'celebrity-then-now',
      'celebrity-then-now.yaml'
    );
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
      getBuildInputs(blueprintFolder, movieId, blueprintPath, catalogRoot)
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
      saveBuildInputs(
        blueprintFolder,
        blueprintPath,
        movieId,
        { Theme: 'Template' },
        [],
        catalogRoot
      )
    ).rejects.toThrow(/Refusing to overwrite/);

    const current = await fs.readFile(inputsPath, 'utf8');
    expect(current).toContain('models:');
    expect(current).toContain('gpt-5-mini');
  });

  it('allows saving when payload includes model selections', async () => {
    await saveBuildInputs(
      blueprintFolder,
      blueprintPath,
      movieId,
      { Theme: 'Updated' },
      [
        {
          producerId: 'Producer:DirectorProducer',
          provider: 'openai',
          model: 'gpt-5-mini',
        },
      ],
      catalogRoot
    );

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

    await saveBuildInputs(
      blueprintFolder,
      blueprintPath,
      movieId,
      { Theme: 'Updated' },
      [
        {
          producerId: 'Producer:DirectorProducer',
          provider: 'openai',
          model: 'gpt-5-mini',
        },
      ],
      catalogRoot
    );

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
      blueprintPath,
      movieId,
      { Theme: 'Updated' },
      [
        {
          producerId: 'Producer:TimelineComposer',
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
      ],
      catalogRoot
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
        blueprintPath,
        movieId,
        inputs: { Theme: 'Updated' },
        models: [
          {
            producerId: 'Producer:DirectorProducer',
            provider: 'openai',
            model: 'gpt-5-mini',
            config: {},
          },
        ],
      })
    ) as {
      blueprintFolder: string;
      blueprintPath: string;
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
      putPayload.blueprintPath,
      putPayload.movieId,
      putPayload.inputs,
      putPayload.models,
      catalogRoot
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

    await saveBuildInputs(
      blueprintFolder,
      blueprintPath,
      movieId,
      { Theme: 'Updated' },
      [
        {
          producerId: 'Producer:DirectorProducer',
          provider: 'openai',
          model: 'gpt-5-mini',
        },
      ],
      catalogRoot
    );

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

    await saveBuildInputs(
      blueprintFolder,
      blueprintPath,
      movieId,
      { Theme: 'Updated' },
      [
        {
          producerId: 'Producer:DirectorProducer',
          provider: 'openai',
          model: 'gpt-5-mini',
        },
      ],
      catalogRoot
    );

    const parsed = await parseInputsForDisplay(inputsPath);
    expect(parsed.inputs.Theme).toBe('Updated');
    expect(parsed.inputs.CelebrityThenImages).toEqual([
      'file:./input-files/then-1.jpg',
      'file:./input-files/then-2.jpg',
    ]);
  });

  it('normalizes legacy nested model entries from inputs yaml into the parent TranscriptionProducer config', async () => {
    const transcriptionBlueprintPath = path.join(
      VIEWER_FIXTURES_ROOT,
      'build-inputs-nested-model-normalization',
      'build-inputs-nested-model-normalization.yaml'
    );

    await fs.writeFile(
      inputsPath,
      [
        'inputs:',
        '  InquiryPrompt: "Tell the story of Ada Lovelace."',
        '  Duration: 30',
        'models:',
        '  - producerId: "TranscriptionProducer"',
        '    provider: "renku"',
        '    model: "speech/transcription"',
        '    config:',
        '      stt:',
        '        confidenceThreshold: 0.5',
        '  - producerId: "TranscriptionProducer.stt"',
        '    provider: "fal-ai"',
        '    model: "elevenlabs/speech-to-text"',
        '    config:',
        '      language: "en"',
        '',
      ].join('\n'),
      'utf8'
    );

    const result = await getBuildInputs(
      blueprintFolder,
      movieId,
      transcriptionBlueprintPath
    );

    expect(result.models).toHaveLength(1);
    expect(result.models[0]).toEqual({
      producerId: 'Producer:TranscriptionProducer',
      provider: 'renku',
      model: 'speech/transcription',
      config: {
        stt: {
          confidenceThreshold: 0.5,
          provider: 'fal-ai',
          model: 'elevenlabs/speech-to-text',
          language: 'en',
        },
      },
    });
  });

  it('rewrites legacy nested model entries in inputs yaml into the parent TranscriptionProducer config on save', async () => {
    const transcriptionBlueprintPath = path.join(
      VIEWER_FIXTURES_ROOT,
      'build-inputs-nested-model-normalization',
      'build-inputs-nested-model-normalization.yaml'
    );

    await fs.writeFile(
      inputsPath,
      [
        'inputs:',
        '  InquiryPrompt: "Tell the story of Ada Lovelace."',
        '  Duration: 30',
        'models:',
        '  - producerId: "TranscriptionProducer"',
        '    provider: "renku"',
        '    model: "speech/transcription"',
        '    config:',
        '      stt:',
        '        confidenceThreshold: 0.5',
        '  - producerId: "TranscriptionProducer.stt"',
        '    provider: "fal-ai"',
        '    model: "elevenlabs/speech-to-text"',
        '    config:',
        '      language: "en"',
        '',
      ].join('\n'),
      'utf8'
    );

    await saveBuildInputs(
      blueprintFolder,
      transcriptionBlueprintPath,
      movieId,
      {
        InquiryPrompt: 'Tell the story of Ada Lovelace.',
        Duration: 45,
      },
      [
        {
          producerId: 'Producer:TranscriptionProducer',
          provider: 'renku',
          model: 'speech/transcription',
          config: {
            stt: {
              confidenceThreshold: 0.8,
              provider: 'fal-ai',
              model: 'elevenlabs/speech-to-text',
              language: 'en',
            },
          },
        },
      ],
      undefined
    );

    const parsed = await parseInputsForDisplay(inputsPath);
    expect(parsed.models).toHaveLength(1);
    expect(parsed.models[0]).toEqual({
      producerId: 'TranscriptionProducer',
      provider: 'renku',
      model: 'speech/transcription',
      config: {
        stt: {
          confidenceThreshold: 0.8,
          provider: 'fal-ai',
          model: 'elevenlabs/speech-to-text',
          language: 'en',
        },
      },
    });

    const content = await fs.readFile(inputsPath, 'utf8');
    expect(content).not.toContain('TranscriptionProducer.stt');
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
      saveBuildInputs(
        blueprintFolder,
        blueprintPath,
        movieId,
        { Theme: 'Updated' },
        [
          {
            producerId: 'Producer:DirectorProducer',
            provider: 'openai',
            model: 'gpt-5-mini',
          },
          {
            producerId: 'Producer:DirectorProducer',
            provider: 'openai',
            model: 'gpt-5.2',
          },
        ],
        catalogRoot
      )
    ).rejects.toThrow(/duplicate producer "Producer:DirectorProducer"/);
  });
});
