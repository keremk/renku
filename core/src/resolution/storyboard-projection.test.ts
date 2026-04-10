import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BlueprintTreeNode } from '../types.js';
import { loadYamlBlueprintTree } from '../index.js';
import { buildStoryboardProjection } from './storyboard-projection.js';

function makeTreeNode(document: Record<string, unknown>): BlueprintTreeNode {
  return {
    id: String((document.meta as { id: string }).id),
    namespacePath: [],
    document,
    children: new Map(),
    sourcePath: '/tmp/storyboard-blueprint.yaml',
  } as unknown as BlueprintTreeNode;
}

describe('buildStoryboardProjection', () => {
  it('derives a scene storyboard with prompt inputs and real media outputs', () => {
    const root = makeTreeNode({
      meta: { id: 'StoryboardFixture', name: 'Storyboard Fixture' },
      inputs: [
        { name: 'SharedStyleImage', type: 'image', required: true },
        { name: 'ScenePrompt', type: 'array', itemType: 'text', required: true },
        { name: 'NumOfScenes', type: 'int', required: true },
      ],
      producers: [
        {
          name: 'StoryboardProducer',
          producer: 'image/text-to-image',
          loop: 'scene',
        },
        {
          name: 'VideoProducer',
          producer: 'video/image-to-video',
          loop: 'scene',
        },
      ],
      artefacts: [
        { name: 'StoryboardImage', type: 'array', itemType: 'image', countInput: 'NumOfScenes' },
        { name: 'SceneVideo', type: 'array', itemType: 'video', countInput: 'NumOfScenes' },
        { name: 'Timeline', type: 'json' },
      ],
      loops: [{ name: 'scene', countInput: 'NumOfScenes' }],
      edges: [
        { from: 'SharedStyleImage', to: 'StoryboardProducer[scene].StyleImage' },
        { from: 'ScenePrompt[scene]', to: 'StoryboardProducer[scene].Prompt' },
        { from: 'StoryboardProducer[scene].GeneratedImage', to: 'StoryboardImage[scene]' },
        { from: 'StoryboardImage[scene]', to: 'VideoProducer[scene].StartImage' },
        { from: 'ScenePrompt[scene]', to: 'VideoProducer[scene].Prompt' },
        { from: 'VideoProducer[scene].GeneratedVideo', to: 'SceneVideo[scene]' },
      ],
    });

    const projection = buildStoryboardProjection({
      root,
      effectiveInputs: {
        SharedStyleImage: 'file:./input-files/style.png',
        ScenePrompt: ['Opening shot', 'Closing shot'],
        NumOfScenes: 2,
      },
      artifactStates: {
        'Artifact:StoryboardImage[0]': {
          canonicalArtifactId: 'Artifact:StoryboardImage[0]',
          status: 'succeeded',
          hash: 'image-0-hash',
          mimeType: 'image/png',
        },
        'Artifact:SceneVideo[0]': {
          canonicalArtifactId: 'Artifact:SceneVideo[0]',
          status: 'succeeded',
          hash: 'video-0-hash',
          mimeType: 'video/mp4',
        },
      },
    });

    expect(projection.meta.axisDimension).toBe('scene');
    expect(projection.meta.axisCount).toBe(2);
    expect(projection.meta.hasProducedStoryState).toBe(true);
    expect(projection.sharedSection.items).toHaveLength(0);
    expect(projection.columns[0]?.title).toBe('Scene 1');
    expect(projection.columns[1]?.title).toBe('Scene 2');
    expect(
      projection.columns[0]?.groups
        .flatMap((group) => group.items)
        .map((item) => item.label)
    ).toEqual(['Scene Video 1', 'Storyboard Image 1']);
    expect(
      projection.columns[1]?.groups
        .flatMap((group) => group.items)
        .some(
          (item) =>
            item.id === 'Artifact:SceneVideo[1]' &&
            item.state === 'pending'
        )
    ).toBe(true);
  });

  it('projects continuity-style columns without rendering the shared seed input column', () => {
    const root = makeTreeNode({
      meta: { id: 'CarryOverFixture', name: 'Carry Over Fixture' },
      inputs: [
        { name: 'InitialImage', type: 'image', required: true },
        { name: 'ScenePrompt', type: 'array', itemType: 'text', required: true },
        { name: 'NumOfScenes', type: 'int', required: true },
      ],
      producers: [
        {
          name: 'ImageProducer',
          producer: 'image/image-compose',
          loop: 'scene',
        },
      ],
      artefacts: [
        { name: 'SceneImage', type: 'array', itemType: 'image', countInput: 'NumOfScenes' },
      ],
      loops: [{ name: 'scene', countInput: 'NumOfScenes' }],
      edges: [
        { from: 'SceneImage[scene-1]', to: 'ImageProducer[scene].StartImage' },
        { from: 'ScenePrompt[scene]', to: 'ImageProducer[scene].Prompt' },
        { from: 'ImageProducer[scene].GeneratedImage', to: 'SceneImage[scene]' },
      ],
    });

    const projection = buildStoryboardProjection({
      root,
      effectiveInputs: {
        InitialImage: 'file:./input-files/start.png',
        ScenePrompt: ['Frame one', 'Frame two'],
        NumOfScenes: 2,
      },
      artifactStates: {
        'Artifact:SceneImage[0]': {
          canonicalArtifactId: 'Artifact:SceneImage[0]',
          status: 'succeeded',
          hash: 'scene-0',
          mimeType: 'image/png',
        },
      },
    });

    const secondColumnItems =
      projection.columns[1]?.groups.flatMap((group) => group.items) ?? [];
    const pendingSecondSceneImage = secondColumnItems.find(
      (item) => item.id === 'Artifact:SceneImage[1]'
    );

    expect(projection.sharedSection.items).toHaveLength(0);
    expect(pendingSecondSceneImage?.state).toBe('pending');
  });

  it('prefers the NumOfSegments-driven segment axis when multiple axes are present', () => {
    const root = makeTreeNode({
      meta: { id: 'AxisFixture', name: 'Axis Fixture' },
      inputs: [
        { name: 'NumOfSegments', type: 'int', required: true },
        { name: 'NumOfImages', type: 'int', required: true },
        { name: 'ScenePrompt', type: 'array', itemType: 'text', required: true },
      ],
      producers: [
        {
          name: 'ImageProducer',
          producer: 'image/text-to-image',
          loop: 'segment',
        },
      ],
      artefacts: [
        { name: 'GeneratedImage', type: 'array', itemType: 'image', countInput: 'NumOfSegments' },
        {
          name: 'ReferencePanel',
          type: 'multidimArray',
          itemType: 'image',
          dimensions: ['segment', 'image'],
        },
      ],
      loops: [
        { name: 'segment', countInput: 'NumOfSegments' },
        { name: 'image', countInput: 'NumOfImages' },
      ],
      edges: [
        { from: 'ScenePrompt[segment]', to: 'ImageProducer[segment].Prompt' },
        { from: 'ImageProducer[segment].GeneratedImage', to: 'GeneratedImage[segment]' },
      ],
    });

    const projection = buildStoryboardProjection({
      root,
      effectiveInputs: {
        NumOfSegments: 3,
        NumOfImages: 2,
        ScenePrompt: ['One', 'Two', 'Three'],
      },
      artifactStates: {
        'Artifact:ImageProducer.GeneratedImage[0]': {
          canonicalArtifactId: 'Artifact:ImageProducer.GeneratedImage[0]',
          status: 'succeeded',
          hash: 'image-0',
          mimeType: 'image/png',
        },
      },
    });

    expect(projection.meta.axisDimension).toBe('segment');
    expect(projection.meta.axisCount).toBe(3);
  });

  it('preserves expected story lanes before any build has been run', () => {
    const root = makeTreeNode({
      meta: { id: 'PendingFixture', name: 'Pending Fixture' },
      inputs: [
        { name: 'ScenePrompt', type: 'array', itemType: 'text', required: true },
        { name: 'NumOfScenes', type: 'int', required: true },
      ],
      producers: [
        {
          name: 'ImageProducer',
          producer: 'image/text-to-image',
          loop: 'scene',
        },
        {
          name: 'VideoProducer',
          producer: 'video/image-to-video',
          loop: 'scene',
        },
      ],
      artefacts: [
        { name: 'SceneImage', type: 'array', itemType: 'image', countInput: 'NumOfScenes' },
        { name: 'SceneVideo', type: 'array', itemType: 'video', countInput: 'NumOfScenes' },
      ],
      loops: [{ name: 'scene', countInput: 'NumOfScenes' }],
      edges: [
        { from: 'ScenePrompt[scene]', to: 'ImageProducer[scene].Prompt' },
        { from: 'ImageProducer[scene].GeneratedImage', to: 'SceneImage[scene]' },
        { from: 'SceneImage[scene]', to: 'VideoProducer[scene].StartImage' },
        { from: 'ScenePrompt[scene]', to: 'VideoProducer[scene].Prompt' },
        { from: 'VideoProducer[scene].GeneratedVideo', to: 'SceneVideo[scene]' },
      ],
    });

    const projection = buildStoryboardProjection({
      root,
      effectiveInputs: {
        ScenePrompt: ['Opening shot'],
        NumOfScenes: 1,
      },
    });

    const firstColumnItems =
      projection.columns[0]?.groups.flatMap((group) => group.items) ?? [];
    const imageItem = firstColumnItems.find(
      (item) => item.id === 'Artifact:SceneImage[0]'
    );
    const videoItem = firstColumnItems.find(
      (item) => item.id === 'Artifact:SceneVideo[0]'
    );

    expect(projection.meta.hasProducedStoryState).toBe(false);
    expect(imageItem?.kind).toBe('placeholder');
    expect(imageItem?.placeholderReason).toBe('not-run');
    expect(videoItem?.kind).toBe('placeholder');
    expect(videoItem?.placeholderReason).toBe('not-run');
  });

  it('resolves indexed top-level prompt input values into storyboard text cards', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-prompts-'));

    try {
      const blueprintPath = path.join(tempDir, 'prompt-input-blueprint.yaml');
      await fs.writeFile(
        blueprintPath,
        [
          'meta:',
          '  id: PromptInputFixture',
          '  name: Prompt Input Fixture',
          '',
          'inputs:',
          '  - name: StoryboardImagePrompt',
          '    type: array',
          '    itemType: text',
          '    countInput: NumOfScenes',
          '  - name: SceneVideoPrompt',
          '    type: array',
          '    itemType: text',
          '    countInput: NumOfScenes',
          '  - name: NumOfScenes',
          '    type: int',
          '',
          'artifacts:',
          '  - name: StoryboardImages',
          '    type: array',
          '    itemType: image',
          '    countInput: NumOfScenes',
          '  - name: SceneVideos',
          '    type: array',
          '    itemType: video',
          '    countInput: NumOfScenes',
          '',
          'loops:',
          '  - name: scene',
          '    countInput: NumOfScenes',
          '',
          'producers:',
          '  - name: StoryboardImageProducer',
          '    producer: image/image-compose',
          '    loop: scene',
          '  - name: SceneVideoProducer',
          '    producer: video/image-to-video',
          '    loop: scene',
          '',
          'connections:',
          '  - from: StoryboardImagePrompt[scene]',
          '    to: StoryboardImageProducer[scene].Prompt',
          '  - from: StoryboardImageProducer[scene].ComposedImage',
          '    to: StoryboardImages[scene]',
          '  - from: StoryboardImageProducer[scene].ComposedImage',
          '    to: SceneVideoProducer[scene].StartImage',
          '  - from: SceneVideoPrompt[scene]',
          '    to: SceneVideoProducer[scene].Prompt',
          '  - from: SceneVideoProducer[scene].GeneratedVideo',
          '    to: SceneVideos[scene]',
          '',
        ].join('\n')
      );

      const { root } = await loadYamlBlueprintTree(blueprintPath, {
        catalogRoot: path.resolve(process.cwd(), '../catalog'),
      });

      const projection = buildStoryboardProjection({
        root,
        effectiveInputs: {
          StoryboardImagePrompt: ['Opening frame prompt', 'Closing frame prompt'],
          SceneVideoPrompt: ['Opening shot prompt', 'Closing shot prompt'],
          NumOfScenes: 2,
        },
      });

      const firstColumnItems =
        projection.columns[0]?.groups.flatMap((group) => group.items) ?? [];
      const storyboardPrompt = firstColumnItems.find(
        (item) => item.id === 'Input:StoryboardImagePrompt[0]'
      );
      const sceneVideoPrompt = firstColumnItems.find(
        (item) => item.id === 'Input:SceneVideoPrompt[0]'
      );

      expect(storyboardPrompt?.text?.value).toBe('Opening frame prompt');
      expect(sceneVideoPrompt?.text?.value).toBe('Opening shot prompt');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('prunes producer outputs that are not connected in the blueprint graph', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-video-'));

    try {
      const blueprintPath = path.join(tempDir, 'connected-output-blueprint.yaml');
      await fs.writeFile(
        blueprintPath,
        [
          'meta:',
          '  id: ConnectedOutputFixture',
          '  name: Connected Output Fixture',
          '',
          'inputs:',
          '  - name: ScenePrompt',
          '    type: array',
          '    itemType: text',
          '    countInput: NumOfScenes',
          '  - name: StartImage',
          '    type: array',
          '    itemType: image',
          '    countInput: NumOfScenes',
          '  - name: NumOfScenes',
          '    type: int',
          '',
          'artifacts:',
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
          '  - name: SceneVideoProducer',
          '    producer: video/image-to-video',
          '    loop: scene',
          '',
          'connections:',
          '  - from: StartImage[scene]',
          '    to: SceneVideoProducer[scene].StartImage',
          '  - from: ScenePrompt[scene]',
          '    to: SceneVideoProducer[scene].Prompt',
          '  - from: SceneVideoProducer[scene].GeneratedVideo',
          '    to: SceneVideo[scene]',
          '',
        ].join('\n')
      );

      const { root } = await loadYamlBlueprintTree(blueprintPath, {
        catalogRoot: path.resolve(process.cwd(), '../catalog'),
      });

      const projection = buildStoryboardProjection({
        root,
        effectiveInputs: {
          ScenePrompt: ['Scene one'],
          StartImage: ['file:./input-files/scene-1.png'],
          NumOfScenes: 1,
        },
        artifactStates: {
          'Artifact:SceneVideoProducer.GeneratedVideo[0]': {
            canonicalArtifactId: 'Artifact:SceneVideoProducer.GeneratedVideo[0]',
            status: 'failed',
          },
        },
      });

      const firstColumnItems =
        projection.columns[0]?.groups.flatMap((group) => group.items) ?? [];
      const itemIds = firstColumnItems.map((item) => item.id);

      expect(itemIds).toContain('Artifact:SceneVideoProducer.GeneratedVideo[0]');
      expect(itemIds).not.toContain('Artifact:SceneVideoProducer.AudioTrack[0]');
      expect(itemIds).not.toContain('Artifact:SceneVideoProducer.FirstFrame[0]');
      expect(itemIds).not.toContain('Artifact:SceneVideoProducer.LastFrame[0]');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
