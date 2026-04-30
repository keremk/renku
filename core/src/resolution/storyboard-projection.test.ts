import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BlueprintDocument, BlueprintTreeNode } from '../types.js';
import {
  hydrateOutputSchemasFromProducerMetadata,
  loadYamlBlueprintTree,
} from '../index.js';
import { buildStoryboardProjection } from './storyboard-projection.js';

const catalogRoot = path.resolve(process.cwd(), '../catalog');

function makeTreeNode(document: Record<string, unknown>): BlueprintTreeNode {
  const defaults: Pick<
    BlueprintDocument,
    'producers' | 'imports' | 'outputs' | 'edges'
  > = {
    producers: [],
    imports: [],
    outputs: [],
    edges: [],
  };
  const normalizedDocument = {
    ...defaults,
    ...document,
  } as BlueprintDocument;
  return {
    id: String((normalizedDocument.meta as { id: string }).id),
    namespacePath: [],
    document: normalizedDocument,
    children: new Map(),
    sourcePath: '/tmp/storyboard-blueprint.yaml',
  };
}

function makeChildTreeNode(
  document: BlueprintDocument,
  namespacePath: string[]
): BlueprintTreeNode {
  return {
    id: document.meta.id,
    namespacePath,
    document,
    children: new Map(),
    sourcePath: '/tmp/storyboard-blueprint.yaml',
  };
}

function makeProducerDocument(args: {
  id: string;
  inputs: BlueprintDocument['inputs'];
  outputs: BlueprintDocument['outputs'];
}): BlueprintDocument {
  return {
    meta: { id: args.id, name: args.id, kind: 'producer' },
    inputs: args.inputs,
    outputs: args.outputs,
    producers: [{ name: args.id }],
    imports: [],
    edges: [],
  };
}

describe('buildStoryboardProjection', () => {
  it('derives a scene storyboard with prompt inputs and real media outputs', () => {
    const root: BlueprintTreeNode = {
      ...makeTreeNode({
      meta: { id: 'StoryboardFixture', name: 'Storyboard Fixture' },
      inputs: [
        { name: 'SharedStyleImage', type: 'image', required: true },
        { name: 'ScenePrompt', type: 'array', itemType: 'text', required: true },
        { name: 'NumOfClips', type: 'int', required: true },
      ],
      imports: [
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
      outputs: [
        { name: 'StoryboardImage', type: 'array', itemType: 'image', countInput: 'NumOfClips' },
        { name: 'SceneVideo', type: 'array', itemType: 'video', countInput: 'NumOfClips' },
      ],
      loops: [{ name: 'scene', countInput: 'NumOfClips' }],
      edges: [
        { from: 'SharedStyleImage', to: 'StoryboardProducer[scene].StyleImage' },
        { from: 'ScenePrompt[scene]', to: 'StoryboardProducer[scene].Prompt' },
        { from: 'StoryboardProducer[scene].GeneratedImage', to: 'StoryboardImage[scene]' },
        { from: 'StoryboardImage[scene]', to: 'VideoProducer[scene].StartImage' },
        { from: 'ScenePrompt[scene]', to: 'VideoProducer[scene].Prompt' },
        { from: 'VideoProducer[scene].GeneratedVideo', to: 'SceneVideo[scene]' },
      ],
      }),
      children: new Map([
        [
          'StoryboardProducer',
          makeChildTreeNode(
            makeProducerDocument({
              id: 'StoryboardProducer',
              inputs: [
                { name: 'StyleImage', type: 'image', required: true },
                { name: 'Prompt', type: 'text', required: true },
              ],
              outputs: [{ name: 'GeneratedImage', type: 'image' }],
            }),
            ['StoryboardProducer']
          ),
        ],
        [
          'VideoProducer',
          makeChildTreeNode(
            makeProducerDocument({
              id: 'VideoProducer',
              inputs: [
                { name: 'StartImage', type: 'image', required: true },
                { name: 'Prompt', type: 'text', required: true },
              ],
              outputs: [{ name: 'GeneratedVideo', type: 'video' }],
            }),
            ['VideoProducer']
          ),
        ],
      ]),
    };

    const projection = buildStoryboardProjection({
      root,
      effectiveInputs: {
        SharedStyleImage: 'file:./input-files/style.png',
        ScenePrompt: ['Opening shot', 'Closing shot'],
        NumOfClips: 2,
      },
      artifactStates: {
        'Artifact:StoryboardProducer.GeneratedImage[0]': {
          canonicalArtifactId: 'Artifact:StoryboardProducer.GeneratedImage[0]',
          status: 'succeeded',
          hash: 'image-0-hash',
          mimeType: 'image/png',
        },
        'Artifact:VideoProducer.GeneratedVideo[0]': {
          canonicalArtifactId: 'Artifact:VideoProducer.GeneratedVideo[0]',
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
            item.id === 'Artifact:VideoProducer.GeneratedVideo[1]' &&
            item.state === 'pending'
        )
    ).toBe(true);
  });

  it('projects continuity-style columns without rendering the shared seed input column', () => {
    const root: BlueprintTreeNode = {
      ...makeTreeNode({
      meta: { id: 'CarryOverFixture', name: 'Carry Over Fixture' },
      inputs: [
        { name: 'InitialImage', type: 'image', required: true },
        { name: 'ScenePrompt', type: 'array', itemType: 'text', required: true },
        { name: 'NumOfClips', type: 'int', required: true },
      ],
      imports: [
        {
          name: 'ImageProducer',
          producer: 'image/image-compose',
          loop: 'scene',
        },
      ],
      outputs: [
        { name: 'SceneImage', type: 'array', itemType: 'image', countInput: 'NumOfClips' },
      ],
      loops: [{ name: 'scene', countInput: 'NumOfClips' }],
      edges: [
        { from: 'SceneImage[scene-1]', to: 'ImageProducer[scene].StartImage' },
        { from: 'ScenePrompt[scene]', to: 'ImageProducer[scene].Prompt' },
        { from: 'ImageProducer[scene].GeneratedImage', to: 'SceneImage[scene]' },
      ],
      }),
      children: new Map([
        [
          'ImageProducer',
          makeChildTreeNode(
            makeProducerDocument({
              id: 'ImageProducer',
              inputs: [
                { name: 'StartImage', type: 'image', required: false },
                { name: 'Prompt', type: 'text', required: true },
              ],
              outputs: [{ name: 'GeneratedImage', type: 'image' }],
            }),
            ['ImageProducer']
          ),
        ],
      ]),
    };

    const projection = buildStoryboardProjection({
      root,
      effectiveInputs: {
        InitialImage: 'file:./input-files/start.png',
        ScenePrompt: ['Frame one', 'Frame two'],
        NumOfClips: 2,
      },
      artifactStates: {
        'Artifact:ImageProducer.GeneratedImage[0]': {
          canonicalArtifactId: 'Artifact:ImageProducer.GeneratedImage[0]',
          status: 'succeeded',
          hash: 'scene-0',
          mimeType: 'image/png',
        },
      },
    });

    const secondColumnItems =
      projection.columns[1]?.groups.flatMap((group) => group.items) ?? [];
    const pendingSecondSceneImage = secondColumnItems.find(
      (item) => item.id === 'Artifact:ImageProducer.GeneratedImage[1]'
    );

    expect(secondColumnItems.map((item) => item.id)).not.toContain('Input:InitialImage');
    expect(pendingSecondSceneImage?.state).toBe('pending');
  });

  it('only treats conditional exports as published when their export binding is active', () => {
    const imageProducerDoc: BlueprintDocument = {
      meta: { id: 'MainImageProducer', name: 'Main Image Producer', kind: 'producer' },
      inputs: [{ name: 'Prompt', type: 'string', required: true }],
      outputs: [{ name: 'GeneratedImage', type: 'image' }],
      producers: [
        {
          name: 'ImageGenerator',
          provider: 'fal-ai',
          model: 'image',
        },
      ],
      imports: [],
      edges: [
        { from: 'Prompt', to: 'ImageGenerator' },
        { from: 'ImageGenerator', to: 'GeneratedImage' },
      ],
    };

    const gateProducerDoc: BlueprintDocument = {
      meta: { id: 'GateProducer', name: 'Gate Producer', kind: 'producer' },
      inputs: [{ name: 'Prompt', type: 'string', required: true }],
      outputs: [{ name: 'ShouldPublish', type: 'json' }],
      producers: [
        {
          name: 'GateGenerator',
          provider: 'openai',
          model: 'gpt-5-mini',
        },
      ],
      imports: [],
      edges: [
        { from: 'Prompt', to: 'GateGenerator' },
        { from: 'GateGenerator', to: 'ShouldPublish' },
      ],
    };

    const optionalImageProducerDoc: BlueprintDocument = {
      meta: {
        id: 'OptionalImageProducer',
        name: 'Optional Image Producer',
        kind: 'producer',
      },
      inputs: [{ name: 'Prompt', type: 'string', required: true }],
      outputs: [{ name: 'GeneratedImage', type: 'image' }],
      producers: [
        {
          name: 'ImageGenerator',
          provider: 'fal-ai',
          model: 'image',
        },
      ],
      imports: [],
      edges: [
        { from: 'Prompt', to: 'ImageGenerator' },
        { from: 'ImageGenerator', to: 'GeneratedImage' },
      ],
    };

    const rootDoc: BlueprintDocument = {
      meta: {
        id: 'ConditionalExportFixture',
        name: 'Conditional Export Fixture',
      },
      inputs: [
        { name: 'ScenePrompt', type: 'array', itemType: 'text', required: true },
        { name: 'NumOfClips', type: 'int', required: true },
      ],
      outputs: [
        {
          name: 'SceneImage',
          type: 'array',
          itemType: 'image',
          countInput: 'NumOfClips',
        },
        {
          name: 'PublishedOptionalImage',
          type: 'array',
          itemType: 'image',
          countInput: 'NumOfClips',
        },
      ],
      producers: [],
      imports: [],
      loops: [{ name: 'scene', countInput: 'NumOfClips' }],
      edges: [
        { from: 'ScenePrompt[scene]', to: 'MainImageProducer[scene].Prompt' },
        {
          from: 'MainImageProducer[scene].GeneratedImage',
          to: 'SceneImage[scene]',
        },
        { from: 'ScenePrompt[scene]', to: 'GateProducer[scene].Prompt' },
        { from: 'ScenePrompt[scene]', to: 'OptionalImageProducer[scene].Prompt' },
        {
          from: 'OptionalImageProducer[scene].GeneratedImage',
          to: 'PublishedOptionalImage[scene]',
          conditions: {
            when: 'Artifact:GateProducer.ShouldPublish[scene]',
            is: true,
          },
        },
      ],
    };

    const root: BlueprintTreeNode = {
      id: 'ConditionalExportFixture',
      namespacePath: [],
      document: rootDoc,
      children: new Map([
        ['MainImageProducer', makeChildTreeNode(imageProducerDoc, ['MainImageProducer'])],
        ['GateProducer', makeChildTreeNode(gateProducerDoc, ['GateProducer'])],
        [
          'OptionalImageProducer',
          makeChildTreeNode(optionalImageProducerDoc, ['OptionalImageProducer']),
        ],
      ]),
      sourcePath: '/tmp/storyboard-blueprint.yaml',
    };

    const inactiveProjection = buildStoryboardProjection({
      root,
      effectiveInputs: {
        ScenePrompt: ['Scene one'],
        NumOfClips: 1,
      },
      resolvedArtifactValues: {
        'Artifact:GateProducer.ShouldPublish[0]': false,
      },
    });

    const inactiveItemIds =
      inactiveProjection.columns[0]?.groups.flatMap((group) => group.items).map((item) => item.id) ?? [];
    expect(inactiveItemIds.length).toBeGreaterThan(0);
    expect(inactiveItemIds).not.toContain(
      'Artifact:OptionalImageProducer.GeneratedImage[0]'
    );

    const activeProjection = buildStoryboardProjection({
      root,
      effectiveInputs: {
        ScenePrompt: ['Scene one'],
        NumOfClips: 1,
      },
      resolvedArtifactValues: {
        'Artifact:GateProducer.ShouldPublish[0]': true,
      },
    });

    const activeItemIds =
      activeProjection.columns[0]?.groups.flatMap((group) => group.items).map((item) => item.id) ?? [];
    expect(activeItemIds).toContain('Artifact:OptionalImageProducer.GeneratedImage[0]');
  });

  it('treats input-gated exports as published only when the input condition is satisfied', () => {
    const mainImageProducerDoc: BlueprintDocument = {
      meta: { id: 'MainImageProducer', name: 'Main Image Producer', kind: 'producer' },
      inputs: [{ name: 'Prompt', type: 'string', required: true }],
      outputs: [{ name: 'GeneratedImage', type: 'image' }],
      producers: [
        {
          name: 'ImageGenerator',
          provider: 'fal-ai',
          model: 'image',
        },
      ],
      imports: [],
      edges: [
        { from: 'Prompt', to: 'ImageGenerator' },
        { from: 'ImageGenerator', to: 'GeneratedImage' },
      ],
    };

    const optionalImageProducerDoc: BlueprintDocument = {
      meta: {
        id: 'OptionalImageProducer',
        name: 'Optional Image Producer',
        kind: 'producer',
      },
      inputs: [{ name: 'Prompt', type: 'string', required: true }],
      outputs: [{ name: 'GeneratedImage', type: 'image' }],
      producers: [
        {
          name: 'ImageGenerator',
          provider: 'fal-ai',
          model: 'image',
        },
      ],
      imports: [],
      edges: [
        { from: 'Prompt', to: 'ImageGenerator' },
        { from: 'ImageGenerator', to: 'GeneratedImage' },
      ],
    };

    const rootDoc: BlueprintDocument = {
      meta: {
        id: 'InputConditionalExportFixture',
        name: 'Input Conditional Export Fixture',
      },
      inputs: [
        { name: 'ScenePrompt', type: 'array', itemType: 'text', required: true },
        { name: 'PublishOptionalImage', type: 'array', itemType: 'boolean', required: true },
        { name: 'NumOfClips', type: 'int', required: true },
      ],
      outputs: [
        {
          name: 'SceneImage',
          type: 'array',
          itemType: 'image',
          countInput: 'NumOfClips',
        },
        {
          name: 'PublishedOptionalImage',
          type: 'array',
          itemType: 'image',
          countInput: 'NumOfClips',
        },
      ],
      producers: [],
      imports: [],
      loops: [{ name: 'scene', countInput: 'NumOfClips' }],
      edges: [
        { from: 'ScenePrompt[scene]', to: 'MainImageProducer[scene].Prompt' },
        {
          from: 'MainImageProducer[scene].GeneratedImage',
          to: 'SceneImage[scene]',
        },
        { from: 'ScenePrompt[scene]', to: 'OptionalImageProducer[scene].Prompt' },
        {
          from: 'OptionalImageProducer[scene].GeneratedImage',
          to: 'PublishedOptionalImage[scene]',
          conditions: {
            when: 'Input:PublishOptionalImage[scene]',
            is: true,
          },
        },
      ],
    };

    const root: BlueprintTreeNode = {
      id: 'InputConditionalExportFixture',
      namespacePath: [],
      document: rootDoc,
      children: new Map([
        ['MainImageProducer', makeChildTreeNode(mainImageProducerDoc, ['MainImageProducer'])],
        [
          'OptionalImageProducer',
          makeChildTreeNode(optionalImageProducerDoc, ['OptionalImageProducer']),
        ],
      ]),
      sourcePath: '/tmp/storyboard-blueprint.yaml',
    };

    const inactiveProjection = buildStoryboardProjection({
      root,
      effectiveInputs: {
        ScenePrompt: ['Scene one'],
        PublishOptionalImage: [false],
        NumOfClips: 1,
      },
    });

    const inactiveItemIds =
      inactiveProjection.columns[0]?.groups.flatMap((group) => group.items).map((item) => item.id) ?? [];
    expect(inactiveItemIds).not.toContain(
      'Artifact:OptionalImageProducer.GeneratedImage[0]'
    );

    const activeProjection = buildStoryboardProjection({
      root,
      effectiveInputs: {
        ScenePrompt: ['Scene one'],
        PublishOptionalImage: [true],
        NumOfClips: 1,
      },
    });

    const activeItemIds =
      activeProjection.columns[0]?.groups.flatMap((group) => group.items).map((item) => item.id) ?? [];
    expect(activeItemIds).toContain('Artifact:OptionalImageProducer.GeneratedImage[0]');
  });

  it('prefers the NumOfClips-driven clip axis when multiple axes are present', () => {
    const root: BlueprintTreeNode = {
      ...makeTreeNode({
      meta: { id: 'AxisFixture', name: 'Axis Fixture' },
      inputs: [
        { name: 'NumOfClips', type: 'int', required: true },
        { name: 'NumOfImages', type: 'int', required: true },
        { name: 'ScenePrompt', type: 'array', itemType: 'text', required: true },
      ],
      imports: [
        {
          name: 'ImageProducer',
          producer: 'image/text-to-image',
          loop: 'clip',
        },
      ],
      outputs: [
        { name: 'GeneratedImage', type: 'array', itemType: 'image', countInput: 'NumOfClips' },
      ],
      loops: [
        { name: 'clip', countInput: 'NumOfClips' },
        { name: 'image', countInput: 'NumOfImages' },
      ],
      edges: [
        { from: 'ScenePrompt[clip]', to: 'ImageProducer[clip].Prompt' },
        { from: 'ImageProducer[clip].GeneratedImage', to: 'GeneratedImage[clip]' },
      ],
      }),
      children: new Map([
        [
          'ImageProducer',
          makeChildTreeNode(
            makeProducerDocument({
              id: 'ImageProducer',
              inputs: [{ name: 'Prompt', type: 'text', required: true }],
              outputs: [{ name: 'GeneratedImage', type: 'image' }],
            }),
            ['ImageProducer']
          ),
        ],
      ]),
    };

    const projection = buildStoryboardProjection({
      root,
      effectiveInputs: {
        NumOfClips: 3,
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

    expect(projection.meta.axisDimension).toBe('clip');
    expect(projection.meta.axisCount).toBe(3);
  });

  it('groups nested clip.image media by the clip storyboard axis', async () => {
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
          '  - name: ClipPrompt',
          '    type: array',
          '    itemType: text',
          '    countInput: NumOfClips',
          '  - name: NumOfClips',
          '    type: int',
          '  - name: NumOfImagesPerClip',
          '    type: int',
          '',
          'outputs:',
          '  - name: ClipImage',
          '    type: multiDimArray',
          '    itemType: image',
          '  - name: ClipAudio',
          '    type: array',
          '    itemType: audio',
          '    countInput: NumOfClips',
          '',
          'loops:',
          '  - name: clip',
          '    countInput: NumOfClips',
          '  - name: image',
          '    parent: clip',
          '    countInput: NumOfImagesPerClip',
          '',
          'imports:',
          '  - name: ImageProducer',
          '    producer: image/text-to-image',
          '    loop: clip.image',
          '  - name: AudioProducer',
          '    producer: audio/text-to-speech',
          '    loop: clip',
          '',
          'connections:',
          '  - from: ClipPrompt[clip]',
          '    to: ImageProducer[clip][image].Prompt',
          '  - from: ImageProducer[clip][image].GeneratedImage',
          '    to: ClipImage[clip][image]',
          '  - from: ClipPrompt[clip]',
          '    to: AudioProducer[clip].Text',
          '  - from: AudioProducer[clip].GeneratedAudio',
          '    to: ClipAudio[clip]',
          '',
        ].join('\n')
      );

      const { root } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });
      const projection = buildStoryboardProjection({
        root,
        effectiveInputs: {
          ClipPrompt: ['First clip', 'Second clip'],
          NumOfClips: 2,
          NumOfImagesPerClip: 2,
        },
      });

      expect(projection.meta.axisDimension).toBe('clip');
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
    const root: BlueprintTreeNode = {
      ...makeTreeNode({
      meta: { id: 'PendingFixture', name: 'Pending Fixture' },
      inputs: [
        { name: 'ScenePrompt', type: 'array', itemType: 'text', required: true },
        { name: 'NumOfClips', type: 'int', required: true },
      ],
      imports: [
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
      outputs: [
        { name: 'SceneImage', type: 'array', itemType: 'image', countInput: 'NumOfClips' },
        { name: 'SceneVideo', type: 'array', itemType: 'video', countInput: 'NumOfClips' },
      ],
      loops: [{ name: 'scene', countInput: 'NumOfClips' }],
      edges: [
        { from: 'ScenePrompt[scene]', to: 'ImageProducer[scene].Prompt' },
        { from: 'ImageProducer[scene].GeneratedImage', to: 'SceneImage[scene]' },
        { from: 'SceneImage[scene]', to: 'VideoProducer[scene].StartImage' },
        { from: 'ScenePrompt[scene]', to: 'VideoProducer[scene].Prompt' },
        { from: 'VideoProducer[scene].GeneratedVideo', to: 'SceneVideo[scene]' },
      ],
      }),
      children: new Map([
        [
          'ImageProducer',
          makeChildTreeNode(
            makeProducerDocument({
              id: 'ImageProducer',
              inputs: [{ name: 'Prompt', type: 'text', required: true }],
              outputs: [{ name: 'GeneratedImage', type: 'image' }],
            }),
            ['ImageProducer']
          ),
        ],
        [
          'VideoProducer',
          makeChildTreeNode(
            makeProducerDocument({
              id: 'VideoProducer',
              inputs: [
                { name: 'StartImage', type: 'image', required: true },
                { name: 'Prompt', type: 'text', required: true },
              ],
              outputs: [{ name: 'GeneratedVideo', type: 'video' }],
            }),
            ['VideoProducer']
          ),
        ],
      ]),
    };

    const projection = buildStoryboardProjection({
      root,
      effectiveInputs: {
        ScenePrompt: ['Opening shot'],
        NumOfClips: 1,
      },
    });

    const firstColumnItems =
      projection.columns[0]?.groups.flatMap((group) => group.items) ?? [];
    const imageItem = firstColumnItems.find(
      (item) => item.id === 'Artifact:ImageProducer.GeneratedImage[0]'
    );
    const videoItem = firstColumnItems.find(
      (item) => item.id === 'Artifact:VideoProducer.GeneratedVideo[0]'
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
          '    countInput: NumOfClips',
          '  - name: SceneVideoPrompt',
          '    type: array',
          '    itemType: text',
          '    countInput: NumOfClips',
          '  - name: NumOfClips',
          '    type: int',
          '',
          'outputs:',
          '  - name: StoryboardImages',
          '    type: array',
          '    itemType: image',
          '    countInput: NumOfClips',
          '  - name: SceneVideos',
          '    type: array',
          '    itemType: video',
          '    countInput: NumOfClips',
          '',
          'loops:',
          '  - name: scene',
          '    countInput: NumOfClips',
          '',
          'imports:',
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
          NumOfClips: 2,
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
          '    countInput: NumOfClips',
          '  - name: StartImage',
          '    type: array',
          '    itemType: image',
          '    countInput: NumOfClips',
          '  - name: NumOfClips',
          '    type: int',
          '',
          'outputs:',
          '  - name: SceneVideo',
          '    type: array',
          '    itemType: video',
          '    countInput: NumOfClips',
          '',
          'loops:',
          '  - name: scene',
          '    countInput: NumOfClips',
          '',
          'imports:',
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
          NumOfClips: 1,
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
      const producerPath = path.join(tempDir, 'secondary-producer.yaml');

      await fs.writeFile(
        producerPath,
        [
          'meta:',
          '  id: SecondaryProducer',
          '  name: Secondary Producer',
          '  kind: producer',
          '',
          'inputs:',
          '  - name: Prompt',
          '    type: string',
          '    storyboard: main',
          '  - name: MultiPrompt',
          '    type: array',
          '    storyboard: secondary',
          '',
          'outputs:',
          '  - name: GeneratedVideo',
          '    type: video',
          '',
        ].join('\n')
      );

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
          '    countInput: NumOfClips',
          '  - name: NumOfClips',
          '    type: int',
          '',
          'outputs:',
          '  - name: ClipVideo',
          '    type: array',
          '    itemType: video',
          '    countInput: NumOfClips',
          '',
          'loops:',
          '  - name: clip',
          '    countInput: NumOfClips',
          '',
          'imports:',
          '  - name: ClipVideoProducer',
          '    path: ./secondary-producer.yaml',
          '    loop: clip',
          '',
          'connections:',
          '  - from: MultiPrompt[clip]',
          '    to: ClipVideoProducer[clip].MultiPrompt',
          '  - from: ClipVideoProducer[clip].GeneratedVideo',
          '    to: ClipVideo[clip]',
          '',
        ].join('\n')
      );

      const { root } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });
      const projection = buildStoryboardProjection({
        root,
        effectiveInputs: {
          MultiPrompt: ['Shot one', 'Shot two'],
          NumOfClips: 2,
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

  it('does not treat imported NumOfClips loops as multiple competing storyboard axes', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-imported-clip-'));

    try {
      const scriptSchemaPath = path.join(tempDir, 'script-output.json');
      const scriptProducerPath = path.join(tempDir, 'script-producer.yaml');
      const blueprintPath = path.join(tempDir, 'imported-clip.yaml');

      await fs.writeFile(
        scriptSchemaPath,
        JSON.stringify({
          name: 'VideoScript',
          schema: {
            type: 'object',
            properties: {
              Clips: {
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
            required: ['Clips'],
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
          '  - name: NumOfClips',
          '    type: int',
          '',
          'outputs:',
          '  - name: VideoScript',
          '    type: json',
          '    arrays:',
          '      - path: Clips',
          '        countInput: NumOfClips',
          '',
          'loops:',
          '  - name: clip',
          '    countInput: NumOfClips',
          '',
        ].join('\n')
      );

      await fs.writeFile(
        blueprintPath,
        [
          'meta:',
          '  id: ImportedClipFixture',
          '  name: Imported Clip Fixture',
          '',
          'inputs:',
          '  - name: NumOfClips',
          '    type: int',
          '',
          'outputs:',
          '  - name: ClipAudio',
          '    type: array',
          '    itemType: audio',
          '    countInput: NumOfClips',
          '',
          'loops:',
          '  - name: clip',
          '    countInput: NumOfClips',
          '',
          'imports:',
          '  - name: ScriptProducer',
          `    path: ${scriptProducerPath}`,
          '  - name: AudioProducer',
          '    producer: audio/text-to-speech',
          '    loop: clip',
          '',
          'connections:',
          '  - from: NumOfClips',
          '    to: ScriptProducer.NumOfClips',
          '  - from: ScriptProducer.VideoScript.Clips[clip].NarrationScript',
          '    to: AudioProducer[clip].Text',
          '  - from: AudioProducer[clip].GeneratedAudio',
          '    to: ClipAudio[clip]',
          '',
        ].join('\n')
      );

      const { root } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });
      await hydrateOutputSchemasFromProducerMetadata(root);

      const projection = buildStoryboardProjection({
        root,
        effectiveInputs: {
          NumOfClips: 2,
        },
      });

      expect(projection.meta.axisDimension).toBe('clip');
      expect(projection.meta.axisCount).toBe(2);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('renders companion text from producer array artifacts keyed directly by NumOfClips', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-numofclips-artifacts-'));

    try {
      const scriptProducerPath = path.join(tempDir, 'script-producer.yaml');
      const blueprintPath = path.join(tempDir, 'numofclips-artifacts.yaml');

      await fs.writeFile(
        scriptProducerPath,
        [
          'meta:',
          '  id: ScriptProducer',
          '  name: Script Producer',
          '  kind: producer',
          '',
          'inputs:',
          '  - name: NumOfClips',
          '    type: int',
          '',
          'outputs:',
          '  - name: VideoPrompts',
          '    type: array',
          '    itemType: string',
          '    countInput: NumOfClips',
          '  - name: NarrationScripts',
          '    type: array',
          '    itemType: string',
          '    countInput: NumOfClips',
          '',
        ].join('\n')
      );

      await fs.writeFile(
        blueprintPath,
        [
          'meta:',
          '  id: NumOfClipsArtifactsFixture',
          '  name: NumOfClips Artifacts Fixture',
          '',
          'inputs:',
          '  - name: NumOfClips',
          '    type: int',
          '',
          'outputs:',
          '  - name: ClipVideo',
          '    type: array',
          '    itemType: video',
          '    countInput: NumOfClips',
          '  - name: ClipAudio',
          '    type: array',
          '    itemType: audio',
          '    countInput: NumOfClips',
          '',
          'loops:',
          '  - name: clip',
          '    countInput: NumOfClips',
          '',
          'imports:',
          '  - name: ScriptProducer',
          `    path: ${scriptProducerPath}`,
          '  - name: VideoProducer',
          '    producer: video/image-to-video',
          '    loop: clip',
          '  - name: AudioProducer',
          '    producer: audio/text-to-speech',
          '    loop: clip',
          '',
          'connections:',
          '  - from: NumOfClips',
          '    to: ScriptProducer.NumOfClips',
          '  - from: ScriptProducer.VideoPrompts[clip]',
          '    to: VideoProducer[clip].Prompt',
          '  - from: ScriptProducer.NarrationScripts[clip]',
          '    to: AudioProducer[clip].Text',
          '  - from: VideoProducer[clip].GeneratedVideo',
          '    to: ClipVideo[clip]',
          '  - from: AudioProducer[clip].GeneratedAudio',
          '    to: ClipAudio[clip]',
          '',
        ].join('\n')
      );

      const { root } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });
      const projection = buildStoryboardProjection({
        root,
        effectiveInputs: {
          NumOfClips: 2,
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
          '  - name: NumOfClips',
          '    type: int',
          '',
          'outputs:',
          '  - name: ClipVideo',
          '    type: array',
          '    itemType: video',
          '    countInput: NumOfClips',
          '',
          'loops:',
          '  - name: clip',
          '    countInput: NumOfClips',
          '',
          'imports:',
          '  - name: MotionTransfer',
          '    producer: video/motion-transfer',
          '    loop: clip',
          '',
          'connections:',
          '  - from: CharacterImage',
          '    to: MotionTransfer[clip].CharacterImage',
          '  - from: DrivingVideo',
          '    to: MotionTransfer[clip].DrivingVideo',
          '  - from: MotionTransfer[clip].GeneratedVideo',
          '    to: ClipVideo[clip]',
          '',
        ].join('\n')
      );

      const { root } = await loadYamlBlueprintTree(blueprintPath, { catalogRoot });
      const projection = buildStoryboardProjection({
        root,
        effectiveInputs: {
          CharacterImage: 'file:./character.png',
          DrivingVideo: 'file:./driving.mp4',
          NumOfClips: 1,
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
          'outputs:',
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
          '    countInput: NumOfClips',
          '  - name: NumOfClips',
          '    type: int',
          '',
          'outputs:',
          '  - name: SegmentImage',
          '    type: array',
          '    itemType: image',
          '    countInput: NumOfClips',
          '',
          'loops:',
          '  - name: segment',
          '    countInput: NumOfClips',
          '',
          'imports:',
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
          NumOfClips: 1,
        },
      });

      const firstColumnItems =
        projection.columns[0]?.groups.flatMap((group) => group.items) ?? [];
      expect(firstColumnItems.map((item) => item.id)).not.toContain('Input:Description[0]');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('fails fast for visible story axes that are not driven by NumOfClips', () => {
    const root: BlueprintTreeNode = {
      ...makeTreeNode({
      meta: { id: 'UnsupportedAxisFixture', name: 'Unsupported Axis Fixture' },
      inputs: [
        { name: 'NumOfPairs', type: 'int', required: true },
      ],
      imports: [
        {
          name: 'PairProducer',
          producer: 'image/text-to-image',
          loop: 'pair',
        },
      ],
      outputs: [
        { name: 'PairImage', type: 'array', itemType: 'image', countInput: 'NumOfPairs' },
      ],
      loops: [{ name: 'pair', countInput: 'NumOfPairs' }],
      edges: [
        { from: 'PairProducer[pair].GeneratedImage', to: 'PairImage[pair]' },
      ],
      producers: [],
      }),
      children: new Map([
        [
          'PairProducer',
          makeChildTreeNode(
            makeProducerDocument({
              id: 'PairProducer',
              inputs: [],
              outputs: [{ name: 'GeneratedImage', type: 'image' }],
            }),
            ['PairProducer']
          ),
        ],
      ]),
    };

    expect(() =>
      buildStoryboardProjection({
        root,
        effectiveInputs: {
          NumOfPairs: 2,
        },
      })
    ).toThrow(/NumOfClips/);
  });
});
