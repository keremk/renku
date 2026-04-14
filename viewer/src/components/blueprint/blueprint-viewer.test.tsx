/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { BlueprintViewer } from './blueprint-viewer';
import type { BlueprintGraphData } from '@/types/blueprint-graph';

const executionMock = vi.hoisted(() => ({
  getProducerOverride: vi.fn(),
  getProducerSchedulingSummary: vi.fn(),
  requestProducerScheduling: vi.fn(),
  setProducerOverrideEnabled: vi.fn(),
  setProducerOverrideCount: vi.fn(),
  resetProducerOverride: vi.fn(),
}));

const layoutMockState = vi.hoisted(() => ({
  nodes: [
    {
      id: 'Producer:AudioProducer[0]',
      type: 'producerNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'AudioProducer',
        runnable: true,
        status: 'not-run-yet',
        inputBindings: [],
        outputBindings: [],
      },
    },
  ],
}));

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({
    nodes,
    onNodeClick,
    onPaneClick,
    children,
  }: {
    nodes: Array<{ id: string }>;
    onNodeClick?: (event: unknown, node: unknown) => void;
    onPaneClick?: (event: unknown) => void;
    children: React.ReactNode;
  }) => (
    <div>
      {nodes.map((node) => (
        <button
          key={node.id}
          type='button'
          data-testid={`node-${node.id}`}
          onClick={() => onNodeClick?.({}, node)}
        >
          {node.id}
        </button>
      ))}
      <button type='button' data-testid='pane' onClick={() => onPaneClick?.({})}>
        pane
      </button>
      {children}
    </div>
  ),
  Background: () => null,
  Controls: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ControlButton: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type='button' onClick={onClick}>
      {children}
    </button>
  ),
  ViewportPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useNodesState: (
    initialNodes: Array<{ id: string }>
  ): [Array<{ id: string }>, React.Dispatch<React.SetStateAction<Array<{ id: string }>>>, (changes: unknown) => void] => {
    const [nodes, setNodes] = React.useState(initialNodes);
    return [nodes, setNodes, () => {}];
  },
  useEdgesState: (
    initialEdges: unknown[]
  ): [unknown[], React.Dispatch<React.SetStateAction<unknown[]>>, (changes: unknown) => void] => {
    const [edges, setEdges] = React.useState(initialEdges);
    return [edges, setEdges, () => {}];
  },
}));

vi.mock('@/lib/blueprint-layout', () => ({
  defaultBlueprintLayoutConfig: {
    nodeWidth: 100,
    nodeHeight: 60,
    horizontalSpacing: 240,
  },
  layoutBlueprintGraph: () => ({
    nodes: layoutMockState.nodes,
    edges: [],
  }),
}));

vi.mock('@/contexts/execution-context', () => ({
  useExecution: () => executionMock,
}));

vi.mock('./producer-details-dialog', () => ({
  ProducerDetailsDialog: ({
    open,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid='producer-dialog'>
        <button type='button' data-testid='close-dialog' onClick={() => onOpenChange(false)}>
          close
        </button>
      </div>
    ) : null,
}));

vi.mock('@/hooks/use-dark-mode', () => ({
  useDarkMode: () => false,
}));

const graphData: BlueprintGraphData = {
  meta: {
    id: 'test-blueprint',
    name: 'Test Blueprint',
  },
  nodes: [],
  edges: [],
  inputs: [],
  outputs: [],
  layerAssignments: {
    'Producer:AudioProducer[0]': 0,
  },
  layerCount: 1,
};

describe('BlueprintViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    layoutMockState.nodes = [
      {
        id: 'Producer:AudioProducer[0]',
        type: 'producerNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'AudioProducer',
          runnable: true,
          status: 'not-run-yet',
          inputBindings: [],
          outputBindings: [],
        },
      },
    ];
    executionMock.getProducerOverride.mockReturnValue(undefined);
    executionMock.getProducerSchedulingSummary.mockReturnValue(undefined);
    executionMock.requestProducerScheduling.mockResolvedValue({
      producerId: 'Producer:AudioProducer',
      probeUpToLayer: 0,
      producerScheduling: {
        producerId: 'Producer:AudioProducer',
        mode: 'inherit',
        maxSelectableCount: 3,
        effectiveCountLimit: null,
        scheduledCount: 3,
        scheduledJobCount: 3,
        upstreamProducerIds: [],
        warnings: [],
      },
      compatibility: {
        ok: true,
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('retries producer scheduling refresh when reopening the same producer dialog', async () => {
    render(
      <BlueprintViewer
        graphData={graphData}
        blueprintName='test-blueprint'
        movieId='movie-123'
        selectedUpToLayer={null}
      />
    );

    fireEvent.click(screen.getByTestId('node-Producer:AudioProducer[0]'));

    await waitFor(() => {
      expect(executionMock.requestProducerScheduling).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByTestId('close-dialog'));
    fireEvent.click(screen.getByTestId('node-Producer:AudioProducer[0]'));

    await waitFor(() => {
      expect(executionMock.requestProducerScheduling).toHaveBeenCalledTimes(2);
    });
  });

  it('does not request producer scheduling for non-runnable composite nodes', async () => {
    layoutMockState.nodes = [
      {
        id: 'Producer:CelebrityVideoProducer',
        type: 'producerNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'CelebrityVideoProducer',
          runnable: false,
          status: 'not-run-yet',
          inputBindings: [],
          outputBindings: [],
        },
      },
    ];

    render(
      <BlueprintViewer
        graphData={{
          ...graphData,
          layerAssignments: {
            'Producer:CelebrityVideoProducer': 2,
          },
        }}
        blueprintName='test-blueprint'
        movieId='movie-123'
        selectedUpToLayer={null}
      />
    );

    fireEvent.click(screen.getByTestId('node-Producer:CelebrityVideoProducer'));

    await waitFor(() => {
      expect(screen.getByTestId('producer-dialog')).toBeTruthy();
    });

    expect(executionMock.requestProducerScheduling).not.toHaveBeenCalled();
  });
});
