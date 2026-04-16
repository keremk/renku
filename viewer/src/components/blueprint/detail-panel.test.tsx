/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DetailPanel } from './detail-panel';
import type { BlueprintGraphData } from '@/types/blueprint-graph';

vi.mock('./inputs-panel', () => ({
  InputsPanel: () => <div>inputs panel</div>,
}));

vi.mock('./models-panel', () => ({
  ModelsPanel: ({
    activeProducerId,
    onActiveProducerChange,
  }: {
    activeProducerId?: string | null;
    onActiveProducerChange?: (producerId: string) => void;
  }) => (
    <div>
      <div data-testid='models-active-producer'>
        {activeProducerId ?? 'none'}
      </div>
      <button
        type='button'
        onClick={() =>
          onActiveProducerChange?.('Producer:SharedActiveProducer')
        }
      >
        choose-model-producer
      </button>
    </div>
  ),
}));

vi.mock('./outputs-panel', () => ({
  OutputsPanel: ({
    activeProducerId,
    onActiveProducerChange,
  }: {
    activeProducerId?: string | null;
    onActiveProducerChange?: (producerId: string) => void;
  }) => (
    <div>
      <div data-testid='outputs-active-producer'>
        {activeProducerId ?? 'none'}
      </div>
      <button
        type='button'
        onClick={() =>
          onActiveProducerChange?.('Producer:OutputSelectedProducer')
        }
      >
        choose-output-producer
      </button>
    </div>
  ),
}));

vi.mock('./storyboard-panel', () => ({
  StoryboardPanel: () => <div>storyboard panel</div>,
}));

vi.mock('./preview-panel', () => ({
  PreviewPanel: () => <div>preview panel</div>,
}));

const graphData: BlueprintGraphData = {
  meta: {
    id: 'detail-test',
    name: 'Detail Test',
  },
  nodes: [],
  edges: [],
  inputs: [],
  outputs: [],
};

describe('DetailPanel', () => {
  it('renders tabs in the expected order', () => {
    render(
      <DetailPanel
        graphData={graphData}
        inputData={null}
        selectedNodeId={null}
        movieId={null}
        blueprintFolder={null}
        blueprintPath='/tmp/detail-test.yaml'
        artifacts={[]}
      />
    );

    const tabLabels = screen
      .getAllByRole('button')
      .slice(0, 5)
      .map((button) => button.textContent?.trim());

    expect(tabLabels).toEqual([
      'Inputs',
      'Models',
      'Outputs',
      'Storyboard',
      'Preview',
    ]);
  });

  it('preserves the active producer when switching between models and outputs tabs', () => {
    render(
      <DetailPanel
        graphData={graphData}
        inputData={null}
        selectedNodeId={null}
        movieId='movie-1'
        blueprintFolder='test-blueprint'
        blueprintPath='/tmp/detail-test.yaml'
        artifacts={[]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Models' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'choose-model-producer' })
    );

    expect(screen.getByTestId('models-active-producer').textContent).toBe(
      'Producer:SharedActiveProducer'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Outputs' }));

    expect(screen.getByTestId('outputs-active-producer').textContent).toBe(
      'Producer:SharedActiveProducer'
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'choose-output-producer' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Models' }));

    expect(screen.getByTestId('models-active-producer').textContent).toBe(
      'Producer:OutputSelectedProducer'
    );
  });
});
