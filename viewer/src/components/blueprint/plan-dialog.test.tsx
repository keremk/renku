/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlanDialog } from './plan-dialog';
import type { PlanDisplayInfo } from '@/types/generation';

const executionMock = vi.hoisted(() => ({
  useExecution: vi.fn(),
}));

vi.mock('@/contexts/execution-context', () => ({
  useExecution: executionMock.useExecution,
}));

function createPlanInfo(
  overrides: Partial<PlanDisplayInfo> = {}
): PlanDisplayInfo {
  return {
    planId: 'plan-123',
    movieId: 'movie-456',
    layers: 2,
    blueprintLayers: 4,
    totalJobs: 4,
    totalCost: 2.8,
    minCost: 2.8,
    maxCost: 2.8,
    hasPlaceholders: false,
    hasRanges: false,
    costByProducer: [
      {
        name: 'NowImageProducer',
        count: 2,
        cost: 0.6,
        hasPlaceholders: false,
        hasCostData: true,
      },
      {
        name: 'CelebrityVideoProducer.TogetherImageProducer',
        count: 1,
        cost: 0.7,
        hasPlaceholders: false,
        hasCostData: true,
      },
      {
        name: 'CelebrityVideoProducer.MeetingVideoProducer',
        count: 1,
        cost: 1.5,
        hasPlaceholders: false,
        hasCostData: true,
      },
    ],
    layerBreakdown: [
      {
        index: 0,
        jobCount: 2,
        jobs: [
          {
            jobId: 'job-now-0',
            producer: 'NowImageProducer',
            estimatedCost: 0.3,
          },
          {
            jobId: 'job-now-1',
            producer: 'NowImageProducer',
            estimatedCost: 0.3,
          },
        ],
        layerCost: 0.6,
        layerMinCost: 0.6,
        layerMaxCost: 0.6,
        hasPlaceholders: false,
      },
      {
        index: 1,
        jobCount: 2,
        jobs: [
          {
            jobId: 'job-together-0',
            producer: 'CelebrityVideoProducer.TogetherImageProducer',
            estimatedCost: 0.7,
          },
          {
            jobId: 'job-meeting-0',
            producer: 'CelebrityVideoProducer.MeetingVideoProducer',
            estimatedCost: 1.5,
          },
        ],
        layerCost: 2.2,
        layerMinCost: 2.2,
        layerMaxCost: 2.2,
        hasPlaceholders: false,
      },
    ],
    producerScheduling: [
      {
        producerId: 'Producer:NowImageProducer',
        mode: 'inherit',
        maxSelectableCount: 2,
        effectiveCountLimit: null,
        scheduledCount: 2,
        scheduledJobCount: 2,
        upstreamProducerIds: [],
        warnings: [],
      },
      {
        producerId: 'Producer:CelebrityVideoProducer.TogetherImageProducer',
        mode: 'inherit',
        maxSelectableCount: 1,
        effectiveCountLimit: null,
        scheduledCount: 1,
        scheduledJobCount: 1,
        upstreamProducerIds: ['Producer:NowImageProducer'],
        warnings: [],
      },
      {
        producerId: 'Producer:CelebrityVideoProducer.MeetingVideoProducer',
        mode: 'inherit',
        maxSelectableCount: 1,
        effectiveCountLimit: null,
        scheduledCount: 1,
        scheduledJobCount: 1,
        upstreamProducerIds: ['Producer:NowImageProducer'],
        warnings: [],
      },
    ],
    warnings: [],
    cliCommand: 'renku generate --blueprint=test --explain',
    ...overrides,
  };
}

function renderDialog(
  {
    stateOverrides,
    pinnedArtifacts = [],
  }: {
    stateOverrides?: Record<string, unknown>;
    pinnedArtifacts?: string[];
  } = {}
) {
  const confirmExecution = vi.fn();
  const dismissDialog = vi.fn();
  const clearLogs = vi.fn();
  const previewPlan = vi.fn().mockResolvedValue(createPlanInfo());

  executionMock.useExecution.mockReturnValue({
    state: {
      status: 'confirming',
      planInfo: createPlanInfo(),
      error: null,
      blueprintName: 'test-blueprint',
      movieId: 'movie-456',
      layerRange: { upToLayer: null },
      selectedForRegeneration: new Set(),
      pinnedArtifacts: new Set(pinnedArtifacts),
      producerOverrides: {},
      ...stateOverrides,
    },
    confirmExecution,
    dismissDialog,
    clearLogs,
    getPinnedArtifacts: () => pinnedArtifacts,
    previewPlan,
  });

  return {
    ...render(<PlanDialog />),
    confirmExecution,
    dismissDialog,
    clearLogs,
    previewPlan,
  };
}

describe('PlanDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('groups composite producers and shows only leaf labels inside the group', () => {
    renderDialog();

    expect(screen.getByText('Celebrity Video Producer')).toBeTruthy();
    expect(screen.getByText('Meeting Video Producer')).toBeTruthy();
    expect(screen.getByText('Together Image Producer')).toBeTruthy();
    expect(
      screen.queryByText('CelebrityVideoProducer.MeetingVideoProducer')
    ).toBeNull();
  });

  it('keeps the run dialog open with an inline invalid-plan error when replanning fails', async () => {
    const { previewPlan } = renderDialog();
    previewPlan.mockRejectedValue(
      new Error(
        'Request failed (400): {"error":{"message":"Producer overrides leave required upstream artifacts unavailable: Producer:CelebrityVideoProducer.MeetingVideoProducer requires Artifact:CelebrityVideo[0]"}}'
      )
    );

    const input = screen.getByRole('spinbutton', {
      name: 'Count for Now Image Producer',
    }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1' } });

    await waitFor(() => {
      expect(screen.getByText("Preview can't run yet")).toBeTruthy();
    });
    expect(screen.getAllByText('Confirm Execution').length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        'Showing the last runnable preview above. Raise the upstream count again, or lower the producer that depends on that missing output.'
      )
    ).toBeTruthy();
    expect(screen.getByText('Why?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run' }).hasAttribute('disabled')).toBe(
      true
    );
  });

  it('keeps the producer list visible when the preview would run nothing', () => {
    renderDialog({
      stateOverrides: {
        planInfo: createPlanInfo({
          layers: 0,
          totalJobs: 0,
          totalCost: 0,
          minCost: 0,
          maxCost: 0,
          costByProducer: [],
          layerBreakdown: [],
          producerScheduling: [
            {
              producerId: 'Producer:NowImageProducer',
              mode: 'disabled',
              maxSelectableCount: 2,
              effectiveCountLimit: 0,
              scheduledCount: 0,
              scheduledJobCount: 0,
              upstreamProducerIds: [],
              warnings: [],
            },
          ],
        }),
        producerOverrides: {
          'Producer:NowImageProducer': {
            enabled: false,
            count: 0,
          },
        },
      },
    });

    expect(screen.getByText('Nothing will run with these counts')).toBeTruthy();
    expect(screen.getByText('Now Image Producer')).toBeTruthy();
    expect(screen.queryByText('All Caught Up')).toBeNull();
  });

  it('updates the visible row count immediately when a draft value changes', () => {
    renderDialog();
    const input = screen.getByRole('spinbutton', {
      name: 'Count for Now Image Producer',
    }) as HTMLInputElement;

    fireEvent.change(input, { target: { value: '1' } });

    expect(input.value).toBe('1');
  });
});
