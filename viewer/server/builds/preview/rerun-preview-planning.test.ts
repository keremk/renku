import { beforeEach, describe, expect, it, vi } from 'vitest';

const generatePlanMock = vi.fn();
const {
  getProducerOptionsForCanonicalProducerIdMock,
  readLatestArtifactEventMock,
  setProducerOptionsForCanonicalProducerIdMock,
} = vi.hoisted(() => ({
  getProducerOptionsForCanonicalProducerIdMock: vi.fn(),
  readLatestArtifactEventMock: vi.fn(),
  setProducerOptionsForCanonicalProducerIdMock: vi.fn(),
}));

vi.mock('@gorenku/core', () => ({
  RuntimeErrorCode: {
    ARTIFACT_RESOLUTION_FAILED: 'R021',
    INVALID_INPUT_BINDING: 'R041',
    MISSING_REQUIRED_INPUT: 'R042',
    NO_PRODUCER_OPTIONS: 'R032',
    VIEWER_CONFIG_MISSING: 'R114',
    MODELS_PANE_DESCRIPTOR_MISSING_FOR_MODEL: 'R115',
  },
  buildArtifactOwnershipIndex: vi.fn(() => new Map()),
  buildProducerCatalog: vi.fn(() => ({})),
  buildProviderMetadata: vi.fn(async () => new Map()),
  copyLatestSucceededArtifactBlobsToMemory: vi.fn(async () => {}),
  convertArtifactOverridesToDrafts: vi.fn(() => []),
  copyEventsToMemory: vi.fn(async () => {}),
  copyRunArchivesToMemory: vi.fn(async () => {}),
  createEventLog: vi.fn(() => ({})),
  createLogger: vi.fn(() => ({})),
  createBuildStateService: vi.fn(() => ({})),
  createRuntimeError: vi.fn(
    (code: string, message: string, details?: Record<string, unknown>) =>
      Object.assign(new Error(message), { code, details })
  ),
  createMovieMetadataService: vi.fn(() => ({
    read: vi.fn(async () => ({
      blueprintPath: '/tmp/blueprint.yaml',
      lastInputsPath: '/tmp/inputs.yaml',
    })),
  })),
  createNotificationBus: vi.fn(() => ({
    complete: vi.fn(),
  })),
  createPlanningService: vi.fn(() => ({
    generatePlan: generatePlanMock,
  })),
  createProducerGraph: vi.fn(() => ({
    nodes: [],
    edges: [],
  })),
  createStorageContext: vi.fn(
    (config: { kind: string; basePath?: string; rootDir?: string }) => ({
      storageKind: config.kind,
      basePath: config.basePath ?? 'builds',
      storage: {
        readToUint8Array: vi.fn(async () => new Uint8Array()),
        write: vi.fn(async () => {}),
        fileExists: vi.fn(async () => false),
        directoryExists: vi.fn(async () => true),
        createDirectory: vi.fn(async () => {}),
        list: vi.fn(),
        readToString: vi.fn(async () => ''),
      },
      resolve: (...parts: string[]) => parts.join('/'),
    })
  ),
  executePlanWithConcurrency: vi.fn(async () => ({
    status: 'succeeded',
    jobs: [],
  })),
  expandBlueprintResolutionContext: vi.fn((context: unknown) => context),
  findLatestSucceededArtifactEvent: vi.fn(() => null),
  findSurgicalTargetLayer: vi.fn(() => 0),
  formatBlobFileName: vi.fn((hash: string) => hash),
  formatProducerScopedInputIdForCanonicalProducerId: vi.fn(
    (producerId: string, field: string) => `${producerId}.${field}`
  ),
  getProducerOptionsForCanonicalProducerId: getProducerOptionsForCanonicalProducerIdMock,
  initializeMovieStorage: vi.fn(async () => {}),
  injectAllSystemInputs: vi.fn((inputs: Record<string, unknown>) => inputs),
  isCanonicalArtifactId: vi.fn((id: string) => id.startsWith('Artifact:')),
  isCanonicalInputId: vi.fn((id: string) => id.startsWith('Input:')),
  loadInputs: vi.fn(async () => ({
    values: { 'Input:Prompt': 'test prompt' },
    providerOptions: new Map(),
    artifactOverrides: [],
  })),
  loadYamlBlueprintTree: vi.fn(async () => ({
    root: {
      id: 'MockBlueprint',
      namespacePath: [],
      document: {},
      children: new Map(),
    },
  })),
  persistArtifactOverrideBlobs: vi.fn(async (overrides: unknown[]) => overrides),
  prepareBlueprintResolutionContext: vi.fn(async () => ({})),
  readLlmInvocationSettings: vi.fn(async () => undefined),
  resolveBlobRefsToInputs: vi.fn(
    async (
      _storage: unknown,
      _movieId: string,
      inputs: Record<string, unknown>
    ) => inputs
  ),
  resolveMappingsForModel: vi.fn(() => ({
    Prompt: { field: 'prompt' },
  })),
  resolveMovieInputsPath: vi.fn(async () => '/tmp/inputs.yaml'),
  resolveStorageBasePathForBlueprint: vi.fn(() => 'viewer/builds'),
  setProducerOptionsForCanonicalProducerId: setProducerOptionsForCanonicalProducerIdMock,
  sliceExecutionPlanThroughLayer: vi.fn((plan: unknown) => plan),
}));

vi.mock('@gorenku/providers', () => ({
  createProviderProduce: vi.fn(),
  createProviderRegistry: vi.fn(),
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
  loadModelCatalog: vi.fn(async () => ({})),
  loadModelInputSchema: vi.fn(async () => undefined),
  loadPricingCatalog: vi.fn(async () => ({
    providers: new Map(),
  })),
  prepareProviderHandlers: vi.fn(),
}));

vi.mock('../../generation/config.js', () => ({
  getCatalogModelsDir: vi.fn(() => '/tmp/catalog/models'),
  requireCliConfig: vi.fn(async () => ({
    storage: { root: '/tmp/storage' },
    catalog: { root: '/tmp/catalog' },
  })),
}));

vi.mock('../artifact-edit-handler.js', () => ({
  readLatestArtifactEvent: readLatestArtifactEventMock,
}));

vi.mock('./input-override-resolver.js', () => ({
  resolveInputOverrideTargets: vi.fn(() => []),
}));

import { RuntimeErrorCode } from '@gorenku/core';
import { estimateRerunPreview } from './rerun-preview.js';

describe('estimateRerunPreview planning', () => {
  beforeEach(() => {
    readLatestArtifactEventMock.mockReset();
    readLatestArtifactEventMock.mockResolvedValue({
      producerJobId: 'Producer:SceneVideoProducer[0]',
      producerId: 'Producer:SceneVideoProducer',
      lastRevisionBy: 'producer',
      inputsHash: 'inputs-hash',
      output: {
        blob: {
          hash: 'artifact-blob',
          size: 4,
          mimeType: 'text/plain',
        },
      },
    });
    generatePlanMock.mockReset();
    getProducerOptionsForCanonicalProducerIdMock.mockReset();
    setProducerOptionsForCanonicalProducerIdMock.mockReset();
    getProducerOptionsForCanonicalProducerIdMock.mockReturnValue([
      {
        provider: 'fal-ai',
        model: 'veo3-fast',
        sdkMapping: {},
      },
    ]);
    generatePlanMock.mockResolvedValue({
      plan: {
        revision: 'rev-0001',
        baselineHash: 'hash',
        layers: [[]],
        createdAt: '2026-01-01T00:00:00.000Z',
        blueprintLayerCount: 1,
      },
      buildState: {
        revision: 'rev-0000',
        baseRevision: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        inputs: {},
        artifacts: {},
        timeline: {},
      },
      executionState: {
        inputHashes: new Map(),
        artifactHashes: new Map(),
      },
      resolvedInputs: {},
    });
  });

  it('forwards local fallback storage into surgical rerun preview planning', async () => {
    await estimateRerunPreview({
      blueprintFolder: '/tmp/blueprint-folder',
      movieId: 'movie-test',
      artifactId: 'Artifact:SceneVideoProducer.GeneratedVideo[0]',
      mode: 'edit',
      prompt: '',
    });

    expect(generatePlanMock).toHaveBeenCalledTimes(1);
    expect(generatePlanMock.mock.calls[0]?.[0]?.storage?.storageKind).toBe(
      'memory'
    );
    expect(
      generatePlanMock.mock.calls[0]?.[0]?.conditionFallbackStorage?.storageKind
    ).toBe('local');
    expect(generatePlanMock.mock.calls[0]?.[0]?.userControls).toEqual({
      surgical: {
        regenerateIds: ['Artifact:SceneVideoProducer.GeneratedVideo[0]'],
      },
    });
    expect(generatePlanMock.mock.calls[0]?.[0]?.surgicalRegenerationScope).toBe(
      'lineage-strict'
    );
  });

  it('uses canonical producerId instead of parsing producerJobId during rerun model overrides', async () => {
    await estimateRerunPreview({
      blueprintFolder: '/tmp/blueprint-folder',
      movieId: 'movie-test',
      artifactId: 'Artifact:SceneVideoProducer.GeneratedVideo[0]',
      mode: 'rerun',
      prompt: '',
      model: {
        provider: 'fal-ai',
        model: 'veo3-fast',
      },
    });

    expect(getProducerOptionsForCanonicalProducerIdMock).toHaveBeenCalledWith(
      expect.any(Map),
      'Producer:SceneVideoProducer'
    );
    expect(setProducerOptionsForCanonicalProducerIdMock).toHaveBeenCalledWith(
      expect.any(Map),
      'Producer:SceneVideoProducer',
      expect.any(Array)
    );
  });

  it('throws a Renku runtime error code when canonical producer ownership is missing', async () => {
    readLatestArtifactEventMock.mockResolvedValueOnce({
      producerJobId: 'Producer:SceneVideoProducer[0]',
      lastRevisionBy: 'producer',
      inputsHash: 'inputs-hash',
      output: {
        blob: {
          hash: 'artifact-blob',
          size: 4,
          mimeType: 'text/plain',
        },
      },
    });

    await expect(
      estimateRerunPreview({
        blueprintFolder: '/tmp/blueprint-folder',
        movieId: 'movie-test',
        artifactId: 'Artifact:SceneVideoProducer.GeneratedVideo[0]',
        mode: 'rerun',
        prompt: '',
      })
    ).rejects.toMatchObject({
      code: RuntimeErrorCode.ARTIFACT_RESOLUTION_FAILED,
    });
  });
});
