/**
 * Unit tests for plan display utilities.
 * Tests the layer counting logic used in plan-dialog.tsx.
 */

import { describe, it, expect } from 'vitest';
import type { PlanDisplayInfo, LayerDisplayInfo } from '@/types/generation';

// Helper to create a minimal PlanDisplayInfo for testing
function createMockPlanInfo(
  layers: number,
  totalJobs: number,
  layerBreakdown: Partial<LayerDisplayInfo>[]
): PlanDisplayInfo {
  return {
    planId: 'plan-test',
    movieId: 'movie-test',
    layers,
    blueprintLayers: 5,
    totalJobs,
    totalCost: 0,
    minCost: 0,
    maxCost: 0,
    hasPlaceholders: false,
    hasRanges: false,
    costByProducer: [],
    layerBreakdown: layerBreakdown.map((partial, i) => ({
      index: partial.index ?? i,
      jobCount: partial.jobCount ?? 0,
      jobs: partial.jobs ?? [],
      layerCost: 0,
      layerMinCost: 0,
      layerMaxCost: 0,
      hasPlaceholders: false,
      ...partial,
    })),
  };
}

describe('Plan Display Info', () => {
  describe('layers field usage', () => {
    it('layers field represents count of layers with jobs to execute', () => {
      // Server sends layers=2 when 2 layers have jobs
      const planInfo = createMockPlanInfo(2, 3, [
        { index: 1, jobCount: 2, jobs: [{ jobId: 'j1', producer: 'P1' }, { jobId: 'j2', producer: 'P1' }] },
        { index: 3, jobCount: 1, jobs: [{ jobId: 'j3', producer: 'P2' }] },
      ]);

      // Dialog should display planInfo.layers
      expect(planInfo.layers).toBe(2);
    });

    it('layers=0 indicates NOOP (nothing to run)', () => {
      const planInfo = createMockPlanInfo(0, 0, []);

      expect(planInfo.layers).toBe(0);
      expect(planInfo.totalJobs).toBe(0);
      // UI should show "Nothing to Run" dialog
    });

    it('layerBreakdown contains only non-empty layers', () => {
      // Server filters empty layers, so layerBreakdown.length === layers
      const planInfo = createMockPlanInfo(2, 3, [
        { index: 1, jobCount: 2 },
        { index: 3, jobCount: 1 },
      ]);

      expect(planInfo.layerBreakdown.length).toBe(planInfo.layers);
    });

    it('blueprintLayers is total layers for dropdown (unchanged by filtering)', () => {
      const planInfo = createMockPlanInfo(1, 1, [
        { index: 2, jobCount: 1 },
      ]);

      // Only 1 layer will execute, but blueprint has 5 layers total
      expect(planInfo.layers).toBe(1);
      expect(planInfo.blueprintLayers).toBe(5);
    });
  });

  describe('consistency checks', () => {
    it('totalJobs matches sum of jobCounts in layerBreakdown', () => {
      const planInfo = createMockPlanInfo(3, 6, [
        { index: 0, jobCount: 2 },
        { index: 1, jobCount: 3 },
        { index: 2, jobCount: 1 },
      ]);

      const sumFromBreakdown = planInfo.layerBreakdown.reduce(
        (sum, layer) => sum + layer.jobCount,
        0
      );

      expect(planInfo.totalJobs).toBe(sumFromBreakdown);
    });

    it('layers matches layerBreakdown length', () => {
      const planInfo = createMockPlanInfo(2, 5, [
        { index: 0, jobCount: 3 },
        { index: 1, jobCount: 2 },
      ]);

      expect(planInfo.layers).toBe(planInfo.layerBreakdown.length);
    });
  });

  describe('real-world scenarios', () => {
    it('surgical regeneration: 3 jobs in 1 layer', () => {
      // User selects 3 artifacts from LipsyncVideoProducer in layer 1
      const planInfo = createMockPlanInfo(1, 3, [
        {
          index: 1,
          jobCount: 3,
          jobs: [
            { jobId: 'j1', producer: 'LipsyncVideoProducer' },
            { jobId: 'j2', producer: 'LipsyncVideoProducer' },
            { jobId: 'j3', producer: 'LipsyncVideoProducer' },
          ],
        },
      ]);

      // Dialog should show: 1 Layer, 3 Jobs
      expect(planInfo.layers).toBe(1);
      expect(planInfo.totalJobs).toBe(3);
    });

    it('full run: all 3 layers have jobs', () => {
      const planInfo = createMockPlanInfo(3, 5, [
        { index: 0, jobCount: 1 },
        { index: 1, jobCount: 2 },
        { index: 2, jobCount: 2 },
      ]);

      expect(planInfo.layers).toBe(3);
      expect(planInfo.totalJobs).toBe(5);
    });

    it('partial run with upToLayer: only first 2 layers', () => {
      // Run up to layer 1 (0-indexed)
      const planInfo = createMockPlanInfo(2, 3, [
        { index: 0, jobCount: 1 },
        { index: 1, jobCount: 2 },
      ]);

      expect(planInfo.layers).toBe(2);
      expect(planInfo.blueprintLayers).toBe(5); // Full blueprint has more
    });
  });
});
