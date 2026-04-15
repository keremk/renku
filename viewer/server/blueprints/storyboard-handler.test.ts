import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatBlobFileName } from '@gorenku/core';
import { getStoryboardProjection } from './storyboard-handler.js';

describe('getStoryboardProjection', () => {
  let tempDir: string;
  let blueprintPath: string;
  let movieId: string;
  let movieDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-handler-'));
    blueprintPath = path.join(tempDir, 'storyboard-blueprint.yaml');
    movieId = 'movie-001';
    movieDir = path.join(tempDir, 'builds', movieId);

    await fs.mkdir(path.join(movieDir, 'manifests'), { recursive: true });
    await fs.mkdir(path.join(movieDir, 'events'), { recursive: true });

    await fs.writeFile(
      blueprintPath,
      [
        'meta:',
        '  id: StoryboardRouteFixture',
        '  name: Storyboard Route Fixture',
        '',
        'inputs:',
        '  - name: SharedStyleImage',
        '    type: image',
        '    required: true',
        '  - name: ScenePrompt',
        '    type: array',
        '    itemType: text',
        '    required: true',
        '  - name: NumOfSegments',
        '    type: int',
        '    required: true',
        '',
        'artifacts:',
        '  - name: StoryboardImage',
        '    type: array',
        '    itemType: image',
        '    countInput: NumOfSegments',
        '  - name: SceneVideo',
        '    type: array',
        '    itemType: video',
        '    countInput: NumOfSegments',
        '',
        'loops:',
        '  - name: scene',
        '    countInput: NumOfSegments',
        '',
        'producers:',
        '  - name: StoryboardProducer',
        '    producer: image/text-to-image',
        '    loop: scene',
        '  - name: VideoProducer',
        '    producer: video/image-to-video',
        '    loop: scene',
        '',
        'connections:',
        '  - from: SharedStyleImage',
        '    to: StoryboardProducer[scene].StyleImage',
        '  - from: ScenePrompt[scene]',
        '    to: StoryboardProducer[scene].Prompt',
        '  - from: StoryboardProducer[scene].GeneratedImage',
        '    to: StoryboardImage[scene]',
        '  - from: StoryboardImage[scene]',
        '    to: VideoProducer[scene].StartImage',
        '  - from: ScenePrompt[scene]',
        '    to: VideoProducer[scene].Prompt',
        '  - from: VideoProducer[scene].GeneratedVideo',
        '    to: SceneVideo[scene]',
        '',
      ].join('\n')
    );

    await fs.writeFile(
      path.join(tempDir, 'input-template.yaml'),
      [
        'inputs:',
        '  SharedStyleImage: "file:./input-files/style.png"',
        '  ScenePrompt:',
        '    - "Only template scene"',
        '  NumOfSegments: 1',
        '',
      ].join('\n')
    );

    await fs.writeFile(
      path.join(movieDir, 'inputs.yaml'),
      [
        'inputs:',
        '  SharedStyleImage: "file:./input-files/style.png"',
        '  ScenePrompt:',
        '    - "Scene one"',
        '    - "Scene two"',
        '  NumOfSegments: 2',
        '',
      ].join('\n')
    );

    await fs.writeFile(
      path.join(movieDir, 'current.json'),
      JSON.stringify({
        revision: 'rev-1',
        manifestPath: 'manifests/rev-1.json',
      })
    );

    await fs.writeFile(
      path.join(movieDir, 'manifests', 'rev-1.json'),
        JSON.stringify({
          inputs: {
            'Input:SharedStyleImage': { payloadDigest: '"file:./input-files/style.png"' },
            'Input:NumOfSegments': { payloadDigest: '1' },
          },
        artefacts: {
          'Artifact:SceneVideo[0]': {
            blob: { hash: 'video-hash', size: 10, mimeType: 'video/mp4' },
            status: 'succeeded',
            createdAt: '2026-04-09T12:00:00Z',
          },
        },
        createdAt: '2026-04-09T12:00:00Z',
      })
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('uses build inputs before falling back to the template', async () => {
    const projection = await getStoryboardProjection({
      blueprintPath,
      blueprintFolder: tempDir,
      movieId,
      catalogRoot: path.resolve(process.cwd(), '../catalog'),
    });

    expect(projection.meta.axisDimension).toBe('scene');
    expect(projection.meta.axisCount).toBe(2);
    expect(projection.meta.hasProducedStoryState).toBe(true);
    expect(projection.columns[1]?.title).toBe('Scene 2');
  });

  it('ignores stale persisted inputs that are not part of the current blueprint graph', async () => {
    await fs.writeFile(
      path.join(movieDir, 'inputs.yaml'),
      [
        'inputs:',
        '  SharedStyleImage: "file:./input-files/style.png"',
        '  ScenePrompt:',
        '    - "Scene one"',
        '    - "Scene two"',
        '  NumOfSegments: 2',
        '  AspectRatio: "9:16"',
        '  NarratorVoiceId: "voice-123"',
        '',
      ].join('\n')
    );

    const projection = await getStoryboardProjection({
      blueprintPath,
      blueprintFolder: tempDir,
      movieId,
      catalogRoot: path.resolve(process.cwd(), '../catalog'),
    });

    expect(projection.meta.axisDimension).toBe('scene');
    expect(projection.meta.axisCount).toBe(2);
    expect(projection.columns[1]?.title).toBe('Scene 2');
  });

  it('hydrates producer output schemas before resolving storyboard-marked prompt companions', async () => {
    const outputSchemaPath = path.join(tempDir, 'story-producer-output.json');
    const storyProducerPath = path.join(tempDir, 'story-producer.yaml');
    const videoProducerPath = path.join(tempDir, 'video-producer.yaml');
    const promptHash = '14966d97e726bb757903645ad8f44e5646c2445fce086775ff55ce3deff7ae26';
    const promptText =
      'Slow push-in through drifting fog as the clocktower wakes above the city skyline.';

    await fs.writeFile(
      outputSchemaPath,
      JSON.stringify({
        name: 'Storyboard',
        schema: {
          type: 'object',
          properties: {
            Scenes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  VideoPrompt: { type: 'string' },
                },
                required: ['VideoPrompt'],
              },
            },
          },
          required: ['Scenes'],
        },
      })
    );

    await fs.writeFile(
      storyProducerPath,
      [
        'meta:',
        '  id: StoryProducerImpl',
        '  kind: producer',
        '  name: Story Producer',
        '  outputSchema: ./story-producer-output.json',
        '',
        'inputs:',
        '  - name: NumOfScenes',
        '    type: int',
        '    required: true',
        '',
        'artifacts:',
        '  - name: Storyboard',
        '    type: json',
        '    arrays:',
        '      - path: Scenes',
        '        countInput: NumOfScenes',
        '',
      ].join('\n')
    );

    await fs.writeFile(
      videoProducerPath,
      [
        'meta:',
        '  id: VideoProducerImpl',
        '  kind: producer',
        '  name: Video Producer',
        '',
        'inputs:',
        '  - name: Prompt',
        '    type: string',
        '    required: true',
        '    storyboard: main',
        '',
        'artifacts:',
        '  - name: GeneratedVideo',
        '    type: video',
        '',
      ].join('\n')
    );

    await fs.writeFile(
      blueprintPath,
      [
        'meta:',
        '  id: StoryboardHydrationFixture',
        '  name: Storyboard Hydration Fixture',
        '',
        'inputs:',
        '  - name: NumOfSegments',
        '    type: int',
        '    required: true',
        '',
        'artifacts:',
        '  - name: SceneVideo',
        '    type: array',
        '    itemType: video',
        '    countInput: NumOfSegments',
        '',
        'loops:',
        '  - name: scene',
        '    countInput: NumOfSegments',
        '',
        'producers:',
        '  - name: StoryProducer',
        '    path: ./story-producer.yaml',
        '  - name: VideoProducer',
        '    path: ./video-producer.yaml',
        '    loop: scene',
        '',
        'connections:',
        '  - from: NumOfSegments',
        '    to: StoryProducer.NumOfScenes',
        '  - from: StoryProducer.Storyboard.Scenes[scene].VideoPrompt',
        '    to: VideoProducer[scene].Prompt',
        '  - from: VideoProducer[scene].GeneratedVideo',
        '    to: SceneVideo[scene]',
        '',
      ].join('\n')
    );

    await fs.writeFile(
      path.join(tempDir, 'input-template.yaml'),
      [
        'inputs:',
        '  NumOfSegments: 1',
        '',
      ].join('\n')
    );

    await fs.writeFile(
      path.join(movieDir, 'inputs.yaml'),
      [
        'inputs:',
        '  NumOfSegments: 1',
        '',
      ].join('\n')
    );

    const promptBlobDir = path.join(movieDir, 'blobs', promptHash.slice(0, 2));
    await fs.mkdir(promptBlobDir, { recursive: true });
    await fs.writeFile(
      path.join(promptBlobDir, formatBlobFileName(promptHash, 'text/plain')),
      promptText
    );

    await fs.writeFile(
      path.join(movieDir, 'manifests', 'rev-1.json'),
      JSON.stringify({
        inputs: {
          'Input:NumOfSegments': { payloadDigest: '1' },
        },
        artefacts: {
          'Artifact:StoryProducer.Storyboard.Scenes[0].VideoPrompt': {
            hash: promptHash,
            blob: {
              hash: promptHash,
              size: promptText.length,
              mimeType: 'text/plain',
            },
            producedBy: 'Producer:StoryProducer',
            status: 'succeeded',
            diagnostics: {
              kind: 'StoryProducer.Storyboard.Scenes.VideoPrompt',
              jsonPath: 'Scenes[0].VideoPrompt',
            },
            createdAt: '2026-04-09T12:00:00Z',
          },
          'Artifact:SceneVideo[0]': {
            hash: 'video-hash',
            blob: {
              hash: 'video-hash',
              size: 10,
              mimeType: 'video/mp4',
            },
            producedBy: 'Producer:VideoProducer[0]',
            status: 'succeeded',
            createdAt: '2026-04-09T12:00:00Z',
          },
        },
        createdAt: '2026-04-09T12:00:00Z',
      })
    );

    const projection = await getStoryboardProjection({
      blueprintPath,
      blueprintFolder: tempDir,
      movieId,
    });

    const textItems = projection.columns.flatMap((column) =>
      column.groups.flatMap((group) =>
        group.items.filter((item) => item.mediaType === 'text')
      )
    );

    expect(textItems).toHaveLength(1);
    expect(textItems[0]?.text?.value).toBe(promptText);
    expect(textItems[0]?.id).toBe(
      'Artifact:StoryProducer.Storyboard.Scenes[0].VideoPrompt'
    );
  });
});
