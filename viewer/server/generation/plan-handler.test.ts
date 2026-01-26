/**
 * Unit tests for plan-handler.ts - Plan building and layer counting.
 */

import { describe, it, expect } from 'vitest';
import type { ExecutionPlan, JobDescriptor, Manifest } from '@gorenku/core';
import type { PlanCostSummary, JobCostEstimate } from '@gorenku/providers';
import type { CachedPlan } from './types.js';
import { buildPlanResponse } from './plan-handler.js';

// Helper to create a mock job descriptor
function createMockJob(id: string, producer: string): JobDescriptor {
  return {
    jobId: id,
    producer,
    inputs: {},
    outputs: [],
    produces: [],
    provider: 'test-provider',
    providerModel: 'test-model',
    rateKey: 'test-rate',
  } as unknown as JobDescriptor;
}

// Helper to create a mock job cost entry
function createMockJobCost(jobId: string, cost: number): JobCostEstimate {
  return {
    jobId,
    producer: 'TestProducer',
    provider: 'test-provider',
    model: 'test-model',
    estimate: {
      cost,
      isPlaceholder: false,
    },
  };
}

// Helper to create a minimal mock cached plan
function createMockCachedPlan(
  layers: JobDescriptor[][],
  jobCosts: JobCostEstimate[] = []
): { cachedPlan: CachedPlan; plan: ExecutionPlan } {
  const plan: ExecutionPlan = {
    revision: 'rev-test',
    manifestBaseHash: 'hash-test',
    layers,
    createdAt: new Date().toISOString(),
    blueprintLayerCount: 5, // Total blueprint layers (for dropdown)
  };

  const costSummary: PlanCostSummary = {
    jobs: jobCosts,
    byProducer: new Map(),
    totalCost: jobCosts.reduce((sum, j) => sum + j.estimate.cost, 0),
    hasPlaceholders: false,
    hasRanges: false,
    minTotalCost: 0,
    maxTotalCost: 0,
    missingProviders: [],
  };

  const mockManifest: Manifest = {
    artefacts: {},
    revision: 'rev-test1',
    baseRevision: null,
    createdAt: new Date().toISOString(),
    inputs: {},
  };

  const cachedPlan: CachedPlan = {
    planId: 'plan-test',
    movieId: 'movie-test',
    plan,
    manifest: mockManifest,
    manifestHash: 'hash123',
    resolvedInputs: {},
    providerOptions: new Map(),
    blueprintPath: '/test/blueprint.yaml',
    basePath: 'test/builds',
    costSummary,
    createdAt: new Date(),
    persist: async () => {},
  };

  return { cachedPlan, plan };
}

describe('buildPlanResponse', () => {
  describe('layer counting', () => {
    it('counts only layers with jobs (filters empty layers)', () => {
      // Scenario: 5 layers total, but only layers 1 and 3 have jobs
      const layers: JobDescriptor[][] = [
        [], // Layer 0: empty (skipped)
        [createMockJob('job-1', 'Producer1')], // Layer 1: 1 job
        [], // Layer 2: empty (skipped)
        [createMockJob('job-2', 'Producer2')], // Layer 3: 1 job
        [], // Layer 4: empty (skipped)
      ];

      const { cachedPlan, plan } = createMockCachedPlan(layers);
      const response = buildPlanResponse(cachedPlan, plan);

      expect(response.layers).toBe(2); // Only 2 layers have jobs
      expect(response.layerBreakdown).toHaveLength(2);
      expect(response.totalJobs).toBe(2);
    });

    it('returns 0 layers when all layers are empty (NOOP scenario)', () => {
      // Scenario: Plan with 3 layers, but all are empty (already completed)
      const layers: JobDescriptor[][] = [
        [], // Empty
        [], // Empty
        [], // Empty
      ];

      const { cachedPlan, plan } = createMockCachedPlan(layers);
      const response = buildPlanResponse(cachedPlan, plan);

      expect(response.layers).toBe(0);
      expect(response.layerBreakdown).toHaveLength(0);
      expect(response.totalJobs).toBe(0);
    });

    it('returns 1 layer when only one layer has jobs', () => {
      // Scenario: User selected artifacts in layer 1, only layer 1 runs
      const layers: JobDescriptor[][] = [
        [], // Layer 0: skipped (already completed)
        [
          createMockJob('job-1', 'LipsyncProducer'),
          createMockJob('job-2', 'LipsyncProducer'),
          createMockJob('job-3', 'LipsyncProducer'),
        ], // Layer 1: 3 jobs
        [], // Layer 2: skipped
      ];

      const { cachedPlan, plan } = createMockCachedPlan(layers);
      const response = buildPlanResponse(cachedPlan, plan);

      expect(response.layers).toBe(1); // Only 1 layer will execute
      expect(response.layerBreakdown).toHaveLength(1);
      expect(response.layerBreakdown[0].jobCount).toBe(3);
      expect(response.totalJobs).toBe(3);
    });

    it('correctly handles consecutive layers with jobs', () => {
      // Scenario: Layers 0, 1, 2 all have jobs
      const layers: JobDescriptor[][] = [
        [createMockJob('job-0', 'ImageProducer')],
        [createMockJob('job-1', 'AudioProducer')],
        [createMockJob('job-2', 'VideoProducer')],
      ];

      const { cachedPlan, plan } = createMockCachedPlan(layers);
      const response = buildPlanResponse(cachedPlan, plan);

      expect(response.layers).toBe(3);
      expect(response.layerBreakdown).toHaveLength(3);
      expect(response.totalJobs).toBe(3);
    });

    it('preserves original layer indices in breakdown', () => {
      // Scenario: Only layers 2 and 4 have jobs
      const layers: JobDescriptor[][] = [
        [], // Layer 0: empty
        [], // Layer 1: empty
        [createMockJob('job-2', 'Producer2')], // Layer 2: 1 job
        [], // Layer 3: empty
        [createMockJob('job-4', 'Producer4')], // Layer 4: 1 job
      ];

      const { cachedPlan, plan } = createMockCachedPlan(layers);
      const response = buildPlanResponse(cachedPlan, plan);

      expect(response.layers).toBe(2);
      expect(response.layerBreakdown).toHaveLength(2);
      // Check that original indices are preserved
      expect(response.layerBreakdown[0].index).toBe(2);
      expect(response.layerBreakdown[1].index).toBe(4);
    });

    it('handles single layer with multiple jobs from same producer', () => {
      // Scenario: Surgical regeneration of 3 artifacts from same producer
      const layers: JobDescriptor[][] = [
        [], // Layer 0: skipped
        [
          createMockJob('job-1a', 'LipsyncVideoProducer'),
          createMockJob('job-1b', 'LipsyncVideoProducer'),
          createMockJob('job-1c', 'LipsyncVideoProducer'),
        ],
        [], // Layer 2: skipped
      ];

      const jobCosts = [
        createMockJobCost('job-1a', 1.40),
        createMockJobCost('job-1b', 1.40),
        createMockJobCost('job-1c', 1.40),
      ];

      const { cachedPlan, plan } = createMockCachedPlan(layers, jobCosts);
      const response = buildPlanResponse(cachedPlan, plan);

      expect(response.layers).toBe(1); // Only 1 layer
      expect(response.totalJobs).toBe(3); // 3 jobs
      expect(response.layerBreakdown[0].jobs).toHaveLength(3);
    });
  });

  describe('blueprintLayers (total layers for dropdown)', () => {
    it('returns blueprintLayers from plan regardless of empty layers', () => {
      const layers: JobDescriptor[][] = [
        [createMockJob('job-1', 'Producer1')],
        [], // Empty
      ];

      const { cachedPlan, plan } = createMockCachedPlan(layers);
      // Set blueprintLayerCount to 5 (total layers in blueprint)
      plan.blueprintLayerCount = 5;

      const response = buildPlanResponse(cachedPlan, plan);

      expect(response.layers).toBe(1); // Only 1 layer will execute
      expect(response.blueprintLayers).toBe(5); // Total blueprint layers unchanged
    });
  });

  describe('layer breakdown details', () => {
    it('calculates per-layer costs correctly', () => {
      const layers: JobDescriptor[][] = [
        [
          createMockJob('job-1', 'ImageProducer'),
          createMockJob('job-2', 'ImageProducer'),
        ],
      ];

      const jobCosts = [
        createMockJobCost('job-1', 0.50),
        createMockJobCost('job-2', 0.75),
      ];

      const { cachedPlan, plan } = createMockCachedPlan(layers, jobCosts);
      const response = buildPlanResponse(cachedPlan, plan);

      expect(response.layerBreakdown[0].layerCost).toBeCloseTo(1.25);
      expect(response.layerBreakdown[0].jobs[0].estimatedCost).toBeCloseTo(0.50);
      expect(response.layerBreakdown[0].jobs[1].estimatedCost).toBeCloseTo(0.75);
    });

    it('handles jobs without cost data', () => {
      const layers: JobDescriptor[][] = [
        [createMockJob('job-1', 'CustomProducer')],
      ];

      // No cost entries provided
      const { cachedPlan, plan } = createMockCachedPlan(layers, []);
      const response = buildPlanResponse(cachedPlan, plan);

      expect(response.layerBreakdown[0].jobs[0].estimatedCost).toBeUndefined();
      expect(response.layerBreakdown[0].layerCost).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('handles empty plan (no layers at all)', () => {
      const layers: JobDescriptor[][] = [];

      const { cachedPlan, plan } = createMockCachedPlan(layers);
      const response = buildPlanResponse(cachedPlan, plan);

      expect(response.layers).toBe(0);
      expect(response.layerBreakdown).toHaveLength(0);
      expect(response.totalJobs).toBe(0);
    });

    it('handles plan with many empty layers and one job', () => {
      // Scenario: Layer 9 has 1 job, all others empty
      const layers: JobDescriptor[][] = Array(10).fill([]);
      layers[9] = [createMockJob('job-9', 'FinalProducer')];

      const { cachedPlan, plan } = createMockCachedPlan(layers);
      const response = buildPlanResponse(cachedPlan, plan);

      expect(response.layers).toBe(1);
      expect(response.layerBreakdown).toHaveLength(1);
      expect(response.layerBreakdown[0].index).toBe(9);
      expect(response.totalJobs).toBe(1);
    });

    it('handles plan where first layer is empty', () => {
      const layers: JobDescriptor[][] = [
        [], // Layer 0: empty
        [createMockJob('job-1', 'Producer1')],
      ];

      const { cachedPlan, plan } = createMockCachedPlan(layers);
      const response = buildPlanResponse(cachedPlan, plan);

      expect(response.layers).toBe(1);
      expect(response.layerBreakdown[0].index).toBe(1);
    });

    it('handles plan where last layer is empty', () => {
      const layers: JobDescriptor[][] = [
        [createMockJob('job-0', 'Producer0')],
        [], // Layer 1: empty
      ];

      const { cachedPlan, plan } = createMockCachedPlan(layers);
      const response = buildPlanResponse(cachedPlan, plan);

      expect(response.layers).toBe(1);
      expect(response.layerBreakdown[0].index).toBe(0);
    });
  });

  describe('real-world scenarios', () => {
    it('surgical regeneration: select 1 artifact in middle layer', () => {
      // User selects 1 artifact in layer 2, layers 0-1 completed, layer 3+ depends
      const layers: JobDescriptor[][] = [
        [], // Layer 0: completed, skipped
        [], // Layer 1: completed, skipped
        [createMockJob('regen-job', 'ImageProducer')], // Layer 2: regenerate this
        [createMockJob('downstream-job', 'VideoProducer')], // Layer 3: downstream
      ];

      const { cachedPlan, plan } = createMockCachedPlan(layers);
      const response = buildPlanResponse(cachedPlan, plan);

      expect(response.layers).toBe(2); // Layers 2 and 3 will execute
      expect(response.totalJobs).toBe(2);
    });

    it('run up to layer: only first 2 layers', () => {
      // User runs "up to layer 1" on fresh blueprint
      const layers: JobDescriptor[][] = [
        [createMockJob('job-0', 'TextProducer')],
        [createMockJob('job-1', 'ImageProducer')],
        // Layers 2+ not included in plan
      ];

      const { cachedPlan, plan } = createMockCachedPlan(layers);
      plan.blueprintLayerCount = 4; // Blueprint has 4 layers total

      const response = buildPlanResponse(cachedPlan, plan);

      expect(response.layers).toBe(2); // 2 layers will execute
      expect(response.blueprintLayers).toBe(4); // Total in blueprint
    });

    it('re-run from layer: skip completed layers', () => {
      // User re-runs from layer 2
      const layers: JobDescriptor[][] = [
        [], // Layer 0: skipped (completed)
        [], // Layer 1: skipped (completed)
        [createMockJob('job-2', 'AudioProducer')],
        [createMockJob('job-3', 'VideoProducer')],
      ];

      const { cachedPlan, plan } = createMockCachedPlan(layers);
      const response = buildPlanResponse(cachedPlan, plan);

      expect(response.layers).toBe(2); // Layers 2 and 3
      expect(response.layerBreakdown[0].index).toBe(2);
      expect(response.layerBreakdown[1].index).toBe(3);
    });

    it('all layers already completed (NOOP)', () => {
      // User clicks run but everything is done
      const layers: JobDescriptor[][] = [
        [], // All layers empty = nothing to do
        [],
        [],
      ];

      const { cachedPlan, plan } = createMockCachedPlan(layers);
      const response = buildPlanResponse(cachedPlan, plan);

      expect(response.layers).toBe(0);
      expect(response.totalJobs).toBe(0);
      // This should trigger NOOP UI
    });
  });
});
