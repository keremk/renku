/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RunButton } from './run-button';
import { useExecution } from '@/contexts/execution-context';
import type { ExecutionStatus } from '@/types/generation';

vi.mock('@/contexts/execution-context', () => ({
  useExecution: vi.fn(),
}));

interface MockExecutionState {
  status: ExecutionStatus;
  isStopping: boolean;
  totalLayers: number;
  layerRange: { upToLayer: number | null };
  selectedForRegeneration: Set<string>;
}

function createMockExecutionState(
  overrides: Partial<MockExecutionState> = {}
): MockExecutionState {
  return {
    status: 'idle',
    isStopping: false,
    totalLayers: 3,
    layerRange: { upToLayer: null },
    selectedForRegeneration: new Set(),
    ...overrides,
  };
}

function mockExecutionContext(state: MockExecutionState) {
  const requestPlan = vi.fn().mockResolvedValue(undefined);
  const cancelExecution = vi.fn().mockResolvedValue(undefined);
  const reset = vi.fn();
  const setLayerRange = vi.fn();

  vi.mocked(useExecution).mockReturnValue({
    state,
    requestPlan,
    cancelExecution,
    reset,
    setLayerRange,
  } as unknown as ReturnType<typeof useExecution>);

  return {
    requestPlan,
    cancelExecution,
    reset,
    setLayerRange,
  };
}

describe('RunButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the selected scope with one-based layer labels', () => {
    mockExecutionContext(
      createMockExecutionState({
        layerRange: { upToLayer: 0 },
      })
    );

    render(<RunButton blueprintName='demo-blueprint' movieId='movie-1' />);

    expect(screen.getByText('Through Layer 1')).toBeTruthy();
  });

  it('updates scope selection from dropdown options', async () => {
    const { setLayerRange } = mockExecutionContext(createMockExecutionState());

    render(<RunButton blueprintName='demo-blueprint' movieId='movie-1' />);

    fireEvent.pointerDown(screen.getByRole('button', { name: /scope/i }));
    await waitFor(() => {
      expect(screen.getByText('Through Layer 2')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Through Layer 2'));

    await waitFor(() => {
      expect(setLayerRange).toHaveBeenCalledWith({ upToLayer: 1 });
    });
  });

  it('plans with selected up-to-layer scope', async () => {
    const { requestPlan } = mockExecutionContext(
      createMockExecutionState({
        layerRange: { upToLayer: 1 },
      })
    );

    render(<RunButton blueprintName='demo-blueprint' movieId='movie-1' />);

    fireEvent.click(screen.getByRole('button', { name: /^run$/i }));

    await waitFor(() => {
      expect(requestPlan).toHaveBeenCalledWith('demo-blueprint', 'movie-1', 1);
    });
  });

  it('plans all layers when scope is all', async () => {
    const { requestPlan } = mockExecutionContext(
      createMockExecutionState({
        layerRange: { upToLayer: null },
      })
    );

    render(<RunButton blueprintName='demo-blueprint' movieId='movie-1' />);

    fireEvent.click(screen.getByRole('button', { name: /^run$/i }));

    await waitFor(() => {
      expect(requestPlan).toHaveBeenCalledWith(
        'demo-blueprint',
        'movie-1',
        undefined
      );
    });
  });
});
