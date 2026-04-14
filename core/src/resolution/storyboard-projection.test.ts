import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BlueprintTreeNode } from '../types.js';
import {
  hydrateOutputSchemasFromProducerMetadata,
  loadYamlBlueprintTree,
} from '../index.js';
import { buildStoryboardProjection } from './storyboard-projection.js';

const catalogRoot = path.resolve(process.cwd(), '../catalog');

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
        { name: 'NumOfSegments', type: 'int', required: true },
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
        { name: 'StoryboardImage', type: 'array', itemType: 'image', countInput: 'NumOfSegments' },
        { name: 'SceneVideo', type: 'array', itemType: 'video', countInput: 'NumOfSegments' },
        { name: 'Timeline', type: 'json' },
      ],
      loops: [{ name: 'scene', countInput: 'NumOfSegments' }],
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
        NumOfSegments: 2,
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
    expect(projection.columns[0]?.title).toBe('Scene 1');
    expect(projection.columns[1]?.title).toBe('Scene 2');
    const firstColumnItems =
      projection.columns[0]?.groups.flatMap((group) => group.items) ?? [];
    expect(firstColumnItems.map((item) => item.id)).not.toContain('Input:SharedStyleImage');
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
        { name: 'NumOfSegments', type: 'int', required: true },
      ],
      producers: [
        {
          name: 'ImageProducer',
          producer: 'image/image-compose',
          loop: 'scene',
        },
      ],
      artefacts: [
        { name: 'SceneImage', type: 'array', itemType: 'image', countInput: 'NumOfSegments' },
      ],
      loops: [{ name: 'scene', countInput: 'NumOfSegments' }],
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
        NumOfSegments: 2,
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

    expect(secondColumnItems.map((item) => item.id)).not.toContain('Input:InitialImage');
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

  it('groups nested segment.image media by the segment storyboard axis', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-nested-media-'));

    try {
      const blueprintPath = path.join(tempDir, 'nested-media.yaml');
      await fs.writeFile(
        blueprintPath,
        [
          'meta:',
          '  id: NestedMediaFixture',
          '  name: Nested Media Fixture',
          '',
          'inputs:',
          '  - name: SegmentPrompt',
          '    type: array',
          '    itemType: text',
          '    countInput: NumOfSegments',
          '  - name: NumOfSegments',
          '    type: int',
          '  - name: NumOfImagesPerSegment',
          '    type: int',
          '',
          'artifacts:',
          '  - name: SegmentImage',
          '    type: multiDimArray',
          '    itemType: image',
          '  - name: SegmentAudio',
          '    type: array',
          '    itemType: audio',
          '    countInput: NumOfSegments',
          '',
          'loops:',
          '  - name: segment',
          '    countInput: NumOfSegments',
          '  - name: image',
          '    parent: segment',
          '    countInput: NumOfImagesPerSegment',
          '',
          'producers:',
          '  - name: ImageProducer',
          '    producer: image/text-to-image',
          '    loop: segment.image',
          '  - name: AudioProducer',
          '    producer: audio/text-to-speech',
          '    loop: segment',
          '',
          'connections:',
          '  - from: SegmentPrompt[segment]',
          '    to: ImageProducer[segment][image].Prompt',
          '  - from: ImageProducer[segment][image].GeneratedImage',
          '    to: SegmentImage[segment][image]',
          '  - from: SegmentPrompt[segment]',
          '    to: AudioProducer[segment].Text',
          '  - from: AudioProducer[segment].GeneratedAudio',
          '    to: SegmentAudio[segment]',
          '',
        ].join('\n')
      );

      const { root } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });
      const projection = buildStoryboardProjection({
        root,
        effectiveInputs: {
          SegmentPrompt: ['First segment', 'Second segment'],
          NumOfSegments: 2,
          NumOfImagesPerSegment: 2,
        },
      });

      expect(projection.meta.axisDimension).toBe('segment');
      expect(projection.meta.axisCount).toBe(2);

      const firstColumnItems =
        projection.columns[0]?.groups.flatMap((group) => group.items) ?? [];
      expect(
        firstColumnItems.filter((item) => item.mediaType === 'audio')
      ).toHaveLength(1);
      expect(
        firstColumnItems.filter((item) => item.mediaType === 'image')
      ).toHaveLength(2);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('preserves expected story lanes before any build has been run', () => {
    const root = makeTreeNode({
      meta: { id: 'PendingFixture', name: 'Pending Fixture' },
      inputs: [
        { name: 'ScenePrompt', type: 'array', itemType: 'text', required: true },
        { name: 'NumOfSegments', type: 'int', required: true },
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
        { name: 'SceneImage', type: 'array', itemType: 'image', countInput: 'NumOfSegments' },
        { name: 'SceneVideo', type: 'array', itemType: 'video', countInput: 'NumOfSegments' },
      ],
      loops: [{ name: 'scene', countInput: 'NumOfSegments' }],
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
        NumOfSegments: 1,
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
          '    countInput: NumOfSegments',
          '  - name: SceneVideoPrompt',
          '    type: array',
          '    itemType: text',
          '    countInput: NumOfSegments',
          '  - name: NumOfSegments',
          '    type: int',
          '',
          'artifacts:',
          '  - name: StoryboardImages',
          '    type: array',
          '    itemType: image',
          '    countInput: NumOfSegments',
          '  - name: SceneVideos',
          '    type: array',
          '    itemType: video',
          '    countInput: NumOfSegments',
          '',
          'loops:',
          '  - name: scene',
          '    countInput: NumOfSegments',
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
        catalogRoot,
      });

      const projection = buildStoryboardProjection({
        root,
        effectiveInputs: {
          StoryboardImagePrompt: ['Opening frame prompt', 'Closing frame prompt'],
          SceneVideoPrompt: ['Opening shot prompt', 'Closing shot prompt'],
          NumOfSegments: 2,
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
          '    countInput: NumOfSegments',
          '  - name: StartImage',
          '    type: array',
          '    itemType: image',
          '    countInput: NumOfSegments',
          '  - name: NumOfSegments',
          '    type: int',
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
        catalogRoot,
      });

      const projection = buildStoryboardProjection({
        root,
        effectiveInputs: {
          ScenePrompt: ['Scene one'],
          StartImage: ['file:./input-files/scene-1.png'],
          NumOfSegments: 1,
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

  it('falls back to a secondary storyboard input when the main one is unbound', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-secondary-'));

    try {
      const blueprintPath = path.join(tempDir, 'secondary-fallback.yaml');
      await fs.writeFile(
        blueprintPath,
        [
          'meta:',
          '  id: SecondaryFallbackFixture',
          '  name: Secondary Fallback Fixture',
          '',
          'inputs:',
          '  - name: MultiPrompt',
          '    type: array',
          '    countInput: NumOfSegments',
          '  - name: NumOfSegments',
          '    type: int',
          '',
          'artifacts:',
          '  - name: SegmentVideo',
          '    type: array',
          '    itemType: video',
          '    countInput: NumOfSegments',
          '',
          'loops:',
          '  - name: segment',
          '    countInput: NumOfSegments',
          '',
          'producers:',
          '  - name: SegmentVideoProducer',
          '    producer: video/kling-multishot',
          '    loop: segment',
          '',
          'connections:',
          '  - from: MultiPrompt[segment]',
          '    to: SegmentVideoProducer[segment].MultiPrompt',
          '  - from: SegmentVideoProducer[segment].GeneratedVideo',
          '    to: SegmentVideo[segment]',
          '',
        ].join('\n')
      );

      const { root } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });
      const projection = buildStoryboardProjection({
        root,
        effectiveInputs: {
          MultiPrompt: ['Shot one', 'Shot two'],
          NumOfSegments: 2,
        },
      });

      const firstColumnItems =
        projection.columns[0]?.groups.flatMap((group) => group.items) ?? [];
      expect(firstColumnItems.map((item) => item.id)).toContain('Input:MultiPrompt[0]');
      const renderedMediaIds = firstColumnItems
        .filter((item) => item.mediaType !== 'text')
        .map((item) => item.id);
      expect(
        projection.connectors.some(
          (connector) =>
            connector.fromItemId === 'Input:MultiPrompt[0]' &&
            renderedMediaIds.includes(connector.toItemId)
        )
      ).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('does not treat imported NumOfSegments loops as multiple competing storyboard axes', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-imported-segment-'));

    try {
      const scriptSchemaPath = path.join(tempDir, 'script-output.json');
      const scriptProducerPath = path.join(tempDir, 'script-producer.yaml');
      const blueprintPath = path.join(tempDir, 'imported-segment.yaml');

      await fs.writeFile(
        scriptSchemaPath,
        JSON.stringify({
          name: 'VideoScript',
          schema: {
            type: 'object',
            properties: {
              Segments: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    NarrationScript: { type: 'string' },
                  },
                  required: ['NarrationScript'],
                },
              },
            },
            required: ['Segments'],
          },
        })
      );

      await fs.writeFile(
        scriptProducerPath,
        [
          'meta:',
          '  id: ScriptProducer',
          '  name: Script Producer',
          '  kind: producer',
          '  outputSchema: ./script-output.json',
          '',
          'inputs:',
          '  - name: NumOfSegments',
          '    type: int',
          '',
          'artifacts:',
          '  - name: VideoScript',
          '    type: json',
          '    arrays:',
          '      - path: Segments',
          '        countInput: NumOfSegments',
          '',
          'loops:',
          '  - name: segment',
          '    countInput: NumOfSegments',
          '',
        ].join('\n')
      );

      await fs.writeFile(
        blueprintPath,
        [
          'meta:',
          '  id: ImportedSegmentFixture',
          '  name: Imported Segment Fixture',
          '',
          'inputs:',
          '  - name: NumOfSegments',
          '    type: int',
          '',
          'artifacts:',
          '  - name: SegmentAudio',
          '    type: array',
          '    itemType: audio',
          '    countInput: NumOfSegments',
          '',
          'loops:',
          '  - name: segment',
          '    countInput: NumOfSegments',
          '',
          'producers:',
          '  - name: ScriptProducer',
          `    path: ${scriptProducerPath}`,
          '  - name: AudioProducer',
          '    producer: audio/text-to-speech',
          '    loop: segment',
          '',
          'connections:',
          '  - from: NumOfSegments',
          '    to: ScriptProducer.NumOfSegments',
          '  - from: ScriptProducer.VideoScript.Segments[segment].NarrationScript',
          '    to: AudioProducer[segment].Text',
          '  - from: AudioProducer[segment].GeneratedAudio',
          '    to: SegmentAudio[segment]',
          '',
        ].join('\n')
      );

      const { root } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });
      await hydrateOutputSchemasFromProducerMetadata(root);

      const projection = buildStoryboardProjection({
        root,
        effectiveInputs: {
          NumOfSegments: 2,
        },
      });

      expect(projection.meta.axisDimension).toBe('segment');
      expect(projection.meta.axisCount).toBe(2);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('renders companion text from producer array artifacts keyed directly by NumOfSegments', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-numofsegments-artifacts-'));

    try {
      const scriptProducerPath = path.join(tempDir, 'script-producer.yaml');
      const blueprintPath = path.join(tempDir, 'numofsegments-artifacts.yaml');

      await fs.writeFile(
        scriptProducerPath,
        [
          'meta:',
          '  id: ScriptProducer',
          '  name: Script Producer',
          '  kind: producer',
          '',
          'inputs:',
          '  - name: NumOfSegments',
          '    type: int',
          '',
          'artifacts:',
          '  - name: VideoPrompts',
          '    type: array',
          '    itemType: string',
          '    countInput: NumOfSegments',
          '  - name: NarrationScripts',
          '    type: array',
          '    itemType: string',
          '    countInput: NumOfSegments',
          '',
        ].join('\n')
      );

      await fs.writeFile(
        blueprintPath,
        [
          'meta:',
          '  id: NumOfSegmentsArtifactsFixture',
          '  name: NumOfSegments Artifacts Fixture',
          '',
          'inputs:',
          '  - name: NumOfSegments',
          '    type: int',
          '',
          'artifacts:',
          '  - name: SegmentVideo',
          '    type: array',
          '    itemType: video',
          '    countInput: NumOfSegments',
          '  - name: SegmentAudio',
          '    type: array',
          '    itemType: audio',
          '    countInput: NumOfSegments',
          '',
          'loops:',
          '  - name: segment',
          '    countInput: NumOfSegments',
          '',
          'producers:',
          '  - name: ScriptProducer',
          `    path: ${scriptProducerPath}`,
          '  - name: VideoProducer',
          '    producer: video/image-to-video',
          '    loop: segment',
          '  - name: AudioProducer',
          '    producer: audio/text-to-speech',
          '    loop: segment',
          '',
          'connections:',
          '  - from: NumOfSegments',
          '    to: ScriptProducer.NumOfSegments',
          '  - from: ScriptProducer.VideoPrompts[segment]',
          '    to: VideoProducer[segment].Prompt',
          '  - from: ScriptProducer.NarrationScripts[segment]',
          '    to: AudioProducer[segment].Text',
          '  - from: VideoProducer[segment].GeneratedVideo',
          '    to: SegmentVideo[segment]',
          '  - from: AudioProducer[segment].GeneratedAudio',
          '    to: SegmentAudio[segment]',
          '',
        ].join('\n')
      );

      const { root } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });
      const projection = buildStoryboardProjection({
        root,
        effectiveInputs: {
          NumOfSegments: 2,
        },
      });

      const firstColumnItems =
        projection.columns[0]?.groups.flatMap((group) => group.items) ?? [];
      expect(firstColumnItems.map((item) => item.id)).toContain(
        'Artifact:ScriptProducer.VideoPrompts[0]'
      );
      expect(firstColumnItems.map((item) => item.id)).toContain(
        'Artifact:ScriptProducer.NarrationScripts[0]'
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('does not surface storyboard text when a producer declares no storyboard metadata', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-motion-transfer-'));

    try {
      const blueprintPath = path.join(tempDir, 'motion-transfer-storyboard.yaml');
      await fs.writeFile(
        blueprintPath,
        [
          'meta:',
          '  id: MotionTransferFixture',
          '  name: Motion Transfer Fixture',
          '',
          'inputs:',
          '  - name: CharacterImage',
          '    type: image',
          '  - name: DrivingVideo',
          '    type: string',
          '  - name: NumOfSegments',
          '    type: int',
          '',
          'artifacts:',
          '  - name: SegmentVideo',
          '    type: array',
          '    itemType: video',
          '    countInput: NumOfSegments',
          '',
          'loops:',
          '  - name: segment',
          '    countInput: NumOfSegments',
          '',
          'producers:',
          '  - name: MotionTransfer',
          '    producer: video/motion-transfer',
          '    loop: segment',
          '',
          'connections:',
          '  - from: CharacterImage',
          '    to: MotionTransfer[segment].CharacterImage',
          '  - from: DrivingVideo',
          '    to: MotionTransfer[segment].DrivingVideo',
          '  - from: MotionTransfer[segment].GeneratedVideo',
          '    to: SegmentVideo[segment]',
          '',
        ].join('\n')
      );

      const { root } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });
      const projection = buildStoryboardProjection({
        root,
        effectiveInputs: {
          CharacterImage: 'file:./character.png',
          DrivingVideo: 'file:./driving.mp4',
          NumOfSegments: 1,
        },
      });

      const firstColumnItems =
        projection.columns[0]?.groups.flatMap((group) => group.items) ?? [];
      expect(firstColumnItems.every((item) => item.mediaType !== 'text')).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('does not infer storyboard text from prompt-like naming when producer metadata is absent', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-no-heuristics-'));

    try {
      const producerPath = path.join(tempDir, 'custom-image-producer.yaml');
      const blueprintPath = path.join(tempDir, 'custom-storyboard.yaml');

      await fs.writeFile(
        producerPath,
        [
          'meta:',
          '  id: CustomImageProducer',
          '  name: Custom Image Producer',
          '  kind: producer',
          '',
          'inputs:',
          '  - name: Description',
          '    type: string',
          '',
          'artifacts:',
          '  - name: GeneratedImage',
          '    type: image',
          '',
        ].join('\n')
      );

      await fs.writeFile(
        blueprintPath,
        [
          'meta:',
          '  id: NoHeuristicsFixture',
          '  name: No Heuristics Fixture',
          '',
          'inputs:',
          '  - name: Description',
          '    type: array',
          '    itemType: string',
          '    countInput: NumOfSegments',
          '  - name: NumOfSegments',
          '    type: int',
          '',
          'artifacts:',
          '  - name: SegmentImage',
          '    type: array',
          '    itemType: image',
          '    countInput: NumOfSegments',
          '',
          'loops:',
          '  - name: segment',
          '    countInput: NumOfSegments',
          '',
          'producers:',
          '  - name: CustomImage',
          `    path: ${producerPath}`,
          '    loop: segment',
          '',
          'connections:',
          '  - from: Description[segment]',
          '    to: CustomImage[segment].Description',
          '  - from: CustomImage[segment].GeneratedImage',
          '    to: SegmentImage[segment]',
          '',
        ].join('\n')
      );

      const { root } = await loadYamlBlueprintTree(blueprintPath);
      const projection = buildStoryboardProjection({
        root,
        effectiveInputs: {
          Description: ['Still no storyboard prompt'],
          NumOfSegments: 1,
        },
      });

      const firstColumnItems =
        projection.columns[0]?.groups.flatMap((group) => group.items) ?? [];
      expect(firstColumnItems.map((item) => item.id)).not.toContain('Input:Description[0]');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('fails fast for visible story axes that are not driven by NumOfSegments', () => {
    const root = makeTreeNode({
      meta: { id: 'UnsupportedAxisFixture', name: 'Unsupported Axis Fixture' },
      inputs: [
        { name: 'NumOfPairs', type: 'int', required: true },
      ],
      artefacts: [
        { name: 'PairImage', type: 'array', itemType: 'image', countInput: 'NumOfPairs' },
      ],
      loops: [{ name: 'pair', countInput: 'NumOfPairs' }],
      edges: [],
      producers: [{ name: 'UnsupportedAxisFixture' }],
    });

    expect(() =>
      buildStoryboardProjection({
        root,
        effectiveInputs: {
          NumOfPairs: 2,
        },
      })
    ).toThrow(/NumOfSegments/);
  });
});
