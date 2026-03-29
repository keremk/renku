/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkspaceLayout } from './workspace-layout';
import type { BlueprintGraphData } from '@/types/blueprint-graph';
import type { BuildInfo, BuildManifestResponse } from '@/types/builds';

vi.mock('@/contexts/execution-context', () => ({
  ExecutionProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useExecution: () => ({
    state: {
      status: 'idle',
      bottomPanelVisible: false,
      executionLogs: [],
      layerRange: { upToLayer: null },
      producerStatuses: {},
    },
    initializeFromManifest: vi.fn(),
    setTotalLayers: vi.fn(),
    setLayerRange: vi.fn(),
  }),
}));

vi.mock('@/hooks', async () => {
  const actual = await vi.importActual<typeof import('@/hooks')>('@/hooks');

  return {
    ...actual,
    useBuildInputs: () => ({
      inputs: null,
      models: [],
      isLoading: false,
      hasLoadedInputs: true,
      saveInputs: vi.fn(),
      saveModels: vi.fn(),
    }),
    useProducerModels: () => ({
      producerModels: {},
      isLoading: false,
    }),
    useProducerConfigSchemas: () => ({ configSchemas: {} }),
    useProducerConfigState: () => ({
      configFieldsByProducer: {},
      configValuesByProducer: {},
    }),
    useProducerPrompts: () => ({
      promptDataByProducer: {},
      savePrompt: vi.fn(),
    }),
    usePanelResizer: () => ({
      percent: 30,
      isDragging: false,
      handleMouseDown: vi.fn(),
    }),
    usePreviewPlayback: () => ({
      currentTime: 0,
      isPlaying: false,
      play: vi.fn(),
      pause: vi.fn(),
      seek: vi.fn(),
      reset: vi.fn(),
    }),
    useModelSelectionEditor: () => ({
      currentSelections: [],
      isDirty: false,
      isSaving: false,
      lastError: null,
      updateSelection: vi.fn(),
      updateConfig: vi.fn(),
      save: vi.fn(),
      reset: vi.fn(),
    }),
  };
});

vi.mock('@/services/use-movie-timeline', () => ({
  useMovieTimeline: () => ({
    timeline: null,
    status: 'idle',
    error: null,
    retry: vi.fn(),
  }),
}));

vi.mock('./detail-panel', () => ({
  DetailPanel: ({
    activeTab,
    onTabChange,
  }: {
    activeTab: string;
    onTabChange: (tab: 'inputs' | 'models' | 'outputs' | 'preview') => void;
  }) => (
    <div>
      <div data-testid='detail-active-tab'>{activeTab}</div>
      <button type='button' onClick={() => onTabChange('inputs')}>
        detail-inputs
      </button>
      <button type='button' onClick={() => onTabChange('models')}>
        detail-models
      </button>
      <button type='button' onClick={() => onTabChange('preview')}>
        detail-preview
      </button>
    </div>
  ),
}));

vi.mock('./bottom-tabbed-panel', () => ({
  BottomTabbedPanel: ({
    activeTab,
    onTabChange,
  }: {
    activeTab: string;
    onTabChange: (tab: 'blueprint' | 'execution' | 'timeline') => void;
  }) => (
    <div>
      <div data-testid='bottom-active-tab'>{activeTab}</div>
      <button type='button' onClick={() => onTabChange('blueprint')}>
        bottom-blueprint
      </button>
      <button type='button' onClick={() => onTabChange('execution')}>
        bottom-execution
      </button>
      <button type='button' onClick={() => onTabChange('timeline')}>
        bottom-timeline
      </button>
    </div>
  ),
}));

vi.mock('./builds-list-sidebar', () => ({
  BuildsListSidebar: () => <div />,
}));

vi.mock('./run-button', () => ({
  RunButton: () => <button type='button'>run</button>,
}));

vi.mock('./switch-blueprint-dialog', () => ({
  SwitchBlueprintDialog: () => <div />,
}));

vi.mock('./plan-dialog', () => ({
  PlanDialog: () => null,
}));

vi.mock('./completion-dialog', () => ({
  CompletionDialog: () => null,
}));

vi.mock('@/components/layout/viewer-page-header', () => ({
  ViewerPageHeader: () => <div />,
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
  layerCount: 0,
};

const builds: BuildInfo[] = [
  {
    movieId: 'movie-1',
    updatedAt: '2026-03-12T00:00:00.000Z',
    revision: 'revision-1',
    hasManifest: true,
    hasInputsFile: false,
    displayName: null,
  },
];

const selectedBuildManifest: BuildManifestResponse = {
  movieId: 'movie-1',
  revision: 'revision-1',
  inputs: {},
  models: [],
  artefacts: [
    {
      id: 'Artifact:TimelineComposer.Timeline',
      name: 'timeline.json',
      hash: 'timeline-hash',
      size: 100,
      mimeType: 'application/json',
      status: 'succeeded',
      createdAt: '2026-03-12T00:00:00.000Z',
    },
  ],
  createdAt: '2026-03-12T00:00:00.000Z',
};

function renderWorkspaceLayout() {
  render(
    <WorkspaceLayout
      graphData={graphData}
      inputData={null}
      movieId={null}
      blueprintFolder='test-blueprint'
      blueprintName='test-blueprint'
      blueprintPath='/tmp/test-blueprint.yaml'
      catalogRoot={null}
      builds={builds}
      buildsLoading={false}
      selectedBuildId='movie-1'
      selectedBuildManifest={selectedBuildManifest}
    />
  );
}

describe('WorkspaceLayout', () => {
  it('keeps Preview and Timeline tabs synchronized after switching away', () => {
    renderWorkspaceLayout();

    expect(screen.getByTestId('detail-active-tab').textContent).toBe('inputs');
    expect(screen.getByTestId('bottom-active-tab').textContent).toBe(
      'blueprint'
    );

    fireEvent.click(screen.getByRole('button', { name: 'detail-preview' }));

    expect(screen.getByTestId('detail-active-tab').textContent).toBe('preview');
    expect(screen.getByTestId('bottom-active-tab').textContent).toBe(
      'timeline'
    );

    fireEvent.click(screen.getByRole('button', { name: 'detail-models' }));
    fireEvent.click(screen.getByRole('button', { name: 'bottom-blueprint' }));

    expect(screen.getByTestId('detail-active-tab').textContent).toBe('models');
    expect(screen.getByTestId('bottom-active-tab').textContent).toBe(
      'blueprint'
    );

    fireEvent.click(screen.getByRole('button', { name: 'detail-preview' }));

    expect(screen.getByTestId('detail-active-tab').textContent).toBe('preview');
    expect(screen.getByTestId('bottom-active-tab').textContent).toBe(
      'timeline'
    );

    fireEvent.click(screen.getByRole('button', { name: 'detail-models' }));
    fireEvent.click(screen.getByRole('button', { name: 'bottom-blueprint' }));

    fireEvent.click(screen.getByRole('button', { name: 'bottom-timeline' }));

    expect(screen.getByTestId('detail-active-tab').textContent).toBe('preview');
    expect(screen.getByTestId('bottom-active-tab').textContent).toBe(
      'timeline'
    );
  });
});
