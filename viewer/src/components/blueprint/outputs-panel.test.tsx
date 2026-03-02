/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OutputsPanel } from './outputs-panel';
import { ExecutionProvider } from '@/contexts/execution-context';
import type { BlueprintGraphData } from '@/types/blueprint-graph';

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
});
