/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './app';
import type { BlueprintGraphData } from '@/types/blueprint-graph';
import type { BuildInfo } from '@/types/builds';

const mockRecheck = vi.fn();
const mockRefetchBuilds = vi.fn().mockResolvedValue(undefined);
const mockRefetchBuildState = vi.fn();

const baseGraph: BlueprintGraphData = {
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

const resolvedPaths = {
  blueprintFolder: '/tmp/blueprints/test-blueprint',
  blueprintPath: '/tmp/blueprints/test-blueprint/blueprint.yaml',
  inputsPath: '/tmp/blueprints/test-blueprint/input-template.yaml',
  catalogRoot: null,
};

type MockBlueprintRoute = {
  blueprintName: string | null;
  inputsFilename: string | null;
  movieId: string | null;
  selectedBuildId: string | null;
  useLast: boolean;
};

type MockBlueprintData = {
  graph: BlueprintGraphData | null;
  inputs: null;
  resolvedPaths: typeof resolvedPaths | null;
  status: 'idle' | 'loading' | 'success' | 'error';
  error: Error | null;
};

type MockBuildsList = {
  builds: BuildInfo[];
  status: 'idle' | 'loading' | 'success' | 'error';
  blueprintFolder: string | null;
  error: Error | null;
  refetch: typeof mockRefetchBuilds;
};

let mockViewerPathname = '/blueprints';
let mockBlueprintRoute: MockBlueprintRoute | null = {
  blueprintName: 'test-blueprint',
  inputsFilename: null,
  movieId: null,
  selectedBuildId: null,
  useLast: false,
};

let mockBlueprintData: MockBlueprintData = {
  graph: baseGraph,
  inputs: null,
  resolvedPaths,
  status: 'success',
  error: null,
};

let mockBuildsList: MockBuildsList = {
  builds: [],
  status: 'success',
  blueprintFolder: resolvedPaths.blueprintFolder,
  error: null,
  refetch: mockRefetchBuilds,
};

vi.mock('@/components/blueprint/workspace-layout', () => ({
  WorkspaceLayout: () => <div>workspace-layout</div>,
}));

vi.mock('@/components/blueprint/create-build-dialog', () => ({
  CreateBuildDialog: ({
    open,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div>
        <p>empty-build-dialog</p>
        <button type='button' onClick={() => onOpenChange(false)}>
          dismiss-empty-build-dialog
        </button>
      </div>
    ) : null,
}));

vi.mock('@/components/home/viewer-home-page', () => ({
  ViewerHomePage: () => <div>viewer-home</div>,
}));

vi.mock('@/components/onboarding/onboarding-page', () => ({
  OnboardingPage: () => <div>onboarding-page</div>,
}));

vi.mock('@/components/settings/settings-page', () => ({
  SettingsPage: () => <div>settings-page</div>,
}));

vi.mock('@/services/use-initialization-status', () => ({
  useInitializationStatus: () => ({
    initialized: true,
    isLoading: false,
    error: null,
    recheck: mockRecheck,
  }),
}));

vi.mock('@/hooks/use-blueprint-route', () => ({
  useBlueprintRoute: () => mockBlueprintRoute,
  useViewerPathname: () => mockViewerPathname,
  updateBlueprintRoute: vi.fn(),
  clearLastFlag: vi.fn(),
}));

vi.mock('@/services/use-blueprint-data', () => ({
  useBlueprintData: () => mockBlueprintData,
}));

vi.mock('@/services/use-builds-list', () => ({
  useBuildsList: () => mockBuildsList,
}));

vi.mock('@/services/use-build-state', () => ({
  useBuildState: () => ({
    buildState: null,
    refetch: mockRefetchBuildState,
  }),
}));

describe('App empty-build prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockViewerPathname = '/blueprints';
    mockBlueprintRoute = {
      blueprintName: 'test-blueprint',
      inputsFilename: null,
      movieId: null,
      selectedBuildId: null,
      useLast: false,
    };
    mockBlueprintData = {
      graph: baseGraph,
      inputs: null,
      resolvedPaths,
      status: 'success',
      error: null,
    };
    mockBuildsList = {
      builds: [],
      status: 'success',
      blueprintFolder: resolvedPaths.blueprintFolder,
      error: null,
      refetch: mockRefetchBuilds,
    };
  });

  it('opens the prompt when the current blueprint has no builds', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('empty-build-dialog')).toBeTruthy();
    });
  });

  it('does not open the prompt when builds are still loading', () => {
    mockBuildsList = {
      ...mockBuildsList,
      status: 'loading',
    };

    render(<App />);

    expect(screen.queryByText('empty-build-dialog')).toBeNull();
  });

  it('does not reopen after dismissal when the build list later returns to zero in the same visit', async () => {
    const { rerender } = render(<App />);

    await waitFor(() => {
      expect(screen.getByText('empty-build-dialog')).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'dismiss-empty-build-dialog' })
    );

    await waitFor(() => {
      expect(screen.queryByText('empty-build-dialog')).toBeNull();
    });

    mockBuildsList = {
      ...mockBuildsList,
      builds: [
        {
          movieId: 'movie-1',
          updatedAt: '2026-04-20T00:00:00.000Z',
          revision: null,
          hasBuildState: false,
          hasInputSnapshot: false,
          hasInputsFile: true,
          displayName: null,
        },
      ],
    };
    rerender(<App />);

    mockBuildsList = {
      ...mockBuildsList,
      builds: [],
    };
    rerender(<App />);

    await waitFor(() => {
      expect(screen.queryByText('empty-build-dialog')).toBeNull();
    });
  });

  it('opens again after navigating away and back to the same empty blueprint', async () => {
    const { rerender } = render(<App />);

    await waitFor(() => {
      expect(screen.getByText('empty-build-dialog')).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'dismiss-empty-build-dialog' })
    );

    await waitFor(() => {
      expect(screen.queryByText('empty-build-dialog')).toBeNull();
    });

    mockViewerPathname = '/';
    mockBlueprintRoute = null;
    rerender(<App />);

    await waitFor(() => {
      expect(screen.getByText('viewer-home')).toBeTruthy();
    });

    mockViewerPathname = '/blueprints';
    mockBlueprintRoute = {
      blueprintName: 'test-blueprint',
      inputsFilename: null,
      movieId: null,
      selectedBuildId: null,
      useLast: false,
    };
    rerender(<App />);

    await waitFor(() => {
      expect(screen.getByText('empty-build-dialog')).toBeTruthy();
    });
  });
});
