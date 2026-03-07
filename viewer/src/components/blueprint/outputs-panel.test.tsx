/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OutputsPanel } from './outputs-panel';
import { ExecutionProvider } from '@/contexts/execution-context';
import type { BlueprintGraphData } from '@/types/blueprint-graph';
import type { ArtifactInfo } from '@/types/builds';

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
      screen.getByLabelText('Select producer ScriptProducer')
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
});
