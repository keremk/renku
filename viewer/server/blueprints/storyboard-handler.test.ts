import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
        '  - name: NumOfScenes',
        '    type: int',
        '    required: true',
        '',
        'artifacts:',
        '  - name: StoryboardImage',
        '    type: array',
        '    itemType: image',
        '    countInput: NumOfScenes',
        '  - name: SceneVideo',
        '    type: array',
        '    itemType: video',
        '    countInput: NumOfScenes',
        '',
        'loops:',
        '  - name: scene',
        '    countInput: NumOfScenes',
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
        '  NumOfScenes: 1',
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
        '  NumOfScenes: 2',
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
          'Input:NumOfScenes': { payloadDigest: '1' },
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
});
