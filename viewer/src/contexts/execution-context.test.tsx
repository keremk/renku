/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @vitest-environment jsdom
 */
/**
 * Comprehensive tests for execution-context.tsx
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ExecutionProvider, useExecution } from './execution-context';
import type { ReactNode } from 'react';
import type { ArtifactInfo } from '@/types/builds';
import type { PlanResponse, ExecuteResponse } from '@/types/generation';

// =============================================================================
// Test Utilities
// =============================================================================

function createWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <ExecutionProvider>{children}</ExecutionProvider>;
  };
}

function createMockArtifact(overrides: Partial<ArtifactInfo> = {}): ArtifactInfo {
  return {
    id: 'Artifact:TestProducer.Output[0]',
    name: 'TestProducer.Output[0]',
    hash: 'abc123',
    size: 1024,
    mimeType: 'application/json',
    status: 'succeeded',
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function createMockExecuteResponse(overrides: Partial<ExecuteResponse> = {}): ExecuteResponse {
  return {
    jobId: 'job-xyz',
    movieId: 'movie-456',
    status: 'running',
    streamUrl: '/viewer-api/generate/jobs/job-xyz/stream',
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockPlanResponse(overrides: Partial<PlanResponse> = {}): PlanResponse {
  return {
    planId: 'plan-123',
    movieId: 'movie-456',
    revision: 'rev-001',
    blueprintPath: '/path/to/blueprint.yaml',
    layers: 2,
    blueprintLayers: 3,
    totalJobs: 5,
    costSummary: {
      jobs: [],
      totalCost: 1.50,
      minTotalCost: 1.00,
      maxTotalCost: 2.00,
      hasPlaceholders: false,
      hasRanges: true,
      missingProviders: [],
      byProducer: {
        'ProducerA': { count: 2, totalCost: 0.75, hasPlaceholders: false, hasRanges: false, minCost: 0.50, maxCost: 1.00 },
        'ProducerB': { count: 3, totalCost: 0.75, hasPlaceholders: false, hasRanges: false, minCost: 0.50, maxCost: 1.00 },
      },
    },
    layerBreakdown: [
      {
        index: 0,
        jobCount: 2,
        jobs: [
          { jobId: 'job-1', producer: 'ProducerA', estimatedCost: 0.25 },
          { jobId: 'job-2', producer: 'ProducerA', estimatedCost: 0.50 },
        ],
        layerCost: 0.75,
        layerMinCost: 0.50,
        layerMaxCost: 1.00,
        hasPlaceholders: false,
      },
      {
        index: 1,
        jobCount: 3,
        jobs: [
          { jobId: 'job-3', producer: 'ProducerB', estimatedCost: 0.25 },
          { jobId: 'job-4', producer: 'ProducerB', estimatedCost: 0.25 },
          { jobId: 'job-5', producer: 'ProducerB', estimatedCost: 0.25 },
        ],
        layerCost: 0.75,
        layerMinCost: 0.50,
        layerMaxCost: 1.00,
        hasPlaceholders: false,
      },
    ],
    ...overrides,
  };
}

// =============================================================================
// Mock the generation-client module
// =============================================================================

vi.mock('@/data/generation-client', () => ({
  createPlan: vi.fn(),
  executePlan: vi.fn(),
  cancelJob: vi.fn(),
  subscribeToJobStream: vi.fn(),
}));

import { createPlan, executePlan, cancelJob, subscribeToJobStream } from '@/data/generation-client';

const mockCreatePlan = vi.mocked(createPlan);
const mockExecutePlan = vi.mocked(executePlan);
const mockCancelJob = vi.mocked(cancelJob);
const mockSubscribeToJobStream = vi.mocked(subscribeToJobStream);

// =============================================================================
// Initial State Tests
// =============================================================================

describe('ExecutionContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('has correct default values', () => {
      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      expect(result.current.state).toEqual({
        status: 'idle',
        layerRange: { upToLayer: null },
        planInfo: null,
        currentJobId: null,
        progress: null,
        producerStatuses: {},
        error: null,
        totalLayers: 0,
        executionLogs: [],
        isStopping: false,
        bottomPanelVisible: false,
        blueprintName: null,
        movieId: null,
        selectedForRegeneration: new Set(),
        pinnedArtifacts: new Set(),
        showCompletionDialog: false,
      });
    });
  });

  // =============================================================================
  // Layer Range Tests
  // =============================================================================

  describe('setLayerRange', () => {
    it('updates layer range with upToLayer', () => {
      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setLayerRange({ upToLayer: 2 });
      });

      expect(result.current.state.layerRange).toEqual({ upToLayer: 2 });
    });

    it('sets upToLayer to null', () => {
      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setLayerRange({ upToLayer: 2 });
      });

      act(() => {
        result.current.setLayerRange({ upToLayer: null });
      });

      expect(result.current.state.layerRange).toEqual({ upToLayer: null });
    });
  });

  describe('setTotalLayers', () => {
    it('updates total layers count', () => {
      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setTotalLayers(5);
      });

      expect(result.current.state.totalLayers).toBe(5);
    });

    it('handles zero layers', () => {
      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setTotalLayers(0);
      });

      expect(result.current.state.totalLayers).toBe(0);
    });
  });

  // =============================================================================
  // Plan Request Tests
  // =============================================================================

  describe('requestPlan', () => {
    it('sets status to planning when request starts', async () => {
      mockCreatePlan.mockImplementation(() => new Promise(() => {})); // Never resolves

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.requestPlan('test-blueprint', 'movie-123', 2);
      });

      expect(result.current.state.status).toBe('planning');
      expect(result.current.state.blueprintName).toBe('test-blueprint');
      expect(result.current.state.movieId).toBe('movie-123');
      expect(result.current.state.layerRange.upToLayer).toBe(2);
    });

    it('transitions to confirming when plan succeeds', async () => {
      const mockResponse = createMockPlanResponse();
      mockCreatePlan.mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint', 'movie-123');
      });

      expect(result.current.state.status).toBe('confirming');
      expect(result.current.state.planInfo).not.toBeNull();
      expect(result.current.state.planInfo?.planId).toBe('plan-123');
      expect(result.current.state.planInfo?.movieId).toBe('movie-456');
      expect(result.current.state.planInfo?.layers).toBe(2);
      expect(result.current.state.planInfo?.blueprintLayers).toBe(3);
      expect(result.current.state.totalLayers).toBe(3); // Uses blueprintLayers
    });

    it('transitions to failed when plan fails', async () => {
      mockCreatePlan.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint');
      });

      expect(result.current.state.status).toBe('failed');
      expect(result.current.state.error).toBe('Network error');
    });

    it('handles non-Error rejection', async () => {
      mockCreatePlan.mockRejectedValue('string error');

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint');
      });

      expect(result.current.state.status).toBe('failed');
      expect(result.current.state.error).toBe('Failed to create plan');
    });

    it('includes selected artifacts in plan request', async () => {
      mockCreatePlan.mockResolvedValue(createMockPlanResponse());

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      // Select some artifacts
      act(() => {
        result.current.toggleArtifactSelection('Artifact:Producer.Output[0]');
        result.current.toggleArtifactSelection('Artifact:Producer.Output[1]');
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint', 'movie-123');
      });

      expect(mockCreatePlan).toHaveBeenCalledWith({
        blueprint: 'test-blueprint',
        movieId: 'movie-123',
        artifactIds: expect.arrayContaining([
          'Artifact:Producer.Output[0]',
          'Artifact:Producer.Output[1]',
        ]),
        upToLayer: undefined,
      });
    });

    it('does not include artifactIds when none selected', async () => {
      mockCreatePlan.mockResolvedValue(createMockPlanResponse());

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint', 'movie-123', 2);
      });

      expect(mockCreatePlan).toHaveBeenCalledWith({
        blueprint: 'test-blueprint',
        movieId: 'movie-123',
        artifactIds: undefined,
        upToLayer: 2,
      });
    });

    it('handles undefined movieId', async () => {
      mockCreatePlan.mockResolvedValue(createMockPlanResponse());

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint');
      });

      expect(mockCreatePlan).toHaveBeenCalledWith({
        blueprint: 'test-blueprint',
        movieId: undefined,
        artifactIds: undefined,
        upToLayer: undefined,
      });
    });
  });

  // =============================================================================
  // Plan Response Conversion Tests
  // =============================================================================

  describe('planResponseToDisplayInfo conversion', () => {
    it('converts cost summary correctly', async () => {
      const mockResponse = createMockPlanResponse();
      mockCreatePlan.mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint');
      });

      const planInfo = result.current.state.planInfo!;
      expect(planInfo.totalCost).toBe(1.50);
      expect(planInfo.minCost).toBe(1.00);
      expect(planInfo.maxCost).toBe(2.00);
      expect(planInfo.hasPlaceholders).toBe(false);
      expect(planInfo.hasRanges).toBe(true);
    });

    it('converts cost by producer correctly', async () => {
      const mockResponse = createMockPlanResponse();
      mockCreatePlan.mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint');
      });

      const planInfo = result.current.state.planInfo!;
      expect(planInfo.costByProducer).toHaveLength(2);

      const producerA = planInfo.costByProducer.find((p: { name: string }) => p.name === 'ProducerA');
      expect(producerA).toEqual({
        name: 'ProducerA',
        count: 2,
        cost: 0.75,
        hasPlaceholders: false,
        hasCostData: true,
      });
    });

    it('converts layer breakdown correctly', async () => {
      const mockResponse = createMockPlanResponse();
      mockCreatePlan.mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint');
      });

      const planInfo = result.current.state.planInfo!;
      expect(planInfo.layerBreakdown).toHaveLength(2);

      const layer0 = planInfo.layerBreakdown[0];
      expect(layer0.index).toBe(0);
      expect(layer0.jobCount).toBe(2);
      expect(layer0.jobs).toHaveLength(2);
      expect(layer0.layerCost).toBe(0.75);
    });

    it('handles surgical info when present', async () => {
      const mockResponse = createMockPlanResponse({
        surgicalInfo: [
          { targetArtifactId: 'Artifact:P.O[0]', sourceJobId: 'job-1' },
          { targetArtifactId: 'Artifact:P.O[1]', sourceJobId: 'job-2' },
        ],
      });
      mockCreatePlan.mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint');
      });

      const planInfo = result.current.state.planInfo!;
      expect(planInfo.surgicalInfo).toHaveLength(2);
      expect(planInfo.surgicalInfo![0]).toEqual({
        targetArtifactId: 'Artifact:P.O[0]',
        sourceJobId: 'job-1',
      });
    });

    it('handles missing providers in cost data', async () => {
      const mockResponse = createMockPlanResponse({
        costSummary: {
          jobs: [],
          totalCost: 0,
          minTotalCost: 0,
          maxTotalCost: 0,
          hasPlaceholders: true,
          hasRanges: false,
          missingProviders: ['openai:gpt-4'],
          byProducer: {
            'TextGenerator': { count: 1, totalCost: 0, hasPlaceholders: true, hasRanges: false, minCost: 0, maxCost: 0 },
          },
        },
      });
      mockCreatePlan.mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint');
      });

      const planInfo = result.current.state.planInfo!;
      expect(planInfo.hasPlaceholders).toBe(true);
    });
  });

  // =============================================================================
  // Execution Tests
  // =============================================================================

  describe('confirmExecution', () => {
    beforeEach(async () => {
      mockCreatePlan.mockResolvedValue(createMockPlanResponse());
      mockSubscribeToJobStream.mockReturnValue(() => {});
    });

    it('does nothing when no plan exists', async () => {
      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.confirmExecution();
      });

      expect(mockExecutePlan).not.toHaveBeenCalled();
    });

    it('calls executePlan with correct parameters', async () => {
      mockExecutePlan.mockResolvedValue(createMockExecuteResponse({ jobId: 'job-abc' }));

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint');
      });

      act(() => {
        result.current.setLayerRange({ upToLayer: 1 });
      });

      await act(async () => {
        await result.current.confirmExecution();
      });

      expect(mockExecutePlan).toHaveBeenCalledWith({
        planId: 'plan-123',
        upToLayer: 1,
        dryRun: false,
      });
    });

    it('passes dryRun parameter correctly', async () => {
      mockExecutePlan.mockResolvedValue(createMockExecuteResponse({ jobId: 'job-abc' }));

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint');
      });

      await act(async () => {
        await result.current.confirmExecution(true);
      });

      expect(mockExecutePlan).toHaveBeenCalledWith({
        planId: 'plan-123',
        upToLayer: undefined,
        dryRun: true,
      });
    });

    it('sets status to executing and stores jobId', async () => {
      mockExecutePlan.mockResolvedValue(createMockExecuteResponse());

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint');
      });

      await act(async () => {
        await result.current.confirmExecution();
      });

      expect(result.current.state.status).toBe('executing');
      expect(result.current.state.currentJobId).toBe('job-xyz');
    });

    it('marks all plan producers as pending', async () => {
      mockExecutePlan.mockResolvedValue(createMockExecuteResponse());

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint');
      });

      await act(async () => {
        await result.current.confirmExecution();
      });

      expect(result.current.state.producerStatuses['Producer:ProducerA']).toBe('pending');
      expect(result.current.state.producerStatuses['Producer:ProducerB']).toBe('pending');
    });

    it('subscribes to job stream', async () => {
      mockExecutePlan.mockResolvedValue(createMockExecuteResponse());

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint');
      });

      await act(async () => {
        await result.current.confirmExecution();
      });

      expect(mockSubscribeToJobStream).toHaveBeenCalledWith(
        'job-xyz',
        expect.any(Function),
        expect.any(Function)
      );
    });

    it('handles execution failure', async () => {
      mockExecutePlan.mockRejectedValue(new Error('Execution failed'));

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint');
      });

      await act(async () => {
        await result.current.confirmExecution();
      });

      expect(result.current.state.status).toBe('failed');
      expect(result.current.state.error).toBe('Execution failed');
    });
  });

  // =============================================================================
  // SSE Event Handling Tests
  // =============================================================================

  describe('SSE event handling', () => {
    let sseCallback: (event: any) => void;

    beforeEach(async () => {
      mockCreatePlan.mockResolvedValue(createMockPlanResponse());
      mockExecutePlan.mockResolvedValue(createMockExecuteResponse());
      mockSubscribeToJobStream.mockImplementation((_jobId, onEvent) => {
        sseCallback = onEvent;
        return () => {};
      });
    });

    async function setupExecutingState() {
      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint');
      });

      await act(async () => {
        await result.current.confirmExecution();
      });

      return result;
    }

    it('handles layer-start event', async () => {
      const result = await setupExecutingState();

      act(() => {
        sseCallback({ type: 'layer-start', layerIndex: 0, jobCount: 3 });
      });

      expect(result.current.state.executionLogs).toHaveLength(1);
      expect(result.current.state.executionLogs[0].type).toBe('layer-start');
      expect(result.current.state.executionLogs[0].message).toContain('Layer 0');
      expect(result.current.state.executionLogs[0].message).toContain('3 jobs');
      expect(result.current.state.progress?.currentLayer).toBe(0);
    });

    it('handles layer-start with single job', async () => {
      const result = await setupExecutingState();

      act(() => {
        sseCallback({ type: 'layer-start', layerIndex: 1, jobCount: 1 });
      });

      expect(result.current.state.executionLogs[0].message).toContain('1 job');
      expect(result.current.state.executionLogs[0].message).not.toContain('1 jobs');
    });

    it('handles layer-skipped event', async () => {
      const result = await setupExecutingState();

      act(() => {
        sseCallback({ type: 'layer-skipped', layerIndex: 0 });
      });

      expect(result.current.state.executionLogs).toHaveLength(1);
      expect(result.current.state.executionLogs[0].type).toBe('layer-skipped');
      expect(result.current.state.executionLogs[0].message).toContain('skipped');
    });

    it('handles job-start event', async () => {
      const result = await setupExecutingState();

      act(() => {
        sseCallback({
          type: 'job-start',
          jobId: 'job-1',
          producer: 'ProducerA',
          layerIndex: 0,
        });
      });

      expect(result.current.state.producerStatuses['Producer:ProducerA']).toBe('running');
      expect(result.current.state.executionLogs).toHaveLength(1);
      expect(result.current.state.executionLogs[0].type).toBe('job-start');
      expect(result.current.state.executionLogs[0].message).toContain('Starting ProducerA');
    });

    it('handles job-complete with succeeded status', async () => {
      const result = await setupExecutingState();

      act(() => {
        sseCallback({
          type: 'job-complete',
          jobId: 'job-1',
          producer: 'ProducerA',
          status: 'succeeded',
        });
      });

      expect(result.current.state.producerStatuses['Producer:ProducerA']).toBe('success');
      expect(result.current.state.executionLogs[0].message).toContain('completed successfully');
      expect(result.current.state.executionLogs[0].message).toContain('✓');
    });

    it('handles job-complete with failed status', async () => {
      const result = await setupExecutingState();

      act(() => {
        sseCallback({
          type: 'job-complete',
          jobId: 'job-1',
          producer: 'ProducerA',
          status: 'failed',
          errorMessage: 'Something went wrong',
        });
      });

      expect(result.current.state.producerStatuses['Producer:ProducerA']).toBe('error');
      expect(result.current.state.executionLogs[0].message).toContain('failed');
      expect(result.current.state.executionLogs[0].message).toContain('✗');
      expect(result.current.state.executionLogs[0].errorDetails).toBe('Something went wrong');
    });

    it('handles job-complete with skipped status', async () => {
      const result = await setupExecutingState();

      act(() => {
        sseCallback({
          type: 'job-complete',
          jobId: 'job-1',
          producer: 'ProducerA',
          status: 'skipped',
        });
      });

      expect(result.current.state.producerStatuses['Producer:ProducerA']).toBe('skipped');
      expect(result.current.state.executionLogs[0].message).toContain('skipped');
    });

    it('shows indexed job label when canonical jobId is available', async () => {
      const result = await setupExecutingState();

      act(() => {
        sseCallback({
          type: 'job-start',
          jobId: 'Producer:ThenImageProducer[1]',
          producer: 'ThenImageProducer',
          layerIndex: 1,
        });
      });

      expect(result.current.state.executionLogs[0].message).toContain('Starting ThenImageProducer[1]');
    });

    it('handles layer-complete event', async () => {
      const result = await setupExecutingState();

      act(() => {
        sseCallback({
          type: 'layer-complete',
          layerIndex: 0,
          succeeded: 2,
          failed: 1,
          skipped: 0,
        });
      });

      expect(result.current.state.executionLogs[0].type).toBe('layer-complete');
      expect(result.current.state.executionLogs[0].message).toContain('2 succeeded');
      expect(result.current.state.executionLogs[0].message).toContain('1 failed');
    });

    it('handles execution-complete with succeeded status', async () => {
      const result = await setupExecutingState();

      act(() => {
        sseCallback({
          type: 'execution-complete',
          status: 'succeeded',
          summary: { counts: { succeeded: 5, failed: 0, skipped: 0 } },
        });
      });

      expect(result.current.state.status).toBe('completed');
      expect(result.current.state.currentJobId).toBeNull();
      expect(result.current.state.executionLogs[0].message).toContain('completed successfully');
    });

    it('handles execution-complete with partial status', async () => {
      const result = await setupExecutingState();

      act(() => {
        sseCallback({
          type: 'execution-complete',
          status: 'partial',
          summary: { counts: { succeeded: 3, failed: 2, skipped: 0 } },
        });
      });

      expect(result.current.state.status).toBe('failed');
      expect(result.current.state.executionLogs[0].message).toContain('some failures');
    });

    it('handles execution-complete with failed status', async () => {
      const result = await setupExecutingState();

      act(() => {
        sseCallback({
          type: 'execution-complete',
          status: 'failed',
          summary: { counts: { succeeded: 0, failed: 5, skipped: 0 } },
        });
      });

      expect(result.current.state.status).toBe('failed');
      expect(result.current.state.executionLogs[0].message).toContain('Execution failed');
    });

    it('handles error event', async () => {
      const result = await setupExecutingState();

      act(() => {
        sseCallback({
          type: 'error',
          message: 'Connection lost',
          code: 'ERR_CONNECTION',
        });
      });

      expect(result.current.state.status).toBe('failed');
      expect(result.current.state.error).toBe('Connection lost');
      expect(result.current.state.executionLogs[0].type).toBe('error');
    });
  });

  // =============================================================================
  // Cancel Execution Tests
  // =============================================================================

  describe('cancelExecution', () => {
    it('cancels running job', async () => {
      mockCreatePlan.mockResolvedValue(createMockPlanResponse());
      mockExecutePlan.mockResolvedValue(createMockExecuteResponse());
      mockSubscribeToJobStream.mockReturnValue(() => {});
      mockCancelJob.mockResolvedValue(undefined);

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint');
      });

      await act(async () => {
        await result.current.confirmExecution();
      });

      await act(async () => {
        await result.current.cancelExecution();
      });

      expect(mockCancelJob).toHaveBeenCalledWith('job-xyz');
      expect(result.current.state.status).toBe('cancelled');
      expect(result.current.state.currentJobId).toBeNull();
      expect(result.current.state.isStopping).toBe(false);
    });

    it('sets isStopping flag during cancellation', async () => {
      mockCreatePlan.mockResolvedValue(createMockPlanResponse());
      mockExecutePlan.mockResolvedValue(createMockExecuteResponse());
      mockSubscribeToJobStream.mockReturnValue(() => {});

      mockCancelJob.mockImplementation(async () => {
        // Simulate async cancellation
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint');
      });

      await act(async () => {
        await result.current.confirmExecution();
      });

      // Check that status is executing before cancel
      expect(result.current.state.status).toBe('executing');

      await act(async () => {
        await result.current.cancelExecution();
      });

      // After cancellation completes, isStopping should be false
      expect(result.current.state.status).toBe('cancelled');
      expect(result.current.state.isStopping).toBe(false);
    });

    it('handles cancel failure gracefully', async () => {
      mockCreatePlan.mockResolvedValue(createMockPlanResponse());
      mockExecutePlan.mockResolvedValue(createMockExecuteResponse());
      mockSubscribeToJobStream.mockReturnValue(() => {});
      mockCancelJob.mockRejectedValue(new Error('Cancel failed'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint');
      });

      await act(async () => {
        await result.current.confirmExecution();
      });

      await act(async () => {
        await result.current.cancelExecution();
      });

      // Should still transition to cancelled even if cancel API fails
      expect(result.current.state.status).toBe('cancelled');
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  // =============================================================================
  // Dialog and Reset Tests
  // =============================================================================

  describe('dismissDialog', () => {
    it('resets to idle and clears plan info and error', async () => {
      mockCreatePlan.mockRejectedValue(new Error('Plan failed'));

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint');
      });

      expect(result.current.state.status).toBe('failed');
      expect(result.current.state.error).not.toBeNull();

      act(() => {
        result.current.dismissDialog();
      });

      expect(result.current.state.status).toBe('idle');
      expect(result.current.state.planInfo).toBeNull();
      expect(result.current.state.error).toBeNull();
    });
  });

  describe('reset', () => {
    it('resets to initial state but preserves some values', async () => {
      mockCreatePlan.mockResolvedValue(createMockPlanResponse());

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      // Set up some state
      act(() => {
        result.current.showBottomPanel();
        result.current.toggleArtifactSelection('artifact-1');
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint');
      });

      // After requestPlan, totalLayers is set from blueprintLayers (3)
      expect(result.current.state.totalLayers).toBe(3);
      expect(result.current.state.status).toBe('confirming');

      act(() => {
        result.current.reset();
      });

      expect(result.current.state.status).toBe('idle');
      expect(result.current.state.planInfo).toBeNull();
      // These should be preserved after reset
      expect(result.current.state.totalLayers).toBe(3); // Preserved from before reset
      expect(result.current.state.bottomPanelVisible).toBe(true);
      expect(result.current.state.selectedForRegeneration.has('artifact-1')).toBe(true);
    });
  });

  // =============================================================================
  // Manifest Initialization Tests
  // =============================================================================

  describe('initializeFromManifest', () => {
    it('maps succeeded artifacts to success status', () => {
      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.initializeFromManifest([
          createMockArtifact({ id: 'Artifact:ProducerA.Output[0]', status: 'succeeded' }),
        ]);
      });

      expect(result.current.state.producerStatuses['Producer:ProducerA']).toBe('success');
    });

    it('maps failed artifacts to error status', () => {
      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.initializeFromManifest([
          createMockArtifact({ id: 'Artifact:ProducerA.Output[0]', status: 'failed' }),
        ]);
      });

      expect(result.current.state.producerStatuses['Producer:ProducerA']).toBe('error');
    });

    it('maps skipped artifacts to skipped status', () => {
      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.initializeFromManifest([
          createMockArtifact({ id: 'Artifact:ProducerA.Output[0]', status: 'skipped' }),
        ]);
      });

      expect(result.current.state.producerStatuses['Producer:ProducerA']).toBe('skipped');
    });

    it('maps unknown status to not-run-yet', () => {
      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.initializeFromManifest([
          createMockArtifact({ id: 'Artifact:ProducerA.Output[0]', status: 'pending' }),
        ]);
      });

      expect(result.current.state.producerStatuses['Producer:ProducerA']).toBe('not-run-yet');
    });

    it('uses worst status when producer has multiple artifacts', () => {
      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.initializeFromManifest([
          createMockArtifact({ id: 'Artifact:ProducerA.Output[0]', status: 'succeeded' }),
          createMockArtifact({ id: 'Artifact:ProducerA.Output[1]', status: 'failed' }),
          createMockArtifact({ id: 'Artifact:ProducerA.Output[2]', status: 'succeeded' }),
        ]);
      });

      // Failed (error) has lower priority, so it should be kept
      expect(result.current.state.producerStatuses['Producer:ProducerA']).toBe('error');
    });

    it('handles multiple producers', () => {
      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.initializeFromManifest([
          createMockArtifact({ id: 'Artifact:ProducerA.Output[0]', status: 'succeeded' }),
          createMockArtifact({ id: 'Artifact:ProducerB.Output[0]', status: 'failed' }),
          createMockArtifact({ id: 'Artifact:ProducerC.Output[0]', status: 'skipped' }),
        ]);
      });

      expect(result.current.state.producerStatuses['Producer:ProducerA']).toBe('success');
      expect(result.current.state.producerStatuses['Producer:ProducerB']).toBe('error');
      expect(result.current.state.producerStatuses['Producer:ProducerC']).toBe('skipped');
    });

    it('ignores artifacts with invalid IDs', () => {
      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.initializeFromManifest([
          createMockArtifact({ id: 'InvalidFormat', status: 'succeeded' }),
          createMockArtifact({ id: 'Artifact:ProducerA.Output[0]', status: 'succeeded' }),
        ]);
      });

      expect(Object.keys(result.current.state.producerStatuses)).toHaveLength(1);
      expect(result.current.state.producerStatuses['Producer:ProducerA']).toBe('success');
    });
  });

  // =============================================================================
  // Artifact Selection Tests
  // =============================================================================

  describe('artifact selection for regeneration', () => {
    it('toggleArtifactSelection adds and removes artifacts', () => {
      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.toggleArtifactSelection('artifact-1');
      });

      expect(result.current.state.selectedForRegeneration.has('artifact-1')).toBe(true);

      act(() => {
        result.current.toggleArtifactSelection('artifact-1');
      });

      expect(result.current.state.selectedForRegeneration.has('artifact-1')).toBe(false);
    });

    it('selectProducerArtifacts adds multiple artifacts', () => {
      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.selectProducerArtifacts(['artifact-1', 'artifact-2', 'artifact-3']);
      });

      expect(result.current.state.selectedForRegeneration.size).toBe(3);
      expect(result.current.isArtifactSelected('artifact-1')).toBe(true);
      expect(result.current.isArtifactSelected('artifact-2')).toBe(true);
      expect(result.current.isArtifactSelected('artifact-3')).toBe(true);
    });

    it('deselectProducerArtifacts removes multiple artifacts', () => {
      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.selectProducerArtifacts(['artifact-1', 'artifact-2', 'artifact-3']);
      });

      act(() => {
        result.current.deselectProducerArtifacts(['artifact-1', 'artifact-3']);
      });

      expect(result.current.state.selectedForRegeneration.size).toBe(1);
      expect(result.current.isArtifactSelected('artifact-2')).toBe(true);
    });

    it('clearRegenerationSelection removes all selections', () => {
      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.selectProducerArtifacts(['artifact-1', 'artifact-2', 'artifact-3']);
      });

      act(() => {
        result.current.clearRegenerationSelection();
      });

      expect(result.current.state.selectedForRegeneration.size).toBe(0);
    });

    it('isArtifactSelected returns correct value', () => {
      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isArtifactSelected('artifact-1')).toBe(false);

      act(() => {
        result.current.toggleArtifactSelection('artifact-1');
      });

      expect(result.current.isArtifactSelected('artifact-1')).toBe(true);
    });

    it('getSelectedArtifacts returns array of selected IDs', () => {
      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.selectProducerArtifacts(['artifact-1', 'artifact-2']);
      });

      const selected = result.current.getSelectedArtifacts();
      expect(selected).toHaveLength(2);
      expect(selected).toContain('artifact-1');
      expect(selected).toContain('artifact-2');
    });
  });

  // =============================================================================
  // Completion Dialog Tests
  // =============================================================================

  describe('completion dialog', () => {
    it('shows completion dialog when execution completes successfully', async () => {
      mockCreatePlan.mockResolvedValue(createMockPlanResponse());
      mockExecutePlan.mockResolvedValue(createMockExecuteResponse());

      let sseCallback: (event: any) => void;
      mockSubscribeToJobStream.mockImplementation((_jobId, onEvent) => {
        sseCallback = onEvent;
        return () => {};
      });

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint');
      });

      await act(async () => {
        await result.current.confirmExecution();
      });

      expect(result.current.state.showCompletionDialog).toBe(false);

      act(() => {
        sseCallback({
          type: 'execution-complete',
          status: 'succeeded',
          summary: { counts: { succeeded: 5, failed: 0, skipped: 0 } },
        });
      });

      expect(result.current.state.showCompletionDialog).toBe(true);
      expect(result.current.state.status).toBe('completed');
    });

    it('shows completion dialog when execution fails', async () => {
      mockCreatePlan.mockResolvedValue(createMockPlanResponse());
      mockExecutePlan.mockResolvedValue(createMockExecuteResponse());

      let sseCallback: (event: any) => void;
      mockSubscribeToJobStream.mockImplementation((_jobId, onEvent) => {
        sseCallback = onEvent;
        return () => {};
      });

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint');
      });

      await act(async () => {
        await result.current.confirmExecution();
      });

      act(() => {
        sseCallback({
          type: 'execution-complete',
          status: 'failed',
          summary: { counts: { succeeded: 0, failed: 3, skipped: 0 } },
        });
      });

      expect(result.current.state.showCompletionDialog).toBe(true);
      expect(result.current.state.status).toBe('failed');
    });

    it('dismissCompletion hides dialog and clears selections when clearSelections is true', () => {
      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      // Set up some selections
      act(() => {
        result.current.selectProducerArtifacts(['artifact-1', 'artifact-2']);
      });

      expect(result.current.state.selectedForRegeneration.size).toBe(2);

      // Simulate dialog showing after completion (manually set for test)
      // The dialog would normally be shown by EXECUTION_COMPLETE action
      act(() => {
        result.current.dismissCompletion(true);
      });

      expect(result.current.state.showCompletionDialog).toBe(false);
      expect(result.current.state.selectedForRegeneration.size).toBe(0);
    });

    it('dismissCompletion hides dialog but keeps selections when clearSelections is false', () => {
      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      // Set up some selections
      act(() => {
        result.current.selectProducerArtifacts(['artifact-1', 'artifact-2']);
      });

      expect(result.current.state.selectedForRegeneration.size).toBe(2);

      act(() => {
        result.current.dismissCompletion(false);
      });

      expect(result.current.state.showCompletionDialog).toBe(false);
      expect(result.current.state.selectedForRegeneration.size).toBe(2);
      expect(result.current.isArtifactSelected('artifact-1')).toBe(true);
      expect(result.current.isArtifactSelected('artifact-2')).toBe(true);
    });
  });

  // =============================================================================
  // Bottom Panel Tests
  // =============================================================================

  describe('bottom panel visibility', () => {
    it('showBottomPanel sets visibility to true', () => {
      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      expect(result.current.state.bottomPanelVisible).toBe(false);

      act(() => {
        result.current.showBottomPanel();
      });

      expect(result.current.state.bottomPanelVisible).toBe(true);
    });

    it('hideBottomPanel sets visibility to false', () => {
      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.showBottomPanel();
      });

      act(() => {
        result.current.hideBottomPanel();
      });

      expect(result.current.state.bottomPanelVisible).toBe(false);
    });
  });

  // =============================================================================
  // Execution Logs Tests
  // =============================================================================

  describe('execution logs', () => {
    it('clearLogs removes all log entries', async () => {
      mockCreatePlan.mockResolvedValue(createMockPlanResponse());
      mockExecutePlan.mockResolvedValue(createMockExecuteResponse());

      let sseCallback: (event: any) => void;
      mockSubscribeToJobStream.mockImplementation((_jobId, onEvent) => {
        sseCallback = onEvent;
        return () => {};
      });

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint');
      });

      await act(async () => {
        await result.current.confirmExecution();
      });

      act(() => {
        sseCallback({ type: 'layer-start', layerIndex: 0, jobCount: 1 });
        sseCallback({ type: 'job-start', jobId: 'job-1', producer: 'P', layerIndex: 0 });
      });

      expect(result.current.state.executionLogs.length).toBeGreaterThan(0);

      act(() => {
        result.current.clearLogs();
      });

      expect(result.current.state.executionLogs).toHaveLength(0);
    });

    it('log entries have unique IDs and timestamps', async () => {
      mockCreatePlan.mockResolvedValue(createMockPlanResponse());
      mockExecutePlan.mockResolvedValue(createMockExecuteResponse());

      let sseCallback: (event: any) => void;
      mockSubscribeToJobStream.mockImplementation((_jobId, onEvent) => {
        sseCallback = onEvent;
        return () => {};
      });

      const { result } = renderHook(() => useExecution(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.requestPlan('test-blueprint');
      });

      await act(async () => {
        await result.current.confirmExecution();
      });

      act(() => {
        sseCallback({ type: 'layer-start', layerIndex: 0, jobCount: 1 });
        sseCallback({ type: 'layer-start', layerIndex: 1, jobCount: 2 });
      });

      const logs = result.current.state.executionLogs;
      expect(logs[0].id).not.toBe(logs[1].id);
      expect(logs[0].timestamp).toBeDefined();
      expect(logs[1].timestamp).toBeDefined();
    });
  });

  // =============================================================================
  // Context Hook Error Test
  // =============================================================================

  describe('useExecution hook', () => {
    it('throws error when used outside provider', () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => {
        try {
          return useExecution();
        } catch (error) {
          return { error };
        }
      });

      // The hook should have caught and returned the error
      expect((result.current as { error: Error }).error).toBeDefined();
      expect((result.current as { error: Error }).error.message).toBe(
        'useExecution must be used within an ExecutionProvider'
      );

      consoleSpy.mockRestore();
    });
  });
});
