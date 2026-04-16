/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OutputsPanel } from './outputs-panel';
import { ExecutionProvider } from '@/contexts/execution-context';
import type {
  BlueprintGraphData,
  ProducerModelInfo,
} from '@/types/blueprint-graph';
import type { ArtifactInfo } from '@/types/builds';

vi.mock('@/data/blueprint-client', async () => {
  const actual =
    await vi.importActual<typeof import('@/data/blueprint-client')>(
      '@/data/blueprint-client'
    );

  return {
    ...actual,
    fetchArtifactPreviewEditModels: () => new Promise<never>(() => {}),
  };
});

const graphData: BlueprintGraphData = {
  meta: {
    id: 'test-blueprint',
    name: 'Test Blueprint',
  },
  nodes: [
    {
      id: 'Producer:ScriptProducer',
      type: 'producer',
      label: 'ScriptProducer',
    },
  ],
  edges: [],
  inputs: [],
  outputs: [
    {
      name: 'Root.Script',
      type: 'string',
    },
  ],
};

const imageProducerGraphData: BlueprintGraphData = {
  meta: {
    id: 'test-blueprint-image',
    name: 'Test Blueprint Image',
  },
  nodes: [
    {
      id: 'Producer:ImageProducer',
      type: 'producer',
      label: 'ImageProducer',
    },
  ],
  edges: [],
  inputs: [],
  outputs: [],
};

const groupedProducerGraphData: BlueprintGraphData = {
  meta: {
    id: 'test-blueprint-grouped',
    name: 'Test Blueprint Grouped',
  },
  nodes: [
    {
      id: 'Producer:ThenImageProducer',
      type: 'producer',
      label: 'ThenImageProducer',
    },
    {
      id: 'Producer:CelebrityVideoProducer.MeetingVideoProducer',
      type: 'producer',
      label: 'MeetingVideoProducer',
      namespacePath: ['CelebrityVideoProducer', 'MeetingVideoProducer'],
    },
    {
      id: 'Producer:CelebrityVideoProducer.VideoStitcher',
      type: 'producer',
      label: 'VideoStitcher',
      namespacePath: ['CelebrityVideoProducer', 'VideoStitcher'],
    },
  ],
  edges: [],
  inputs: [],
  outputs: [],
};

const orderedProducerModels: Record<string, ProducerModelInfo> = {
  'Producer:DirectorProducer': {
    category: 'prompt',
    availableModels: [],
  },
  'Producer:ThenImageProducer': {
    category: 'asset',
    availableModels: [],
  },
  'Producer:NowImageProducer': {
    category: 'asset',
    availableModels: [],
  },
  'Producer:CelebrityVideoProducer.TogetherImageProducer': {
    category: 'asset',
    availableModels: [],
  },
  'Producer:CelebrityVideoProducer.MeetingVideoProducer': {
    category: 'asset',
    availableModels: [],
  },
  'Producer:CelebrityVideoProducer.TransitionVideoProducer': {
    category: 'asset',
    availableModels: [],
  },
  'Producer:CelebrityVideoProducer.VideoStitcher': {
    category: 'composition',
    availableModels: [],
  },
  'Producer:MusicProducer': {
    category: 'asset',
    availableModels: [],
  },
  'Producer:TimelineComposer': {
    category: 'composition',
    availableModels: [],
  },
  'Producer:VideoExporter': {
    category: 'composition',
    availableModels: [],
  },
};

describe('OutputsPanel', () => {
  it('renders producer list layout for selected builds with zero artifacts', () => {
    render(
      <ExecutionProvider>
        <OutputsPanel
          outputs={graphData.outputs}
          selectedNodeId={null}
          movieId='movie-1'
          blueprintFolder='test-blueprint'
          artifacts={[]}
          graphData={graphData}
        />
      </ExecutionProvider>
    );

    expect(screen.getByText('Producers')).toBeTruthy();
    expect(
      screen.getByLabelText('Select producer Producer:ScriptProducer')
    ).toBeTruthy();
    expect(
      screen.getByText('No artifacts generated yet for this producer.')
    ).toBeTruthy();
  });

  it('renders output definitions when no build is selected', () => {
    render(
      <OutputsPanel
        outputs={graphData.outputs}
        selectedNodeId={null}
        movieId={null}
        blueprintFolder={null}
        artifacts={[]}
        graphData={graphData}
      />
    );

    expect(screen.getByText('Root.Script')).toBeTruthy();
    expect(screen.queryByText('Producers')).toBeNull();
  });

  it('shows card actions for object-array image artifacts', async () => {
    const artifacts: ArtifactInfo[] = [
      {
        id: 'Artifact:ImageProducer.GeneratedImage[0][0]',
        name: 'GeneratedImage-0-0.png',
        hash: 'hash-image-0-0',
        size: 1024,
        mimeType: 'image/png',
        producerNodeId: 'Producer:ImageProducer',
        status: 'succeeded',
        createdAt: '2026-03-07T00:00:00.000Z',
      },
    ];

    render(
      <ExecutionProvider>
        <OutputsPanel
          outputs={[]}
          selectedNodeId='Producer:ImageProducer'
          movieId='movie-1'
          blueprintFolder='test-blueprint'
          artifacts={artifacts}
          graphData={imageProducerGraphData}
        />
      </ExecutionProvider>
    );

    const actionsButton = await screen.findByLabelText('Card actions');
    fireEvent.pointerDown(actionsButton);

    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeTruthy();
  });

  it('groups composite producers and keeps per-row outputs controls', () => {
    render(
      <ExecutionProvider>
        <OutputsPanel
          outputs={[
            {
              name: 'Root.CompositeOutput',
              type: 'string',
            },
          ]}
          selectedNodeId={null}
          movieId='movie-1'
          blueprintFolder='test-blueprint'
          artifacts={[]}
          graphData={groupedProducerGraphData}
        />
      </ExecutionProvider>
    );

    expect(screen.getByText('Celebrity Video Producer')).toBeTruthy();
    expect(screen.getByText('Meeting Video Producer')).toBeTruthy();
    expect(screen.getByText('Video Stitcher')).toBeTruthy();
    expect(
      screen.queryByText('CelebrityVideoProducer.MeetingVideoProducer')
    ).toBeNull();
    expect(screen.getAllByLabelText('Open in Finder')).toHaveLength(3);
    expect(screen.getAllByLabelText('Keep')).toHaveLength(3);
    expect(screen.getAllByLabelText('Generate Again')).toHaveLength(3);

    const groupedProducerButton = screen.getByRole('button', {
      name: 'Select producer Producer:CelebrityVideoProducer.MeetingVideoProducer',
    });
    fireEvent.click(groupedProducerButton);

    expect(groupedProducerButton.getAttribute('aria-current')).toBe('true');
  });

  it('does not leak producedBy instance IDs into the producer list', () => {
    const artifacts: ArtifactInfo[] = [
      {
        id: 'Artifact:ThenImageProducer.GeneratedImage[0]',
        name: 'ThenImageProducer.GeneratedImage[0]',
        hash: 'hash-then-0',
        size: 256,
        mimeType: 'image/png',
        producedBy: 'Producer:ThenImageProducer[0]',
        status: 'succeeded',
        createdAt: '2026-03-07T00:00:00.000Z',
      },
      {
        id: 'Artifact:ThenImageProducer.GeneratedImage[1]',
        name: 'ThenImageProducer.GeneratedImage[1]',
        hash: 'hash-then-1',
        size: 256,
        mimeType: 'image/png',
        producedBy: 'Producer:ThenImageProducer[1]',
        status: 'succeeded',
        createdAt: '2026-03-07T00:00:01.000Z',
      },
    ];

    render(
      <ExecutionProvider>
        <OutputsPanel
          outputs={[
            {
              name: 'Root.CompositeOutput',
              type: 'string',
            },
          ]}
          selectedNodeId={null}
          movieId='movie-1'
          blueprintFolder='test-blueprint'
          artifacts={artifacts}
          graphData={groupedProducerGraphData}
        />
      </ExecutionProvider>
    );

    expect(screen.queryByText('ThenImageProducer[0]')).toBeNull();
    expect(screen.queryByText('ThenImageProducer[1]')).toBeNull();
    expect(
      screen.getByRole('button', {
        name: 'Select producer Producer:ThenImageProducer',
      })
    ).toBeTruthy();
  });

  it('matches Models pane ordering from graph layer progression', () => {
    render(
      <ExecutionProvider>
        <OutputsPanel
          outputs={[
            {
              name: 'Root.CompositeOutput',
              type: 'string',
            },
          ]}
          selectedNodeId={null}
          movieId='movie-1'
          blueprintFolder='test-blueprint'
          artifacts={[]}
          graphData={{
            ...groupedProducerGraphData,
            nodes: [
              {
                id: 'Producer:CelebrityVideoProducer.MeetingVideoProducer',
                type: 'producer',
                label: 'MeetingVideoProducer',
                namespacePath: ['CelebrityVideoProducer', 'MeetingVideoProducer'],
              },
              {
                id: 'Producer:DirectorProducer',
                type: 'producer',
                label: 'DirectorProducer',
              },
              {
                id: 'Producer:MusicProducer',
                type: 'producer',
                label: 'MusicProducer',
              },
              {
                id: 'Producer:ThenImageProducer',
                type: 'producer',
                label: 'ThenImageProducer',
              },
              {
                id: 'Producer:NowImageProducer',
                type: 'producer',
                label: 'NowImageProducer',
              },
              {
                id: 'Producer:CelebrityVideoProducer.TogetherImageProducer',
                type: 'producer',
                label: 'TogetherImageProducer',
                namespacePath: ['CelebrityVideoProducer', 'TogetherImageProducer'],
              },
              {
                id: 'Producer:CelebrityVideoProducer.TransitionVideoProducer',
                type: 'producer',
                label: 'TransitionVideoProducer',
                namespacePath: ['CelebrityVideoProducer', 'TransitionVideoProducer'],
              },
              {
                id: 'Producer:CelebrityVideoProducer.VideoStitcher',
                type: 'producer',
                label: 'VideoStitcher',
                namespacePath: ['CelebrityVideoProducer', 'VideoStitcher'],
              },
              {
                id: 'Producer:TimelineComposer',
                type: 'producer',
                label: 'TimelineComposer',
              },
              {
                id: 'Producer:VideoExporter',
                type: 'producer',
                label: 'VideoExporter',
              },
            ],
            layerAssignments: {
              'Producer:DirectorProducer': 0,
              'Producer:ThenImageProducer': 1,
              'Producer:NowImageProducer': 1,
              'Producer:CelebrityVideoProducer.TogetherImageProducer': 2,
              'Producer:CelebrityVideoProducer.MeetingVideoProducer': 3,
              'Producer:CelebrityVideoProducer.TransitionVideoProducer': 4,
              'Producer:CelebrityVideoProducer.VideoStitcher': 5,
              'Producer:MusicProducer': 6,
              'Producer:TimelineComposer': 7,
              'Producer:VideoExporter': 8,
            },
            layerCount: 9,
          }}
          producerModels={orderedProducerModels}
        />
      </ExecutionProvider>
    );

    const producerButtons = screen
      .getAllByRole('button')
      .filter((button) =>
        button.getAttribute('aria-label')?.startsWith('Select producer ')
      )
      .map((button) => button.getAttribute('aria-label'));

    expect(producerButtons).toEqual([
      'Select producer Producer:DirectorProducer',
      'Select producer Producer:ThenImageProducer',
      'Select producer Producer:NowImageProducer',
      'Select producer Producer:CelebrityVideoProducer.TogetherImageProducer',
      'Select producer Producer:CelebrityVideoProducer.MeetingVideoProducer',
      'Select producer Producer:CelebrityVideoProducer.TransitionVideoProducer',
      'Select producer Producer:CelebrityVideoProducer.VideoStitcher',
      'Select producer Producer:MusicProducer',
      'Select producer Producer:TimelineComposer',
      'Select producer Producer:VideoExporter',
    ]);
  });
});
