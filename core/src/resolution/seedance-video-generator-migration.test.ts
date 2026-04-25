import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBuildStateService } from '../build-state.js';
import { createEventLog } from '../event-log.js';
import {
  createPlanningService,
  type GeneratePlanResult,
  type ProviderOptionEntry,
} from '../orchestration/planning-service.js';
import {
  createStorageContext,
  initializeMovieStorage,
} from '../storage.js';
import type {
  ProducerCatalog,
} from '../types.js';
import { CATALOG_ROOT } from '../../tests/catalog-paths.js';
import {
  expandBlueprintResolutionContext,
  loadBlueprintResolutionContext,
  normalizeBlueprintResolutionInputs,
} from './blueprint-resolution-context.js';

const SEEDANCE_BLUEPRINT_PATH = join(
  CATALOG_ROOT,
  'producers',
  'video',
  'seedance-video-generator',
  'seedance-video-generator.yaml'
);

describe('SeedanceVideoGenerator condition migration', () => {
  it('produces only text branch jobs for the Text workflow', async () => {
    const { result } = await createSeedancePlan(
      seedanceInputs({ workflow: 'Text' })
    );

    expect(scheduledProducerAliases(result)).toEqual([
      'TextClipProducer',
      'TextPromptCompiler',
    ]);
    expectScheduledJobsDoNotUseConditionalInputBindings(result);
  });

  it('produces only reference branch jobs for the Reference workflow', async () => {
    const { result } = await createSeedancePlan(
      seedanceInputs({ workflow: 'Reference' })
    );

    expect(scheduledProducerAliases(result)).toEqual([
      'ReferenceClipProducer',
      'ReferencePromptCompiler',
    ]);
    expectScheduledJobsDoNotUseConditionalInputBindings(result);
  });

  it('activates the StartEnd branch only when plain anchors are confirmed', async () => {
    const inactive = await createSeedancePlan(
      seedanceInputs({
        workflow: 'StartEnd',
        startEndAnchorsArePlain: false,
      })
    );
    expect(scheduledProducerAliases(inactive.result)).toEqual([]);

    const active = await createSeedancePlan(
      seedanceInputs({
        workflow: 'StartEnd',
        startEndAnchorsArePlain: true,
      })
    );
    expect(scheduledProducerAliases(active.result)).toEqual([
      'StartEndClipProducer',
      'StartEndPromptCompiler',
    ]);
    expectScheduledJobsDoNotUseConditionalInputBindings(active.result);
  });

  it('produces only multishot branch jobs for the MultiShot workflow', async () => {
    const { result } = await createSeedancePlan(
      seedanceInputs({ workflow: 'MultiShot' })
    );

    expect(scheduledProducerAliases(result)).toEqual([
      'MultiShotClipProducer',
      'MultiShotPromptCompiler',
    ]);
    expectScheduledJobsDoNotUseConditionalInputBindings(result);
  });

  it('keeps the public GeneratedVideo output routes explicitly conditional', async () => {
    const { canonical } = await createSeedancePlan(
      seedanceInputs({ workflow: 'Text' })
    );
    const generatedVideoRoutes = canonical.outputSourceBindings.filter(
      (binding) => binding.outputId === 'Output:GeneratedVideo'
    );

    expect(generatedVideoRoutes).toHaveLength(4);
    expect(generatedVideoRoutes.every((binding) => binding.conditions)).toBe(
      true
    );
    expect(generatedVideoRoutes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conditions: { when: 'Input:Workflow', is: 'Text' },
        }),
        expect.objectContaining({
          conditions: { when: 'Input:Workflow', is: 'Reference' },
        }),
        expect.objectContaining({
          conditions: {
            all: [
              { when: 'Input:Workflow', is: 'StartEnd' },
              { when: 'Input:StartEndAnchorsArePlain', is: true },
            ],
          },
        }),
        expect.objectContaining({
          conditions: { when: 'Input:Workflow', is: 'MultiShot' },
        }),
      ])
    );
  });
});

async function createSeedancePlan(inputValues: Record<string, unknown>) {
  const context = await loadBlueprintResolutionContext({
    blueprintPath: SEEDANCE_BLUEPRINT_PATH,
    catalogRoot: CATALOG_ROOT,
    schemaSource: { kind: 'producer-metadata' },
  });
  const canonicalInputs = normalizeBlueprintResolutionInputs(
    context,
    inputValues,
    { requireCanonicalIds: true }
  );
  const canonical = expandBlueprintResolutionContext(
    context,
    canonicalInputs
  ).canonical;
  const providerOptions = createSeedanceProviderOptions(canonical);
  const providerCatalog = createSeedanceProviderCatalog(canonical);
  const storage = createStorageContext({ kind: 'memory' });
  const movieId = `seedance-${String(inputValues['Input:Workflow'])}`;
  await initializeMovieStorage(storage, movieId);

  const service = createPlanningService();
  const result = await service.generatePlan({
    movieId,
    blueprintTree: context.root,
    inputValues,
    providerCatalog,
    providerOptions,
    resolutionContext: context,
    storage,
    buildStateService: createBuildStateService(storage),
    eventLog: createEventLog(storage),
  });

  return { canonical, result };
}

function seedanceInputs(args: {
  workflow: 'Text' | 'Reference' | 'StartEnd' | 'MultiShot';
  startEndAnchorsArePlain?: boolean;
}): Record<string, unknown> {
  return {
    'Input:Workflow': args.workflow,
    'Input:SceneIntent': 'A glass artist shaping molten color at a workbench.',
    'Input:CameraIntent': 'Slow dolly in with a steady medium close-up.',
    'Input:AudioIntent': 'Soft workshop ambience and gentle flame hiss.',
    'Input:EnvironmentAndStyle': 'Warm studio light, clean documentary texture.',
    'Input:EndFrameDescription': 'The finished glass piece cools on the table.',
    'Input:ShotBreakdown': 'Shot 1: gather glass. Shot 2: shape details.',
    'Input:ReferenceMediaInstructions':
      'Use the supplied stills for palette and material detail.',
    'Input:StartEndAnchorsArePlain': args.startEndAnchorsArePlain ?? false,
    'Input:UseNativeAudio': false,
    'Input:ReferenceImage1': 'blob://reference-image-1',
    'Input:ReferenceImage2': 'blob://reference-image-2',
    'Input:StartImage': 'blob://start-image',
    'Input:EndImage': 'blob://end-image',
    'Input:Duration': 5,
    'Input:Resolution': { width: 1280, height: 720 },
  };
}

function scheduledProducerAliases(result: GeneratePlanResult): string[] {
  return result.plan.layers
    .flat()
    .map((job) => job.producer)
    .sort();
}

function expectScheduledJobsDoNotUseConditionalInputBindings(
  result: GeneratePlanResult
): void {
  for (const job of result.plan.layers.flat()) {
    expect(job.context?.conditionalInputBindings).toBeUndefined();
  }
}

function createSeedanceProviderOptions(
  canonical: ReturnType<typeof expandBlueprintResolutionContext>['canonical']
): Map<string, ProviderOptionEntry> {
  return new Map(
    canonical.nodes
      .filter((node) => node.type === 'Producer')
      .map((node) => [
        node.producerAlias,
        {
          sdkMapping: node.producer?.sdkMapping as
            | ProviderOptionEntry['sdkMapping']
            | undefined,
          outputs: node.producer?.outputs as
            | ProviderOptionEntry['outputs']
            | undefined,
          selectionInputKeys: [],
          configInputPaths: [],
        },
      ])
  );
}

function createSeedanceProviderCatalog(
  canonical: ReturnType<typeof expandBlueprintResolutionContext>['canonical']
): ProducerCatalog {
  return Object.fromEntries(
    canonical.nodes
      .filter((node) => node.type === 'Producer')
      .map((node) => [
        node.producerAlias,
        {
          provider: 'fal-ai',
          providerModel: 'seedance-migration-test',
          rateKey: `seedance:${node.producerAlias}`,
        },
      ])
  );
}
