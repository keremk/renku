import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockRequest,
  createMockResponse,
  parseResponseJson,
} from './test-utils.js';

const generatePlanMock = vi.fn();

function createRuntimeError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

vi.mock('@gorenku/core', () => ({
  createStorageContext: vi.fn(() => ({
    storage: {},
    resolve: (...parts: string[]) => parts.join('/'),
  })),
  initializeMovieStorage: vi.fn(async () => {}),
  createBuildStateService: vi.fn(() => ({})),
  createEventLog: vi.fn(() => ({})),
  createPlanningService: vi.fn(() => ({
    generatePlan: generatePlanMock,
  })),
  createMovieMetadataService: vi.fn(() => ({
    merge: vi.fn(async () => {}),
  })),
  commitExecutionDraft: vi.fn(async () => ({
    planPath: 'runs/rev-0001-plan.json',
    targetRevision: 'rev-0001',
    plan: { revision: 'rev-0001', layers: [], createdAt: '2026-01-01T00:00:00.000Z' },
  })),
  resolveCurrentBuildContext: vi.fn(async () => ({
    currentBuildRevision: null,
    latestRunRevision: null,
    snapshotSourceRun: null,
  })),
  validatePreparedBlueprintTree: vi.fn(async () => ({
    context: { graph: { nodes: [], edges: [] } },
    validation: { valid: true, errors: [], warnings: [], issues: [] },
  })),
  loadYamlBlueprintTree: vi.fn(async () => ({
    root: { id: 'MockBlueprint', namespacePath: [], document: {}, children: new Map() },
  })),
  loadInputs: vi.fn(async () => ({
    values: { 'Input:Prompt': 'test' },
    providerOptions: new Map<string, unknown>(),
    artifactOverrides: [],
  })),
  buildProducerCatalog: vi.fn(() => ({})),
  isRenkuError: vi.fn(
    (error: unknown): error is { code?: string; message: string } =>
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      'code' in error
  ),
  createValidationError: vi.fn((code: string, message: string) =>
    createRuntimeError(code, message)
  ),
  ValidationErrorCode: {
    BLUEPRINT_VALIDATION_FAILED: 'V001',
  },
  isCanonicalProducerId: vi.fn((id: string) => id.startsWith('Producer:')),
  copyRunArchivesToMemory: vi.fn(async () => {}),
  copyPlansToMemory: vi.fn(async () => {}),
  copyEventsToMemory: vi.fn(async () => {}),
  copyBlobsFromMemoryToLocal: vi.fn(async () => {}),
  buildProviderMetadata: vi.fn(async (providerOptions: Map<string, unknown>) => providerOptions),
  convertArtifactOverridesToDrafts: vi.fn(() => []),
  persistArtifactOverrideBlobs: vi.fn(async () => []),
  deriveSurgicalInfoArray: vi.fn(() => []),
}));

vi.mock('@gorenku/providers', () => ({
  loadPricingCatalog: vi.fn(async () => ({ providers: new Map() })),
  estimatePlanCosts: vi.fn(() => ({
    jobs: [],
    byProducer: new Map(),
    totalCost: 0,
    hasPlaceholders: false,
    hasRanges: false,
    minTotalCost: 0,
    maxTotalCost: 0,
    missingProviders: [],
  })),
  loadModelCatalog: vi.fn(async () => undefined),
  loadModelInputSchema: vi.fn(async () => undefined),
}));

vi.mock('./config.js', () => ({
  requireCliConfig: vi.fn(async () => ({
    storage: { root: '/tmp/storage' },
    catalog: { root: '/tmp/catalog' },
  })),
  getCatalogModelsDir: vi.fn(() => undefined),
}));

vi.mock('./paths.js', () => ({
  resolveBlueprintPaths: vi.fn(async () => ({
    blueprintPath: '/tmp/blueprint.yaml',
    blueprintFolder: '/tmp',
    buildsFolder: '/tmp/builds',
    inputsPath: '/tmp/inputs.yaml',
  })),
  generateMovieId: vi.fn(() => 'movie-test'),
  normalizeMovieId: vi.fn((movieId: string) => movieId),
  resolveBuildInputsPath: vi.fn(async () => undefined),
}));

vi.mock('./recovery-prepass.js', () => ({
  recoverFailedArtifactsBeforePlanning: vi.fn(async () => ({
    checkedArtifactIds: [],
    recoveredArtifactIds: [],
    pendingArtifactIds: [],
    failedRecoveries: [],
  })),
}));

import { handleProducerSchedulingRequest } from './plan-handler.js';

function createCorePlanResult() {
  return {
    plan: {
      revision: 'rev-0001',
      baselineHash: 'hash',
      layers: [
        [
          {
            jobId: 'Producer:StoryboardImageProducer[0]',
            producer: 'StoryboardImageProducer',
            inputs: [],
            produces: [],
            provider: 'test-provider',
            providerModel: 'test-model',
            rateKey: 'test-rate',
          },
        ],
      ],
      createdAt: new Date().toISOString(),
      blueprintLayerCount: 4,
    },
    buildState: {
      revision: 'rev-0000',
      baseRevision: null,
      createdAt: new Date().toISOString(),
      inputs: {},
      artifacts: {},
      timeline: {},
    },
    baselineHash: null,
    executionState: {
      inputHashes: new Map(),
      artifactHashes: new Map(),
    },
    inputEvents: [],
    resolvedInputs: {},
    producerScheduling: [
      {
        producerId: 'Producer:StoryboardImageProducer',
        mode: 'capped',
        maxSelectableCount: 4,
        effectiveCountLimit: 2,
        scheduledCount: 2,
        scheduledJobCount: 2,
        upstreamProducerIds: ['Producer:CharacterImageProducer'],
        warnings: [],
      },
    ],
    warnings: [],
  };
}

describe('handleProducerSchedulingRequest integration', () => {
  beforeEach(() => {
    generatePlanMock.mockReset();
    generatePlanMock.mockImplementation(async (args: { userControls?: { scope?: { upToLayer?: number } } }) => {
      if (args.userControls?.scope?.upToLayer === undefined) {
        throw createRuntimeError(
          'R137',
          'Producer overrides leave required upstream artifacts unavailable: Producer:SceneVideoProducer requires Artifact:StoryboardImageProducer.ComposedImage[2]'
        );
      }
      return createCorePlanResult();
    });
  });

  it('returns scoped scheduling metadata and compatibility failure when full-scope planning would raise R137', async () => {
    const req = createMockRequest({
      blueprint: 'style-cartoon',
      producerId: 'Producer:StoryboardImageProducer',
      producerLayer: 2,
      planningControls: {
        scope: {
          producerDirectives: [
            { producerId: 'Producer:StoryboardImageProducer', count: 2 },
          ],
        },
      },
    });
    const res = createMockResponse();

    const handled = await handleProducerSchedulingRequest(req, res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    const response = parseResponseJson<{
      producerId: string;
      probeUpToLayer: number;
      compatibility: { ok: boolean; error?: { code?: string; message: string } };
    }>(res);

    expect(response.producerId).toBe('Producer:StoryboardImageProducer');
    expect(response.probeUpToLayer).toBe(2);
    expect(response.compatibility).toMatchObject({
      ok: false,
      error: {
        code: 'R137',
      },
    });

    expect(generatePlanMock).toHaveBeenCalledTimes(2);
    expect(generatePlanMock.mock.calls[0]?.[0]?.userControls?.scope?.upToLayer).toBe(2);
    expect(
      generatePlanMock.mock.calls[1]?.[0]?.userControls?.scope?.upToLayer
    ).toBeUndefined();
  });

  it('returns compatibility ok when full-scope planning controls are valid', async () => {
    const req = createMockRequest({
      blueprint: 'style-cartoon',
      producerId: 'Producer:StoryboardImageProducer',
      producerLayer: 2,
      planningControls: {
        scope: {
          upToLayer: 0,
          producerDirectives: [
            { producerId: 'Producer:StoryboardImageProducer', count: 2 },
          ],
        },
      },
    });
    const res = createMockResponse();

    const handled = await handleProducerSchedulingRequest(req, res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    const response = parseResponseJson<{ compatibility: { ok: boolean } }>(res);
    expect(response.compatibility).toEqual({ ok: true });

    expect(generatePlanMock).toHaveBeenCalledTimes(2);
    expect(generatePlanMock.mock.calls[0]?.[0]?.userControls?.scope?.upToLayer).toBe(2);
    expect(generatePlanMock.mock.calls[1]?.[0]?.userControls?.scope?.upToLayer).toBe(0);
  });
});
